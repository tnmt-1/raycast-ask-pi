import { homedir, userInfo } from "node:os";

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
}

/**
 * Raycast starts extensions with a minimal PATH, so the CLI (and `node`, which Pi's launcher calls)
 * may not be found. Prepend the user's configured directories; the rest of the environment is passed
 * through unchanged so Pi keeps using its existing provider credentials. USER is filled in when
 * missing because Claude Code needs it to read its login.
 */
export function buildEnv(
  base: NodeJS.ProcessEnv,
  extraPath: string,
  home = homedir(),
  user = userInfo().username,
): NodeJS.ProcessEnv {
  const current = (base.PATH ?? "").split(":").filter(Boolean);
  const extra = extraPath
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => expandHome(p, home))
    .filter((p) => !current.includes(p));
  return { ...base, USER: base.USER || user, PATH: [...new Set(extra), ...current].join(":") };
}
