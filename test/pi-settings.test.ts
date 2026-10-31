import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelChoices, parseEnabledModels, readEnabledModels } from "../src/services/pi-settings";

describe("parseEnabledModels", () => {
  it("returns the enabledModels strings", () => {
    const json = JSON.stringify({ defaultModel: "x", enabledModels: ["a/b", "", 3, " c/d "] });
    expect(parseEnabledModels(json)).toEqual(["a/b", "c/d"]);
  });

  it("returns an empty list when the key is missing or the file is not JSON", () => {
    expect(parseEnabledModels("{}")).toEqual([]);
    expect(parseEnabledModels("not json")).toEqual([]);
  });
});

describe("readEnabledModels", () => {
  it("reads settings.json in the Pi agent directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rla-pi-settings-"));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ enabledModels: ["p/m"] }));
    expect(await readEnabledModels(dir)).toEqual(["p/m"]);
  });

  it("returns an empty list when settings.json does not exist", async () => {
    expect(await readEnabledModels(mkdtempSync(join(tmpdir(), "rla-pi-settings-")))).toEqual([]);
  });
});

describe("modelChoices", () => {
  it("adds the preferred model when it is not in the list", () => {
    expect(modelChoices(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(modelChoices(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(modelChoices(["a"], "")).toEqual(["a"]);
  });
});
