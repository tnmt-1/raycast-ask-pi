import type { AgentId, SessionRecord } from "../types";

export function sessionsForProject(all: SessionRecord[], projectPath: string, agentId: AgentId): SessionRecord[] {
  return all
    .filter((s) => s.projectPath === projectPath && s.agentId === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function upsertSession(all: SessionRecord[], record: SessionRecord): SessionRecord[] {
  const existing = all.find((s) => s.id === record.id);
  if (!existing) return [...all, record];
  return all.map((s) => (s.id === record.id ? { ...record, title: existing.title, createdAt: existing.createdAt } : s));
}

export function removeSession(all: SessionRecord[], id: string): SessionRecord[] {
  return all.filter((s) => s.id !== id);
}

export function sessionTitle(prompt: string): string {
  const line = prompt
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  return line ? line.slice(0, 60) : "Untitled";
}
