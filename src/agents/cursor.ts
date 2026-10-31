// Cursor Agent CLI in print mode with `--output-format stream-json`.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Agent, HistoryTurn } from "../types";
import { contentText, createCliAgent, isObject, joinBlocks, type StreamParser } from "./cli-agent";

/** Ask mode is read-only. `auto` is the model available on every plan. Cursor assigns the chat id itself. */
export function buildCursorArgs(options: { sessionId: string; resume: boolean }): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--trust",
    "--mode",
    "ask",
    "--model",
    "auto",
    ...(options.resume ? ["--resume", options.sessionId] : []),
  ];
}

export class CursorEventParser implements StreamParser {
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
        this.status = "Waiting for the model…";
        break;
      case "thinking":
        this.status = "Thinking…";
        break;
      case "assistant": {
        if (!isObject(event.message)) break;
        const text = contentText(event.message.content);
        // A delta carries only a timestamp; the full text of a segment carries a model call id or no timestamp.
        const isDelta = typeof event.timestamp_ms === "number" && event.model_call_id === undefined;
        if (isDelta) {
          this.live += text;
          this.status = "Writing…";
        } else {
          this.live = "";
          if (text.trim() !== "") this.blocks.push(text);
        }
        break;
      }
      case "tool_call":
        if (event.subtype === "started" && isObject(event.tool_call)) {
          const key = Object.keys(event.tool_call)[0] ?? "tool";
          this.status = `Running ${key.replace(/ToolCall$/, "")}…`;
        } else {
          this.status = "Waiting for the model…";
        }
        break;
      case "result":
        this.settled = true;
        if (event.is_error === true) {
          this.error = typeof event.result === "string" && event.result ? event.result : "Cursor reported an error.";
        }
        break;
    }
  }
}

function unwrapQuery(text: string): string {
  const match = text.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/);
  return (match ? match[1] : text).trim();
}

/** Turns a Cursor agent transcript into prompt/answer pairs. */
export function cursorHistoryTurns(records: unknown[]): HistoryTurn[] {
  const turns: { prompt: string; blocks: string[] }[] = [];
  for (const r of records) {
    if (!isObject(r) || !isObject(r.message)) continue;
    const text = contentText(r.message.content);
    if (r.role === "user") {
      turns.push({ prompt: unwrapQuery(text), blocks: [] });
    } else if (r.role === "assistant" && turns.length > 0 && text.trim() !== "") {
      turns[turns.length - 1].blocks.push(text);
    }
  }
  return turns.map((t) => ({ prompt: t.prompt, text: t.blocks.join("\n\n") }));
}

async function findCursorTranscript(cursorHome: string, chatId: string): Promise<string | undefined> {
  const projects = join(cursorHome, "projects");
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return undefined;
  }
  return dirs.map((d) => join(projects, d, "agent-transcripts", chatId, `${chatId}.jsonl`)).find((f) => existsSync(f));
}

export function createCursorAgent(options: { command: string; env: NodeJS.ProcessEnv; cursorHome: string }): Agent {
  return createCliAgent({
    id: "cursor",
    title: "Cursor",
    command: options.command,
    env: options.env,
    pathPreference: "Cursor CLI Path",
    presetSessionId: false,
    buildArgs: buildCursorArgs,
    newParser: () => new CursorEventParser(),
    findSessionFile: (id) => findCursorTranscript(options.cursorHome, id),
    historyTurns: cursorHistoryTurns,
  });
}
