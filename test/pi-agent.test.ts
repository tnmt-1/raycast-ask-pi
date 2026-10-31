import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPiAgent } from "../src/agents/pi";

function fakePi(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rla-pi-"));
  const file = join(dir, "pi");
  writeFileSync(
    file,
    `#!${process.execPath}
const emit = (e) => process.stdout.write(JSON.stringify(e) + "\\n");
const args = process.argv.slice(2);
const sid = args[args.indexOf("--session-id") + 1];
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
${body}
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

const ok = `
  emit({ type: "session", version: 3, id: sid, cwd: process.cwd() });
  emit({ type: "agent_start" });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "echo: " } });
  emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "echo: " + prompt }], stopReason: "stop" } });
  emit({ type: "agent_settled", aborted: false });
`;

describe("PiAgent", () => {
  it("runs the CLI and returns the final answer with the session id", async () => {
    const agent = createPiAgent({ command: fakePi(ok), env: {} });
    const updates: string[] = [];
    const result = await agent.run({
      cwd: tmpdir(),
      prompt: "# 見出し\n```\ncode\n```",
      sessionId: "s-1",
      onUpdate: (u) => updates.push(u.text),
    });
    expect(result).toMatchObject({ status: "done", sessionId: "s-1", text: "echo: # 見出し\n```\ncode\n```" });
    expect(updates).toContain("echo: ");
  });

  it("reports agent errors from the event stream", async () => {
    const body = `
      emit({ type: "session", id: sid });
      emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "No API key" } });
      emit({ type: "agent_settled", aborted: false });
    `;
    const result = await createPiAgent({ command: fakePi(body), env: {} }).run({
      cwd: tmpdir(),
      prompt: "x",
      sessionId: "s-2",
      onUpdate: () => {},
    });
    expect(result.status).toBe("error");
    expect(result.error).toBe("No API key");
  });

  it("reports a non-zero exit with stderr", async () => {
    const body = `process.stderr.write("Error: Model not found\\n"); process.exit(1);`;
    const result = await createPiAgent({ command: fakePi(body), env: {} }).run({
      cwd: tmpdir(),
      prompt: "x",
      sessionId: "s-3",
      onUpdate: () => {},
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Model not found");
  });

  it("returns cancelled with partial text when aborted", async () => {
    const body = `
      emit({ type: "session", id: sid });
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "partial" } });
      setInterval(() => {}, 1000);
    `;
    const controller = new AbortController();
    const result = await createPiAgent({ command: fakePi(body), env: {} }).run({
      cwd: tmpdir(),
      prompt: "x",
      sessionId: "s-4",
      signal: controller.signal,
      onUpdate: (u) => {
        if (u.text === "partial") controller.abort();
      },
    });
    expect(result.status).toBe("cancelled");
    expect(result.text).toBe("partial");
  });

  it("explains how to fix a missing CLI", async () => {
    const result = await createPiAgent({ command: "/nonexistent/pi", env: {} }).run({
      cwd: tmpdir(),
      prompt: "x",
      sessionId: "s-5",
      onUpdate: () => {},
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Pi CLI Path/);
  });

  it("loads earlier turns through RPC get_messages without sending a prompt", async () => {
    const body = `
      const cmd = JSON.parse(prompt.trim());
      emit({ type: "extension_ui_request", id: "x" });
      emit({
        type: "response", id: cmd.id, command: cmd.type, success: true,
        data: { messages: [
          { role: "user", content: [{ type: "text", text: args.join(" ") }] },
          { role: "assistant", content: [{ type: "text", text: "A1" }], stopReason: "stop" },
        ] },
      });
    `;
    const turns = await createPiAgent({ command: fakePi(body), env: {} }).history({ cwd: tmpdir(), sessionId: "s-6" });
    expect(turns).toEqual([{ prompt: "--mode rpc --session-id s-6", text: "A1" }]);
  });

  it("fails loading history when RPC reports an error", async () => {
    const body = `
      const cmd = JSON.parse(prompt.trim());
      emit({ type: "response", id: cmd.id, command: cmd.type, success: false, error: "boom" });
    `;
    await expect(
      createPiAgent({ command: fakePi(body), env: {} }).history({ cwd: tmpdir(), sessionId: "s-7" }),
    ).rejects.toThrow("boom");
  });
});

describe("PiAgent model selection", () => {
  it("passes the requested model and thinking level to the CLI", async () => {
    const body = `
      emit({ type: "session", id: sid });
      emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: args.join(" ") }], stopReason: "stop" } });
      emit({ type: "agent_settled", aborted: false });
    `;
    const result = await createPiAgent({ command: fakePi(body), env: {} }).run({
      cwd: tmpdir(),
      prompt: "x",
      sessionId: "s-8",
      model: "p/m",
      thinking: "max",
      onUpdate: () => {},
    });
    expect(result.text).toContain("--model p/m");
    expect(result.text).toContain("--thinking max");
  });
});
