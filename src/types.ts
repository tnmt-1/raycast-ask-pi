export type AgentId = "pi";

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
}

export interface RunRequest {
  cwd: string;
  prompt: string;
  sessionId: string;
  /** Model pattern such as "provider/id"; empty or omitted uses the agent's default. */
  model?: string;
  /** Thinking level; empty or omitted uses the agent's default. */
  thinking?: string;
  signal?: AbortSignal;
  onUpdate: (update: RunUpdate) => void;
}

export interface RunResult {
  status: "done" | "error" | "cancelled";
  text: string;
  sessionId: string;
  error?: string;
}

export interface HistoryTurn {
  prompt: string;
  text: string;
}

export interface Agent {
  id: AgentId;
  title: string;
  run(request: RunRequest): Promise<RunResult>;
  /** Earlier prompts and answers of a session, oldest first. */
  history(request: { cwd: string; sessionId: string; signal?: AbortSignal }): Promise<HistoryTurn[]>;
}
