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
import { useEffect, useRef, useState } from "react";
import { AGENT_CHOICES } from "../agents";
import { useProjects, useSessions } from "../hooks";
import { getPreferences } from "../preferences";
import { expandHome } from "../services/env";
import { sessionsForProject } from "../services/sessions";
import type { AgentId } from "../types";
import { ConversationView } from "./ConversationView";
import { ProjectForm } from "./ProjectForm";
import { ProjectSelector } from "./ProjectSelector";

const NEW_SESSION = "__new__";
const LAST_PROJECT_KEY = "lastProject";

export function PromptForm() {
  const { push } = useNavigation();
  const prefs = getPreferences();
  const { projects, isLoading: projectsLoading, fileError, filePath, addLocal } = useProjects();
  const { sessions, isLoading: sessionsLoading, remove, reload } = useSessions();

  const [agentId, setAgentId] = useState<AgentId>(prefs.defaultAgent ?? "pi");
  const [projectPath, setProjectPath] = useState<string>();
  const [sessionChoice, setSessionChoice] = useState(NEW_SESSION);
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState<string>();
  const promptRef = useRef<Form.TextArea>(null);

  const onConversationClosed = () => {
    reload();
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
  const projectSessions = project ? sessionsForProject(sessions, project.path, agentId) : [];

  // Default to continuing the latest session of the selected project.
  useEffect(() => {
    if (sessionsLoading) return;
    setSessionChoice(projectSessions[0]?.id ?? NEW_SESSION);
  }, [projectPath, agentId, sessionsLoading]);

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
      <ConversationView agentId={agentId} project={project} prompt={prompt} session={session} />,
      onConversationClosed,
    );
  };

  const openSelectedSession = async () => {
    const session = projectSessions.find((s) => s.id === sessionChoice);
    if (!project || !session) return;
    await LocalStorage.setItem(LAST_PROJECT_KEY, project.path);
    push(<ConversationView agentId={agentId} project={project} session={session} />, onConversationClosed);
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
      isLoading={projectsLoading || sessionsLoading}
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
      <Form.Dropdown
        id="agent"
        title="Agent"
        value={agentId}
        onChange={(v) => setAgentId(v as AgentId)}
        storeValue={false}
      >
        {AGENT_CHOICES.map((a) => (
          <Form.Dropdown.Item key={a.id} value={a.id} title={a.title} />
        ))}
      </Form.Dropdown>
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
