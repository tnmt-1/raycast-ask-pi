import { readFile } from "node:fs/promises";
import { LocalStorage } from "@raycast/api";
import { useLocalStorage, usePromise } from "@raycast/utils";
import { useMemo } from "react";
import { getPreferences } from "./preferences";
import { expandHome } from "./services/env";
import { mergeProjects, parseProjectsFile } from "./services/projects";
import { removeSession, upsertSession } from "./services/sessions";
import type { Project, SessionRecord } from "./types";

const DEFAULT_PROJECTS_FILE = "~/.config/raycast-local-agent/projects.json";

export function projectsFilePath(): string {
  return expandHome(getPreferences().projectsFile?.trim() || DEFAULT_PROJECTS_FILE);
}

async function loadFileProjects(path: string): Promise<Project[]> {
  try {
    return parseProjectsFile(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function useProjects() {
  const filePath = projectsFilePath();
  const file = usePromise(loadFileProjects, [filePath]);
  const local = useLocalStorage<Project[]>("projects", []);

  const projects = useMemo(() => mergeProjects(file.data ?? [], local.value ?? []), [file.data, local.value]);

  return {
    projects,
    filePath,
    fileError: file.error,
    isLoading: file.isLoading || local.isLoading,
    reload: file.revalidate,
    addLocal: (project: Omit<Project, "source">) =>
      local.setValue([
        ...(local.value ?? []).filter((p) => p.path !== project.path),
        { ...project, source: "local" as const },
      ]),
    removeLocal: (path: string) => local.setValue((local.value ?? []).filter((p) => p.path !== path)),
  };
}

const SESSIONS_KEY = "sessions";

async function readSessions(): Promise<SessionRecord[]> {
  const raw = await LocalStorage.getItem<string>(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Read-modify-write against storage so a long-running conversation never overwrites newer records.
export async function saveSession(record: SessionRecord): Promise<void> {
  await LocalStorage.setItem(SESSIONS_KEY, JSON.stringify(upsertSession(await readSessions(), record)));
}

export async function deleteSession(id: string): Promise<void> {
  await LocalStorage.setItem(SESSIONS_KEY, JSON.stringify(removeSession(await readSessions(), id)));
}

export function useSessions() {
  const { data, isLoading, revalidate } = usePromise(readSessions);
  return {
    sessions: data ?? [],
    isLoading,
    reload: revalidate,
    remove: async (id: string) => {
      await deleteSession(id);
      await revalidate();
    },
  };
}
