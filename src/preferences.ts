import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  piPath?: string;
  extraPath?: string;
  projectsFile?: string;
  defaultModel?: string;
  defaultThinking?: string;
  defaultProject?: string;
}

export const getPreferences = () => getPreferenceValues<Preferences>();
