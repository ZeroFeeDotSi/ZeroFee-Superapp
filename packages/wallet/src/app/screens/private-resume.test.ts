// the audit's way-home audit P3 (7 Nov): reload mid way home: Jobs resumed the row, but Private's page said "$0.00" and
// "Nothing here yet." with a live Move over money already on its way. The page now reads the open way home back from its
// row and its carry's parts. Fails on main: no resumeAway, the page reads nothing back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVATE_HOME_TITLE } from "@zerofee/shell-api/job-start.ts";
import { resumeAway } from "./private-resume.ts";

const row = (o: Partial<{ id: string; title: string; state: "pending" | "done" | "failed" | "stopped"; usd: string; startedAt: number }> = {}) => ({ id: "job:abc", title: PRIVATE_HOME_TITLE, state: "pending" as const, usd: "$33.86", startedAt: 1_000, ...o });
const parts = (m: Record<string, string[]>) => (id: string) => m[id];

test("P3: the way home a reload left going comes back: its figure, its movements by id, its tap", () => {
  assert.deepEqual(resumeAway([row()], parts({ "job:abc": ["home:mv-1", "home:mv-2"] })), { usd: "$33.86", ids: ["home:mv-1", "home:mv-2"], madeAt: 1_000 });
  assert.deepEqual(resumeAway([row({ id: "job:x", title: "Send $5.00 to bob.near" }), row()], parts({ "job:abc": ["home:mv-1"], "job:x": ["s"] }))?.ids, ["home:mv-1"], "another job's row is never this page's");
});

test("P3 controls: no parts kept (closed before the core answered: the reopen ended it), an ended row, a core row, no figure: nothing to resume", () => {
  assert.equal(resumeAway([row()], parts({})), null);
  assert.equal(resumeAway([row({ state: "done" })], parts({ "job:abc": ["home:mv-1"] })), null);
  assert.equal(resumeAway([row({ state: "stopped" })], parts({ "job:abc": ["home:mv-1"] })), null);
  assert.equal(resumeAway([row({ id: "move:mv-1" })], parts({ "move:mv-1": ["home:mv-1"] })), null);
  assert.equal(resumeAway([{ ...row(), usd: undefined }], parts({ "job:abc": ["home:mv-1"] })), null);
  assert.equal(resumeAway([], parts({})), null);
});

test("P3: the page reads it back on mount and as the sealed rows come, once; the trigger goes off, Private's money is claimed till its end; Move is off while it goes", () => {
  const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");
  assert.match(src, /const r = resumeAway\(taskStore\(\)\.list\(\), \(id\) => carried\(id\)\?\.parts\);/);
  assert.match(src, /if \(resumed\.current \|\| step\.current !== "no"\) return;/, "once, never over the page's own job");
  assert.match(src, /resumed\.current = \{ release: claim\(\["private"\]\) \};\n\s*setAway\(\{ usd: r\.usd, ids: r\.ids \}\); setMadeAt\(r\.madeAt\); setLandedAt\(null\); set\("sent"\);/);
  assert.match(src, /const off = taskStore\(\)\.subscribe\(look\);\n\s*return \(\) => \{ off\(\); letGo\(\); \};/);
  assert.match(src, /const onEnd = \(landed: boolean\) => \{ letGo\(\); setAway\(null\);/);
  assert.match(src, /data-testid="private-move" disabled=\{moving !== "no"\}/);
  // "Nothing here yet." stays away while it is on its way (d404929d2's rule, the same `away`)
  assert.match(src, /rows\.length === 0 && !pocket\?\.oldWords && !away && <p className="zf-small wl-explain">/);
});
