// ALPHA: the card's few-tap set-up and the one-tap repeats, as journeys: what the person copied in the card's own app
// is read, proven and saved with no typing, and a repeat goes straight to Face ID unless there's something to say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PayFlow, type Step } from "../pay.ts";
import { FakeLedger, USDC_NEAR } from "../testing/fake-ledger.ts";
import { CARDS, FIRST_TOPUP_MAX, checkAndSaveCard, loadCard, markConfirmed, nextTopUpAmount, readCardAddress, rememberTopUp } from "./cards.ts";

const GNOSIS = CARDS.find((c) => c.id === "gnosis-pay")!;
const SAFE = "0x5a3e000000000000000000000000000000005a3e";
const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};

test("what was copied in the card's app is read as its address: a bare address or a link naming one", () => {
  assert.equal(readCardAddress(` ${SAFE}\n`, GNOSIS), SAFE);
  assert.equal(readCardAddress(`ethereum:${SAFE}@100`, GNOSIS), SAFE);
  assert.equal(readCardAddress("my card", GNOSIS), null);
  assert.equal(readCardAddress("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", GNOSIS), null, "not a Gnosis Chain address");
  assert.equal(readCardAddress(null, GNOSIS), null);
});

test("one tap proves and saves the card; a look-alike or an unprovable one is a Problem and nothing is saved", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: {}, cardAccounts: [SAFE.toLowerCase()] });
  const saved = await checkAndSaveCard(ledger, GNOSIS, SAFE, "EURe");
  assert.ok("ok" in saved);
  assert.deepEqual(await loadCard(ledger), { productId: "gnosis-pay", address: SAFE, coin: "EURe" });

  const other = new FakeLedger({ accountId: "me.near", balances: {}, cardAccounts: [] });
  const wrong = await checkAndSaveCard(other, GNOSIS, SAFE, "EURe");
  assert.ok("problem" in wrong && wrong.problem.code === "pay.card.not-card");
  assert.equal(await loadCard(other), null);

  const unchecked = new FakeLedger({ accountId: "me.near", balances: {} });
  const none = await checkAndSaveCard(unchecked, GNOSIS, SAFE, "EURe");
  assert.ok("problem" in none && none.problem.code === "pay.card.unchecked");
  assert.equal(await loadCard(unchecked), null);
});

test("a top-up starts at the small first one, then at the last one once the card is confirmed", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: {}, cardAccounts: [SAFE.toLowerCase()] });
  await checkAndSaveCard(ledger, GNOSIS, SAFE, "EURe");
  assert.equal(nextTopUpAmount((await loadCard(ledger))!), FIRST_TOPUP_MAX);
  await markConfirmed(ledger);
  assert.equal(nextTopUpAmount((await loadCard(ledger))!), "0", "nothing remembered yet");
  await rememberTopUp(ledger, "20");
  assert.equal(nextTopUpAmount((await loadCard(ledger))!), "20");
});

test("a repeat goes straight to the approval sheet: one tap, then Face ID", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "100" } });
  const flow = new PayFlow({ bridge: ledger });
  await flow.warm();
  const t = { to: { kind: "ledger" as const, accountId: "alex.near" }, token: flow.tokens!.byAsset(USDC_NEAR)!, amount: "5", notes: [], name: "Alex" };
  kind(await flow.sendAtOnce(t), "paid");
  assert.ok(ledger.calls.some((c) => c.method === "ledger.transfer"));
});

test("but Confirm still comes first when there's something to say: a hold, or the Private switch", async () => {
  const held = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "500" }, protection: { level: "wait", waitSeconds: 86400, text: "This goes on hold for 24 hours first." } });
  const a = new PayFlow({ bridge: held, anyCoin: true });
  await a.warm();
  const out = { to: { kind: "chain" as const, chain: "near", address: "shop.near" }, token: a.tokens!.byAsset(USDC_NEAR)!, amount: "300", notes: [] };
  assert.ok(kind(await a.sendAtOnce(out), "confirm").confirm.hold);
  assert.equal(held.calls.some((c) => c.method === "ledger.pay"), false);

  const pocket = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "100" }, pocket: { available: true, ready: true, balances: { [USDC_NEAR]: "40" } } });
  const b = new PayFlow({ bridge: pocket });
  await b.warm();
  assert.ok(kind(await b.sendAtOnce({ ...out, amount: "4" }), "confirm").confirm.privacy);
});

test("Get Gnosis Pay opens its consumer app, where a person signs up and orders the card, never the business pages", () => {
  assert.equal(GNOSIS.signupUrl, "https://app.gnosispay.com");
  assert.match(GNOSIS.signupNote, /checks that first/);
});

test("Get Gnosis Pay first makes the card's own wallet (kind pay, on Gnosis Chain), never the Browser wallet", async () => {
  const { ensureCardWallet } = await import("./cards.ts");
  const ledger = new FakeLedger({ accountId: "me.near", balances: {} });
  const w = await ensureCardWallet(ledger);
  assert.ok("ok" in w && /^0x[0-9a-f]{40}$/.test(w.ok.address));
  assert.deepEqual(ledger.calls.find((c) => c.method === "subwallet.create")?.params, { kind: "pay", chain: "gnosis" });
});
