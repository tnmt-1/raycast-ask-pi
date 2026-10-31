import { Action, ActionPanel, Color, Icon, Image, Keyboard, List, showToast, Toast } from "@raycast/api";
import { randomUUID } from "node:crypto";
import { useEffect, useRef, useState } from "react";
import { createAgent } from "../agents";
import { saveSession } from "../hooks";
import { sessionTitle } from "../services/sessions";
import { buildTranscript, turnMarkdown, type Turn } from "../services/transcript";
import type { AgentId, Project, SessionRecord } from "../types";

interface Props {
  agentId: AgentId;
  /** Model and thinking level for every prompt in this view; omitted values use Pi's defaults. */
  model?: string;
  thinking?: string;
  project: Project;
  /** First prompt to send; when omitted, the view only shows the session. */
  prompt?: string;
  /** Existing session to continue; a new one is created when omitted. */
  session?: SessionRecord;
  /** Called with the session id each time a prompt is sent. */
  onSessionUsed?: (id: string) => void;
}

const UPDATE_INTERVAL_MS = 150;

const PHASE: Record<Turn["phase"], string> = {
  starting: "Starting",
  running: "Running",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

const PHASE_ICON: Record<Turn["phase"], Image.ImageLike> = {
  starting: { source: Icon.CircleProgress, tintColor: Color.Yellow },
  running: { source: Icon.CircleProgress, tintColor: Color.Yellow },
  done: { source: Icon.CheckCircle, tintColor: Color.Green },
  error: { source: Icon.XMarkCircle, tintColor: Color.Red },
  cancelled: { source: Icon.MinusCircle, tintColor: Color.SecondaryText },
};

export function ConversationView({ agentId, model, thinking, project, prompt, session, onSessionUsed }: Props) {
  const [sessionId, setSessionId] = useState(() => session?.id ?? randomUUID());
  const [continued, setContinued] = useState(session);
  const [turns, setTurns] = useState<Turn[]>([]);
  // Prompts and answers from before this view was opened, oldest first.
  const [history, setHistory] = useState<Turn[]>([]);
  const [historyLoading, setHistoryLoading] = useState(Boolean(session));
  const [draft, setDraft] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  // The selection is always controlled: the newest turn, unless the user picked an older one.
  const [pinnedId, setPinnedId] = useState<string>();
  const latestIdRef = useRef<string | undefined>(undefined);

  const current = turns.at(-1);
  const running = current?.phase === "starting" || current?.phase === "running";
  const latestId = turns.length > 0 ? `turn-${turns.length - 1}` : undefined;
  latestIdRef.current = latestId;
  const selectedId = pinnedId ?? latestId;

  async function send(text: string) {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const targetSession = sessionId;
    const updateLast = (patch: Partial<Turn>) =>
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, ...patch } : t)));
    setPinnedId(undefined);
    setTurns((prev) => [...prev, { prompt: text, text: "", phase: "starting", status: "Starting…" }]);
    const title = continued?.title ?? sessionTitle(turns[0]?.prompt ?? text);
    // Saved before running too, so the session is listed as soon as the user navigates back.
    const startedAt = Date.now();
    await saveSession({
      id: targetSession,
      agentId,
      projectPath: project.path,
      title,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    onSessionUsed?.(targetSession);

    const toast = await showToast({ style: Toast.Style.Animated, title: "Agent running", message: project.name });
    // Streaming emits an update per token; re-render at most every UPDATE_INTERVAL_MS.
    let pending: Partial<Turn> | undefined;
    let timer: NodeJS.Timeout | undefined;
    const result = await createAgent(agentId).run({
      cwd: project.path,
      prompt: text,
      sessionId: targetSession,
      model,
      thinking,
      signal: abort.signal,
      onUpdate: (u) => {
        pending = { phase: u.phase, text: u.text, status: u.status };
        timer ??= setTimeout(() => {
          timer = undefined;
          if (pending && mounted.current) updateLast(pending);
        }, UPDATE_INTERVAL_MS);
      },
    });
    clearTimeout(timer);
    const superseded = controller.current !== abort;
    if (!superseded) controller.current = null;

    // Keep the session even when the view was closed: Pi has already persisted the conversation.
    const now = Date.now();
    await saveSession({
      id: result.sessionId,
      agentId,
      projectPath: project.path,
      title,
      createdAt: now,
      updatedAt: now,
    });
    if (superseded) return;
    if (!mounted.current) {
      await toast.hide();
      return;
    }

    updateLast({ phase: result.status, text: result.text, error: result.error });
    if (result.status === "done") {
      toast.style = Toast.Style.Success;
      toast.title = "Done";
      toast.message = project.name;
    } else if (result.status === "cancelled") {
      toast.style = Toast.Style.Failure;
      toast.title = "Cancelled";
    } else {
      toast.style = Toast.Style.Failure;
      toast.title = "Agent failed";
      toast.message = result.error?.split("\n")[0];
    }
  }

  useEffect(() => {
    mounted.current = true;
    // Deferred so React's development double-mount (mount, unmount, mount) starts the first run only once.
    const start = setTimeout(async () => {
      // Load earlier turns before sending, so Pi does not append to the session while it is being read.
      if (session) await loadHistory(session.id);
      if (mounted.current && prompt) send(prompt);
    });
    return () => {
      clearTimeout(start);
      // Navigating back leaves the agent running; it saves the session when it finishes.
      mounted.current = false;
    };
  }, []);

  async function loadHistory(id: string) {
    try {
      const earlier = await createAgent(agentId).history({ cwd: project.path, sessionId: id });
      if (mounted.current) setHistory(earlier.map((t) => ({ ...t, phase: "done", status: "" })));
    } catch (err) {
      if (!mounted.current) return;
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not load earlier messages",
        message: err instanceof Error ? err.message.split("\n")[0] : String(err),
      });
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }

  const startNewSession = () => {
    setSessionId(randomUUID());
    setContinued(undefined);
    setTurns([]);
    setHistory([]);
    setPinnedId(undefined);
  };

  const submit = () => {
    if (running) {
      showToast({
        style: Toast.Style.Failure,
        title: "Agent is still running",
        message: "Wait for the answer or cancel with ⌃C",
      });
      return;
    }
    if (draft.trim() === "") return;
    const text = draft;
    setDraft("");
    send(text);
  };

  const sendAction = draft.trim() !== "" && <Action title="Send" icon={Icon.ArrowRight} onAction={submit} />;

  const actions = (turn?: Turn) => (
    <ActionPanel>
      {sendAction}
      {running ? (
        <Action
          title="Cancel"
          icon={Icon.Stop}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ["ctrl"], key: "c" }}
          onAction={() => controller.current?.abort()}
        />
      ) : null}
      {turn ? (
        <Action.CopyToClipboard title="Copy Answer" content={turn.text} shortcut={Keyboard.Shortcut.Common.Copy} />
      ) : null}
      {turn ? (
        <Action.CopyToClipboard
          title="Copy Prompt"
          content={turn.prompt}
          shortcut={Keyboard.Shortcut.Common.CopyName}
        />
      ) : null}
      <Action.CopyToClipboard
        title="Copy Conversation"
        content={buildTranscript([...history, ...turns])}
        shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
      />
      {!running && current ? (
        <Action
          title="Re-Run Last Prompt"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={() => send(current.prompt)}
        />
      ) : null}
      {!running ? (
        <Action
          title="Start New Session"
          icon={Icon.PlusCircle}
          shortcut={Keyboard.Shortcut.Common.New}
          onAction={startNewSession}
        />
      ) : null}
      <Action.CopyToClipboard
        title="Copy Session ID"
        content={sessionId}
        shortcut={{ modifiers: ["cmd", "opt"], key: "i" }}
      />
    </ActionPanel>
  );

  return (
    <List
      isShowingDetail={turns.length + history.length > 0}
      isLoading={running || historyLoading}
      filtering={false}
      searchText={draft}
      onSearchTextChange={setDraft}
      searchBarPlaceholder={
        running ? "Agent is running… (⌃C to cancel)" : turns.length === 0 ? "Ask the agent…" : "Ask a follow-up…"
      }
      navigationTitle={`${project.name}${current ? ` · ${PHASE[current.phase]}` : ""}`}
      selectedItemId={selectedId}
      onSelectionChange={(id) => {
        // Read the latest id from a ref: Raycast may call a handler from an earlier render.
        if (id) setPinnedId(id === latestIdRef.current ? undefined : id);
      }}
      actions={actions()}
    >
      {turns.length + history.length === 0 ? (
        <List.EmptyView
          icon={Icon.Message}
          title={historyLoading ? "Loading earlier messages…" : "New session"}
          description="Type a prompt in the search bar and press Enter."
        />
      ) : null}
      {/* Newest first: Raycast tends to reselect the first item when the list re-renders. */}
      <List.Section title={continued ? "This conversation" : undefined}>
        {turns
          .map((turn, i) => (
            <List.Item
              key={`turn-${i}`}
              id={`turn-${i}`}
              title={turn.prompt.split("\n")[0]}
              icon={PHASE_ICON[turn.phase]}
              detail={<List.Item.Detail markdown={turnMarkdown(turn)} />}
              actions={actions(turn)}
            />
          ))
          .reverse()}
      </List.Section>
      {history.length > 0 ? (
        <List.Section title={`Earlier in “${continued?.title ?? "this session"}”`}>
          {history
            .map((turn, i) => (
              <List.Item
                key={`history-${i}`}
                id={`history-${i}`}
                title={turn.prompt.split("\n")[0]}
                icon={{ source: Icon.Clock, tintColor: Color.SecondaryText }}
                detail={<List.Item.Detail markdown={turnMarkdown(turn)} />}
                actions={actions(turn)}
              />
            ))
            .reverse()}
        </List.Section>
      ) : null}
    </List>
  );
}
