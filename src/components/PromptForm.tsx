import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  LocalStorage,
  openExtensionPreferences,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { useProjects, useSessions } from "../hooks";
import { getPreferences } from "../preferences";
import { expandHome } from "../services/env";
import { modelChoices, readEnabledModels, THINKING_LEVELS } from "../services/pi-settings";
import { sessionsForProject } from "../services/sessions";
import type { AgentId } from "../types";
import { ConversationView } from "./ConversationView";
import { ProjectForm } from "./ProjectForm";
import { ProjectSelector } from "./ProjectSelector";

const NEW_SESSION = "__new__";
const LAST_PROJECT_KEY = "lastProject";
/** Dropdown value meaning "do not pass this option; let Pi decide". */
const PI_DEFAULT = "__pi_default__";
const AGENT_ID: AgentId = "pi";

export function PromptForm() {
  const { push } = useNavigation();
  const prefs = getPreferences();
  const { projects, isLoading: projectsLoading, fileError, filePath, addLocal } = useProjects();
  const { sessions, isLoading: sessionsLoading, remove, reload } = useSessions();

  const defaultModel = prefs.defaultModel?.trim() ?? "";
  const defaultThinking = prefs.defaultThinking?.trim() ?? "";
  const { data: enabledModels, isLoading: modelsLoading } = usePromise(readEnabledModels);
  const [model, setModel] = useState(defaultModel || PI_DEFAULT);
  const [thinking, setThinking] = useState(defaultThinking || PI_DEFAULT);
  const runOptions = {
    model: model === PI_DEFAULT ? undefined : model,
    thinking: thinking === PI_DEFAULT ? undefined : thinking,
  };
  const [projectPath, setProjectPath] = useState<string>();
  const [sessionChoice, setSessionChoice] = useState(NEW_SESSION);
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState<string>();
  const promptRef = useRef<Form.TextArea>(null);
  // Session last used in the conversation view, selected again when the user comes back.
  const lastSessionRef = useRef<string>(undefined);
  const onSessionUsed = (id: string) => {
    lastSessionRef.current = id;
  };

  const onConversationClosed = () => {
    reload();
    if (lastSessionRef.current) setSessionChoice(lastSessionRef.current);
    promptRef.current?.focus();
  };

  // Pick the initial project once the list is loaded: last used, then the preference, then the first one.
  useEffect(() => {
    if (projectsLoading || projectPath || projects.length === 0) return;
    LocalStorage.getItem<string>(LAST_PROJECT_KEY).then((last) => {
      const preferred = prefs.defaultProject ? expandHome(prefs.defaultProject.trim()).replace(/\/+$/, "") : undefined;
      const pick = [last, preferred].find((p) => p && projects.some((x) => x.path === p)) ?? projects[0].path;
      setProjectPath(pick);
    });
  }, [projectsLoading, projects]);

  const project = projects.find((p) => p.path === projectPath);
  const projectSessions = project ? sessionsForProject(sessions, project.path, AGENT_ID) : [];

  // Start a new session whenever the project changes.
  useEffect(() => {
    setSessionChoice(NEW_SESSION);
  }, [projectPath]);

  const submit = async () => {
    if (!project) return;
    if (prompt.trim() === "") {
      setPromptError("Enter a prompt");
      return;
    }
    await LocalStorage.setItem(LAST_PROJECT_KEY, project.path);
    const session = projectSessions.find((s) => s.id === sessionChoice);
    setPrompt("");
    push(
      <ConversationView
        agentId={AGENT_ID}
        {...runOptions}
        project={project}
        prompt={prompt}
        session={session}
        onSessionUsed={onSessionUsed}
      />,
      onConversationClosed,
    );
  };

  const openSelectedSession = async () => {
    const session = projectSessions.find((s) => s.id === sessionChoice);
    if (!project || !session) return;
    await LocalStorage.setItem(LAST_PROJECT_KEY, project.path);
    onSessionUsed(session.id);
    push(
      <ConversationView
        agentId={AGENT_ID}
        {...runOptions}
        project={project}
        session={session}
        onSessionUsed={onSessionUsed}
      />,
      onConversationClosed,
    );
  };

  const deleteSelectedSession = async () => {
    const session = projectSessions.find((s) => s.id === sessionChoice);
    if (!session) return;
    const ok = await confirmAlert({
      title: "Remove session from list?",
      message: `“${session.title}” is only removed from this extension. The Pi session file is kept.`,
      primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
    });
    if (ok) await remove(session.id);
  };

  if (!projectsLoading && projects.length === 0) {
    const hint = `You can also list projects in ${filePath}.`;
    return (
      <ProjectForm
        onboarding
        notice={fileError ? `${fileError.message}\n${hint}` : hint}
        onSave={async (p) => {
          await addLocal(p);
          setProjectPath(p.path);
        }}
      />
    );
  }

  return (
    <Form
      isLoading={projectsLoading || sessionsLoading || modelsLoading}
      navigationTitle="Ask Local Agent"
      actions={
        <ActionPanel>
          {project ? <Action.SubmitForm title="Run Agent" icon={Icon.Play} onSubmit={submit} /> : null}
          <Action.Push
            title="Add Project"
            icon={Icon.Plus}
            shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
            target={
              <ProjectForm
                onSave={async (p) => {
                  await addLocal(p);
                  setProjectPath(p.path);
                }}
              />
            }
          />
          {project ? (
            <Action
              title="New Session"
              icon={Icon.PlusCircle}
              shortcut={Keyboard.Shortcut.Common.New}
              onAction={() => setSessionChoice(NEW_SESSION)}
            />
          ) : null}
          {sessionChoice !== NEW_SESSION ? (
            <Action
              title="Open Session"
              icon={Icon.Bubble}
              shortcut={Keyboard.Shortcut.Common.Open}
              onAction={openSelectedSession}
            />
          ) : null}
          {sessionChoice !== NEW_SESSION ? (
            <Action
              title="Remove Session from List"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["ctrl"], key: "x" }}
              onAction={deleteSelectedSession}
            />
          ) : null}
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    >
      {fileError ? <Form.Description title="Projects file error" text={fileError.message} /> : null}
      {projects.length > 0 ? (
        <ProjectSelector projects={projects} value={projectPath} onChange={setProjectPath} />
      ) : null}
      {project ? (
        <Form.Dropdown
          id="session"
          title="Session"
          value={sessionChoice}
          onChange={setSessionChoice}
          storeValue={false}
        >
          <Form.Dropdown.Item value={NEW_SESSION} title="New session" icon={Icon.PlusCircle} />
          {projectSessions.map((s) => (
            <Form.Dropdown.Item key={s.id} value={s.id} title={s.title} keywords={[s.id]} icon={Icon.Bubble} />
          ))}
        </Form.Dropdown>
      ) : null}
      <Form.Dropdown
        id="model"
        title="Model"
        info="Models listed in enabledModels of Pi's settings.json."
        value={model}
        onChange={setModel}
        storeValue={false}
      >
        <Form.Dropdown.Item value={PI_DEFAULT} title="Pi default" icon={Icon.Gear} />
        {modelChoices(enabledModels ?? [], defaultModel).map((m) => (
          <Form.Dropdown.Item key={m} value={m} title={m} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="thinking" title="Thinking" value={thinking} onChange={setThinking} storeValue={false}>
        <Form.Dropdown.Item value={PI_DEFAULT} title="Pi default" icon={Icon.Gear} />
        {THINKING_LEVELS.map((t) => (
          <Form.Dropdown.Item key={t} value={t} title={t} />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="prompt"
        ref={promptRef}
        title="Prompt"
        placeholder="What should the agent do?"
        value={prompt}
        error={promptError}
        onChange={(v) => {
          setPrompt(v);
          setPromptError(undefined);
        }}
        autoFocus
      />
    </Form>
  );
}
