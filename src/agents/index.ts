import type { Agent, AgentId } from "../types";
import { buildEnv, expandHome } from "../services/env";
import { getPreferences } from "../preferences";
import { createPiAgent } from "./pi";

export const AGENT_CHOICES: { id: AgentId; title: string }[] = [{ id: "pi", title: "Pi" }];

export function createAgent(id: AgentId): Agent {
  const prefs = getPreferences();
  const env = buildEnv(process.env, prefs.extraPath ?? "");
  switch (id) {
    case "pi":
      return createPiAgent({ command: expandHome(prefs.piPath?.trim() || "pi"), env });
  }
}
