import { describe, expect, it } from "vitest";
import { PiEventParser, buildPiArgs, historyTurns, summarizeToolArgs } from "../src/agents/pi-events";

const assistantEnd = (text: string, stopReason = "stop", errorMessage?: string) => ({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason, errorMessage },
});

describe("buildPiArgs", () => {
  it("uses JSON mode and the given session id without putting the prompt in argv", () => {
    expect(buildPiArgs({ sessionId: "abc-123" })).toEqual([
      "--mode",
      "json",
      "--session-id",
      "abc-123",
      "--tools",
      "read,grep,find,ls,web_search,fetch_content",
      "--no-mcp",
    ]);
  });
});

describe("buildPiArgs read-only", () => {
  it("allows only read-only tools and disables MCP", () => {
    const args = buildPiArgs({ sessionId: "abc-123" });
    expect(args.join(" ")).toContain("--tools read,grep,find,ls,web_search,fetch_content");
    expect(args).toContain("--no-mcp");
  });
});

describe("buildPiArgs web tools", () => {
  it("allows web search and fetch but no tool that edits files or runs commands", () => {
    const args = buildPiArgs({ sessionId: "abc-123" });
    const tools = args[args.indexOf("--tools") + 1].split(",");
    expect(tools).toEqual(expect.arrayContaining(["web_search", "fetch_content"]));
    for (const t of ["edit", "write", "bash"]) expect(tools).not.toContain(t);
  });
});

describe("buildPiArgs model and thinking", () => {
  it("passes the model and thinking level when given", () => {
    const args = buildPiArgs({ sessionId: "s", model: "anthropic/claude-opus-4-8", thinking: "high" }).join(" ");
    expect(args).toContain("--model anthropic/claude-opus-4-8");
    expect(args).toContain("--thinking high");
  });

  it("leaves them to Pi when empty", () => {
    const args = buildPiArgs({ sessionId: "s", model: "", thinking: "" });
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--thinking");
  });
});

describe("summarizeToolArgs", () => {
  it("prefers command or path and flattens newlines", () => {
    expect(summarizeToolArgs({ command: "ls -la\npwd" })).toBe("ls -la ⏎ pwd");
    expect(summarizeToolArgs({ path: "src/a.ts" })).toBe("src/a.ts");
  });

  it("truncates long values", () => {
    expect(summarizeToolArgs({ command: "x".repeat(200) }).length).toBeLessThanOrEqual(81);
  });
});

describe("PiEventParser", () => {
  it("captures the session id from the header", () => {
    const p = new PiEventParser();
    p.handle({ type: "session", version: 3, id: "sid-1", cwd: "/tmp" });
    expect(p.sessionId).toBe("sid-1");
  });

  it("streams text deltas and replaces them with the final message", () => {
    const p = new PiEventParser();
    p.handle({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    p.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" } });
    p.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "lo" } });
    expect(p.text).toBe("Hello");
    p.handle(assistantEnd("Hello!"));
    expect(p.text).toBe("Hello!");
  });

  it("ignores user and system messages", () => {
    const p = new PiEventParser();
    p.handle({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "question" }] } });
    p.handle({ type: "message_end", message: { role: "system", content: "" } });
    expect(p.text).toBe("");
  });

  it("interleaves tool activity between assistant messages", () => {
    const p = new PiEventParser();
    p.handle(assistantEnd("Let me look."));
    p.handle({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
    expect(p.status).toBe("Running bash…");
    p.handle(assistantEnd("Done."));
    expect(p.text).toBe("Let me look.\n\nDone.");
  });

  it("ignores thinking in both the status and the text", () => {
    const p = new PiEventParser();
    p.handle({ type: "turn_start" });
    p.handle({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hmm" },
    });
    expect(p.status).toBe("Waiting for the model…");
    expect(p.text).toBe("");
  });

  it("records provider errors from the final assistant message", () => {
    const p = new PiEventParser();
    p.handle(assistantEnd("", "error", "429 rate limited"));
    expect(p.error).toBe("429 rate limited");
  });

  it("clears an error after a successful retry", () => {
    const p = new PiEventParser();
    p.handle(assistantEnd("", "error", "529 overloaded"));
    p.handle({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "529 overloaded" });
    expect(p.status).toBe("Retrying (1/3)…");
    p.handle({ type: "auto_retry_end", success: true, attempt: 2 });
    p.handle(assistantEnd("ok"));
    expect(p.error).toBeUndefined();
    expect(p.text).toBe("ok");
  });

  it("keeps the final retry error", () => {
    const p = new PiEventParser();
    p.handle({ type: "auto_retry_end", success: false, attempt: 3, finalError: "gave up" });
    expect(p.error).toBe("gave up");
  });

  it("marks aborted runs", () => {
    const p = new PiEventParser();
    p.handle(assistantEnd("partial", "aborted"));
    p.handle({ type: "agent_settled", aborted: true });
    expect(p.aborted).toBe(true);
    expect(p.settled).toBe(true);
  });

  it("ignores unknown or malformed events", () => {
    const p = new PiEventParser();
    p.handle(null);
    p.handle("text");
    p.handle({ type: "something_new" });
    expect(p.text).toBe("");
  });
});

describe("historyTurns", () => {
  it("pairs each user prompt with the assistant text and tool calls that follow it", () => {
    const turns = historyTurns([
      { role: "system", content: "" },
      { role: "user", content: [{ type: "text", text: "list files" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "Let me look." },
          { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
        ],
        stopReason: "toolUse",
      },
      { role: "toolResult", content: [{ type: "text", text: "a.ts" }] },
      { role: "assistant", content: [{ type: "text", text: "Found a.ts." }], stopReason: "stop" },
      { role: "user", content: "thanks" },
      { role: "assistant", content: [{ type: "text", text: "You're welcome." }], stopReason: "stop" },
    ]);
    expect(turns).toEqual([
      { prompt: "list files", text: "Let me look.\n\nFound a.ts." },
      { prompt: "thanks", text: "You're welcome." },
    ]);
  });

  it("ignores malformed entries", () => {
    expect(historyTurns([null, 1, { role: "assistant", content: [{ type: "text", text: "orphan" }] }])).toEqual([]);
  });
});
