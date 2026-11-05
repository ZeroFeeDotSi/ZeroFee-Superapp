// QA's MUST (5 Nov): Send from the Safe through the fill paid an OUTSIDE payee after one sheet titled "Move $X to
// Private" that never named them (rule 4, and the binding to the signed payout quote). Gated by a hard constant (core
// safe-send-fill-open.ts), never VITE_SAFE_FILL_OPEN alone: OPEN since feat/safe-send-fill (one sheet naming the payee in
// full, the payout bound before the Safe signs: real-core-paths ENTRY 3, core send-fill-sign-path). The ledger's refusal
// is dropped for that bound path only (the constant open AND the build's fill switch on); anywhere else it stands.
// Controls: Send from Private still signs; a Move with a Safe top-up still works; Safe → your own NEAR wallet still works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge } from "@zerofee/core/bridge";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { SAFE_SEND_FILL_OPEN } from "@zerofee/core/safe-send-fill-open";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { SAFE_SEND_OPEN } from "./send-open.ts";
import { sendSources } from "./app/money/send-sources.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Balance } from "./types.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const STRANGER_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLETS = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: "sw-trade-sol", chain: "sol", address: SOL }, { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT }];
const SHUT = "Sending from your Safe opens soon. Your money is still in your Safe.";

function setup(o: { pocketUnits?: string; fillOpen?: boolean } = {}) {
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: o.pocketUnits ?? "10000000" }], subwallets: WALLETS as never });
  const asked: any[] = [];
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    quote: async (req: any) => { asked.push(req); return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any; },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async () => ({ intentHash: "h" }),
    status: async (_a: string, _via?: string, tag?: string) => ({ status: "SUCCESS", ...(tag ? { swapDetails: { amountOut: "999999999999999999999999" } } : {}) } as any),
  };
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: o.fillOpen ?? true });
  return { ledger, core, asked };
}
const nothingMoved = (s: ReturnType<typeof setup>, why: string) => assert.deepEqual([s.asked.length, s.core.signed.length, s.core.privateIns.length, s.core.privatePays.length], [0, 0, 0, 0], why);

test("the gate is a hard constant, open now the fill is bound, never the build's VITE_SAFE_FILL_OPEN alone: Send's Safe source needs both", () => {
  assert.equal(SAFE_SEND_FILL_OPEN, true);
  assert.equal(SAFE_FILL_OPEN, true, "Move's fill is open in this build");
  const src = readFileSync(new URL("../../core/src/safe-send-fill-open.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ""), /import|process\.env|VITE_|SAFE_FILL_OPEN\b/, "no flag, env or import feeds it");
  assert.equal(SAFE_SEND_OPEN, SAFE_SEND_FILL_OPEN && SAFE_FILL_OPEN, "Send's Safe source: the hard constant and the build's fill switch");
  const open = readFileSync(new URL("./send-open.ts", import.meta.url), "utf8");
  assert.match(open, /export const SAFE_SEND_OPEN: boolean = SAFE_SEND_FILL_OPEN && SAFE_FILL_OPEN;/, "both, always");
});

test("the backstop stands off the bound path: with the build's fill switch off, a Safe-fill Send to an outside payee is refused before any price or sheet, by name (a chain address and a NEAR account); control: switch on, the bound path is never refused as shut", async () => {
  for (const to of [{ kind: "chain", chain: "sol", address: STRANGER_SOL }, { kind: "ledger", accountId: "bob.near" }, { kind: "chain", chain: "near", address: "bob.near" }]) {
    const s = setup({ pocketUnits: "0", fillOpen: false });
    const r = await s.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "30", to, fill: true });
    assert.ok("problem" in r, JSON.stringify(to));
    assert.equal(r.problem.code, "ledger.safe-send.shut");
    assert.equal(r.problem.whatHappened, SHUT);
    assert.deepEqual(r.problem.money, { state: "safe", where: "in your Safe" });
    nothingMoved(s, `${JOB_OF(to)}: nothing priced, signed, filled or paid`);
  }
  // Private would cover it: still refused off the bound path, a fill is never asked of the ledger for an outside payee
  const covered = setup({ pocketUnits: "50000000", fillOpen: false });
  const r = await covered.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "5", to: { kind: "chain", chain: "sol", address: STRANGER_SOL }, fill: true });
  assert.ok("problem" in r && r.problem.code === "ledger.safe-send.shut");
  nothingMoved(covered, "covered by Private: still nothing");
  // control: the bound path (switch on) goes on to the price and the Safe's one sheet (signing: real-core-paths ENTRY 3)
  const bound = setup({ pocketUnits: "0", fillOpen: true });
  const b = await bound.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "30", to: { kind: "chain", chain: "sol", address: STRANGER_SOL }, fill: true });
  assert.ok(!("problem" in b) || b.problem.code !== "ledger.safe-send.shut", "the bound path: never refused as shut");
  assert.equal(bound.core.privateIns.length, 1, "the Safe's move in priced: the bound path ran");
});
const JOB_OF = (to: Record<string, string>) => to.address ?? to.accountId;

