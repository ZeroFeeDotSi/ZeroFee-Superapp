// A site's top-up, one exit (QA, 5 Nov): the ledger's Move from Private with `whole` (float-private.ts asks it
// for a site's Add). Private short: exactly ONE fill (the Safe's one sheet, Face ID) and then ONE exit to the site's
// wallet; Private's own share stays. Private covers: no fill, one exit, the Safe signs nothing. Control: without
// `whole` (Home's Move), Private's share pays first and the fill pays the rest, two exits, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { fillStepUsd } from "@zerofee/core/private-route";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SITE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const JOB = "site-topup-0123456789abcdef0123";
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT }, { kind: "site", id: "sw-site-pump", chain: "sol", address: SITE, site: "pump" }];

function setup(o: { pocketUnits: string; fillOpen?: boolean }) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: o.pocketUnits }], subwallets: WALLETS as never });
  const asked: any[] = [];
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    quote: async (req: any) => { asked.push(req); return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any; },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async (_a: string, _via?: string, tag?: string) => ({ status: "SUCCESS", ...(tag ? { swapDetails: { amountOut: "999999999999999999999999" } } : {}) } as any),
  };
  const chain = fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } });
  const ledger = createLedgerService({ bridge: core as Bridge, chain, apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: o.fillOpen ?? false });
  return { ledger, core, asked };
}
const pay = (s: ReturnType<typeof setup>, usd: number, whole: boolean) => s.ledger.call<{ parts: { wallet: string; ids: string[] }[] }>("ledger.moveFromPrivate", { parts: [{ wallet: "sw-site-pump", usd }], job: JOB, caller: "trade", ...(whole ? { whole: true } : {}) });
const exits = (s: ReturnType<typeof setup>) => s.asked.filter((q) => !q.dry && q.recipient === SITE);

test("from the Safe (Private short): exactly ONE fill, the whole amount rounded up a step, under ONE Face ID, then ONE exit to the site's wallet; Private's own share stays (control: Home's Move without `whole` pays two exits once Private's share is past its buffer)", async () => {
  const s = setup({ pocketUnits: "12500000", fillOpen: true });
  const r = await pay(s, 30, true);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["safe-send"], "one job: the fill and its exit");
  assert.equal((r.ok.parts[0] as { minOut?: string }).minOut, "6900", "83: the site's one exit names its quoted least (its tick waits for a read that shows it)");
  assert.equal(s.core.privateIns.length, 1, "one fill");
  assert.equal(Number(s.core.privateIns[0]!.amount) / 1e6, fillStepUsd(30), "the whole $30 rounded up a step, never the $17.50 gap");
  assert.equal(s.core.signed.length, 1, "one Safe sheet: one Face ID");
  assert.equal(exits(s).length, 1, "one exit to the site's wallet");
  assert.equal(s.core.privatePays.length, 1);
  assert.deepEqual([exits(s)[0].depositType, exits(s)[0].recipientType, exits(s)[0].refundTo], ["CONFIDENTIAL_INTENTS", "DESTINATION_CHAIN", POCKET]);
  // one Face ID (6 Nov): the same Move without `whole` folds the same way while Private stays under its $500 buffer (the audit's R2)
  const f = setup({ pocketUnits: "12500000", fillOpen: true });
  const folded = await pay(f, 30, false);
  assert.ok("ok" in folded);
  assert.deepEqual([folded.ok.parts[0]!.ids.map((id) => id.split(":")[0]), exits(f).length, f.core.signed.length], [["safe-send"], 1, 1]);
  // control: past the buffer (Private's $450 plus the whole fill's step) without `whole`: Private's share, then the fill's
  // part, two exits
  const c = setup({ pocketUnits: "450000000", fillOpen: true });
  const two = await pay(c, 600, false);
  assert.ok("ok" in two);
  assert.deepEqual(two.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["pocket-send", "safe-send"]);
  assert.equal(exits(c).length, 2);
});

test("Private covers it: no fill, one exit, the Safe signs nothing, `whole` or not", async () => {
  for (const whole of [true, false]) {
    const s = setup({ pocketUnits: "25000000", fillOpen: true });
    const r = await pay(s, 10, whole);
    assert.ok("ok" in r);
    assert.deepEqual(r.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["pocket-send"]);
    assert.deepEqual([s.core.privateIns.length, s.core.signed.length, exits(s).length], [0, 0, 1], String(whole));
    assert.deepEqual(s.core.privatePays.map((p) => p.send), [true], "the pocket's own payment: the core counts it in the one cap (site-topup-cap.test.ts)");
  }
});

test("Private short and the fill closed: `whole` changes nothing, refused before anything", async () => {
  const s = setup({ pocketUnits: "3000000" });
  const r = await pay(s, 10, true);
  assert.ok("problem" in r);
  assert.equal(r.problem.code, "ledger.private.short");
  assert.deepEqual([s.asked.length, s.core.signed.length, s.core.privateIns.length], [0, 0, 0]);
});
