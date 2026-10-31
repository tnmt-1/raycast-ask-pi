// Interprets Pi's `--mode json` event stream (see Pi docs: json.md).

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function buildPiArgs(options: { sessionId: string }): string[] {
  return [
    "--mode",
    "json",
    "--session-id",
    options.sessionId,
    "--model",
    "claude-code/claude-haiku-5-5",
    "--thinking",
    "low",
  ];
}

export function buildPiRpcArgs(options: { sessionId: string }): string[] {
  return ["--mode", "rpc", "--session-id", options.sessionId];
}

export function summarizeToolArgs(args: unknown): string {
  if (!isObject(args)) return "";
  const preferred = ["command", "path", "file_path", "pattern", "query", "url"];
  const key = preferred.find((k) => typeof args[k] === "string");
  const raw = key ? String(args[key]) : JSON.stringify(args);
  const flat = raw.replace(/\s*\n\s*/g, " ⏎ ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function textOf(message: Json): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is Json => isObject(c) && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

export class PiEventParser {
  sessionId?: string;
  status = "Starting…";
  error?: string;
  aborted = false;
  settled = false;

  private blocks: string[] = [];
  private streaming = new Map<number, string>();

  get text(): string {
    const live = [...this.streaming.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, t]) => t)
      .join("");
    return [...this.blocks, live].filter((b) => b.trim() !== "").join("\n\n");
  }

  handle(event: unknown): void {
    if (!isObject(event) || typeof event.type !== "string") return;
    switch (event.type) {
      case "session":
        if (typeof event.id === "string") this.sessionId = event.id;
        break;
      case "agent_start":
      case "turn_start":
        this.status = "Waiting for the model…";
        break;
      case "message_start":
        if (isObject(event.message) && event.message.role === "assistant") this.streaming.clear();
        break;
      case "message_update":
        this.onAssistantEvent(event.assistantMessageEvent);
        break;
      case "message_end":
        this.onMessageEnd(event.message);
        break;
      case "tool_execution_start":
        this.status = `Running ${typeof event.toolName === "string" ? event.toolName : "tool"}…`;
        break;
      case "tool_execution_end":
        this.status = "Waiting for the model…";
        break;
      case "compaction_start":
        this.status = "Compacting context…";
        break;
      case "auto_retry_start":
        this.status = `Retrying (${event.attempt}/${event.maxAttempts})…`;
        break;
      case "auto_retry_end":
        if (event.success === true) this.error = undefined;
        else if (typeof event.finalError === "string") this.error = event.finalError;
        break;
      case "agent_settled":
        this.settled = true;
        if (event.aborted === true) this.aborted = true;
        break;
    }
  }

  private onAssistantEvent(e: unknown): void {
    if (!isObject(e)) return;
    const index = typeof e.contentIndex === "number" ? e.contentIndex : 0;
    switch (e.type) {
      case "text_start":
        this.streaming.set(index, "");
        this.status = "Writing…";
        break;
      case "text_delta":
        this.streaming.set(index, (this.streaming.get(index) ?? "") + String(e.delta ?? ""));
        this.status = "Writing…";
        break;
      case "text_end":
        if (typeof e.content === "string") this.streaming.set(index, e.content);
        break;
      case "toolcall_start":
        this.status = `Preparing ${typeof e.toolName === "string" ? e.toolName : "tool"}…`;
        break;
    }
  }

  private onMessageEnd(message: unknown): void {
    if (!isObject(message) || message.role !== "assistant") return;
    this.streaming.clear();
    const text = textOf(message);
    if (text.trim() !== "") this.blocks.push(text);
    if (message.stopReason === "error") {
      this.error = typeof message.errorMessage === "string" ? message.errorMessage : "The agent reported an error.";
    } else if (message.stopReason === "aborted") {
      this.aborted = true;
    } else {
      this.error = undefined;
    }
  }
}

/** Turns Pi's `get_messages` result into prompt/answer pairs, in the same shape the live view renders. */
export function historyTurns(messages: unknown[]): { prompt: string; text: string }[] {
  const turns: { prompt: string; blocks: string[] }[] = [];
  for (const m of messages) {
    if (!isObject(m)) continue;
    if (m.role === "user") {
      turns.push({ prompt: textOf(m), blocks: [] });
    } else if (m.role === "assistant" && turns.length > 0 && Array.isArray(m.content)) {
      const blocks = turns[turns.length - 1].blocks;
      for (const c of m.content) {
        if (!isObject(c)) continue;
        if (c.type === "text" && typeof c.text === "string" && c.text.trim() !== "") blocks.push(c.text);
      }
    }
  }
  return turns.map((t) => ({ prompt: t.prompt, text: t.blocks.join("\n\n") }));
}
