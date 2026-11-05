// 5 Nov: the background worker imported panel.js (a shared chunk had pulled the panel's entry in), so it died at start on
// `document`, and the whole extension waited for ever (the trading panel on its mark, the approval window blank). The
// worker is its own build now (vite.worker.config.ts); this reads the BUILT files: everything the worker loads is its own.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));

/** Every file the worker loads from `dir` (static and dynamic imports, followed), relative to `dir`. */
export function workerFiles(dir: string, entry = "background.js"): string[] {
  const seen = new Set<string>();
  const walk = (rel: string) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const p = join(dir, rel);
    if (!existsSync(p)) return;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'`](\.{1,2}\/[^"'`]+)["'`]/g)) walk(normalize(relative(dir, join(dirname(p), m[1]!))));
  };
  walk(entry);
  return [...seen];
}
/** What's wrong with the worker's files (empty: nothing): anything that isn't the worker's own. */
export const workerProblems = (files: string[]) => files.filter((f) => f !== "background.js" && !f.startsWith("worker/")).map((f) => `the worker loads ${f}`);

test("the graph reader: a worker that reaches a page's entry fails (control: the 5 Nov build's shape); its own chunks pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "zf-worker-"));
  try {
    mkdirSync(join(dir, "chunks"));
    mkdirSync(join(dir, "worker"));
    writeFileSync(join(dir, "background.js"), `import{a}from"./chunks/jupiter.js";`);
    writeFileSync(join(dir, "chunks/jupiter.js"), `import{r}from"../panel.js";`);
    writeFileSync(join(dir, "panel.js"), `document.body;`);
    assert.deepEqual(workerProblems(workerFiles(dir)).sort(), ["the worker loads chunks/jupiter.js", "the worker loads panel.js"]);
    writeFileSync(join(dir, "background.js"), `import{a}from"./worker/seal.js";const b=()=>import("./worker/requote.js");`);
    writeFileSync(join(dir, "worker/seal.js"), `export const a=1;`);
    writeFileSync(join(dir, "worker/requote.js"), `import{a}from"./seal.js";`);
    assert.deepEqual(workerFiles(dir).sort(), ["background.js", "worker/requote.js", "worker/seal.js"]);
    assert.deepEqual(workerProblems(workerFiles(dir)), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the BUILT worker (build/) loads only its own files, never the panel or the app", { skip: !existsSync(join(here, "build/background.js")) && !process.env.ZF_REQUIRE_BUILD ? "no build here" : false }, () => {
  const files = workerFiles(join(here, "build"));
  assert.ok(files.length > 1, "the worker has its own chunks");
  assert.deepEqual(workerProblems(files), []);
  for (const f of files) assert.ok(!/\bcreateRoot\b/.test(readFileSync(join(here, "build", f), "utf8")), `${f} draws no page`);
});
