// Claude Code in print mode with `--output-format stream-json`.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Agent, HistoryTurn } from "../types";
import { contentText, createCliAgent, isObject, joinBlocks, type StreamParser } from "./cli-agent";

/** Read-only tools: the agent can look at the project but not edit files or run commands. */
const READ_ONLY_TOOLS = "Read,Grep,Glob";

export function buildClaudeArgs(options: { sessionId: string; resume: boolean }): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    READ_ONLY_TOOLS,
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    ...(options.resume ? ["--resume", options.sessionId] : ["--session-id", options.sessionId]),
  ];
}

export class ClaudeEventParser implements StreamParser {
  sessionId?: string;
  status = "Starting…";
  error?: string;
  settled = false;

  private blocks: string[] = [];
  private live = "";

  get text(): string {
    return joinBlocks([...this.blocks, this.live]);
  }

  handle(event: unknown): void {
    if (!isObject(event)) return;
    if (typeof event.session_id === "string") this.sessionId = event.session_id;
    switch (event.type) {
      case "system":
        if (event.subtype === "init") this.status = "Waiting for the model…";
        break;
      case "stream_event":
        this.onStreamEvent(event.event);
        break;
      case "assistant":
        if (isObject(event.message)) {
          this.live = "";
          const text = contentText(event.message.content);
          if (text.trim() !== "") this.blocks.push(text);
        }
        break;
      case "user":
        this.status = "Waiting for the model…";
        break;
      case "result":
        this.settled = true;
        if (event.is_error === true) {
          const errors = Array.isArray(event.errors) ? event.errors.filter((e) => typeof e === "string") : [];
          this.error =
            errors.join("\n") || (typeof event.result === "string" && event.result) || "Claude reported an error.";
        }
        break;
    }
  }

  private onStreamEvent(e: unknown): void {
    if (!isObject(e)) return;
    if (e.type === "content_block_start" && isObject(e.content_block)) {
      const block = e.content_block;
      if (block.type === "tool_use") this.status = `Running ${typeof block.name === "string" ? block.name : "tool"}…`;
      else if (block.type === "thinking") this.status = "Thinking…";
      else if (block.type === "text") this.live = "";
    } else if (e.type === "content_block_delta" && isObject(e.delta) && e.delta.type === "text_delta") {
      this.live += String(e.delta.text ?? "");
      this.status = "Writing…";
    }
  }
}

/** Turns a Claude Code session file into prompt/answer pairs. */
export function claudeHistoryTurns(records: unknown[]): HistoryTurn[] {
  const turns: { prompt: string; blocks: string[] }[] = [];
  for (const r of records) {
    if (!isObject(r) || r.isMeta === true || r.isSidechain === true || !isObject(r.message)) continue;
    const content = r.message.content;
    if (r.type === "user") {
      // Tool results are recorded as user messages; only text is a prompt.
      const prompt = contentText(content).trim();
      if (prompt !== "") turns.push({ prompt, blocks: [] });
    } else if (r.type === "assistant" && turns.length > 0) {
      const text = contentText(content);
      if (text.trim() !== "") turns[turns.length - 1].blocks.push(text);
    }
  }
  return turns.map((t) => ({ prompt: t.prompt, text: t.blocks.join("\n\n") }));
}

async function findClaudeSession(configDir: string, sessionId: string): Promise<string | undefined> {
  const projects = join(configDir, "projects");
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return undefined;
  }
  return dirs.map((d) => join(projects, d, `${sessionId}.jsonl`)).find((f) => existsSync(f));
}

export function createClaudeAgent(options: { command: string; env: NodeJS.ProcessEnv; configDir: string }): Agent {
  return createCliAgent({
    id: "claude",
    title: "Claude Code",
    command: options.command,
    env: options.env,
    pathPreference: "Claude CLI Path",
    presetSessionId: true,
    buildArgs: buildClaudeArgs,
    newParser: () => new ClaudeEventParser(),
    findSessionFile: (id) => findClaudeSession(options.configDir, id),
    historyTurns: claudeHistoryTurns,
  });
}
