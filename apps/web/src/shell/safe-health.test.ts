// S-2, the Safe's health check: five lines from facts, a sixth only while old words hold money; an unknown fact is never
// ticked nor offered; every line not done opens its own fix; it loads with the Safe sheet, never in Home's first load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { faceIdOn, healthLines, oldWordsHoldMoney, openFix, type HealthFacts } from "./safe-health.ts";

const ALL_DONE: HealthFacts = { wordsChecked: true, rules: true, secondDevice: true, waitSeconds: 172_800, faceId: true, oldWordsMoney: false };
const UNKNOWN: HealthFacts = { wordsChecked: null, rules: null, secondDevice: null, waitSeconds: null, faceId: null, oldWordsMoney: null };
const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("five lines in one order, all ticked, none offers a fix", () => {
  const l = healthLines(ALL_DONE);
  assert.deepEqual(l.map((x) => x.key), ["words", "rules", "device", "wait", "faceid"]);
  assert.ok(l.every((x) => x.done && x.fix === null));
  assert.deepEqual(l.map((x) => x.text), ["Backup words checked", "Big payments follow your rules", "Second device added", "Recovery wait: 48 hours", "Face ID is on"]);
});

test("each line not done opens its own fix, in plain words", () => {
  const l = healthLines({ wordsChecked: false, rules: false, secondDevice: false, waitSeconds: 0, faceId: false, oldWordsMoney: true });
  assert.deepEqual(l.map((x) => [x.key, x.fix]), [["words", "check-words"], ["rules", "protection"], ["device", "devices"], ["wait", "recovery"], ["faceid", "settings"], ["oldwords", "details"]]);
  assert.deepEqual(l.map((x) => x.text), ["Check your backup words", "Choose what big payments need", "Add a second device", "Set up your recovery wait", "Turn on Face ID for ZeroFee", "A wallet from your old words still holds money"]);
  assert.ok(l.every((x) => !x.done));
  // control: the fix map is one-to-one (no two lines open the same screen)
  assert.equal(new Set(l.map((x) => x.fix)).size, l.length);
});

test("an unknown fact is neither ticked nor offered: its line isn't there", () => {
  assert.deepEqual(healthLines(UNKNOWN), []);
  // control: the same fact known shows its line
  assert.deepEqual(healthLines({ ...UNKNOWN, secondDevice: false }).map((x) => x.key), ["device"]);
  assert.deepEqual(healthLines({ ...UNKNOWN, rules: true }).map((x) => x.key), ["rules"]);
});

test("old words: a line only while such a wallet holds money", () => {
  assert.ok(!healthLines({ ...ALL_DONE, oldWordsMoney: false }).some((x) => x.key === "oldwords"));
  assert.ok(!healthLines({ ...ALL_DONE, oldWordsMoney: null }).some((x) => x.key === "oldwords"));
  assert.ok(healthLines({ ...ALL_DONE, oldWordsMoney: true }).some((x) => x.key === "oldwords"));
  assert.equal(oldWordsHoldMoney([]), false);
  assert.equal(oldWordsHoldMoney([{ oldWords: true, cashUsd: "0", coinsUsd: "0.00" }]), false);
  assert.equal(oldWordsHoldMoney([{ oldWords: true, cashUsd: "3.20" }]), true);
  assert.equal(oldWordsHoldMoney([{ oldWords: true, holds: "0.0012 ETH" }]), true);
  assert.equal(oldWordsHoldMoney([{ oldWords: true, holds: "0 ETH" }]), false);
  // control: money in a wallet from the CURRENT words is not this line's
  assert.equal(oldWordsHoldMoney([{ cashUsd: "50" }, { oldWords: true, cashUsd: "0" }]), false);
  // a wallet that couldn't be read is not "nothing there"
  assert.equal(oldWordsHoldMoney([{ oldWords: true, unread: true }]), null);
  assert.equal(oldWordsHoldMoney([{ oldWords: true, unread: true }, { oldWords: true, cashUsd: "1" }]), true);
});

test("Face ID: on only with no blocker; a Face ID blocker is off; anything else is unknown", () => {
  assert.equal(faceIdOn(null), true);
  assert.equal(faceIdOn("security.faceid.off"), false);
  assert.equal(faceIdOn("security.faceid.not-set-up"), false);
  assert.equal(faceIdOn("security.chip.missing"), null);
  assert.equal(faceIdOn(undefined), null, "a browser, or a read that failed: no line");
});

test("no progress count and no banned words on the lines", () => {
  const words = healthLines({ wordsChecked: false, rules: false, secondDevice: false, waitSeconds: 0, faceId: false, oldWordsMoney: true }).map((x) => x.text).join(" ") + healthLines(ALL_DONE).map((x) => x.text).join(" ");
  assert.doesNotMatch(words, /\d of \d|seed|mnemonic|policy|passkey|Spending|cap\b|contract/i);
});

test("loads with the Safe sheet, never in Home's first load; display only", () => {
  const app = src("../App.tsx");
  assert.match(app, /const SafeHealth = lazy\(\(\) => import\("\.\/shell\/SafeHealth\.tsx"\)/);
  assert.doesNotMatch(app, /^import .*SafeHealth/m);
  const comp = src("./SafeHealth.tsx");
  // reads only: no tx, no approval, no spending/ledger writes
  assert.doesNotMatch(comp, /"tx\.|approval\.|topUp|putAway|setCap|exportKey|"ledger\.(send|withdraw|pay)/);
  // the Safe tab on Home (D129; Safe | Hot, 5 Nov) draws it under the Safe's coins; nothing to go back to
  assert.match(src("../../../../packages/wallet/src/app/screens/Home.tsx"), /\{a\.health\?\.\(\(\) => undefined\)\}/);
  // known.ts and the iPhone host sit in Home's first load; importing them here split it (+3.5 KB, measured): they come
  // in as props. Types only.
  assert.doesNotMatch(comp, /^import \{[^}]*\} from "\.\.\/(apps\/security\/known|host\/ios)\.ts"/m);
  assert.match(comp, /^import type \{ IosHost \} from "\.\.\/host\/ios\.ts"/m);
});

test("each fix opens its own screen; the words check and Settings shut the Safe sheet first", () => {
    const calls: string[] = [];
  const go = { place: (p: string) => calls.push(`place:${p}`), details: () => calls.push("details"), close: () => calls.push("close"), checkWords: () => calls.push("words"), settings: () => calls.push("settings") };
  for (const f of ["check-words", "protection", "devices", "recovery", "settings", "details"] as const) openFix(f, go);
  assert.deepEqual(calls, ["close", "words", "place:protection", "place:devices", "place:recovery", "close", "settings", "details"]);
});

test("the recovery wait reads as Recovery says it (security/rules.ts waitName, kept in step here)", async () => {
  const { waitName: recovery } = await import("../apps/security/rules.ts");
  const { waitName } = await import("./safe-health.ts");
  for (const s of [30, 60, 3_599, 3_600, 86_400, 172_800, 259_199, 259_200, 604_800, 2_592_000]) assert.equal(waitName(s), recovery(s), `${s} s`);
});
