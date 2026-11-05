// The first run's amount tap answers at once and always ends (a mainnet test, 4 Nov).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAILED_LINE, SLOW_LINE, fundTap } from "./fund-tap.ts";

test("set-up refused: its own line comes back to show above the amounts", async () => {
  assert.deepEqual(await fundTap(async () => ({ line: "Set the right time, then try again." })), { line: "Set the right time, then try again.", final: false });
});
test("set-up throws: the plain line, never silence", async () => {
  assert.deepEqual(await fundTap(async () => { throw new Error("bridge gone"); }), { line: FAILED_LINE, final: false });
});
test("set-up hangs: a line after the limit, never a dead button", async () => {
  const t0 = Date.now();
  assert.deepEqual(await fundTap(() => new Promise(() => {}), 30), { line: SLOW_LINE, final: false });
  assert.ok(Date.now() - t0 < 1000);
});
test("a build whose core has no AgentZero wallet (testnet: security.method.unknown): final, so the amounts go; any other code stays retryable", async () => {
  assert.deepEqual(await fundTap(async () => ({ line: "This part of the app isn't ready yet.", code: "security.method.unknown" })), { line: "This part of the app isn't ready yet.", final: true });
  assert.deepEqual(await fundTap(async () => ({ line: "Couldn't reach NEAR.", code: "near.unreachable" })), { line: "Couldn't reach NEAR.", final: false });
});
test("control: set-up ok, or the person said no: no line", async () => {
  assert.equal(await fundTap(async () => ({ ok: true })), null);
  assert.equal(await fundTap(async () => ({ declined: true })), null);
});
test("the card: the tapped amount says Opening… at once, the others wait, the line is an alert above the amounts; the chat hands the result back", () => {
  const card = readFileSync(new URL("./AgentWallet.tsx", import.meta.url), "utf8");
  const fund = card.slice(card.indexOf("export function FundCard("), card.indexOf("/** The one line above the box"));
  assert.match(fund, /setBusy\(usd \?\? "other"\);\s*setLine\(null\);\s*const said = await fundTap/, "busy is set before set-up starts");
  assert.match(fund, /busy === a \? OPENING/);
  assert.match(fund, /disabled=\{busy !== null\}/);
  assert.ok(fund.indexOf('role="alert"') < fund.indexOf("azw-amounts"), "the line sits above the amounts");
  assert.match(fund, /\{!line\?\.final && <div className="azw-amounts"/, "a final refusal drops the amounts");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /onAmount=\{\(usd\) => wallet!\.setup\(\)\.then\(\(r\) => \{ if \("ok" in r\) setWalletSheet\(\{ start: "fill"[^}]*\}\); return r; \}\)\}/);
  assert.doesNotMatch(chat, /onAmount=\{\(usd\) => void wallet/);
  assert.match(chat, /wallet \? <div className="azw-meter-slot">\{!fundFirst && <Suspense/, "the meter's place is held from the first paint");
  const css = readFileSync(new URL("./wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.azw-meter-slot \{[^}]*min-height: 40px/);
});
