// Home's honest reads (the Home plan §1.1, §3; D129; the wallet bar is Safe | Hot now, safe-hot.test.ts): a failed
// read names who failed (never "Solana and NEAR" whatever failed, audit item 16), keeps the last figure "as of 10:52",
// and a phone that is offline says only that. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingStatus } from "@zerofee/core/spending";
import { shortTime } from "@zerofee/core/clock";
import { clock, withKept } from "./home-view.ts";
import { readLines } from "./read-lines.ts";

const net = (network: string, closed = false) => ({ network, name: network, cashUsd: "1.00", coinsUsd: "0.00", readyUsd: "1.00", nativeAmount: "0.01", ...(closed ? { closed: true } : {}) });
const S = (networks: unknown[], extra: Partial<SpendingStatus> = {}) => ({ loaded: true, totalUsd: "3.00", reserveUsd: "1.00", cashUsd: "3.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "497", ready: true, firstTopUp: false, onItsWay: [], networks, ...extra }) as unknown as SpendingStatus;
const AT = new Date(2026, 10, 3, 10, 52).getTime();
/** 10:52 as this device writes it (clock.ts). */
const T = shortTime(AT);

test("a failed read names who failed, never \"Solana and NEAR\" whatever failed (Home.tsx:68, :218 on main)", () => {
  assert.deepEqual(readLines({ offline: false, chains: { ids: ["hood"], at: null } }), ["Robinhood Chain didn't answer. ETH (RH) shows when it does."]);
  assert.deepEqual(readLines({ offline: false, chains: { ids: ["sol"], at: AT } }), [`Solana didn't answer. SOL is as of ${T}.`]);
  assert.deepEqual(readLines({ offline: false, chains: { ids: ["sol", "hood"], at: AT } }), [`Solana and Robinhood Chain didn't answer. SOL and ETH (RH) are as of ${T}.`]);
  // Trading's balance is 1Click's confidential count (subwallets.ts heldBy): 1Click, never NEAR
  assert.deepEqual(readLines({ offline: false, oneClick: { at: AT } }), [`NEAR Intents didn't answer. Your wallets are as of ${T}.`]);
  assert.deepEqual(readLines({ offline: false, oneClick: { at: null } }), ["NEAR Intents didn't answer, so your wallets show when it does."]);
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: AT } }), [`NEAR didn't answer. Your Safe is as of ${T}. Your money is still in it.`]);
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR Intents' bridge", at: null } }), ["NEAR Intents' bridge didn't answer. Your Safe is as last read. Your money is still in it."]);
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: null, shown: false } }), ["NEAR didn't answer, so your Safe shows when it does. Your money is still in it."], "nothing kept: never \"as last read\"");
  assert.deepEqual(readLines({ offline: false, trade: true }), ["Trade didn't answer. Coins you bought show when it does."]);
  // control: Robinhood failing alone never blames Solana or NEAR; nothing failed, nothing said
  assert.doesNotMatch(readLines({ offline: false, chains: { ids: ["hood"], at: null } }).join(" "), /Solana|NEAR/);
  assert.deepEqual(readLines({ offline: false }), []);
  for (const l of readLines({ offline: false, safe: { by: "NEAR", at: AT }, oneClick: { at: AT }, chains: { ids: ["sol"], at: AT }, trade: true })) assert.doesNotMatch(l, /\$0|went wrong|error|we can't|please|!/i, l);
});

test("a phone that is offline says only that, with the time of its figures", () => {
  assert.deepEqual(readLines({ offline: true, safe: { by: "NEAR", at: AT }, oneClick: { at: AT } }), [`You're offline. This is your money as of ${T}.`]);
  assert.deepEqual(readLines({ offline: true }), [], "control: offline with every figure read says nothing");
});

test("a read that failed keeps the last figure: 1Click unread is the kept copy; a chain left out keeps its kept row", () => {
  const kept = S([net("sol"), net("hood")]);
  const unread = S([], { loaded: false, unread: true });
  assert.deepEqual(withKept(unread, kept), { s: kept, stale: "all" });
  assert.deepEqual(withKept(unread, null), { s: unread, stale: [] }, "control: nothing kept, the unread answer as it is (never $0)");
  const nearOnly = S([]);
  const merged = withKept(nearOnly, kept);
  assert.deepEqual([merged.s?.networks.map((n) => n.network), merged.stale], [["sol", "hood"], ["sol", "hood"]]);
  const full = S([net("sol"), net("hood")], { totalUsd: "9.00" });
  assert.deepEqual(withKept(full, kept), { s: full, stale: [] }, "control: a full answer is the answer");
  assert.deepEqual(withKept(S([net("sol")]), kept).stale, ["hood"]);
});

test("QA's MUST (Sim test: Hot $0.00 for about 30 s after a reload): a fresh read before the wallets answer keeps the kept rows AND their dollars in the total, never $0.00 (control: a full answer is its own total)", () => {
  const kept = S([{ ...net("sol"), cashUsd: "175.14", coinsUsd: "2.47" }, { ...net("hood"), cashUsd: "28.98" }], { totalUsd: "241.59" });
  // the engine's first read: the NEAR wallet in, no chain wallet yet (each unread chain is left out, core spending.ts)
  const early = S([], { totalUsd: "0.00", cashUsd: "0.00", coinsUsd: "0.00", reserveUsd: "0.00" });
  const m = withKept(early, kept);
  assert.equal(m.s!.totalUsd, "206.59", "the kept wallets' dollars: 175.14 + 2.47 + 28.98");
  assert.equal(m.s!.cashUsd, "204.12");
  assert.equal(m.s!.coinsUsd, "2.47");
  assert.deepEqual(m.stale, ["sol", "hood"]);
  // one chain in: only the other is kept, added once
  const half = withKept(S([{ ...net("sol"), cashUsd: "180.00" }], { totalUsd: "215.00" }), kept);
  assert.equal(half.s!.totalUsd, "243.98");
  const full = S([net("sol"), net("hood")], { totalUsd: "0.00" });
  assert.equal(withKept(full, kept).s!.totalUsd, "0.00", "control: a full answer stands, even an empty one");
});

test("the time reads as the phone's clock (one format across Home, clock.ts): 10:52 on a 24-hour phone, 10:52 AM on a 12-hour one", () => {
  assert.equal(clock(AT), shortTime(AT));
  assert.equal(shortTime(AT, "en-GB"), "10:52");
  assert.match(shortTime(AT, "en-US"), /^10:52\s?AM$/);
});
