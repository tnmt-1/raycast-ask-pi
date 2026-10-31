import { describe, expect, it } from "vitest";
import { expandHome, buildEnv } from "../src/services/env";
import { mergeProjects, parseProjectsFile } from "../src/services/projects";
import { removeSession, sessionsForProject, sessionTitle, upsertSession } from "../src/services/sessions";
import type { SessionRecord } from "../src/types";

describe("expandHome", () => {
  it("expands a leading tilde only", () => {
    expect(expandHome("~/a", "/Users/me")).toBe("/Users/me/a");
    expect(expandHome("~", "/Users/me")).toBe("/Users/me");
    expect(expandHome("/x/~/a", "/Users/me")).toBe("/x/~/a");
  });
});

describe("buildEnv", () => {
  it("prepends extra PATH entries and keeps the rest of the environment", () => {
    const env = buildEnv({ PATH: "/usr/bin", HOME: "/Users/me" }, "~/.local/bin:/opt/homebrew/bin", "/Users/me");
    expect(env.PATH).toBe("/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin");
    expect(env.HOME).toBe("/Users/me");
  });

  it("does not duplicate entries already on PATH", () => {
    const env = buildEnv({ PATH: "/opt/homebrew/bin:/usr/bin" }, "/opt/homebrew/bin", "/h");
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
  });
});

describe("parseProjectsFile", () => {
  it("accepts an array or an object with projects", () => {
    expect(parseProjectsFile('[{"name":"A","path":"/a"}]', "/h")).toEqual([{ name: "A", path: "/a", source: "file" }]);
    expect(parseProjectsFile('{"projects":[{"path":"~/b"}]}', "/h")).toEqual([
      { name: "b", path: "/h/b", source: "file" },
    ]);
  });

  it("skips invalid entries and strips trailing slashes", () => {
    expect(parseProjectsFile('[{"name":"x"},1,{"path":"/c/"}]', "/h")).toEqual([
      { name: "c", path: "/c", source: "file" },
    ]);
  });

  it("throws a readable error on invalid JSON", () => {
    expect(() => parseProjectsFile("{", "/h")).toThrow(/projects file/i);
  });
});

describe("mergeProjects", () => {
  it("dedupes by path, preferring the file entry, and sorts by name", () => {
    const merged = mergeProjects(
      [{ name: "Zed", path: "/z", source: "file" }],
      [
        { name: "dup", path: "/z", source: "local" },
        { name: "alpha", path: "/a", source: "local" },
      ],
    );
    expect(merged.map((p) => [p.name, p.source])).toEqual([
      ["alpha", "local"],
      ["Zed", "file"],
    ]);
  });
});

describe("sessions", () => {
  const rec = (id: string, projectPath: string, updatedAt: number): SessionRecord => ({
    id,
    agentId: "pi",
    projectPath,
    title: id,
    createdAt: 0,
    updatedAt,
  });

  it("lists sessions of one project and agent, newest first", () => {
    const all = [rec("a", "/p", 1), rec("b", "/q", 5), rec("c", "/p", 3), { ...rec("d", "/p", 9), agentId: "other" }];
    expect(sessionsForProject(all, "/p", "pi").map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("upserts by id keeping createdAt and title", () => {
    const first = upsertSession([], rec("a", "/p", 1));
    const next = upsertSession(first, { ...rec("a", "/p", 7), title: "new", createdAt: 99 });
    expect(next).toEqual([{ ...rec("a", "/p", 7), title: "a", createdAt: 0 }]);
  });

  it("removes a session by id", () => {
    expect(removeSession([rec("a", "/p", 1), rec("b", "/p", 2)], "a").map((s) => s.id)).toEqual(["b"]);
  });

  it("derives a short one-line title from the prompt", () => {
    expect(sessionTitle("\n  First line here\nsecond")).toBe("First line here");
    expect(sessionTitle("x".repeat(100))).toHaveLength(60);
    expect(sessionTitle("   ")).toBe("Untitled");
  });
});
