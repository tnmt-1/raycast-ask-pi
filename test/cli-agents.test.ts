import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClaudeEventParser, buildClaudeArgs, claudeHistoryTurns, createClaudeAgent } from "../src/agents/claude";
import { CodexEventParser, buildCodexArgs, codexHistoryTurns, createCodexAgent } from "../src/agents/codex";
import { CursorEventParser, buildCursorArgs, createCursorAgent, cursorHistoryTurns } from "../src/agents/cursor";
import type { Agent } from "../src/types";
import { fakeCli, tempDir, writeJsonl } from "./fake-cli";

const feed = (parser: { handle(e: unknown): void }, events: unknown[]) => events.forEach((e) => parser.handle(e));

describe("buildClaudeArgs", () => {
  it("starts a new session with the given id and only read-only tools", () => {
    const args = buildClaudeArgs({ sessionId: "s1", resume: false });
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "stream-json", "--verbose"]));
    expect(args.join(" ")).toContain("--session-id s1");
    expect(args.join(" ")).toContain("--tools Read,Grep,Glob");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--resume");
  });

  it("resumes an existing session", () => {
    const args = buildClaudeArgs({ sessionId: "s1", resume: true });
    expect(args.join(" ")).toContain("--resume s1");
    expect(args).not.toContain("--session-id");
  });
});

describe("ClaudeEventParser", () => {
  it("streams text deltas and keeps finished blocks", () => {
    const p = new ClaudeEventParser();
    feed(p, [
      { type: "system", subtype: "init", session_id: "abc" },
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      },
    ]);
    expect(p.sessionId).toBe("abc");
    expect(p.text).toBe("Hel");
    feed(p, [
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "Read" } },
      },
    ]);
    expect(p.status).toBe("Running Read…");
    feed(p, [{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }]);
    expect(p.text).toBe("Hello\n\nDone");
  });

  it("reports an error result", () => {
    const p = new ClaudeEventParser();
    feed(p, [{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found"] }]);
    expect(p.error).toBe("No conversation found");
    expect(p.settled).toBe(true);
  });
});

describe("claudeHistoryTurns", () => {
  it("pairs real user prompts with assistant text, skipping meta, sidechain and tool results", () => {
    const turns = claudeHistoryTurns([
      { type: "queue-operation" },
      { type: "user", message: { role: "user", content: "Q1\n" } },
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: "A1" }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
      { type: "user", isMeta: true, message: { content: "meta" } },
      { type: "user", isSidechain: true, message: { content: "side" } },
      { type: "assistant", message: { content: [{ type: "text", text: "A2" }] } },
      { type: "user", message: { content: [{ type: "text", text: "Q2" }] } },
    ]);
    expect(turns).toEqual([
      { prompt: "Q1", text: "A1\n\nA2" },
      { prompt: "Q2", text: "" },
    ]);
  });
});

describe("buildCodexArgs", () => {
  it("runs exec in a read-only sandbox and reads the prompt from stdin", () => {
    expect(buildCodexArgs({ sessionId: "ignored", resume: false })).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="read-only"',
      "-",
    ]);
  });

  it("resumes by thread id", () => {
    expect(buildCodexArgs({ sessionId: "t1", resume: true })).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="read-only"',
      "resume",
      "t1",
      "-",
    ]);
  });
});

describe("CodexEventParser", () => {
  it("collects agent messages and ignores config warnings", () => {
    const p = new CodexEventParser();
    feed(p, [
      { type: "thread.started", thread_id: "t1" },
      { type: "item.completed", item: { type: "error", message: "ignoring setting" } },
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "Looking" } },
      { type: "item.started", item: { type: "command_execution", command: "ls" } },
    ]);
    expect(p.sessionId).toBe("t1");
    expect(p.status).toBe("Running ls…");
    expect(p.error).toBeUndefined();
    feed(p, [
      { type: "item.completed", item: { type: "agent_message", text: "Found it" } },
      { type: "turn.completed" },
    ]);
    expect(p.text).toBe("Looking\n\nFound it");
    expect(p.settled).toBe(true);
  });

  it("reports a failed turn", () => {
    const p = new CodexEventParser();
    feed(p, [{ type: "turn.failed", error: { message: "rate limited" } }]);
    expect(p.error).toBe("rate limited");
  });
});

