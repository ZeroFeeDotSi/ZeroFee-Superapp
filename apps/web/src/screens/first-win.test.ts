// O-2b, the first win: when it is offered, how much, its words, and that every way out leads into ZeroFee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { grade } from "../../../../tools/copy/voice.ts";
import { SEND_MORE_LINE } from "./fund.ts";
import { markWinSeen, readWin, winOffer, winSeen, winStateOf, WIN_GAS_NEAR, WIN_SEEN_KEY, WIN_WORDS, type WinFacts } from "./first-win.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const base: WinFacts = { pocket: { available: true, ready: false, canAdd: true }, kid: false, near: { amount: "1.2", usd: "5.40" }, seen: false };

function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

test("offered with $2 of NEAR at a live price: $2 of NEAR, Hidden's wallet made first if needed", () => {
  const o = winOffer(base)!;
  assert.equal(o.usd, 2);
  assert.equal(o.near, "0.44445", "$2 at $4.50 a NEAR, rounded up: never under $2");
  assert.equal(o.setUp, true);
  assert.equal(winOffer({ ...base, pocket: { available: true, ready: true, canAdd: true } })!.setUp, false, "already made: not again");
});

test("not offered where it can't work, each for its own reason (controls: change only that fact and it is offered)", () => {
  const cases: [string, Partial<WinFacts>][] = [
    ["shown before on this device", { seen: true }],
    ["a child's account (D30: no Hidden)", { kid: true }],
    ["Hidden is not open on this build", { pocket: { available: false, ready: false, canAdd: true } }],
    ["a move into Hidden can't be priced here (review H1: the shipped build's route is closed)", { pocket: { available: true, ready: true, canAdd: false } }],
    ["canAdd unsaid (an older Wallet): never assumed", { pocket: { available: true, ready: true } }],
    ["Hidden unread", { pocket: null }],
    ["no NEAR on the account", { near: null }],
    ["a kept price never sizes a move (B28)", { near: { amount: "1.2", usd: "5.40", priceKept: true } }],
    ["no price", { near: { amount: "1.2" } }],
    ["under $2 in the Safe", { near: { amount: "0.4", usd: "1.80" } }],
  ];
  for (const [why, over] of cases) {
    assert.equal(winOffer({ ...base, ...over }), null, why);
    assert.ok(winOffer(base), `control for "${why}"`);
  }
});

test("the fee's NEAR always stays: exactly $2 in the Safe hides a little less, never the last of it; too little after that, no offer", () => {
  const exact = winOffer({ ...base, near: { amount: "0.5", usd: "2.00" } })!;
  assert.ok(Number(exact.near) <= 0.5 - WIN_GAS_NEAR + 1e-12, `kept back ${WIN_GAS_NEAR} NEAR: ${exact.near}`);
  assert.equal(exact.usd, 1.96);
  assert.equal(WIN_WORDS.go(exact.usd), "Hide $1.96", "the button says the real dollars");
  // A pricey NEAR whose fee reserve leaves under $1.50: not offered.
  assert.equal(winOffer({ ...base, near: { amount: "0.012", usd: "2.40" } }), null);
  // Plenty in the Safe: never more than $2.
  assert.equal(winOffer({ ...base, near: { amount: "100", usd: "450" } })!.usd, 2);
});

test("a movement's status: done is done; refunded or a problem fails (the money stays or comes back); the rest still moves", () => {
  assert.equal(winStateOf("done"), "done");
  assert.equal(winStateOf("refunded"), "failed");
  assert.equal(winStateOf("problem"), "failed");
  for (const s of ["moving", "waiting", undefined]) assert.equal(winStateOf(s), "moving", String(s));
});

test("offered once per device; storage that refuses never asks again and again", () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(winSeen(store), false);
  markWinSeen(store);
  assert.equal(m.get(WIN_SEEN_KEY), "1");
  assert.equal(winSeen(store), true);
  assert.equal(winSeen({ getItem: () => { throw new Error("denied"); } }), true);
});

test("readWin: a slow or failing read means no offer, within its time, so Open ZeroFee is never held up", async () => {
  const never: Bridge = { call: () => new Promise(() => undefined), on: () => () => undefined };
  const t0 = Date.now();
  assert.equal(await readWin(never, never, 50), null);
  assert.ok(Date.now() - t0 < 1000);
  const failing: Bridge = { call: async () => ({ problem: { code: "x", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }) as never, on: () => () => undefined };
  assert.equal(await readWin(failing, failing, 50), null);
  // Control: all three answer: offered.
  const shell: Bridge = { call: async () => ({ ok: { stage: "ready" } }) as never, on: () => () => undefined };
  const wallet: Bridge = {
    call: async (m: string) => ({ ok: m === "ledger.private" ? { available: true, ready: true, canAdd: true } : [{ tokenId: "near", held: "account", amount: "1.2", usd: "5.40" }] }) as never,
    on: () => () => undefined,
  };
  assert.deepEqual(await readWin(shell, wallet, 50), { near: "0.44445", usd: 2, setUp: false });
});

test("the words: grade 5, voice A or B, Private never Hidden (product decision, 5 Nov), and nothing claims more than Private gives", () => {
  const lines = [WIN_WORDS.line(2), WIN_WORDS.cameBack, WIN_WORDS.heldTitle, WIN_WORDS.heldLine, WIN_WORDS.moving(2), WIN_WORDS.slow, WIN_WORDS.doneLine, WIN_WORDS.safe, WIN_WORDS.failTitle, WIN_WORDS.getting, SEND_MORE_LINE];
  const bad = lines.flatMap((s) => {
    const why: string[] = [];
    if (s.split(/\s+/).length > 3 && fkGrade(s) > 5) why.push(`${s}: grade ${fkGrade(s).toFixed(1)}`);
    const g = grade("first-win", s);
    if (g.grade !== "A" && g.grade !== "B") why.push(`${s}: ${g.grade} ${g.problems.join("; ")}`);
    if (/\bhidden\b|spending|deposit|nobody can see|no one can see|invisible|untraceable/i.test(s)) why.push(`${s}: a word or a claim`);
    return why;
  });
  assert.deepEqual(bad, []);
  // Review Low: the offer says Hidden's own limits in its own words (PRIVATE_SEEN), never more.
  assert.match(src("./FirstWin.tsx"), /note=\{PRIVATE_SEEN\}/);
});

test("only Wallet's own doors, never a send of its own (the paths themselves: first-win-screen.test.ts)", () => {
  const f = src("./FirstWin.tsx");
  for (const m of f.matchAll(/wallet\.call(?:<[^>]*>)?\("([^"]+)"/g)) assert.ok(["ledger.privateSetup", "ledger.quoteToPrivate", "ledger.toPrivate", "ledger.activity"].includes(m[1]), m[1]);
});

test("the first win never weighs on the first load: FundStart loads it lazily and imports only its types (control: the pattern sees a static import)", () => {
  const fs = src("./FundStart.tsx");
  assert.match(fs, /lazy\(\(\) => import\("\.\/FirstWin\.tsx"\)/);
  assert.match(fs, /const look = import\("\.\/FirstWin\.tsx"\)\.then\(\(m\) => m\.readWin\(bridge, wallet\)\)/, "the offer's reads load with it, after 'Open ZeroFee', bounded");
  const statics = /^import (?!type )[^\n]*from "\.\/(FirstWin\.tsx|first-win\.ts)";$/m;
  assert.doesNotMatch(fs, statics);
  assert.match('import { readWin } from "./first-win.ts";', statics);
});
