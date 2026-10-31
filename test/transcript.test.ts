import { describe, expect, it } from "vitest";
import { answerText, buildTranscript, turnMarkdown, type Turn } from "../src/services/transcript";

const turn = (over: Partial<Turn>): Turn => ({ prompt: "Q", text: "", phase: "done", status: "", ...over });

describe("buildTranscript", () => {
  it("quotes every prompt line and shows the answer below", () => {
    const md = buildTranscript([turn({ prompt: "line1\nline2", text: "# Answer" })]);
    expect(md).toBe("> line1\n> line2\n\n# Answer");
  });

  it("separates turns with a rule", () => {
    const md = buildTranscript([turn({ prompt: "a", text: "A" }), turn({ prompt: "b", text: "B" })]);
    expect(md).toBe("> a\n\nA\n\n---\n\n> b\n\nB");
  });

  it("shows the live status while running", () => {
    const md = buildTranscript([turn({ phase: "running", text: "partial", status: "Running bash…" })]);
    expect(md).toBe("> Q\n\npartial\n\n_⏳ Running bash…_");
  });

  it("shows errors in a code block", () => {
    const md = buildTranscript([turn({ phase: "error", error: "No API key\nfor provider" })]);
    expect(md).toBe("> Q\n\n**Error**\n\n```\nNo API key\nfor provider\n```");
  });

  it("marks cancelled runs", () => {
    const md = buildTranscript([turn({ phase: "cancelled", text: "part" })]);
    expect(md).toBe("> Q\n\npart\n\n_Cancelled._");
  });

  it("closes an unbalanced code fence in streamed text so later content renders", () => {
    const md = buildTranscript([turn({ phase: "running", text: "```ts\nconst a = 1;", status: "Writing…" })]);
    expect(md).toBe("> Q\n\n```ts\nconst a = 1;\n```\n\n_⏳ Writing…_");
  });

  it("uses a longer fence when the error contains backticks", () => {
    const md = buildTranscript([turn({ phase: "error", error: "bad ``` here" })]);
    expect(md).toContain("````\nbad ``` here\n````");
  });
});

describe("answerText", () => {
  it("shows only the status before any text arrives", () => {
    expect(answerText(turn({ phase: "starting", status: "Starting…" }))).toBe("⏳ Starting…");
  });

  it("appends the live status below streamed text", () => {
    expect(answerText(turn({ phase: "running", text: "partial", status: "Writing…" }))).toBe("partial\n\n⏳ Writing…");
  });

  it("returns the answer as is when done", () => {
    expect(answerText(turn({ phase: "done", text: "# Answer\n```ts\nx\n```" }))).toBe("# Answer\n```ts\nx\n```");
  });

  it("appends the error message", () => {
    expect(answerText(turn({ phase: "error", text: "part", error: "No API key" }))).toBe("part\n\nError: No API key");
  });

  it("marks cancelled runs", () => {
    expect(answerText(turn({ phase: "cancelled", text: "part" }))).toBe("part\n\n(Cancelled)");
  });
});

describe("turnMarkdown", () => {
  it("renders a single turn the same way as one entry of the transcript", () => {
    const t = turn({ phase: "running", prompt: "a\nb", text: "```ts\nx", status: "Writing…" });
    expect(turnMarkdown(t)).toBe(buildTranscript([t]));
  });
});
