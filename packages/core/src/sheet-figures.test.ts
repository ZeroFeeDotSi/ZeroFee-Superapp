// Grade 02e: every sheet's before → after is what leaves (E6), and one limit is one figure everywhere (E3).
// - E6: the restore start sheet said "NEAR 7.2318 → 7.2248" while 0.0199 left: the waiting recovery's storage was missing.
// - E3: Protection said $490, its sheet $492 and Waiting $493 for one 114.4164 NEAR limit; test NEAR's fee was $0.04
//   while the hub priced test NEAR at $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DecodedTx } from "./tx-decode.ts";
import { plainWords, formatNearShort } from "./words.ts";
import { RECOVERY_HOLD_YOCTO, bandUsd, ownAccountCall } from "./known-contracts.ts";
import { contractBands, usdBands } from "./demo-core.ts";

const NEAR = 10n ** 24n;
const self = (method: string, args: object): DecodedTx => ({
  signerId: "zf-x.testnet",
  receiverId: "zf-x.testnet",
  publicKey: { type: "ed25519", data: new Uint8Array(32), handle: "ed25519:x" } as unknown as DecodedTx["publicKey"],
  nonce: 1n,
  blockHash: "11111111111111111111111111111111",
  actions: [{ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas: 30_000_000_000_000n, depositYocto: 0n }],
});
const ctx = (network: "testnet" | "mainnet", available: bigint) => ({ network, balanceYocto: available + 3n * NEAR, availableYocto: available, gasPriceYocto: 100_000_000n, knownRecipients: new Set<string>(), nearUsd: 4.3 });
const fee = (tx: DecodedTx) => (30_000_000_000_000n + 5_000_000_000_000n) * 100_000_000n * 2n;
const short = (y: bigint) => formatNearShort(y, "down");

test("E6: the restore start sheet's NEAR line counts the recovery's storage hold, and says it comes back at Finish", () => {
  const before = 7_231_800_000_000_000_000_000_000n;
  const start = self("start_recovery", { new_key: "AA==" });
  const w = plainWords(start, ctx("testnet", before));
  assert.deepEqual(w.effect[0], { token: "NEAR", before: short(before), after: short(before - fee(start) - RECOVERY_HOLD_YOCTO) });
  // Summary first (UI-SIMPLICITY-RULES 2, 6): the hold is said word for word in the sheet's own disclosure, one tap down.
  assert.ok((w.details ?? []).flatMap((d) => d.lines).some((l) => /0\.0197 NEAR .*comes back when you finish/.test(l)), JSON.stringify(w.details));
  // The grade's own figures: 7.2318 then 7.2119 at the finish, 0.0199 gone (0.01965 held, the rest the fee burnt).
  assert.equal(short(before - RECOVERY_HOLD_YOCTO - 250_000_000_000_000_000_000n), "7.2119");
  // Finish (and a stop) gives it back: the after-figure is the balance plus the hold, "up to" (only the fee burnt comes
  // off). Grade 02h, H8: "7.0972 → 7.0958" (the most fee, 0.021, taken off) read as the 0.0197 left out; it landed 7.1161.
  for (const m of ["finish_recovery", "cancel_recovery"]) {
    const tx = self(m, {});
    const end = plainWords(tx, ctx("testnet", 7_211_900_000_000_000_000_000_000n));
    assert.equal(end.effect[0].after, `up to ${formatNearShort(7_211_900_000_000_000_000_000_000n + RECOVERY_HOLD_YOCTO, "up")}`, m);
    assert.equal(end.effect[0].after, "up to 7.2316", m);
    assert.ok(end.lines.some((l) => /0\.0197 NEAR held while it waited comes back/.test(l)), m);
  }
  assert.equal(RECOVERY_HOLD_YOCTO, (4n + 1953n + 8n) * 10n ** 19n);
});

