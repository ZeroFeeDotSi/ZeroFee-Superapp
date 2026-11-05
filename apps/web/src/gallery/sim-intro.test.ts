// D157 (product decision, 3 Nov): the public site is the Sim only, and its first screen says so once: pretend money, why a
// tab can't do it all, Try it; the Chrome extension is coming soon (its download only after its security review), and
// no link to today's old extension build, no iPhone link (none exists yet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTRO_EXTENSION, INTRO_KEY, INTRO_LINE, INTRO_SOURCE, INTRO_TITLE, INTRO_TRY, introSeen, keepIntroSeen } from "./sim-intro.ts";

test("the intro's words (Copywriter) and nothing that downloads or links out", () => {
  assert.equal(INTRO_TITLE, "ZeroFee, on pretend money");
  assert.equal(INTRO_LINE, "Nothing real moves. Tap Approve to act. Face ID and websites are pretend here.");
  // control (Sim pass, 4 Nov): the Sim has a Browser and site wallets, so the line never says it lacks them
  assert.doesNotMatch(INTRO_LINE, /site wallets|the Browser/);
  assert.equal(INTRO_TRY, "Try it");
  assert.match(INTRO_EXTENSION, /coming soon/);
  assert.equal(INTRO_SOURCE, "Built in the open. Get the code and run it yourself.");
  const src = readFileSync(new URL("./SimIntro.tsx", import.meta.url), "utf8") + readFileSync(new URL("./sim-intro.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.zip|href=|download|testflight|apps\.apple\.com/i);
});

test("shown once: kept after Try it; control: a fresh or blocked store shows it", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  assert.equal(introSeen(store), false);
  keepIntroSeen(store);
  assert.equal(kv.get(INTRO_KEY), "1");
  assert.equal(introSeen(store), true);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(introSeen(broken), false);
  assert.doesNotThrow(() => keepIntroSeen(broken));
  // the demo shows it first, in the public build only
  const demo = readFileSync(new URL("./Demo.tsx", import.meta.url), "utf8");
  assert.match(demo, /useState\(\(\) => PUBLIC_BUILD && !introSeen\(\)\)/);
  assert.match(demo, /if \(intro\) return <SimIntro onTry=\{\(\) => setIntro\(false\)\} \/>;/);
});
