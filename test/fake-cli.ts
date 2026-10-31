import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Writes an executable Node script that receives `args` and the full stdin as `prompt`, then runs `body`. */
export function fakeCli(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), `rla-${name}-`));
  const file = join(dir, name);
  writeFileSync(
    file,
    `#!${process.execPath}
const emit = (e) => process.stdout.write(JSON.stringify(e) + "\\n");
const args = process.argv.slice(2);
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
${body}
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

export function writeJsonl(file: string, records: unknown[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export const tempDir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
