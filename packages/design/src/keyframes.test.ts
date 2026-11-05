// A @keyframes name in the design package means one motion (REVAMP, 3 Nov: mark.css and motion.css both defined
// zf-breathe differently, so the later file silently set the Mark's and every coin halo's breathing alike). A name may
// appear in two files only with the same body (zf-draw: mark.css can load without motion.css).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const twice = (files: { f: string; css: string }[]): string[] => {
  const seen = new Map<string, { f: string; body: string }>();
  const out: string[] = [];
  for (const { f, css } of files) for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)) {
    const body = m[2]!.replace(/\s+/g, " ");
    const had = seen.get(m[1]!);
    if (had && had.body !== body) out.push(`${m[1]} (${had.f}, ${f})`);
    else if (!had) seen.set(m[1]!, { f, body });
  }
  return out;
};

test("each @keyframes name in packages/design means one motion", () => {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => ({ f, css: readFileSync(new URL(f, dir), "utf8") }));
  assert.ok(files.length > 5);
  assert.deepEqual(twice(files), []);
  // controls: the old pair is caught; the same body twice is not
  assert.deepEqual(twice([{ f: "a.css", css: "@keyframes d { to { x: 0; } }" }, { f: "b.css", css: "@keyframes d {  to { x: 0; } }" }]), []);
  assert.deepEqual(twice([{ f: "mark.css", css: "@keyframes zf-breathe { 50% { opacity: .82; } }" }, { f: "motion.css", css: "@keyframes zf-breathe { 50% { opacity: .1; } }" }]), ["zf-breathe (mark.css, motion.css)"]);
});