describe("codexHistoryTurns", () => {
  it("reads user and agent items from the rollout", () => {
    const turns = codexHistoryTurns([
      { type: "session_meta", payload: {} },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md" }] },
      },
      {
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Q1\n" }] } },
      },
      {
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "Text", text: "A1" }] } },
      },
      {
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "Text", text: "A2" }] } },
      },
    ]);
    expect(turns).toEqual([{ prompt: "Q1", text: "A1\n\nA2" }]);
  });
});

describe("buildCursorArgs", () => {
  it("runs in ask mode with the auto model", () => {
    const args = buildCursorArgs({ sessionId: "ignored", resume: false });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--trust",
      "--mode",
      "ask",
      "--model",
      "auto",
    ]);
  });

  it("resumes by chat id", () => {
    expect(buildCursorArgs({ sessionId: "c1", resume: true }).slice(-2)).toEqual(["--resume", "c1"]);
  });
});

describe("CursorEventParser", () => {
  it("replaces streamed deltas with the final text of each segment", () => {
    const p = new CursorEventParser();
    const msg = (text: string, extra: object) => ({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
      ...extra,
    });
    feed(p, [
      { type: "system", subtype: "init", session_id: "c1" },
      msg("One", { timestamp_ms: 1 }),
      msg(" short", { timestamp_ms: 2 }),
    ]);
    expect(p.sessionId).toBe("c1");
    expect(p.text).toBe("One short");
    feed(p, [
      msg("One short.", { timestamp_ms: 3, model_call_id: "m" }),
      { type: "tool_call", subtype: "started", tool_call: { readToolCall: { args: { path: "a.txt" } } } },
    ]);
    expect(p.status).toBe("Running read…");
    feed(p, [
      msg("hello", { timestamp_ms: 4 }),
      msg("hello", {}),
      { type: "result", subtype: "success", is_error: false },
    ]);
    expect(p.text).toBe("One short.\n\nhello");
    expect(p.settled).toBe(true);
  });

  it("reports an error result", () => {
    const p = new CursorEventParser();
    feed(p, [{ type: "result", subtype: "error", is_error: true, result: "Model unavailable" }]);
    expect(p.error).toBe("Model unavailable");
  });
});

describe("cursorHistoryTurns", () => {
  it("unwraps the user query and joins assistant text", () => {
    const turns = cursorHistoryTurns([
      {
        role: "user",
        message: {
          content: [{ type: "text", text: "<timestamp>Sunday</timestamp>\n<user_query>\nQ1\n</user_query>" }],
        },
      },
      { role: "assistant", message: { content: [{ type: "text", text: "A1" }] } },
      { type: "turn_ended", status: "success" },
      { role: "user", message: { content: [{ type: "text", text: "plain" }] } },
    ]);
    expect(turns).toEqual([
      { prompt: "Q1", text: "A1" },
      { prompt: "plain", text: "" },
    ]);
  });
});

const run = (agent: Agent, sessionId: string, resume: boolean) =>
  agent.run({ cwd: tmpdir(), prompt: "hello", sessionId, resume, onUpdate: () => {} });