test("E3 (02f): test NEAR's fee is in dollars at NEAR's price like mainnet's, Wallet's one sample price; NEAR alone with no price", () => {
  const tx = self("finish_recovery", {});
  assert.match(plainWords(tx, ctx("testnet", NEAR)).lines.at(-1)!, /Fee: at most about \$0\.\d\d \([\d.]+ NEAR\)\.$/);
  assert.match(plainWords(tx, { ...ctx("testnet", NEAR), nearUsd: null }).lines.at(-1)!, /Fee: at most [\d.]+ NEAR\.$/);
  assert.match(plainWords(tx, ctx("mainnet", NEAR)).lines.at(-1)!, /Fee: at most about \$0\.\d\d \([\d.]+ NEAR\)\.$/);
});

test("E3: one limit, one figure: the page (usdBands), its sheet and Waiting (bandLines) say the dollars chosen", () => {
  // Saved at $4.30; read later at $4.41 by another device (no device-kept copy): $500 on every screen.
  const onChain = contractBands([{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 3600 }], { near: 4.3 }, "testnet");
  assert.equal(usdBands(onChain, null)![0].upToUsd, 500);
  assert.equal(usdBands(onChain, 4.41)![0].upToUsd, 500);
  const sheet = ownAccountCall("set_protection", { bands: onChain }, 4.41)!.lines[0];
  assert.match(sheet, /^Payments up to \$500 \(116\.27\d* NEAR\)/);
  // The NEAR moved by under a millionth to carry the dollars.
  const near = BigInt((onChain[0] as { up_to: [string, string][] }).up_to[0][1]);
  const exact = (50_000n * NEAR * 10_000n) / 4_300_000n;
  assert.ok(exact - near < 10n ** 18n && near - exact < 10n ** 18n);
  // An older limit (no dollars carried): the same rounded "about" figure on the page and the sheet, at one price.
  const older = [{ up_to: [["near", "114416400000000000000000000"]], level: "FaceId" }, { up_to: null, level: "FaceId" }];
  assert.deepEqual(usdBands(older, 4.3)![0], { upToUsd: 490, about: true, level: "faceid" });
  assert.equal(bandUsd(older[0].up_to as [string, string][], 4.3), "about $490");
  // A tail that today's price can't be near (a request could carry any) is not believed: the price's figure instead.
  const lying = [[["near", (10n ** 27n / 10n ** 18n * 10n ** 18n + 500n * 1_000_000n + 777_777n).toString()]]] as [string, string][][];
  assert.equal(bandUsd(lying[0], 4.3), "about $4,300");
});

test("02f F1, F6: the sheet's fee is handed to screens as its own figure; a send of all never says '→ 0' when some stays", () => {
  const before = 7_199_300_000_000_000_000_000_000n;
  const send = (yocto: bigint): DecodedTx => ({ ...self("x", {}), receiverId: "guest-book.testnet", actions: [{ kind: "transfer", yocto }] });
  const all = plainWords(send(7_199_000_000_000_000_000_000_000n), ctx("testnet", before));
  assert.equal(all.effect[0].after, "under 0.0003", "7.1993 less 7.199 sent, with a fee bound of 0.001: under 0.0003 stays, never a flat 0");
  assert.ok(all.fee && all.lines.at(-1)!.endsWith(`Fee: at most ${all.fee}.`), "the fee field is the line's own figure");
  const some = plainWords(send(NEAR), ctx("testnet", before));
  assert.equal(some.effect[0].after, short(before - NEAR - 5_000_000_000_000n * 100_000_000n * 2n), "an ordinary send: the worst case, as before");
});

test("02f F10: both restore sheets say the device that has the account loses its key (the finish deletes it)", () => {
  for (const m of ["start_recovery", "finish_recovery"]) {
    const w = plainWords(self(m, m === "start_recovery" ? { new_key: "AA==" } : {}), ctx("testnet", NEAR));
    // On the sheet's first view (a line), and for the start word for word in its disclosure too (summary first, 2 Nov).
    assert.ok(w.lines.some((l) => /loses its key/.test(l)), `${m}: ${w.lines.join(" | ")}`);
    assert.ok([...w.lines, ...(w.details ?? []).flatMap((d) => d.lines)].some((l) => /loses its key and stops working for your account/.test(l)), m);
  }
  assert.ok(!plainWords(self("cancel_recovery", {}), ctx("testnet", NEAR)).lines.some((l) => /loses its key/.test(l)), "control: a stop removes no key");
});
