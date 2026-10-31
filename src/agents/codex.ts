// Codex CLI via `codex exec --json`.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Agent, HistoryTurn } from "../types";
import { contentText, createCliAgent, isObject, joinBlocks, type StreamParser } from "./cli-agent";

const BASE_ARGS = ["exec", "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"'];

/** Codex assigns the thread id itself, so a new conversation ignores `sessionId`. */
export function buildCodexArgs(options: { sessionId: string; resume: boolean }): string[] {
  return options.resume ? [...BASE_ARGS, "resume", options.sessionId, "-"] : [...BASE_ARGS, "-"];
}

export class CodexEventParser implements StreamParser {
  sessionId?: string;
  status = "Starting…";
  error?: string;
  settled = false;

  private blocks: string[] = [];

  get text(): string {
    return joinBlocks(this.blocks);
  }

  handle(event: unknown): void {
    if (!isObject(event)) return;
    switch (event.type) {
      case "thread.started":
        if (typeof event.thread_id === "string") this.sessionId = event.thread_id;
        break;
      case "turn.started":
        this.status = "Waiting for the model…";
        break;
      case "item.started":
        if (isObject(event.item) && event.item.type === "command_execution") {
          const command = String(event.item.command ?? "command");
          this.status = `Running ${command.length > 60 ? `${command.slice(0, 60)}…` : command}…`;
        }
        break;
      case "item.completed":
        // `error` items here are warnings (e.g. unknown config keys); the turn still runs.
        if (isObject(event.item) && event.item.type === "agent_message" && typeof event.item.text === "string") {
          this.blocks.push(event.item.text);
          this.status = "Waiting for the model…";
        }
        break;
      case "turn.completed":
        this.settled = true;
        break;
      case "turn.failed":
        this.settled = true;
        this.error =
          isObject(event.error) && typeof event.error.message === "string" ? event.error.message : "Codex failed.";
        break;
      case "error":
        if (typeof event.message === "string") this.error = event.message;
        break;
    }
  }
}

/** Turns a Codex rollout file into prompt/answer pairs. */
export function codexHistoryTurns(records: unknown[]): HistoryTurn[] {
  const turns: { prompt: string; blocks: string[] }[] = [];
  for (const r of records) {
    if (!isObject(r) || r.type !== "event_msg" || !isObject(r.payload)) continue;
    const item = r.payload.item;
    if (r.payload.type !== "item_completed" || !isObject(item)) continue;
    if (item.type === "UserMessage") {
      turns.push({ prompt: contentText(item.content).trim(), blocks: [] });
    } else if (item.type === "AgentMessage" && turns.length > 0) {
      const text = contentText(item.content, ["Text", "text"]);
      if (text.trim() !== "") turns[turns.length - 1].blocks.push(text);
    }
  }
  return turns.map((t) => ({ prompt: t.prompt, text: t.blocks.join("\n\n") }));
}

async function findCodexRollout(codexHome: string, threadId: string): Promise<string | undefined> {
  let files: string[];
  try {
    files = await readdir(join(codexHome, "sessions"), { recursive: true });
  } catch {
    return undefined;
  }
  const match = files.find((f) => f.endsWith(`-${threadId}.jsonl`));
  return match ? join(codexHome, "sessions", match) : undefined;
}

export function createCodexAgent(options: { command: string; env: NodeJS.ProcessEnv; codexHome: string }): Agent {
  return createCliAgent({
    id: "codex",
    title: "Codex",
    command: options.command,
    env: options.env,
    pathPreference: "Codex CLI Path",
    presetSessionId: false,
    buildArgs: buildCodexArgs,
    newParser: () => new CodexEventParser(),
    findSessionFile: (id) => findCodexRollout(options.codexHome, id),
    historyTurns: codexHistoryTurns,
  });
}
