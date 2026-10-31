import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Pi's config directory: PI_CODING_AGENT_DIR, or ~/.pi/agent. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
}

export function parseEnabledModels(content: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const list = (data as { enabledModels?: unknown })?.enabledModels;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter((m) => m !== "");
}

/** The models listed in Pi's settings.json (`enabledModels`); empty when the file or key is missing. */
export async function readEnabledModels(agentDir = piAgentDir()): Promise<string[]> {
  try {
    return parseEnabledModels(await readFile(join(agentDir, "settings.json"), "utf8"));
  } catch {
    return [];
  }
}

/** Keeps the preferred model selectable even when it is not in `enabledModels`. */
export function modelChoices(enabled: string[], preferred: string): string[] {
  const p = preferred.trim();
  return p === "" || enabled.includes(p) ? enabled : [...enabled, p];
}
