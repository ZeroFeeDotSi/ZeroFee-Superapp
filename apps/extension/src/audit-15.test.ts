// Audit 15 (8 Nov), the Extension, graded C-: FE1 the panel sent people to a phone screen a mainnet phone never shows;
// FE2 "We stopped this before signing it." with a program's raw id; FE3 ellipsis busy lines; FE4 a cut address on screen.
// Each fails on main ea3017f8a.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MVP_APPS } from "../../web/src/shown-apps.ts";
import { extProblems, refusedLine } from "./problems.ts";
import { checkSolTx } from "./vault/policy.ts";
import { AFTER_MONEY, JOURNEY_STEPS, PHONE_LINK_SHOWN, stepFor } from "./panel/setup.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** A source's code lines, comments dropped (a // line, a /* or * line, and a trailing // comment). */
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");

test("FE1: the panel never points to the phone's Extension tab while the phone doesn't show it: no step 3, no Settings row, no balance line", () => {
  assert.equal(PHONE_LINK_SHOWN, MVP_APPS.has("extension"), "one switch with the phone's tab");
  assert.equal(PHONE_LINK_SHOWN, false);
  assert.equal(JOURNEY_STEPS, 2);
  assert.equal(AFTER_MONEY, "set", "Add trading money, then You're set");
  for (const stage of ["locked", "unlocked"] as const) assert.equal(stepFor(stage, "link"), "set", "a journey kept on the old step 3 goes on");
  const journey = read("./panel/screens/Journey.tsx");
  assert.doesNotMatch(code(journey), /of 3|onStep\("link"\)/);
  assert.match(journey, /linked=\{PHONE_LINK_SHOWN && linked\}/, "From my ZeroFee balance (On your phone: Extension) only with the tab");
  assert.match(journey, /if \(step === "link" && PHONE_LINK_SHOWN\)/);
  assert.match(read("./panel/screens/Access.tsx"), /\{PHONE_LINK_SHOWN && <Row title="Link your phone"/);
});

test("FE2: a refused trade says ZeroFee stopped it, by name, one plain line for its kind, never an id or \"we\"", () => {
  const OWNER = "11111111111111111111111111111112";
  const id = "Stake11111111111111111111111111111111111111";
  const p = extProblems.refused(`a program that isn't on the list (${id})`);
  assert.equal(p.whatHappened, "ZeroFee stopped this trade before signing it.");
  assert.equal(p.more, "It asked to use a program ZeroFee doesn't know.");
  assert.equal(p.money.state === "safe" && p.money.where, "in your trading wallet");
  assert.ok(!JSON.stringify(p).includes(id));
  assert.equal(refusedLine("SOL would leave this wallet for someone else"), "It would send money from this wallet to someone else.");
  assert.equal(refusedLine("a token instruction that could move or hand over coins"), "It could move your coins out of this wallet.");
  assert.equal(refusedLine("the priority fee is over the cap"), "Its fee was over this wallet's limit.");
  assert.equal(refusedLine("the transaction can't be read"), "It asked for more than a trade needs.");
  // no line names a base58 id, whatever the policy said
  for (const why of ["a program comes from a lookup table", `a program that isn't on the list (${OWNER})`]) assert.doesNotMatch(refusedLine(why), /[1-9A-HJ-NP-Za-km-z]{32,}/);
  assert.equal(extProblems.stale().whatHappened, "This trade waited too long, so ZeroFee didn't sign it.");
  const all = Object.values(extProblems).map((make) => (make as (...a: unknown[]) => { whatHappened: string; more?: string })(50, "2026-01-01T00:00:00.000Z"));
  for (const q of all) assert.doesNotMatch(`${q.whatHappened} ${q.more ?? ""}`, /\b[Ww]e\b|\bwe'|\bour\b/, q.whatHappened);
  assert.ok(typeof checkSolTx === "function", "control: the policy still gives its own reason, in code");
});

test("FE3: no busy line ends in an ellipsis in the panel or the phone's tab; the button keeps its word, off while it works", () => {
  const files = ["./panel/screens/Access.tsx", "./panel/screens/Journey.tsx", "./panel/screens/TradeView.tsx", "../../../packages/extension-app/src/app/ExtensionApp.tsx"];
  for (const f of files) assert.deepEqual(code(read(f)).split("\n").filter((l) => /…/.test(l)), [], f);
  assert.match(read("./panel/screens/Access.tsx"), /disabled=\{busy \|\| \(!byTouch && pass\.length === 0\)\}>\{byTouch \? "Unlock with Touch ID" : "Unlock"\}/);
});

test("FE4: a coin Solana didn't load is never a cut address on screen", () => {
  const view = read("./panel/screens/TradeView.tsx");
  assert.doesNotMatch(code(view), /mint\.slice\(/, "no cut address");
  assert.match(view, /export const COIN_LATE = "Solana didn't answer, so this coin didn't load\. Your money is in your trading wallet\.";/);
  assert.match(view, /<p className="zf-small">\{COIN_LATE\}<\/p>/, "the line on screen");
});
