import type { RunPhase } from "../types";

export interface Turn {
  prompt: string;
  text: string;
  phase: RunPhase;
  status: string;
  error?: string;
}

function closeOpenFence(text: string): string {
  const fences = text.match(/^ {0,3}(`{3,}|~{3,})/gm) ?? [];
  if (fences.length % 2 === 0) return text;
  const last = fences[fences.length - 1].trim();
  return `${text}\n${last}`;
}

function codeBlock(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

export function turnMarkdown(turn: Turn): string {
  const parts = [
    turn.prompt
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n"),
  ];
  if (turn.text.trim() !== "") parts.push(closeOpenFence(turn.text));
  if (turn.phase === "starting" || turn.phase === "running") parts.push(`_⏳ ${turn.status}_`);
  if (turn.phase === "error") parts.push("**Error**", codeBlock(turn.error ?? "Unknown error"));
  if (turn.phase === "cancelled") parts.push("_Cancelled._");
  return parts.join("\n\n");
}

export function buildTranscript(turns: Turn[]): string {
  return turns.map(turnMarkdown).join("\n\n---\n\n");
}

/** Plain-text answer for a turn, used where Markdown cannot be rendered (Form.Description). */
export function answerText(turn: Turn): string {
  const parts = turn.text.trim() !== "" ? [turn.text] : [];
  if (turn.phase === "starting" || turn.phase === "running") parts.push(`⏳ ${turn.status}`);
  if (turn.phase === "error") parts.push(`Error: ${turn.error ?? "Unknown error"}`);
  if (turn.phase === "cancelled") parts.push("(Cancelled)");
  return parts.join("\n\n");
}
