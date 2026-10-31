import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentId } from "../types";
import { buildEnv, expandHome } from "../services/env";
import { getPreferences } from "../preferences";
import { createClaudeAgent } from "./claude";
import { createCodexAgent } from "./codex";
import { createCursorAgent } from "./cursor";
import { createPiAgent } from "./pi";

export const AGENT_CHOICES: { id: AgentId; title: string }[] = [
  { id: "pi", title: "Pi" },
  { id: "claude", title: "Claude Code" },
  { id: "codex", title: "Codex" },
  { id: "cursor", title: "Cursor" },
];

export function createAgent(id: AgentId): Agent {
  const prefs = getPreferences();
  const env = buildEnv(process.env, prefs.extraPath ?? "");
  const command = (value: string | undefined, fallback: string) => expandHome(value?.trim() || fallback);
  switch (id) {
    case "pi":
      return createPiAgent({ command: command(prefs.piPath, "pi"), env });
    case "claude":
      return createClaudeAgent({
        command: command(prefs.claudePath, "claude"),
        env,
        configDir: env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      });
    case "codex":
      return createCodexAgent({
        command: command(prefs.codexPath, "codex"),
        env,
        codexHome: env.CODEX_HOME || join(homedir(), ".codex"),
      });
    case "cursor":
      return createCursorAgent({
        command: command(prefs.cursorPath, "cursor-agent"),
        env,
        cursorHome: join(homedir(), ".cursor"),
      });
  }
}
