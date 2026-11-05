// D119 landing 2: the core's perps.* methods against a fake Hyperliquid testnet (no network). Turning perps off REVOKES
// the trading key on Hyperliquid (landing 1's review leftover 1), orders are built and checked to Hyperliquid's rules,
// every refusal names Hyperliquid and keeps the money line, and the only host ever asked is Hyperliquid's testnet API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { MemoryVault } from "../vault.ts";
import { AGENT_NAME, HL_MAINNET, HL_TESTNET, revokeAgentAction, signApproveAgent, type HlNet } from "./agent.ts";
import { HL_TYPES, hlAddress, l1Digest, userSignedDigest } from "./hl-sign.ts";
import { HL_USDC_TOKEN, NOT_SAFE_LINE, PERPS_WHERE, PerpsService, perpsProblems, type PerpsDeps } from "./service.ts";

const T0 = 1_760_000_000_000;
const recover = (digest: Uint8Array, sig: { r: string; s: string; v: number }) => {
  const pub = new secp256k1.Signature(BigInt(sig.r), BigInt(sig.s)).addRecoveryBit(sig.v - 27).recoverPublicKey(digest).toBytes(false);
  return `0x${Array.from(keccak_256(pub.slice(1)).slice(-20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
};
const META = { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }, { name: "OLD", szDecimals: 2, maxLeverage: 3, isDelisted: true }] };
const MIDS = { BTC: "60000.0", ETH: "3000.0" };

/** A fake Hyperliquid testnet: answers /info, records every /exchange, refuses what `refuse` says. */
function fakeHl(opts: { refuse?: (action: any) => string | null; positions?: any[]; down?: boolean; spot?: number; listAgents?: false; cancelRefused?: true; free?: number; leverage?: unknown } = {}) {
  const urls: string[] = [];
  const agents = new Map<string, string>();
  const sent: { action: any; nonce: number; signature: any }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    urls.push(url);
    if (opts.down) throw new TypeError("network");
    const body = JSON.parse(String(init.body));
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (url.endsWith("/info")) {
      if (body.type === "meta") return json(META);
      if (body.type === "allMids") return json(MIDS);
      if (body.type === "clearinghouseState") return json({ marginSummary: { accountValue: "1000.5" }, withdrawable: String(opts.free ?? 800.25), assetPositions: (opts.positions ?? []).map((position) => ({ position })) });
      if (body.type === "spotClearinghouseState") return json({ balances: [{ coin: "USDC", total: String(opts.spot ?? 0), hold: "0" }] });
      // Hyperliquid's own list of the account's agents: the last one approved under each name (a revoke replaces it)
      if (body.type === "activeAssetData" && opts.leverage !== undefined) return json({ user: body.user, coin: body.coin, leverage: opts.leverage });
      if (body.type === "extraAgents") return json(opts.listAgents === false ? [] : [...agents.values()].map((address) => ({ name: "zerofee", address, validUntil: T0 + 1 })));
      return json(null);
    }
    sent.push(body);
    const no = opts.refuse?.(body.action);
    if (no) return json({ status: "err", response: no });
    if (body.action.type === "approveAgent") agents.set(String(body.action.agentName).replace(/ valid_until \d+$/, ""), body.action.agentAddress);
    if (body.action.type === "cancel" && opts.cancelRefused) return json({ status: "err", response: "User or API Wallet does not exist." });
    if (body.action.type === "cancel") return json({ status: "ok", response: { type: "cancel", data: { statuses: [{ error: "Order was never placed, already canceled, or filled." }] } } });
    if (body.action.type === "order") return json({ status: "ok", response: { type: "order", data: { statuses: body.action.orders.map((o: any) => (o.t.limit?.tif === "Gtc" ? { resting: { oid: 1 } } : { filled: { totalSz: o.s, avgPx: "60010", oid: 2 } })) } } });
    return json({ status: "ok", response: { type: "default" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls, sent };
}

function service(hl: ReturnType<typeof fakeHl>, opts: { yes?: boolean; now?: () => number; net?: HlNet; money?: PerpsDeps["money"] } = {}) {
  const main = secp256k1.utils.randomSecretKey();
  const mainAddress = hlAddress(main);
  const vault = new MemoryVault();
  const sheets: string[] = [];
  const svc = new PerpsService({
    vault, fetch: hl.fetch, now: opts.now ?? (() => T0),
    approve: async (w) => (sheets.push(w.title), opts.yes ?? true),
    withMainKey: async (use) => use(main.slice(), mainAddress),
    mainAddress: async () => mainAddress,
    ...(opts.net ? { net: opts.net } : {}),
    ...(opts.money ? { money: opts.money } : {}),
  });
  return { svc, vault, mainAddress, sheets };
}
const nameOf = (a: any) => String(a.agentName).replace(/ valid_until \d+$/, "");
const signerOfUserAction = (x: { action: any; signature: any }) => recover(userSignedDigest(x.action, HL_TYPES.approveAgent.primaryType, [...HL_TYPES.approveAgent.fields]), x.signature);

test("turning on: one Face ID sheet, the MAIN key signs a testnet approval of a new trading key (declined: nothing sent)", async () => {
  const hl = fakeHl();
  const no = service(hl, { yes: false });
  await assert.rejects(no.svc.setup(), (e: any) => e.problem.code === "perps.declined");
  assert.equal(hl.sent.length, 0, "declined: nothing reached Hyperliquid");
  assert.equal((await no.svc.state()).on, false);
  const { svc, mainAddress, sheets } = service(hl);
  const s = await svc.setup();
  assert.equal(s.on, true);
  assert.deepEqual(sheets, ["Turn on perps on Hyperliquid"]);
  const [ap] = hl.sent;
  assert.equal(ap!.action.type, "approveAgent");
  assert.equal(ap!.action.hyperliquidChain, "Testnet");
  assert.equal(nameOf(ap!.action), AGENT_NAME);
  assert.equal(signerOfUserAction(ap!), mainAddress, "signed by the main key");
});

test("an approval Hyperliquid refuses leaves no trading key; its words go behind More, the money line stays", async () => {
  const hl = fakeHl({ refuse: (a) => (a.type === "approveAgent" ? "Must deposit before performing actions." : null) });
  const { svc } = service(hl);
  await assert.rejects(svc.setup(), (e: any) => e.problem.code === "perps.hyperliquid.refused" && /Hyperliquid/.test(e.problem.whatHappened) && e.problem.money.where === PERPS_WHERE && /Must deposit/.test(e.problem.more));
  assert.equal((await svc.state()).on, false);
});

test("turning OFF revokes on Hyperliquid: the main key signs an approval under the SAME name for a throwaway address, then the key leaves the phone", async () => {
  const hl = fakeHl();
  const { svc, mainAddress, sheets } = service(hl);
  await svc.setup();
  const approved = hl.sent[0]!.action.agentAddress;
  const s = await svc.off();
  assert.equal(s.on, false);
  assert.equal(s.offPending, undefined);
  assert.deepEqual(sheets, ["Turn on perps on Hyperliquid", "Turn off perps on Hyperliquid"]);
  assert.equal(hl.sent.length, 3, "control: a forget-only off sends nothing; this one sends the revoke (after setup's approval and its proof's cancel)");
  const rv = hl.sent[2]!;
  assert.equal(rv.action.type, "approveAgent");
  assert.equal(nameOf(rv.action), nameOf(hl.sent[0]!.action), "same name: Hyperliquid deregisters the old agent");
  assert.notEqual(rv.action.agentAddress, approved, "never the old address again");
  assert.equal(signerOfUserAction(rv), mainAddress, "the main key signs the revoke");
  // and the trading key can't sign any more
  await assert.rejects(svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "market" }), (e: any) => e.problem.code === "perps.off");
});

test("off when Hyperliquid doesn't answer: the key still leaves the phone, the off waits, and the next off revokes again", async () => {
  let down = false;
  const hl = fakeHl();
  const flaky = { ...hl, fetch: (async (u: string, i: RequestInit) => { if (down && u.endsWith("/exchange")) throw new TypeError("down"); return hl.fetch(u, i); }) as typeof fetch };
  const { svc } = service(flaky);
  await svc.setup();
  down = true;
  await assert.rejects(svc.off(), (e: any) => e.problem.code === "perps.off.unconfirmed" && e.problem.money.where === PERPS_WHERE && e.problem.next.kind === "retry");
  const mid = await svc.state();
  assert.deepEqual([mid.on, mid.offPending], [false, true]);
  down = false;
  const done = await svc.off();
  assert.equal(done.offPending, undefined);
  assert.equal(hl.sent.filter((x) => x.action.type === "approveAgent").length, 2, "setup + the retried revoke");
});

test("revokeAgentAction: a testnet approval under our name with a new throwaway address each time, signable by the main key only on testnet", () => {
  const a = revokeAgentAction(T0), b = revokeAgentAction(T0);
  assert.notEqual(a.agentAddress, b.agentAddress);
  assert.equal(a.agentName, `${AGENT_NAME} valid_until ${T0 + 3_600_000}`);
  assert.equal(a.hyperliquidChain, HL_TESTNET.chain);
  assert.ok(signApproveAgent(a, secp256k1.utils.randomSecretKey()));
  assert.throws(() => signApproveAgent({ ...a, hyperliquidChain: "Mainnet" as "Testnet" }, secp256k1.utils.randomSecretKey()));
});

test("a market long: leverage first (within Hyperliquid's limit), then an Ioc through the price with TP above and SL below; signed by the trading key", async () => {
  const hl = fakeHl();
  const { svc, vault } = service(hl);
  await svc.setup();
  const r = await svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 5, kind: "market", tp: 66000, sl: 57000 });
  assert.equal(r.filled, true);
  assert.match(r.line, /^Long BTC opened: \$\d/);
  const [lev, ord] = hl.sent.slice(2); // after setup's approval and its proof's cancel
  assert.deepEqual(lev!.action, { type: "updateLeverage", asset: 0, isCross: true, leverage: 5 });
  assert.equal(ord!.action.grouping, "normalTpsl");
  assert.deepEqual(ord!.action.orders, [
    { a: 0, b: true, p: "63000", s: "0.00416", r: false, t: { limit: { tif: "Ioc" } } },
    // each close may fill 10 % past its trigger (review L10), so a jump past it still closes
    { a: 0, b: false, p: "59400", s: "0.00416", r: true, t: { trigger: { isMarket: true, triggerPx: "66000", tpsl: "tp" } } },
    { a: 0, b: false, p: "51300", s: "0.00416", r: true, t: { trigger: { isMarket: true, triggerPx: "57000", tpsl: "sl" } } },
  ]);
  const agentAddr = JSON.parse(new TextDecoder().decode((await vault.get("perps-agent-testnet.v1"))!)).address;
  assert.equal(recover(l1Digest(ord!.action, ord!.nonce, true), ord!.signature), agentAddr, "the trading key signed it, for testnet");
  assert.ok(ord!.nonce > lev!.nonce, "never the same nonce twice");
});

test("a limit short rests at its price; TP/SL on the wrong side, too much leverage or under $10 are refused before anything is signed", async () => {
  const hl = fakeHl();
  const { svc } = service(hl);
  await svc.setup();
  const r = await svc.order({ coin: "ETH", side: "short", usd: 20, leverage: 2, kind: "limit", limitPx: 3100.123 });
  assert.equal(r.filled, false);
  assert.match(r.line, /^Short ETH waits at \$3,100\.10/);
  assert.equal(hl.sent.at(-1)!.action.orders[0].p, "3100.1");
  const before = hl.sent.length;
  const refusedWith = async (ask: any, re: RegExp) => assert.rejects(svc.order(ask), (e: any) => e.problem.code === "perps.order.refused" && re.test(e.problem.whatHappened) && e.problem.money.where === PERPS_WHERE);
  await refusedWith({ coin: "BTC", side: "long", usd: 50, leverage: 41, kind: "market" }, /BTC goes up to 40× on Hyperliquid/);
  await refusedWith({ coin: "BTC", side: "long", usd: 4, leverage: 2, kind: "market" }, /smallest trade is \$10/);
  await refusedWith({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "market", tp: 50000 }, /Take profit must be above/);
  await refusedWith({ coin: "BTC", side: "short", usd: 50, leverage: 2, kind: "market", sl: 50000 }, /Stop loss must be above/);
  await refusedWith({ coin: "OLD", side: "long", usd: 50, leverage: 2, kind: "market" }, /doesn't list/);
  assert.equal(hl.sent.length, before, "nothing sent for any of them");
  await svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 40, kind: "market" });
  assert.equal(hl.sent.length, before + 2, "control: the most leverage goes");
});

test("positions read with P&L and liquidation price; close one and close all are reduce-only the other way", async () => {
  const positions = [
    { coin: "BTC", szi: "0.002", entryPx: "59000", positionValue: "120", unrealizedPnl: "2.0", returnOnEquity: "0.1", liquidationPx: "45000", leverage: { type: "cross", value: 5 }, marginUsed: "24" },
    { coin: "ETH", szi: "-0.05", entryPx: "3050", positionValue: "150", unrealizedPnl: "-2.5", returnOnEquity: "-0.05", liquidationPx: null, leverage: { type: "cross", value: 3 }, marginUsed: "50" },
  ];
  const hl = fakeHl({ positions });
  const { svc } = service(hl);
  await svc.setup();
  const s = await svc.state();
  assert.deepEqual([s.balanceUsd, s.freeUsd], [1000.5, 800.25]);
  assert.deepEqual(s.positions.map((p) => [p.coin, p.side, p.size, p.pnlUsd, p.liqPx, p.leverage]), [["BTC", "long", "0.002", 2, 45000, 5], ["ETH", "short", "0.05", -2.5, null, 3]]);
  assert.match((await svc.close("ETH")).line, /ETH closed\. Lost about \$2\.50/);
  assert.deepEqual(hl.sent.at(-1)!.action.orders, [{ a: 1, b: true, p: "3150", s: "0.05", r: true, t: { limit: { tif: "Ioc" } } }]);
  await svc.closeAll();
  assert.deepEqual(hl.sent.at(-1)!.action.orders.map((o: any) => [o.a, o.b, o.s, o.r]), [[0, false, "0.002", true], [1, true, "0.05", true]]);
  await assert.rejects(svc.close("SOL"), (e: any) => e.problem.code === "perps.position.none");
});

test("Hyperliquid down: a plain line naming it, the money line, Try again; and the only host ever asked is its testnet API", async () => {
  const hl = fakeHl({ down: true });
  const { svc } = service(hl);
  await assert.rejects(svc.state(), (e: any) => e.problem.code === "perps.hyperliquid.unreachable" && e.problem.next.kind === "retry");
  const ok = fakeHl();
  const s2 = service(ok);
  await s2.svc.setup();
  await s2.svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "market" });
  await s2.svc.markets();
  await s2.svc.off();
  assert.ok(ok.urls.length > 5);
  for (const u of [...hl.urls, ...ok.urls]) assert.match(u, /^https:\/\/api\.hyperliquid-testnet\.xyz\/(info|exchange)$/);
});

test("every perps problem names Hyperliquid or perps, says where the money is, and never says Spending", () => {
  for (const [k, f] of Object.entries(perpsProblems)) {
    const p = (f as (x?: string) => any)("Pick Long or Short.");
    // input: the form's own hint, under its field; notSafe: the product's line (3 Nov), its code says perps
    if (k !== "input" && k !== "notSafe") assert.match(p.whatHappened, /Hyperliquid/, k);
    assert.equal(p.money.where, PERPS_WHERE, k);
    assert.doesNotMatch(JSON.stringify(p), /Spending/, k);
    assert.match(p.code, /^perps\./, k);
  }
});

test("review M1: a short limit UNDER the market is sized at the market's price, never more than asked (control: above the market, at its limit)", async () => {
  const hl = fakeHl();
  const { svc } = service(hl);
  await svc.setup();
  await svc.order({ coin: "BTC", side: "short", usd: 500, leverage: 2, kind: "limit", limitPx: 6000 });
  assert.equal(hl.sent.at(-1)!.action.orders[0].s, "0.01666", "$1,000 at the market's $60,000, not 10× more at $6,000");
  await svc.order({ coin: "BTC", side: "short", usd: 50, leverage: 2, kind: "limit", limitPx: 62500 });
  assert.equal(hl.sent.at(-1)!.action.orders[0].s, "0.0016", "control: a resting short at $62,500");
  await svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "limit", limitPx: 50000 });
  assert.equal(hl.sent.at(-1)!.action.orders[0].s, "0.002", "a long fills at or under its limit: sized at it");
});

test("review L8: saying no to a renewal keeps the trading key this phone has (control: yes makes a new one)", async () => {
  let now = T0;
  const hl = fakeHl();
  let yes = true;
  const main = secp256k1.utils.randomSecretKey();
  const vault = new MemoryVault();
  const svc = new PerpsService({ vault, fetch: hl.fetch, now: () => now, approve: async () => yes, withMainKey: async (use) => use(main.slice(), hlAddress(main)), mainAddress: async () => hlAddress(main) });
  await svc.setup();
  const first = hl.sent[0]!.action.agentAddress;
  now += 29.5 * 86_400_000; // within a day of its end: setup renews
  yes = false;
  await assert.rejects(svc.setup(), (e: any) => e.problem.code === "perps.declined");
  assert.equal(JSON.parse(new TextDecoder().decode((await vault.get("perps-agent-testnet.v1"))!)).address, first, "the old key stays");
  yes = true;
  await svc.setup();
  assert.notEqual(hl.sent.at(-1)!.action.agentAddress, first, "control: a new one");
});

test("review L7: a waiting off ends when Hyperliquid answers no again (an account it doesn't know); not answering keeps it waiting", async () => {
  let mode: "down" | "no" = "down";
  const hl = fakeHl({ refuse: (a) => (a.type === "approveAgent" && mode === "no" ? "User or API Wallet does not exist." : null) });
  const flaky = { ...hl, fetch: (async (u: string, i: RequestInit) => { if (mode === "down" && u.endsWith("/exchange")) throw new TypeError("down"); return hl.fetch(u, i); }) as typeof fetch };
  const { svc } = service(flaky);
  await assert.rejects(svc.off(), (e: any) => e.problem.code === "perps.off.unconfirmed");
  await assert.rejects(svc.off(), (e: any) => e.problem.code === "perps.off.unconfirmed", "control: still not answering, still waiting");
  assert.equal((await svc.state()).offPending, true);
  mode = "no";
  await assert.rejects(svc.off(), (e: any) => e.problem.code === "perps.hyperliquid.refused" && /does not exist/.test(e.problem.more));
  assert.equal((await svc.state()).offPending, undefined, "no longer waiting for ever");
});

test("review L6: a market whose rules don't read (NaN leverage or size decimals) is refused, never every leverage", async () => {
  const hl = fakeHl();
  const bad = { ...hl, fetch: (async (u: string, i: RequestInit) => { const b = JSON.parse(String(i.body)); if (b.type === "meta") return new Response(JSON.stringify({ universe: [{ name: "BTC", szDecimals: 5 }, { name: "ETH", szDecimals: "x", maxLeverage: 25 }] })); return hl.fetch(u, i); }) as typeof fetch };
  const { svc } = service(bad);
  await svc.setup();
  for (const coin of ["BTC", "ETH"]) await assert.rejects(svc.order({ coin, side: "long", usd: 50, leverage: 100, kind: "market" }), (e: any) => /doesn't list/.test(e.problem.whatHappened), coin);
  assert.deepEqual(await svc.markets(), []);
});


// ── Landing 3 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const signerOf = (x: { action: any; signature: any }, t: { primaryType: string; fields: readonly any[] }) => recover(userSignedDigest(x.action, t.primaryType, [...t.fields]), x.signature);

test("landing 3, the on-phone proof (product decision, 3 Nov; review M2): after the approval and before any order, Hyperliquid lists the agent and takes its cancel as a signature; the agent never signs a withdrawal, not even as a test", async () => {
  const hl = fakeHl();
  const { svc } = service(hl);
  assert.equal((await svc.setup()).on, true);
  const [ap, cancel] = hl.sent;
  assert.equal(ap!.action.type, "approveAgent");
  assert.deepEqual(cancel!.action, { type: "cancel", cancels: [{ a: 0, o: 1 }] });
  assert.equal(recover(l1Digest(cancel!.action, cancel!.nonce, true), cancel!.signature), ap!.action.agentAddress, "the cancel is the agent's");
  assert.equal(hl.sent.length, 2, "nothing else before the first order");
  assert.equal(hl.sent.some((x) => x.action.type === "withdraw3"), false, "no withdraw3 is ever signed by the agent (review M2: its refusal proved nothing)");
});

for (const [what, opts] of [["(a) Hyperliquid doesn't list the agent", { listAgents: false }], ["(b) the agent's cancel isn't taken as a signature", { cancelRefused: true }]] as const) {
  test(`landing 3, the proof fails when ${what}: "${NOT_SAFE_LINE}", the agent is revoked on Hyperliquid and gone from the phone`, async () => {
    const hl = fakeHl(opts as never);
    const { svc, mainAddress } = service(hl);
    await assert.rejects(svc.setup(), (e: any) => e.problem.code === "perps.selfcheck.failed" && e.problem.whatHappened === NOT_SAFE_LINE);
    const approvals = hl.sent.filter((x) => x.action.type === "approveAgent");
    assert.equal(approvals.length, 2, "the approval, then the revoke under the same name");
    assert.notEqual(approvals[1]!.action.agentAddress, approvals[0]!.action.agentAddress);
    assert.equal(signerOf(approvals[1]!, HL_TYPES.approveAgent), mainAddress);
    assert.equal((await svc.state()).on, false);
    await assert.rejects(svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "market" }), (e: any) => e.problem.code === "perps.off");
  });
}

test("landing 3, mainnet as data: the only host is api.hyperliquid.xyz; the approval says Mainnet; the agent's L1 signature uses mainnet's source; no 'test money' on its lines", async () => {
  const hl = fakeHl();
  const { svc } = service(hl, { net: HL_MAINNET });
  const s = await svc.setup();
  assert.equal(s.testNetwork, false);
  for (const u of hl.urls) assert.match(u, /^https:\/\/api\.hyperliquid\.xyz\/(info|exchange)$/);
  const [ap, cancel] = hl.sent;
  assert.deepEqual([ap!.action.hyperliquidChain, ap!.action.signatureChainId], ["Mainnet", "0x66eee"]);
  assert.equal(recover(l1Digest(cancel!.action, cancel!.nonce, false), cancel!.signature), ap!.action.agentAddress, "source 'a' (mainnet)");
  assert.notEqual(recover(l1Digest(cancel!.action, cancel!.nonce, true), cancel!.signature), ap!.action.agentAddress, "control: not testnet's");
  // a testnet agent on the same phone is another key, never mainnet's (each network's names in the vault)
  const t = service(fakeHl());
  await t.svc.setup();
  await assert.rejects(new PerpsService({ vault: t.vault, approve: async () => true, withMainKey: async (u) => u(new Uint8Array(32).fill(1), "0x" + "1".repeat(40) as `0x${string}`), mainAddress: async () => ("0x" + "1".repeat(40)) as `0x${string}`, fetch: fakeHl().fetch, net: HL_MAINNET }).order({ coin: "BTC", side: "long", usd: 50, leverage: 2, kind: "market" }), (e: any) => e.problem.code === "perps.off");
});

function money() {
  const calls: any[] = [];
  let payWith: ((d: string, a: string) => Promise<void>) | null = null;
  const m: NonNullable<PerpsDeps["money"]> = {
    toPerps: async (u, k, r) => (calls.push(["to", u, k, r]), { id: `fm-${k}`, kind: "out", perps: true, status: "pending", where: "in-flight", sent: { tokenId: "usdc", amount: u }, expected: { tokenId: "hl", amount: "0" }, usd: Number(u) / 1e6, startedAtIso: "", updatedAtIso: "" }),
    fromPerps: async (u, k, pay) => (calls.push(["from", u, k]), (payWith = pay), { id: `fm-${k}`, kind: "in", perps: true, status: "pending", where: "chain", sent: { tokenId: "hl", amount: u }, expected: { tokenId: "usdc", amount: "0" }, usd: Number(u) / 1e8, startedAtIso: "", updatedAtIso: "" }),
  };
  return { m, calls, pay: (d: string, a: string) => payWith!(d, a) };
}

test("landing 3, Put money in: mainnet only, on one sheet, to the core's OWN Perps address (never the app's), at least $5; test money is never Trading's", async () => {
  const mo = money();
  const testnet = service(fakeHl(), { money: mo.m });
  await assert.rejects(testnet.svc.fund(25, "perps-fund-key-0001"), (e: any) => e.problem.code === "perps.money.test-network");
  const no = service(fakeHl(), { net: HL_MAINNET, money: mo.m, yes: false });
  await assert.rejects(no.svc.fund(25, "perps-fund-key-0002"), (e: any) => e.problem.code === "perps.declined");
  const { svc, mainAddress, sheets } = service(fakeHl(), { net: HL_MAINNET, money: mo.m });
  await assert.rejects(svc.fund(4.99, "perps-fund-key-0003"), (e: any) => /least is \$5/.test(e.problem.whatHappened));
  await assert.rejects(svc.fund(10.005, "perps-fund-key-0004"), (e: any) => e.problem.code === "perps.order.refused");
  await svc.call("perps.fund", { usd: 25, key: "perps-fund-key-0005", recipient: "0x" + "e".repeat(40) });
  assert.deepEqual(mo.calls, [["to", "25000000", "perps-fund-key-0005", mainAddress]], "the app's recipient is ignored: the core's own address");
  assert.deepEqual(sheets, ["Put 25.00 dollars into Perps"]);
});

test("landing 3, what arrived goes into trading: the MAIN key signs usdClassTransfer (toPerp), rounded down, on a sheet; nothing arrived: nothing signed", async () => {
  const none = fakeHl();
  const a = service(none, { net: HL_MAINNET });
  await a.svc.useArrived();
  assert.equal(none.sent.length, 0);
  const hl = fakeHl({ spot: 12.345678912 });
  const { svc, mainAddress, sheets } = service(hl, { net: HL_MAINNET });
  await svc.useArrived();
  const [x] = hl.sent;
  assert.deepEqual([x!.action.type, x!.action.amount, x!.action.toPerp, x!.action.hyperliquidChain], ["usdClassTransfer", "12.345678", true, "Mainnet"]);
  assert.equal(signerOf(x!, HL_TYPES.usdClassTransfer), mainAddress);
  assert.deepEqual(sheets, ["Use it for trades"]);
});

test("landing 3, Take out: one sheet; inside the Trading move, trading's part moves to spot (rounded UP, review M1), then the MAIN key sends exactly 1Click's amount to its deposit address; anything else is refused", async () => {
  const mo = money();
  const hl = fakeHl({ spot: 1.2345675 });
  const { svc, mainAddress, sheets } = service(hl, { net: HL_MAINNET, money: mo.m });
  await assert.rejects(svc.takeOut(900, "perps-out-key-00001"), (e: any) => /up to \$801\.48/.test(e.problem.whatHappened));
  await assert.rejects(svc.takeOut(10, "short-key"), (e: any) => e.problem.code === "perps.order.refused", "one key rule: 16 to 64");
  await svc.takeOut(10, "perps-out-key-00002");
  assert.deepEqual(sheets, ["Take 10.00 dollars out of Perps"]);
  assert.deepEqual(mo.calls, [["from", "1000000000", "perps-out-key-00002"]]);
  assert.equal(hl.sent.length, 0, "nothing signed before the quote is checked (review L3)");
  const DEP = "0x00000000000000000000000000000000000D3f05";
  await mo.pay(DEP, "1000000000");
  const [cls, send] = hl.sent;
  // spot 1.2345675 counts as 1.234567: 8.765433 more makes at least 10 (rounded down, 8.765432, would leave 9.9999995)
  assert.deepEqual([cls!.action.type, cls!.action.amount, cls!.action.toPerp], ["usdClassTransfer", "8.765433", false]);
  assert.ok(1.2345675 + Number(cls!.action.amount) >= 10, "spot then holds at least the amount sent");
  assert.ok(1.2345675 + 8.765432 < 10, "control: rounding down would leave too little");
  assert.deepEqual([send!.action.type, send!.action.destination, send!.action.token, send!.action.amount], ["spotSend", DEP.toLowerCase(), HL_USDC_TOKEN, "10"]);
  assert.equal(signerOf(send!, HL_TYPES.spotSend), mainAddress);
  const before = hl.sent.length;
  await assert.rejects(mo.pay(DEP, "1000000001"), (e: any) => e.problem.code === "perps.hyperliquid.refused");
  await assert.rejects(mo.pay("not-an-address", "1000000000"), (e: any) => e.problem.code === "perps.hyperliquid.refused");
  assert.equal(hl.sent.length, before, "neither was signed");
  await assert.rejects(service(fakeHl(), { money: mo.m }).svc.takeOut(10, "perps-out-key-00003"), (e: any) => e.problem.code === "perps.money.test-network");
});

test("landing 3, Take out again after a part-done one: spot already holds it, so no transfer (never a '0'); more than trading has free is refused before signing", async () => {
  const mo = money();
  const full = fakeHl({ spot: 10 });
  const a = service(full, { net: HL_MAINNET, money: mo.m });
  await a.svc.takeOut(10, "perps-out-key-00004");
  await mo.pay("0x00000000000000000000000000000000000d3f05", "1000000000");
  assert.deepEqual(full.sent.map((x) => x.action.type), ["spotSend"], "no usdClassTransfer when spot already holds it");
  // more than spot and trading's free together: refused before the sheet
  const b = service(fakeHl({ spot: 2, free: 3 }), { net: HL_MAINNET, money: mo.m });
  await assert.rejects(b.svc.takeOut(10, "perps-out-key-00005"), (e: any) => /up to \$5\.00/.test(e.problem.whatHappened));
  // pay runs against Hyperliquid as it is now (free $3): 8 is more than that
  const late = money();
  const e = service(fakeHl({ spot: 2 }), { net: HL_MAINNET, money: late.m });
  await e.svc.takeOut(10, "perps-out-key-00007");
  const swapped = fakeHl({ spot: 2, free: 3 });
  (e.svc as any).fetch = swapped.fetch;
  await assert.rejects(late.pay("0x00000000000000000000000000000000000d3f05", "1000000000"), (x: any) => /up to \$5\.00/.test(x.problem.whatHappened));
  assert.equal(swapped.sent.length, 0, "nothing signed");
});

test("landing 3, a spotSend Hyperliquid didn't answer is marked maybe-sent (the Trading move waits for 1Click); a refusal before it is not", async () => {
  const mo = money();
  let down = false;
  const hl = fakeHl({ spot: 10 });
  const flaky = { ...hl, fetch: (async (u: string, i: RequestInit) => { if (down && u.endsWith("/exchange")) throw new TypeError("down"); return hl.fetch(u, i); }) as typeof fetch };
  const { svc } = service(flaky, { net: HL_MAINNET, money: mo.m });
  await svc.takeOut(10, "perps-out-key-00008");
  down = true;
  await assert.rejects(mo.pay("0x00000000000000000000000000000000000d3f05", "1000000000"), (e: any) => e.maybeSent === true && e.problem.code === "perps.hyperliquid.unreachable");
  await assert.rejects(mo.pay("0x00000000000000000000000000000000000d3f05", "1000000001"), (e: any) => e.maybeSent === undefined);
});

test("D145: an order whose leverage Hyperliquid already holds (same value, same margin type) skips updateLeverage; any other answer sets it first", async () => {
  const kinds = async (leverage: unknown) => {
    const hl = fakeHl({ leverage });
    const { svc } = service(hl);
    await svc.setup();
    await svc.order({ coin: "BTC", side: "long", usd: 50, leverage: 5, kind: "market" });
    return hl.sent.slice(2).map((x) => x.action.type);
  };
  assert.deepEqual(await kinds({ type: "cross", value: 5 }), ["order"], "held already: one round trip less");
  // controls: another value, another margin type, a value that doesn't read, no answer at all
  assert.deepEqual(await kinds({ type: "cross", value: 3 }), ["updateLeverage", "order"]);
  assert.deepEqual(await kinds({ type: "isolated", value: 5 }), ["updateLeverage", "order"]);
  assert.deepEqual(await kinds({ type: "cross", value: "5" }), ["updateLeverage", "order"]);
  assert.deepEqual(await kinds(undefined), ["updateLeverage", "order"]);
});
