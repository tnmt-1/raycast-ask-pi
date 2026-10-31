import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Splits a UTF-8 byte stream into records on LF only (JSONL framing; Unicode separators stay inside lines). */
export function createLineSplitter(onLine: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const flushLines = () => {
    let i: number;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      if (line !== "") onLine(line);
    }
  };
  return {
    write(chunk: Buffer) {
      buffer += decoder.write(chunk);
      flushLines();
    },
    end() {
      buffer += decoder.end();
      flushLines();
      if (buffer !== "") onLine(buffer.replace(/\r$/, ""));
      buffer = "";
    },
  };
}

export interface RunProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  signal?: AbortSignal;
  onLine: (line: string) => void;
}

export interface RunProcessResult {
  exitCode: number | null;
  stderr: string;
  aborted: boolean;
}

const MAX_STDERR = 16_000;
const KILL_GRACE_MS = 3000;

export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const { command, args, cwd, env, stdin, signal, onLine } = options;

  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return Promise.reject(new Error(`Working directory not found: ${cwd}`));
  }

  return new Promise((resolve, reject) => {
    // shell: false — arguments go straight to execve, so prompts and paths are never interpreted by a shell.
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const splitter = createLineSplitter(onLine);
    let stderr = "";
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    const abort = () => {
      if (aborted || child.exitCode !== null) return;
      aborted = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => splitter.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8");
    });
    child.stdin.on("error", () => {
      // The child may exit before reading stdin; the exit code reports the real problem.
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(killTimer);
      reject(err.code === "ENOENT" ? new Error(`Command not found: ${command}`) : err);
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(killTimer);
      splitter.end();
      resolve({ exitCode: code, stderr: stderr.slice(0, MAX_STDERR), aborted });
    });

    child.stdin.end(stdin);
  });
}
