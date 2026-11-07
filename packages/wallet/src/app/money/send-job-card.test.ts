// QA QA's SHOULD (8 Nov, jobs walk: 01d vs 03e): a Swap's job page has the From and To card ("From Private / To SOL
// wallet"); a Send's page had none. the copy review's spec (7 Nov): every job kind draws the same face. The Send's page now has the
// same card: From where its money left by Home's name (sendFrom, as Activity's row says it), To whom it paid. Fails on
// main: job-face.ts has no jobEnds and sendTrack keeps no payee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Movement } from "../../types.ts";
import { sendFrom } from "../format.ts";
import { sendTrack, type LiveTrack } from "./live-steps.ts";
import { FACE_CARD, jobEnds } from "./job-face.ts";

const T0 = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const mv = (o: Partial<Movement>): Movement => ({ id: "safe-send:s1", kind: "pay", status: "done", amount: "25000000", startedAtIso: iso(T0), updatedAtIso: iso(T0 + 6_000), explorerUrls: ["https://nearblocks.io/txns/abc"], to: "alice.near", private: true, ...o });

test("QA 20: a Send's job page has the Swap page's From and To card: From your Safe's \"Safe\", To \"alice.near\"; going and done alike", () => {
  for (const status of ["done", "moving"] as const) {
    const m = mv({ status });
    const t = sendTrack(m, sendFrom(m), "alice.near", "$25.00")!;
    assert.deepEqual(jobEnds(t), { from: "Safe", to: "alice.near" }, status);
  }
  assert.deepEqual(FACE_CARD, { from: "From", to: "To" }, "the card's two labels, as the Swap's");
});

test("QA 20: the From is where the money left, by the one rule Activity's row reads (Private's own payment: Private; a wallet's: its name); To is the payee as the page says it", () => {
  const priv = mv({ id: "pocket-send:p1" });
  assert.deepEqual(jobEnds(sendTrack(priv, sendFrom(priv), "bob.near", "$5.00")!), { from: "Private", to: "bob.near" });
  assert.deepEqual(jobEnds(sendTrack(mv({ id: "hidden-row:h1" }), "sol", "0x7D06…7e3D", "$5.00")!), { from: "SOL wallet", to: "0x7D06…7e3D" });
});

test("controls: no payee said (\"them\") or no record names where it left: no card, never a guess; a Swap's and a Move's own ends are unchanged", () => {
  assert.equal(jobEnds(sendTrack(mv({}), "safe", "them", "$5.00")!), null, "no payee");
  const unnamed = mv({ id: "x-send:u1", private: true });
  assert.equal(sendFrom(unnamed), "", "the table names no place for it");
  assert.equal(jobEnds(sendTrack(unnamed, sendFrom(unnamed), "alice.near", "$5.00")!), null, "no place: no card");
  const swap: LiveTrack = { id: "swap:x", kind: "swap", title: "Swap $25.00 of USDC for SOL", wallets: ["sol"], startMs: T0, steps: [], money: { at: ["sol"], from: ["private"], to: ["sol"] } };
  assert.deepEqual(jobEnds(swap), { from: "Private", to: "SOL wallet" });
  assert.equal(jobEnds({ ...swap, money: { at: [], from: [], to: [] } }), null, "control: no ends, no card");
  // the page draws the card from jobEnds alone
  const page = readFileSync(new URL("./LiveTrack.tsx", import.meta.url), "utf8");
  assert.match(page, /const ends = jobEnds\(t\);/);
  assert.match(page, /\{ends && <div className="lv-job__card"><div><span>\{FACE_CARD\.from\}<\/span><b>\{ends\.from\}<\/b><\/div><div><span>\{FACE_CARD\.to\}<\/span><b>\{ends\.to\}<\/b><\/div><\/div>\}/);
});
