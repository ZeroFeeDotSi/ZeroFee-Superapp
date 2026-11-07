// the audit's way-home audit M9 (7 Nov) in the wallet, and QA 16's SHOULD on P2: a way home's refusal reaches the person in the
// core's plain reason, never the generic "This wallet can't approve this, so ZeroFee said no." (the Jobs row, the part
// that went), and every coin is named ("$5.00 of it" and "?" were the fallbacks). Fails on p2's tip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { securityProblems } from "@zerofee/core/security-problems";
import { fromPrivate, homePartWent } from "./private-pay.ts";
import { refusalWords as homeStopWords } from "@zerofee/shell-api/refusal-face.ts";

const USDC = "nep141:usdc", ODD = "nep141:odd.near", NEAR = "nep141:wrap.near";
// the core's own way-home refusal, as pocket-moves now writes it
const coreNo = () => ({ ...securityProblems.subwalletRefused("NEAR Intents said no. Your money is still in Private. Try again in a minute."), whatHappened: "NEAR Intents said no.", money: { state: "safe" as const, where: "in Private" } });
const problemOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { problem: { whatHappened: string } }).problem; } throw new Error("no refusal"); };
function rig(rows: { tokenId: string; amount: string; symbol?: string; name?: string; usd?: string | null }[], refuse: string, problem: unknown) {
  return {
    rows,
    home: async (t: string) => (t === refuse ? ({ problem } as never) : ({ ok: { id: `pm-${t.slice(-4)}`, status: "pending" } } as never)),
    status: () => "moving" as const, remember: async () => {}, emit: () => {}, iso: () => "2026-11-08T00:00:00.000Z",
  };
}

test("M9: the part that went says the core's reason by name, never the generic refusal sentence", async () => {
  const x = rig([{ tokenId: USDC, amount: "25", symbol: "USDC", usd: "25.00" }, { tokenId: NEAR, amount: "2", symbol: "NEAR", usd: "8.86" }], NEAR, coreNo());
  const p = await problemOf(fromPrivate({}, "wallet", x));
  assert.equal(p.whatHappened, "$25.00 of USDC is on its way to your Safe. NEAR is still in Private. NEAR Intents said no.");
  // control: the generic one (no reason of its own) is never quoted either: its head is "ZeroFee said no."
  const bare = homePartWent(securityProblems.subwalletRefused(""), ["$5.00 of USDC"], ["NEAR"]);
  assert.doesNotMatch(bare.whatHappened, /can't approve this|that wallet/);
});

test("QA 16's SHOULD: a coin the catalogue doesn't know is named \"an unnamed coin\", never \"?\" or \"it\"; known coins by symbol", async () => {
  const went = rig([{ tokenId: ODD, amount: "3", symbol: "?", name: "An unnamed coin", usd: "5.00" }, { tokenId: NEAR, amount: "2", symbol: "NEAR", usd: "8.86" }], NEAR, coreNo());
  assert.equal((await problemOf(fromPrivate({}, "wallet", went))).whatHappened, "$5.00 of an unnamed coin is on its way to your Safe. NEAR is still in Private. NEAR Intents said no.");
  const left = rig([{ tokenId: USDC, amount: "25", symbol: "USDC", usd: "25.00" }, { tokenId: NEAR, amount: "2", symbol: "NEAR", usd: "8.86" }, { tokenId: ODD, amount: "3", symbol: "?", usd: null }], NEAR, coreNo());
  const w = (await problemOf(fromPrivate({}, "wallet", left))).whatHappened;
  assert.equal(w, "$25.00 of USDC is on its way to your Safe. NEAR and an unnamed coin are still in Private. NEAR Intents said no.");
  assert.doesNotMatch(w, /\?|\bit\b|the rest/);
});

test("M9: the way home's Jobs row says the refusal's own words, head then body (control: any other Problem its own)", () => {
  assert.equal(homeStopWords(coreNo()), "NEAR Intents said no. Your money is still in Private. Try again in a minute.");
  assert.equal(homeStopWords({ code: "ledger.private.home.part-went", whatHappened: "$5.00 of USDC is on its way to your Safe.", money: { state: "on-the-way", where: "x" }, next: { kind: "nothing", label: "Go back" } }), "$5.00 of USDC is on its way to your Safe.");
  const src = readFileSync(new URL("./app/screens/Private.tsx", import.meta.url), "utf8");
  assert.match(src, /declined: \(r\) => "problem" in r && \/declined\$\/\.test\(r\.problem\.code\),\n\s+\/\/[^\n]*\n\s+words: refusalWords,/);
});
