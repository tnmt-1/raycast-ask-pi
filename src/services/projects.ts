import { basename } from "node:path";
import type { Project } from "../types";
import { expandHome } from "./env";

const normalize = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

export function parseProjectsFile(content: string, home?: string): Project[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new Error(`Could not parse the projects file: ${err instanceof Error ? err.message : String(err)}`);
  }
  const list = Array.isArray(data) ? data : (data as { projects?: unknown })?.projects;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): Project[] => {
    if (typeof item !== "object" || item === null) return [];
    const { name, path } = item as { name?: unknown; path?: unknown };
    if (typeof path !== "string" || path.trim() === "") return [];
    const resolved = normalize(expandHome(path.trim(), home));
    const title = typeof name === "string" && name.trim() !== "" ? name.trim() : basename(resolved);
    return [{ name: title, path: resolved, source: "file" }];
  });
}

export function mergeProjects(fromFile: Project[], local: Project[]): Project[] {
  const byPath = new Map<string, Project>();
  for (const p of [...fromFile, ...local]) {
    if (!byPath.has(p.path)) byPath.set(p.path, p);
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}
