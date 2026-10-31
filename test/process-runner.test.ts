import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLineSplitter, runProcess } from "../src/services/process-runner";

describe("createLineSplitter", () => {
  it("splits only on LF, strips CR and buffers partial lines", () => {
    const lines: string[] = [];
    const split = createLineSplitter((l) => lines.push(l));
    split.write(Buffer.from('{"a":1}\r\n{"b"'));
    split.write(Buffer.from(':"x\u2028y"}\n'));
    split.end();
    expect(lines).toEqual(['{"a":1}', '{"b":"x\u2028y"}']);
  });

  it("decodes multi-byte characters split across chunks", () => {
    const lines: string[] = [];
    const split = createLineSplitter((l) => lines.push(l));
    const bytes = Buffer.from("日本\n");
    split.write(bytes.subarray(0, 2));
    split.write(bytes.subarray(2));
    split.end();
    expect(lines).toEqual(["日本"]);
  });

  it("flushes a trailing line without LF", () => {
    const lines: string[] = [];
    const split = createLineSplitter((l) => lines.push(l));
    split.write(Buffer.from("tail"));
    split.end();
    expect(lines).toEqual(["tail"]);
  });
});

function script(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rla-test-"));
  const file = join(dir, "fake.js");
  writeFileSync(file, `#!${process.execPath}\n${body}`);
  chmodSync(file, 0o755);
  return file;
}

describe("runProcess", () => {
  it("passes stdin verbatim, args without a shell, and the cwd", async () => {
    const file = script(`
      let input = "";
      process.stdin.on("data", (c) => (input += c));
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ input, args: process.argv.slice(2), cwd: process.cwd() }));
      });
    `);
    const cwd = mkdtempSync(join(tmpdir(), "rla-cwd-"));
    const lines: string[] = [];
    const prompt = "line1\n$(rm -rf /) `id` \"q\" 's' ; | & @file -x";
    const result = await runProcess({
      command: file,
      args: ["--flag", "a b; echo hi"],
      cwd,
      env: { PATH: process.env.PATH ?? "" },
      stdin: prompt,
      onLine: (l) => lines.push(l),
    });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(lines[0]);
    expect(out.input).toBe(prompt);
    expect(out.args).toEqual(["--flag", "a b; echo hi"]);
    expect(out.cwd.endsWith(cwd.split("/").pop()!)).toBe(true);
  });

  it("collects stderr and the exit code", async () => {
    const file = script(`process.stderr.write("boom\\n"); process.exit(3);`);
    const result = await runProcess({ command: file, args: [], cwd: tmpdir(), env: {}, stdin: "", onLine: () => {} });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom");
  });

  it("terminates the child when the signal aborts", async () => {
    const file = script(`console.log("started"); setInterval(() => {}, 1000);`);
    const controller = new AbortController();
    const started = Date.now();
    const result = await runProcess({
      command: file,
      args: [],
      cwd: tmpdir(),
      env: {},
      stdin: "",
      signal: controller.signal,
      onLine: () => controller.abort(),
    });
    expect(result.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("rejects with a clear error when the command does not exist", async () => {
    await expect(
      runProcess({ command: "/nonexistent/pi", args: [], cwd: tmpdir(), env: {}, stdin: "", onLine: () => {} }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects when the working directory does not exist", async () => {
    const file = script(`process.exit(0)`);
    await expect(
      runProcess({ command: file, args: [], cwd: "/nonexistent-dir-xyz", env: {}, stdin: "", onLine: () => {} }),
    ).rejects.toThrow(/working directory/i);
  });
});
