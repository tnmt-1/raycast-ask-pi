export type AgentId = "pi" | "claude" | "codex" | "cursor";

export interface Project {
  name: string;
  path: string;
  source: "file" | "local";
}

export interface SessionRecord {
  id: string;
  agentId: AgentId;
  projectPath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type RunPhase = "starting" | "running" | "done" | "error" | "cancelled";

export interface RunUpdate {
  phase: RunPhase;
  text: string;
  status: string;
  /** Set once the agent has reported the id it uses for this conversation. */
  sessionId?: string;
}

export interface RunRequest {
  cwd: string;
  prompt: string;
  sessionId: string;
  /** True when `sessionId` names a conversation the agent already has; false starts a new one. */
  resume: boolean;
  signal?: AbortSignal;
  onUpdate: (update: RunUpdate) => void;
}

export interface RunResult {
  status: "done" | "error" | "cancelled";
  text: string;
  /** Undefined when the agent never created a conversation (e.g. it failed to start). */
  sessionId?: string;
  error?: string;
}

export interface HistoryTurn {
  prompt: string;
  text: string;
}

export interface Agent {
  id: AgentId;
  title: string;
  /** True when the agent uses the `sessionId` it is given for a new conversation; false when it assigns its own. */
  presetSessionId: boolean;
  run(request: RunRequest): Promise<RunResult>;
  /** Earlier prompts and answers of a session, oldest first. */
  history(request: { cwd: string; sessionId: string; signal?: AbortSignal }): Promise<HistoryTurn[]>;
}
