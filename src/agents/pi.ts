import type { Agent, HistoryTurn, RunRequest, RunResult } from "../types";
import { runProcess } from "../services/process-runner";
import { PiEventParser, buildPiArgs, buildPiRpcArgs, historyTurns } from "./pi-events";

export interface PiAgentOptions {
  command: string;
  env: NodeJS.ProcessEnv;
}

function stderrSummary(stderr: string): string {
  // Pi prints harmless "Warning:" lines (e.g. unmatched model patterns); keep only the meaningful part.
  const lines = stderr.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("Warning:"));
  return (lines.length > 0 ? lines : stderr.split("\n")).join("\n").trim().slice(-4000);
}

const HISTORY_TIMEOUT_MS = 30_000;

export function createPiAgent(options: PiAgentOptions): Agent {
  return {
    id: "pi",
    title: "Pi",
    async history({ cwd, sessionId, signal }): Promise<HistoryTurn[]> {
      // One RPC command, then stdin closes, which asks Pi to shut down after answering.
      const timeout = AbortSignal.timeout(HISTORY_TIMEOUT_MS);
      let response: { success?: boolean; error?: unknown; data?: { messages?: unknown } } | undefined;
      const result = await runProcess({
        command: options.command,
        args: buildPiRpcArgs({ sessionId }),
        cwd,
        env: options.env,
        stdin: JSON.stringify({ id: "history", type: "get_messages" }) + "\n",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        onLine: (line) => {
          try {
            const record = JSON.parse(line);
            if (record?.type === "response" && record.id === "history") response = record;
          } catch {
            // Ignore non-JSON lines.
          }
        },
      });
      if (!response) {
        throw new Error(
          result.aborted
            ? "Loading the session was cancelled."
            : stderrSummary(result.stderr) || "Pi returned no session messages.",
        );
      }
      if (!response.success) throw new Error(String(response.error ?? "Pi could not load the session."));
      const messages = response.data?.messages;
      return historyTurns(Array.isArray(messages) ? messages : []);
    },
    async run(request: RunRequest): Promise<RunResult> {
      const parser = new PiEventParser();
      const emit = (phase: "starting" | "running") =>
        request.onUpdate({ phase, text: parser.text, status: parser.status });

      emit("starting");
      const fail = (error: string): RunResult => ({
        status: "error",
        text: parser.text,
        sessionId: parser.sessionId ?? request.sessionId,
        error,
      });

      try {
        const result = await runProcess({
          command: options.command,
          args: buildPiArgs({ sessionId: request.sessionId }),
          cwd: request.cwd,
          env: options.env,
          // The prompt goes through stdin so it is never parsed as a CLI option or @file reference.
          stdin: request.prompt,
          signal: request.signal,
          onLine: (line) => {
            let event: unknown;
            try {
              event = JSON.parse(line);
            } catch {
              return;
            }
            parser.handle(event);
            emit("running");
          },
        });

        const sessionId = parser.sessionId ?? request.sessionId;
        if (result.aborted || parser.aborted) {
          return { status: "cancelled", text: parser.text, sessionId };
        }
        if (parser.error) return fail(parser.error);
        if (result.exitCode !== 0) {
          return fail(stderrSummary(result.stderr) || `Pi exited with code ${result.exitCode}.`);
        }
        if (!parser.settled && parser.text === "") {
          return fail(stderrSummary(result.stderr) || "Pi finished without producing an answer.");
        }
        return { status: "done", text: parser.text, sessionId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("Command not found")) {
          return fail(
            `${message}\n\nSet "Pi CLI Path" in the extension preferences to the absolute path of \`pi\` (run \`which pi\` in a terminal), or add its directory to "Additional PATH".`,
          );
        }
        return fail(message);
      }
    },
  };
}
