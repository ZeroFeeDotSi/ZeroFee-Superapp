// k-security crawl (4 Nov, 1c6f4215f): Protection opens on the rules kept on this device, keyed by account, then NEAR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshView, keepRules, keptRules, rulesKey } from "./protection-cache.ts";
import { type Band } from "./rules.ts";
import { openOn } from "./rules-now.ts";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const USD = [{ upToUsd: 500, level: "faceid" as const }, { upToUsd: null, level: "wait" as const, waitSeconds: 86_400 }];
const READ = { bands: [{ up_to: [["near", "1"]], level: "FaceId" }], usd: USD };

test("a read with dollar rules is kept per network and account; another account reads nothing", () => {
  const s = mem();
  keepRules("mainnet", "a.near", READ, s);
  assert.deepEqual(keptRules("mainnet", "a.near", s), READ);
  assert.equal(keptRules("mainnet", "b.near", s), null, "control: another account");
  assert.equal(keptRules("testnet", "a.near", s), null, "control: another network");
  assert.notEqual(rulesKey("mainnet", "a.near"), rulesKey("mainnet", "b.near"));
});

test("nothing is kept from a failed read, rules without dollars, or no account; a damaged copy is none", () => {
  const s = mem();
  keepRules("mainnet", "a.near", null, s);
  keepRules("mainnet", "a.near", { bands: [], usd: null }, s);
  keepRules("mainnet", "", READ, s);
  assert.equal(s.m.size, 0);
  s.setItem(rulesKey("mainnet", "a.near"), "{oops");
  assert.equal(keptRules("mainnet", "a.near", s), null);
  assert.equal(keptRules("mainnet", "a.near", null), null, "storage blocked");
});

test("NEAR's answer replaces an untouched copy, and keeps the person's own change", () => {
  const kept = openOn(READ, "testnet");
  assert.equal(kept.k, "bands");
  const newer = openOn({ ...READ, usd: [{ upToUsd: 1000, level: "faceid" }, { upToUsd: null, level: "both", waitSeconds: 86_400 }] }, "testnet") as Extract<ReturnType<typeof openOn>, { k: "bands" }>;
  assert.deepEqual(freshView(kept, newer), newer, "untouched: NEAR's rules");
  const k = kept as Extract<typeof kept, { k: "bands" }>;
  const edited = { ...k, bands: k.bands.map((b, i): Band => (i === 0 ? { ...b, level: "device" } : b)) };
  const out = freshView(edited, newer) as typeof k;
  assert.deepEqual(out.bands, edited.bands, "the person's change stays");
  assert.deepEqual(out.from, newer.from, "what the account holds comes from NEAR");
  assert.deepEqual(freshView({ k: "loading" }, newer), newer);
});

test("the screen opens on the kept copy, says Retry only with none, and Save waits for NEAR", () => {
  const src = readFileSync(new URL("./Protection.tsx", import.meta.url), "utf8");
  assert.match(src, /const kept = keptRules\(network, accountId\)/);
  assert.match(src, /setView\(\(v\) => \(v\.k === "bands" \? v : next\)\)/, "a failed read never drops a copy for Retry");
  assert.match(src, /disabled=\{!fresh \|\| !dirty/);
  assert.match(src, /if \(!fresh \|\| !dirty \|\| saving\) return;/);
  assert.match(readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8"), /accountId=\{account\.accountId\}/);
});