test("the From list off the bound path (safeOpen false) offers no Safe source for an outside payee: a Safe coin with nothing in Private has no row, one with some offers only Private's share; the hot wallets stay (control: open, the Safe's part is listed)", () => {
  const safe: Balance[] = [
    { tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "300", usd: "300", bridged: false, held: "ledger", listed: true },
    { tokenId: "near", symbol: "NEAR", name: "NEAR", icon: "near", chain: "near", amount: "20", usd: "60", bridged: false, held: "account", listed: true },
  ];
  const pocket: Balance[] = [{ tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "12.5", usd: "12.5", bridged: false, held: "private", listed: true }];
  const rows: Balance[] = [{ tokenId: "row:sol", symbol: "SOL", name: "Solana", icon: "sol", chain: "sol", amount: "1", usd: "150", bridged: false, held: "account", listed: true }];
  const s = sendSources(rows, safe, pocket, false);
  assert.equal(s.filter((x) => x.symbol === "NEAR" && x.row === null).length, 0, "nothing of NEAR in Private: no Safe row");
  const usdc = s.filter((x) => x.symbol === "USDC" && x.row === null);
  assert.equal(usdc.length, 1);
  assert.equal(usdc[0]!.max, "12.5", "only Private's share can go: never the Safe's own part");
  assert.ok(s.some((x) => x.row === "sol"), "the hot wallet stays offered");
  assert.ok(s.every((x) => x.row !== null || Number(x.max) <= 12.5), "no source sends the Safe's own money");
  const open = sendSources(rows, safe, pocket, true);
  assert.ok(open.some((x) => x.symbol === "NEAR" && x.row === null), "control: with the Safe's route open the Safe's part is listed");
});

test("controls: Send from Private still signs; a Move with a Safe top-up still works; Safe → your own NEAR wallet and own SOL wallet still go", async () => {
  // Send from Private (no fill) to an outside payee: the pocket's own payment, as before
  const p = setup({ pocketUnits: "50000000", fillOpen: true });
  const sent = await p.ledger.call<{ id: string }[]>("ledger.sendFromSafe", { tokenId: USDC, amount: "5", to: { kind: "chain", chain: "sol", address: STRANGER_SOL } });
  assert.ok("ok" in sent, "problem" in sent ? `${sent.problem.code} ${sent.problem.whatHappened}` : "");
  assert.deepEqual(sent.ok.map((m) => m.id.split(":")[0]), ["pocket-send"]);
  assert.equal(p.core.privatePays.length, 1, "Private's payment signed");
  // a Move whose Safe tops Private up: one Safe sheet, then Private pays the person's own SOL wallet
  const m = setup({ pocketUnits: "12500000", fillOpen: true });
  const mv = await m.ledger.call<{ parts: { ids: string[] }[] }>("ledger.moveFromPrivate", { parts: [{ wallet: "sw-trade-sol", usd: 30 }], job: "move-private-0123456789abcdef0123", caller: "trade" });
  assert.ok("ok" in mv, "problem" in mv ? `${mv.problem.code} ${mv.problem.whatHappened}` : "");
  assert.equal(m.core.signed.length, 1, "the Safe's top-up: one sheet");
  assert.equal(m.core.privateIns.length, 1, "Private filled from the Safe");
  // Safe → your own NEAR wallet (Move's leg to it, topped up from the Safe)
  const n = setup({ pocketUnits: "0", fillOpen: true });
  const nv = await n.ledger.call<{ parts: { ids: string[] }[] }>("ledger.moveFromPrivate", { parts: [{ wallet: "near", usd: 30 }], job: "move-private-0123456789abcdef0124", caller: "trade" });
  assert.ok("ok" in nv, "problem" in nv ? `${nv.problem.code} ${nv.problem.whatHappened}` : "");
  assert.ok(nv.ok.parts[0]!.ids.length > 0);
  // a Send's fill to the person's own wallet is not the shut path (it may go on as Move's own does)
  for (const to of [{ kind: "chain", chain: "sol", address: SOL }, { kind: "ledger", accountId: FLOAT }]) {
    const o = setup({ pocketUnits: "0", fillOpen: true });
    const r = await o.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "30", to, toTokenId: USDC, fill: true });
    assert.ok(!("problem" in r) || r.problem.code !== "ledger.safe-send.shut", `own wallet ${JOB_OF(to)}: never refused as shut`);
  }
});
