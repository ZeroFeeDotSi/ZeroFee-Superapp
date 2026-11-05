// Security F2 / D34: the card wallet (kind "pay", Gnosis) holds at most $250; a move in past that is refused before signing.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Problem } from "@zerofee/core/bridge";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const USDC_GNOSIS = "nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near";
const CARD = "0x5a3e000000000000000000000000000000005a3e";
const OTHER = "0x6b4f000000000000000000000000000000006b4f";
/** The fixture's own price for this coin: the cap is measured at the catalogue price, so the tests are too. */
const PRICE = (() => {
  const t = JSON.parse(readFileSync(new URL("./testing/fixtures/oneclick-tokens.json", import.meta.url), "utf8")) as { tokens: { assetId: string; price: number }[] };
  return t.tokens.find((x) => x.assetId === USDC_GNOSIS)!.price;
})();
/** Whole coins worth `dollars` (rounded down to 6 places, so never over). */
const coins = (dollars: number) => Math.floor((dollars / PRICE) * 1e6) / 1e6;
const usdc = (dollars: number) => String(Math.round(coins(dollars) * 1e6));

function setup(held: number, kind = "pay") {
  const core = fakeCore({
    accountId: ME,
    subwallets: [{ kind, address: CARD }],
    balances: [{ token: "native", symbol: "xDAI", decimals: 18, amount: "0" }, { token: "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0", symbol: "USDC.e", decimals: 6, amount: usdc(held) }],
  });
  const ledger = createLedgerService({ bridge: core, chain: fakeNear(ME, { ledger: { [USDC_GNOSIS]: usdc(1000) } }), apis: createApis(replayFetch()), trackMs: 5, readCall: async () => ({ kind: "ran" }) });
  return { core, ledger };
}
const send = (ledger: ReturnType<typeof setup>["ledger"], amount: string, toAddress = CARD) => ledger.call("ledger.withdraw", { tokenId: USDC_GNOSIS, amount, toAddress, chain: "gnosis" });

test("the card wallet takes a move in that keeps it at or under $250", async () => {
  const under = setup(230);
  const r = await send(under.ledger, String(coins(10)));
  assert.ok(!("problem" in r) || r.problem.code !== "ledger.card.cap", "under the cap is not refused for the cap");
  const exact = setup(230);
  const e = await send(exact.ledger, String(coins(20)));
  assert.ok(!("problem" in e) || e.problem.code !== "ledger.card.cap", "exactly $250 is allowed");
});

test("a move in past $250 is refused in plain words, before anything is signed", async () => {
  const { ledger, core } = setup(230);
  const r = await send(ledger, String(coins(20.5)));
  assert.ok("problem" in r);
  const p = r.problem as Problem;
  assert.equal(p.code, "ledger.card.cap");
  assert.match(p.whatHappened, /^Your card wallet holds up to \$250\. It has \$229\.99, so you can add up to \$20\.01\.$/, "held and room, to the cent, at the catalogue price");
  assert.deepEqual(p.money, { state: "safe", where: "in your Safe" });
  assert.equal(core.signed.length, 0, "nothing was signed");
});

test("a wallet that isn't the card wallet is unaffected by the cap", async () => {
  const trade = setup(230, "trade");
  const a = await send(trade.ledger, "100");
  assert.ok(!("problem" in a) || a.problem.code !== "ledger.card.cap");
  const elsewhere = setup(230);
  const b = await send(elsewhere.ledger, "100", OTHER);
  assert.ok(!("problem" in b) || b.problem.code !== "ledger.card.cap");
});
