// The ledger signs as the app that asked, lets only Wallet and Pay move money (any other app only withdraws to its own
// kind of wallet), and keeps each app's movements to that app and Wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { createApis } from "./apis.ts";
import { createLedgerService, ownMovements, type Caller } from "./ledger.ts";
import type { Movement } from "./types.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOL_ADDR = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const OTHER_SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function setup(o: { wallets?: { kind: string; address: string }[] } = {}) {
  const core = fakeCore({ accountId: ME });
  const asked: [Caller, string][] = [];
  const bridgeFor = (caller: Caller): Bridge => ({
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      asked.push([caller, method]);
      // Every kind, unfiltered: the core lists only the caller's own, but the ledger checks the kind itself too.
      if (method === "subwallet.list") return { ok: (o.wallets ?? []).map((w) => ({ id: w.address, chain: "sol", label: "", ...w })) as T };
      return core.call<T>(method, params);
    },
    on: (event, handler) => core.on(event, handler),
  });
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC_SOL]: "90000000" } }), apis: createApis(replayFetch()), readCall: async () => ({ kind: "ran" }) });
  return { core, asked, ledger };
}

async function ok<T>(ledger: Bridge, method: string, params?: Record<string, unknown>): Promise<T> {
  const r = await ledger.call<T>(method, params);
  if ("problem" in r) assert.fail(`${method} gave ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
}
const refusal = async (ledger: Bridge, method: string, params: Record<string, unknown>) => {
  const r = await ledger.call(method, params);
  assert.ok("problem" in r, `${method} as ${params.caller} should be refused`);
  return [r.problem.code, r.problem.whatHappened];
};

test("a request is signed as the app that asked, so the sheet's hint names it; storage stays Wallet's", async () => {
  const { ledger, asked } = setup();
  await ok(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near", caller: "pay" });
  assert.deepEqual(asked.filter(([, m]) => m.startsWith("tx.")), [["pay", "tx.request"]]);
  assert.ok(asked.filter(([, m]) => m.startsWith("device.") || m === "account.state").every(([c]) => c === "wallet"), "Wallet's own storage, whoever asked");
  asked.length = 0;
  await ok(ledger, "ledger.quotePay", { fromTokenId: USDC_SOL, toTokenId: USDC_SOL, to: { kind: "ledger", accountId: "bob.near" }, amountOut: "1", caller: "pay" });
  assert.deepEqual(asked.filter(([, m]) => m.startsWith("tx.")), [["pay", "tx.describe"]]);
  asked.length = 0;
  await ok(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" });
  assert.deepEqual(asked.filter(([, m]) => m.startsWith("tx.")), [["wallet", "tx.request"]], "the shell's own call is Wallet's");
});

test("only Wallet and Pay move money; the Extension withdraws only to its own wallet; the chain wallets' apps never take a public send (D55); every app may read", async () => {
  const LAPTOP = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const BROWSER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const { ledger, core } = setup({ wallets: [{ kind: "trade", address: SOL_ADDR }, { kind: "extension", address: LAPTOP }, { kind: "browser", address: BROWSER }] });
  const send = { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near" };
  assert.deepEqual(await refusal(ledger, "ledger.transfer", { ...send, caller: "trade" }), ["ledger.caller.refused", "Trade can't send from your Safe. Wallet and Pay can."]);
  for (const caller of ["earn", "agent", "extension", "browser"]) {
    for (const method of ["ledger.transfer", "ledger.convert", "ledger.quoteConvert"]) {
      assert.equal((await refusal(ledger, method, { ...send, caller }))[0], "ledger.caller.refused", `${caller} ${method}`);
    }
  }
  assert.equal((await refusal(ledger, "ledger.balances", { caller: "someone" }))[0], "ledger.caller.refused", "an app we don't know");
  const out = (toAddress: string, caller: string) => ({ tokenId: USDC_SOL, amount: "1", toAddress, chain: "sol", caller });
  // One wallet per chain (D55): Trade, Browser, Apps and Chat (app id "chat") share the chain wallets, filled only through Spending's
  // confidential moves, so a public send from the Safe into any of them (or anywhere else) is refused for those apps
  const PRIVATE_WAY = ["ledger.caller.refused", "Moves into your NEAR wallet go through Move, so your Safe stays private."];
  for (const caller of ["trade", "browser", "social", "chat"]) {
    for (const to of [SOL_ADDR, BROWSER, OTHER_SOL]) assert.deepEqual(await refusal(ledger, "ledger.withdraw", out(to, caller)), PRIVATE_WAY, `${caller} to ${to}`);
  }
  assert.deepEqual(await refusal(ledger, "ledger.withdraw", out(OTHER_SOL, "extension")), ["ledger.caller.refused", "Extension can send only to its own wallets."], "a raw address");
  assert.equal((await refusal(ledger, "ledger.withdraw", out(SOL_ADDR, "extension")))[0], "ledger.caller.refused", "Trade's wallet isn't Extension's");
  assert.equal((await refusal(ledger, "ledger.withdraw", out(OTHER_SOL, "earn")))[0], "ledger.caller.refused");
  assert.equal(core.signed.length, 0, "nothing was signed for any refusal");
  assert.equal((await ok<Movement>(ledger, "ledger.withdraw", out(LAPTOP, "extension"))).caller, "extension", "Extension funds its own laptop wallet");
  await ok(ledger, "ledger.withdraw", out(OTHER_SOL, "pay"));
  await ok(ledger, "ledger.withdraw", out(OTHER_SOL, "wallet"));
  for (const caller of ["earn", "agent", "trade"]) {
    await ok(ledger, "ledger.balances", { caller });
    await ok(ledger, "ledger.tokens", { caller });
    await ok(ledger, "ledger.activity", { caller });
  }
});

test("an app may pay its own kind of wallet (the Extension funding its laptop wallet through a quote), and nothing else; Trade never (D55)", async () => {
  const LAPTOP = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const { ledger, core } = setup({ wallets: [{ kind: "trade", address: SOL_ADDR }, { kind: "extension", address: LAPTOP }] });
  const quote = (address: string, caller: string) => ({ fromTokenId: USDC_SOL, toTokenId: USDC_SOL, to: { kind: "chain", chain: "sol", address }, amountOut: "1", caller });
  const q = await ok<{ id: string }>(ledger, "ledger.quotePay", quote(LAPTOP, "extension"));
  const paid = await ok<Movement>(ledger, "ledger.pay", { quoteId: q.id, caller: "extension" });
  assert.deepEqual([paid.kind, paid.caller, core.signed.length], ["pay", "extension", 1]);
  assert.deepEqual(await refusal(ledger, "ledger.quotePay", quote(OTHER_SOL, "extension")), ["ledger.caller.refused", "Extension can send only to its own wallets."], "a raw address");
  assert.equal((await refusal(ledger, "ledger.quotePay", quote(SOL_ADDR, "extension")))[0], "ledger.caller.refused", "another kind's wallet");
  assert.deepEqual(await refusal(ledger, "ledger.quotePay", quote(SOL_ADDR, "trade")), ["ledger.caller.refused", "Moves into your NEAR wallet go through Move, so your Safe stays private."], "Trade's own chain wallet: through Top up only");
  assert.equal((await refusal(ledger, "ledger.quotePay", { ...quote(LAPTOP, "extension"), to: { kind: "ledger", accountId: "bob.near" } }))[0], "ledger.caller.refused", "a ledger balance is never an app's wallet");
  const other = await ok<{ id: string }>(ledger, "ledger.quotePay", quote(OTHER_SOL, "pay"));
  assert.equal((await refusal(ledger, "ledger.pay", { quoteId: other.id, caller: "extension" }))[0], "ledger.caller.refused", "paying someone else's quote is checked again");
  assert.equal(core.signed.length, 1, "nothing more was signed");
});

test("a movement's updates reach only the app that asked and Wallet; activity keeps each app's labels to itself", async () => {
  const { ledger } = setup();
  const heard: Record<string, string[]> = { pay: [], trade: [], wallet: [] };
  for (const app of ["pay", "trade", "wallet"] as const) {
    ownMovements(ledger, app).on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => heard[app].push(movement.label ?? movement.id));
  }
  await ok(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near", label: "Kiosk", caller: "pay" });
  assert.deepEqual(heard, { pay: ["Kiosk"], trade: [], wallet: ["Kiosk"] });

  const [asTrade] = await ok<Movement[]>(ledger, "ledger.activity", { caller: "trade" });
  const [asPay] = await ok<Movement[]>(ledger, "ledger.activity", { caller: "pay" });
  const [asWallet] = await ok<Movement[]>(ledger, "ledger.activity", {});
  assert.deepEqual([asTrade.label, asPay.label, asWallet.label], [undefined, "Kiosk", "Kiosk"]);
});

test("updates that belong to no app (a deposit) reach every app", () => {
  const handlers: ((p: unknown) => void)[] = [];
  const fake: Bridge = { call: async () => ({ ok: null as never }), on: (_e, h) => (handlers.push(h as (p: unknown) => void), () => {}) };
  const heard: string[] = [];
  ownMovements(fake, "trade").on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => heard.push(movement.id));
  handlers.forEach((h) => h({ movement: { id: "deposit:1" } }));
  handlers.forEach((h) => h({ movement: { id: "pay:2", caller: "pay" } }));
  assert.deepEqual(heard, ["deposit:1"]);
});

test("an app renames only its own movement; another app's, or one nobody knows, is refused alike", async () => {
  const { ledger } = setup();
  const m = await ok<Movement>(ledger, "ledger.transfer", { tokenId: USDC_SOL, amount: "1", toAccountId: "bob.near", label: "Address you pasted for Mt Pelerin", caller: "pay" });
  const heard: string[] = [];
  ownMovements(ledger, "pay").on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => heard.push(movement.label ?? ""));
  const long = `Paid · Mt Pelerin told you: 10.00 EUR to DE89 …3000${" and more".repeat(10)}`;
  const renamed = await ok<Movement>(ledger, "ledger.relabel", { id: m.id, label: long, caller: "pay" });
  assert.equal(renamed.label, long.slice(0, 60), "the same 60-character rule as when sent");
  assert.deepEqual(heard, [long.slice(0, 60)]);
  assert.equal((await ok<Movement[]>(ledger, "ledger.activity", { caller: "pay" }))[0].label, long.slice(0, 60));
  for (const [params, why] of [[{ id: m.id, label: "x", caller: "trade" }, "another app's"], [{ id: "transfer:nope", label: "x", caller: "pay" }, "unknown"], [{ id: m.id, label: "  ", caller: "pay" }, "empty"]] as const) {
    assert.equal((await refusal(ledger, "ledger.relabel", params))[0], "ledger.movement.unknown", why);
  }
});

test("an app's label for a move into its own wallet is the sheet's hint (the core names the app); a label that could disguise is refused", async () => {
  const LAPTOP = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const { ledger, core } = setup({ wallets: [{ kind: "extension", address: LAPTOP }] });
  const out = (label: string) => ({ tokenId: USDC_SOL, amount: "1", toAddress: LAPTOP, chain: "sol", caller: "extension", label });
  await ok(ledger, "ledger.withdraw", out("Move $1.00 of USDC to your laptop's trading wallet"));
  assert.equal(core.signed.at(-1)?.why, "Move $1.00 of USDC to your laptop's trading wallet", "the core adds \"Extension says:\" itself");
  const signed = core.signed.length;
  for (const bad of ["Move $1.00 ‮of USDC", "Move\n$1.00", "x".repeat(81)]) {
    assert.deepEqual((await refusal(ledger, "ledger.withdraw", out(bad)))[0], "ledger.label.invalid", JSON.stringify(bad));
  }
  assert.equal(core.signed.length, signed, "nothing signed for a refused label");
  await ok(ledger, "ledger.withdraw", { ...out(""), caller: "wallet", toAddress: OTHER_SOL, label: "Rent" });
  assert.match(core.signed.at(-1)?.why ?? "", /^Send 1 USDC to /, "Wallet's and Pay's own sends keep the plain words");
});