describe("CLI agents", () => {
  it("Claude streams the answer and returns the session id from init", async () => {
    const cli = fakeCli(
      "claude",
      `
      const sid = args[args.indexOf("--session-id") + 1];
      emit({ type: "system", subtype: "init", session_id: sid });
      emit({ type: "assistant", message: { content: [{ type: "text", text: "echo: " + prompt }] } });
      emit({ type: "result", subtype: "success", is_error: false, session_id: sid });
    `,
    );
    const agent = createClaudeAgent({ command: cli, env: {}, configDir: tempDir("rla-claude-home-") });
    expect(agent.presetSessionId).toBe(true);
    expect(await run(agent, "s1", false)).toMatchObject({ status: "done", text: "echo: hello", sessionId: "s1" });
  });

  it("Claude reports a resume failure", async () => {
    const cli = fakeCli(
      "claude",
      `process.stderr.write("No conversation found\\n");
       emit({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found"] });
       process.exit(1);`,
    );
    const result = await run(createClaudeAgent({ command: cli, env: {}, configDir: tmpdir() }), "s1", true);
    expect(result).toMatchObject({ status: "error", error: "No conversation found" });
  });

  it("Codex returns the thread id it assigned and announces it while running", async () => {
    const cli = fakeCli(
      "codex",
      `
      emit({ type: "thread.started", thread_id: "t-new" });
      emit({ type: "item.completed", item: { type: "agent_message", text: args.join(" ") + " | " + prompt } });
      emit({ type: "turn.completed" });
    `,
    );
    const ids: (string | undefined)[] = [];
    const agent = createCodexAgent({ command: cli, env: {}, codexHome: tmpdir() });
    expect(agent.presetSessionId).toBe(false);
    const result = await agent.run({
      cwd: tmpdir(),
      prompt: "hello",
      sessionId: "t-old",
      resume: true,
      onUpdate: (u) => ids.push(u.sessionId),
    });
    expect(result).toMatchObject({ status: "done", sessionId: "t-new" });
    expect(result.text).toContain("resume t-old -");
    expect(result.text).toContain("| hello");
    expect(ids).toContain("t-new");
  });

  it("Codex surfaces stderr when it exits with an error", async () => {
    const cli = fakeCli("codex", `process.stderr.write("Error: no rollout found\\n"); process.exit(1);`);
    const result = await run(createCodexAgent({ command: cli, env: {}, codexHome: tmpdir() }), "t1", true);
    expect(result.status).toBe("error");
    expect(result.error).toContain("no rollout found");
  });

  it("Cursor explains how to fix a missing CLI", async () => {
    const result = await run(
      createCursorAgent({ command: "/nonexistent/agent", env: {}, cursorHome: tmpdir() }),
      "c",
      false,
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Cursor CLI Path/);
  });

  it("Cursor cancels with partial text", async () => {
    const cli = fakeCli(
      "cursor",
      `emit({ type: "system", subtype: "init", session_id: "c1" });
       emit({ type: "assistant", message: { content: [{ type: "text", text: "partial" }] }, timestamp_ms: 1 });
       setInterval(() => {}, 1000);`,
    );
    const controller = new AbortController();
    const result = await createCursorAgent({ command: cli, env: {}, cursorHome: tmpdir() }).run({
      cwd: tmpdir(),
      prompt: "x",
      sessionId: "c0",
      resume: false,
      signal: controller.signal,
      onUpdate: (u) => {
        if (u.text === "partial") controller.abort();
      },
    });
    expect(result).toMatchObject({ status: "cancelled", text: "partial", sessionId: "c1" });
  });
});

describe("CLI agent history", () => {
  it("Claude finds the session file in any project directory", async () => {
    const home = tempDir("rla-claude-");
    writeJsonl(join(home, "projects", "-some-project", "s1.jsonl"), [
      { type: "user", message: { content: "Q" } },
      { type: "assistant", message: { content: [{ type: "text", text: "A" }] } },
    ]);
    const agent = createClaudeAgent({ command: "claude", env: {}, configDir: home });
    expect(await agent.history({ cwd: tmpdir(), sessionId: "s1" })).toEqual([{ prompt: "Q", text: "A" }]);
  });

  it("Codex finds the rollout by thread id", async () => {
    const home = tempDir("rla-codex-");
    writeJsonl(join(home, "sessions", "2026", "11", "01", "rollout-2026-11-01T06-26-03-t1.jsonl"), [
      {
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Q" }] } },
      },
      {
        type: "event_msg",
        payload: { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "Text", text: "A" }] } },
      },
    ]);
    const agent = createCodexAgent({ command: "codex", env: {}, codexHome: home });
    expect(await agent.history({ cwd: tmpdir(), sessionId: "t1" })).toEqual([{ prompt: "Q", text: "A" }]);
  });

  it("Cursor finds the transcript by chat id", async () => {
    const home = tempDir("rla-cursor-");
    writeJsonl(join(home, "projects", "some-project", "agent-transcripts", "c1", "c1.jsonl"), [
      { role: "user", message: { content: [{ type: "text", text: "<user_query>\nQ\n</user_query>" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "A" }] } },
    ]);
    const agent = createCursorAgent({ command: "agent", env: {}, cursorHome: home });
    expect(await agent.history({ cwd: tmpdir(), sessionId: "c1" })).toEqual([{ prompt: "Q", text: "A" }]);
  });

  it("fails with a clear message when the session file is missing", async () => {
    const agent = createCodexAgent({ command: "codex", env: {}, codexHome: tempDir("rla-codex-") });
    await expect(agent.history({ cwd: tmpdir(), sessionId: "nope" })).rejects.toThrow(/nope/);
  });
});
