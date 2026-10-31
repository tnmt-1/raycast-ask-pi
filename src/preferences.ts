import { getPreferenceValues } from "@raycast/api";
import type { AgentId } from "./types";

export interface Preferences {
  piPath?: string;
  claudePath?: string;
  codexPath?: string;
  cursorPath?: string;
  extraPath?: string;
  projectsFile?: string;
  defaultAgent?: AgentId;
  defaultProject?: string;
}

export const getPreferences = () => getPreferenceValues<Preferences>();
