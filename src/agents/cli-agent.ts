// Shared runner for agents driven by a one-shot CLI that prints JSONL events on stdout.

import { readFile } from "node:fs/promises";
import type { Agent, AgentId, HistoryTurn, RunRequest, RunResult } from "../types";
import { runProcess } from "../services/process-runner";

export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Joins the `text` of every `{ type: <textType>, text }` part of a content array (or returns a plain string). */
export function contentText(content: unknown, textTypes = ["text"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is Json => isObject(c) && textTypes.includes(String(c.type)) && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

export const joinBlocks = (blocks: string[]) => blocks.filter((b) => b.trim() !== "").join("\n\n");

export interface StreamParser {
  sessionId?: string;
  text: string;
  status: string;
  error?: string;
  settled: boolean;
  handle(event: unknown): void;
}

export async function readJsonl(path: string): Promise<unknown[]> {
  const records: unknown[] = [];
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Skip a partially written last line.
    }
  }
  return records;
}

export interface CliAgentSpec {
  id: AgentId;
  title: string;
  command: string;
  env: NodeJS.ProcessEnv;
  /** Title of the preference that sets the CLI path, shown when the command is missing. */
  pathPreference: string;
  presetSessionId: boolean;
  buildArgs(options: { sessionId: string; resume: boolean }): string[];
  newParser(): StreamParser;
  findSessionFile(sessionId: string): Promise<string | undefined>;
  historyTurns(records: unknown[]): HistoryTurn[];
}

function summary(stderr: string, stdoutText: string[]): string {
  const lines = [...stdoutText, ...stderr.split("\n")].filter((l) => l.trim() !== "");
  return lines.join("\n").trim().slice(-4000);
}

export function createCliAgent(spec: CliAgentSpec): Agent {
  return {
    id: spec.id,
    title: spec.title,
    presetSessionId: spec.presetSessionId,
    async history({ sessionId }): Promise<HistoryTurn[]> {
      const file = await spec.findSessionFile(sessionId);
      if (!file) throw new Error(`${spec.title} has no saved session ${sessionId}.`);
      return spec.historyTurns(await readJsonl(file));
    },
    async run(request: RunRequest): Promise<RunResult> {
      const parser = spec.newParser();
      // Lines that are not JSON are usually fatal messages printed before the event stream starts.
      const plainLines: string[] = [];
      const known = request.resume || spec.presetSessionId ? request.sessionId : undefined;
      const sessionId = () => parser.sessionId ?? known;
      const emit = (phase: "starting" | "running") =>
        request.onUpdate({ phase, text: parser.text, status: parser.status, sessionId: parser.sessionId });
      const fail = (error: string): RunResult => ({
        status: "error",
        text: parser.text,
        sessionId: sessionId(),
        error,
      });

      emit("starting");
      try {
        const result = await runProcess({
          command: spec.command,
          args: spec.buildArgs({ sessionId: request.sessionId, resume: request.resume }),
          cwd: request.cwd,
          env: spec.env,
          // The prompt goes through stdin so it is never parsed as a CLI option.
          stdin: request.prompt,
          signal: request.signal,
          onLine: (line) => {
            let event: unknown;
            try {
              event = JSON.parse(line);
            } catch {
              plainLines.push(line);
              return;
            }
            parser.handle(event);
            emit("running");
          },
        });

        if (result.aborted) return { status: "cancelled", text: parser.text, sessionId: sessionId() };
        if (parser.error) return fail(parser.error);
        if (result.exitCode !== 0) {
          return fail(summary(result.stderr, plainLines) || `${spec.title} exited with code ${result.exitCode}.`);
        }
        if (!parser.settled && parser.text === "") {
          return fail(summary(result.stderr, plainLines) || `${spec.title} finished without producing an answer.`);
        }
        return { status: "done", text: parser.text, sessionId: sessionId() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("Command not found")) {
          return fail(
            `${message}\n\nSet "${spec.pathPreference}" in the extension preferences to the absolute path of \`${spec.command}\` (run \`which\` in a terminal), or add its directory to "Additional PATH".`,
          );
        }
        return fail(message);
      }
    },
  };
}
