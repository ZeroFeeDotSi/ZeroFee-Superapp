// Money that came in (product decision, 3 Nov was wrong): every Add once it ended, the NEAR that opened the
// account and money others sent straight to the Safe are each one lasting "Received" row in Activity, counted once by
// the Statement (and so by AgentZero, which reads the same rows). Every check has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Received } from "@zerofee/core/add-outside";
import { createApis } from "./apis.ts";
import { NATIVE_NEAR, WRAPPED_NEAR } from "./catalogue.ts";
import { createLedgerService } from "./ledger.ts";
import { SAFE_QUIET_MS, SAFE_RECEIVED, receivedMovement, receivedRows, safeWatch, type ReceivedDeps } from "./received.ts";
import { describe } from "./app/format.ts";
import { statementRows, summaryLine } from "./app/statement.ts";
import type { Balance, Chain, Movement, Token } from "./types.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const ME = "kid.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "nep141:sol.omft.near";
const T0 = Date.parse("2026-11-03T10:00:00.000Z");

const add: Received = { id: "add:fo-add-sol-wallet-1", kind: "add", chain: "sol", into: "sol", tokenId: SOL, decimals: 9, amount: "101000000", usd: "15.15", feeUsd: "0.30", atIso: "2026-11-03T09:00:00.000Z" };
const opened: Received = { id: "open:kid.near", kind: "open", chain: "near", into: "safe", tokenId: "near", decimals: 24, amount: "5000000000000000000000000", usd: "20.00", atIso: "2026-11-01T09:00:00.000Z" };
const row = (tokenId: string, amount: string, usd?: string, o: Partial<Balance> = {}): Balance => ({ tokenId, symbol: tokenId === USDC ? "USDC" : "NEAR", name: "", icon: "", chain: "near", amount, ...(usd ? { usd } : {}), bridged: false, held: "ledger", listed: true, ...o });

/** received.ts's deps on a plain map, a clock, this phone's moves, the account's steps and the core's answer. */
function deps(o: { mine?: Movement[]; steps?: string[] | null; touched?: string[] | null; adds?: Received[]; opened?: Received | null } = {}) {
  const kv = new Map<string, string>();
  const clock = { t: T0 };
  const said: Movement[] = [];
  const asked: Record<string, unknown>[] = [];
  const d: ReceivedDeps = {
    stored: async (k) => kv.get(k) ?? null,
    store: async (k, v) => kv.set(k, v),
    mine: async () => o.mine ?? [],
    chainTimes: () => (o.steps === undefined ? [] : o.steps),
    core: async <T,>(method: string, p?: Record<string, unknown>) => {
      asked.push({ method, ...p });
      if (o.touched === null) throw new Error("the core didn't answer");
      return { adds: o.adds ?? [], opened: o.opened ?? null, ...(p?.since !== undefined ? { touched: o.touched ?? [] } : {}) } as T;
    },
    now: () => clock.t,
    emit: (m) => said.push(m),
  };
  return { d, kv, clock, said, asked, o };
}

test("the Safe watch: a coin that rose while none of the person's own moves touched it is one Received row with its dollars; the next read without a change, none (control: the first read is only the start)", async () => {
  const { d, kv, clock, said } = deps();
  assert.deepEqual(await safeWatch(d, ME, [row(USDC, "10", "10.00")]), [], "the first read: the start, never a row");
  clock.t += 30_000;
  const got = await safeWatch(d, ME, [row(USDC, "22.5", "22.50")]);
  assert.deepEqual(got.map((m) => [m.kind, m.status, m.from, m.to, m.amount, m.usd, m.into]), [["deposit", "done", undefined, USDC, "12.5", "12.50", "safe"]]);
  assert.equal(said.length, 1, "Activity is told");
  clock.t += 30_000;
  assert.deepEqual(await safeWatch(d, ME, [row(USDC, "22.5", "22.50")]), [], "no change: no second row");
  assert.equal(JSON.parse(kv.get(SAFE_RECEIVED)!).length, 1, "kept once");
  // control: another account's first read is its own start
  assert.deepEqual(await safeWatch(d, "other.near", [row(USDC, "99", "99.00")]), []);
});

test("the Safe watch never says one of the person's own moves came from someone else: a move of this phone's open or just ended, the float's move home, or a step the account signed (NEAR) (controls: a coin none of them touched)", async () => {
  const send: Movement = { id: "home:1", kind: "private", status: "done", from: "private", to: USDC, amount: "12.5", startedAtIso: new Date(T0).toISOString(), updatedAtIso: new Date(T0 + 10_000).toISOString(), explorerUrls: [] };
  const rise = async (o: Parameters<typeof deps>[0], coins: [string, string, string][]) => {
    const { d, clock } = deps(o);
    await safeWatch(d, ME, coins.map(([t, a, u]) => row(t, a, u)));
    clock.t += 30_000;
    return safeWatch(d, ME, coins.map(([t, a, u]) => row(t, String(Number(a) + 12.5), (Number(u) + 12.5).toFixed(2))));
  };
  assert.deepEqual(await rise({ mine: [send] }, [[USDC, "10", "10.00"]]), [], "this phone's move into the Safe, ended since the last read");
  assert.deepEqual(await rise({ mine: [{ ...send, updatedAtIso: new Date(T0 - SAFE_QUIET_MS + 1000).toISOString() }] }, [[USDC, "10", "10.00"]]), [], "ended a moment before the last read");
  assert.deepEqual(await rise({ mine: [{ ...send, status: "moving", updatedAtIso: new Date(T0 - 86_400_000).toISOString() }] }, [[USDC, "10", "10.00"]]), [], "still on its way");
  assert.deepEqual(await rise({ mine: [{ ...send, from: "private", to: "trading" }] }, [[USDC, "10", "10.00"]]), [], "a move whose coins can't be told: none");
  assert.deepEqual(await rise({ touched: [USDC] }, [[USDC, "10", "10.00"]]), [], "the float's move home (an Add to the Safe, a Move back)");
  assert.deepEqual(await rise({ touched: ["*"] }, [[USDC, "10", "10.00"]]), [], "the float unread: none");
  assert.deepEqual(await rise({ touched: null }, [[USDC, "10", "10.00"]]), [], "the core didn't answer: none");
  assert.deepEqual(await rise({ steps: [new Date(T0 + 5_000).toISOString()] }, [[NATIVE_NEAR, "10", "40.00"]]), [], "NEAR after a step the account signed");
  assert.deepEqual(await rise({ steps: null }, [[NATIVE_NEAR, "10", "40.00"]]), [], "NEAR before the account's record is read");
  // controls: the same rises, untouched
  assert.equal((await rise({ mine: [{ ...send, updatedAtIso: new Date(T0 - 3_600_000).toISOString() }] }, [[USDC, "10", "10.00"]])).length, 1, "a move ended long before");
  assert.equal((await rise({ touched: [SOL] }, [[USDC, "10", "10.00"]])).length, 1, "the float touched another coin");
  assert.deepEqual((await rise({ mine: [send] }, [[USDC, "10", "10.00"], [NATIVE_NEAR, "10", "40.00"]])).map((m) => m.to), [], "every own move pays NEAR: NEAR too is touched");
  const near = await rise({ steps: [new Date(T0 - 3_600_000).toISOString()] }, [[NATIVE_NEAR, "10", "40.00"]]);
  assert.deepEqual(near.map((m) => [m.to, m.amount]), [[NATIVE_NEAR, "12.5"]], "NEAR sent by someone: its row, as NEAR");
});

test("the Safe watch: NEAR on the account and wrapped NEAR are one coin; an unnamed coin and a rise under a cent are never Received (controls)", async () => {
  const { d, clock } = deps();
  await safeWatch(d, ME, [row(NATIVE_NEAR, "10", "40.00", { held: "account" }), row(WRAPPED_NEAR, "1", "4.00"), row("nep141:spam.near", "1", undefined, { listed: false })]);
  clock.t += 30_000;
  // 2 NEAR wrapped into intents by a move of the account's own coins: the sum is the same
  assert.deepEqual(await safeWatch(d, ME, [row(NATIVE_NEAR, "8", "32.00", { held: "account" }), row(WRAPPED_NEAR, "3", "12.00"), row("nep141:spam.near", "1000", undefined, { listed: false })]), [], "moved between its own places; an airdropped unnamed coin");
  clock.t += 30_000;
  assert.deepEqual(await safeWatch(d, ME, [row(NATIVE_NEAR, "8.001", "32.004", { held: "account" }), row(WRAPPED_NEAR, "3", "12.00")]), [], "a storage refund under a cent");
  clock.t += 30_000;
  assert.equal((await safeWatch(d, ME, [row(NATIVE_NEAR, "9.001", "36.004", { held: "account" }), row(WRAPPED_NEAR, "3", "12.00")])).length, 1, "control: a whole NEAR sent");
});

test("Activity's Received rows: each Add and the opening from the core, once; a Safe row that is a bridge deposit Activity lists already is left out (control: another amount stays)", async () => {
  const { d, kv } = deps({ adds: [add], opened });
  kv.set(SAFE_RECEIVED, JSON.stringify([
    { id: "safe:x:1", kind: "deposit", status: "done", to: USDC, amount: "42.1", startedAtIso: "", updatedAtIso: "2026-11-03T08:00:00.000Z", explorerUrls: [], into: "safe", usd: "42.10" },
    { id: "safe:x:2", kind: "deposit", status: "done", to: USDC, amount: "7", startedAtIso: "", updatedAtIso: "2026-11-03T07:00:00.000Z", explorerUrls: [], into: "safe", usd: "7.00" },
  ]));
  const bridge: Movement = { id: "deposit:H1", kind: "deposit", status: "done", from: "sol", to: USDC, amount: "42.10", startedAtIso: "", updatedAtIso: "2026-11-03T08:00:00.000Z", explorerUrls: [] };
  const rows = await receivedRows(d, [bridge]);
  assert.deepEqual(rows.map((m) => m.id), ["add:fo-add-sol-wallet-1", "open:kid.near", "safe:x:2"]);
  assert.deepEqual(receivedMovement(add), { id: add.id, kind: "deposit", status: "done", from: "sol", to: SOL, amount: "0.101", startedAtIso: add.atIso, updatedAtIso: add.atIso, explorerUrls: [], into: "sol", usd: "15.15", feeUsd: "0.30" });
  assert.equal(receivedMovement(opened).amount, "5");
  assert.equal(receivedMovement(opened).opened, true);
});

test("the ledger: each kind appears in Activity once, read after read, and a Safe read finds money others sent; each is done, so Home's on-its-way list (moving deposits only) never shows one beside its line (control: the core's record unread, none of its rows)", async () => {
  const holdings = { ledger: { [USDC]: "10000000" } };
  const received = { adds: [add] as unknown[], opened: opened as unknown, touched: [] as string[] };
  const core = fakeCore({ accountId: ME, received });
  const ledger: Bridge = createLedgerService({ bridge: core, chain: fakeNear(ME, holdings), apis: createApis(replayFetch()), readCall: async () => ({ kind: "ran" }) });
  const ok = async <T,>(method: string, p?: Record<string, unknown>): Promise<T> => {
    const r: BridgeResult<T> = await ledger.call<T>(method, p);
    if ("problem" in r) assert.fail(`${method}: ${r.problem.whatHappened}`);
    return r.ok;
  };
  await ok("ledger.balances");
  const told = new Promise<Movement>((resolve) => {
    const off = ledger.on<{ movement: Movement }>("ledger.movementUpdated", ({ movement }) => movement.id.startsWith("safe:") && (off(), resolve(movement)));
  });
  // 12.5 USDC sent straight to the Safe by someone else
  holdings.ledger[USDC] = "22500000";
  await ok("ledger.balances");
  const safe = await told;
  assert.deepEqual([safe.to, safe.amount, safe.into], [USDC, "12.5", "safe"]);
  const ids = async () => (await ok<Movement[]>("ledger.activity", { caller: "wallet" })).map((m) => m.id).filter((id) => /^(add|open|safe):/.test(id)).sort();
  const want = [add.id, opened.id, safe.id].sort();
  assert.deepEqual(await ids(), want);
  assert.deepEqual(await ids(), want, "read again: each once");
  const all = (await ok<Movement[]>("ledger.activity", { caller: "wallet" })).filter((m) => want.includes(m.id));
  assert.ok(all.every((m) => m.kind === "deposit" && m.status === "done"), "done: never on Home's on-its-way list");
  assert.match(await import("node:fs").then((fs) => fs.readFileSync(new URL("./app/screens/Home.tsx", import.meta.url), "utf8")), /m\.kind === "deposit" && m\.status === "moving"/, "Home's list takes moving deposits only");
  await ok("ledger.balances");
  assert.deepEqual(await ids(), want, "a Safe read with no change adds nothing");
  // control: the core's record unread, its rows aren't made up (the Safe's own row is this phone's)
  received.adds = [];
  received.opened = null;
  assert.deepEqual(await ids(), [safe.id]);
});

test("the Statement counts every dollar that came in: an Add's at its dollars when it landed, to the wallet it landed in; the opening; money sent to the Safe (control: without its dollars, an Add of SOL said nothing came in)", () => {
  const tokens = new Map<string, Token>([[SOL, { assetId: SOL, chain: "sol", symbol: "SOL", decimals: 9, contract: null, priceUsd: "150" }], [USDC, { assetId: USDC, chain: "near", symbol: "USDC", decimals: 6, contract: null, priceUsd: "1" }]]);
  const chains: Chain[] = [{ id: "sol", name: "Solana" }, { id: "near", name: "NEAR" }] as Chain[];
  const safe: Movement = { id: "safe:x:1", kind: "deposit", status: "done", to: USDC, amount: "12.5", startedAtIso: "", updatedAtIso: "2026-11-03T08:00:00.000Z", explorerUrls: [], into: "safe", usd: "12.50" };
  const ms = [receivedMovement(add), receivedMovement(opened), safe];
  const rows = statementRows(ms, [], tokens, chains, 2026, 10);
  assert.deepEqual(rows.map((r) => [r.type, r.coin, r.amount, r.dollars, r.from, r.to, r.way]), [
    ["Received", "NEAR", "5", "20.00", "NEAR", "Safe", 1],
    ["Received", "USDC", "12.5", "12.50", "", "Safe", 1],
    ["Received", "SOL", "0.101", "15.15", "Solana", "SOL wallet", 1],
  ]);
  assert.equal(summaryLine(rows, 2026, 10), "3 moves in November 2026. $47.65 came in.");
  const { usd: _u, ...bare } = receivedMovement(add);
  assert.equal(summaryLine(statementRows([bare], [], tokens, chains, 2026, 10), 2026, 10), "1 move in November 2026.", "control: an Add with no dollars counted nothing");
  // Activity's own words
  assert.deepEqual(describe(receivedMovement(add), tokens, chains), { title: "Received", detail: "0.101 SOL from Solana · in your SOL wallet · $0.30 in fees" });
  assert.equal(describe(receivedMovement(opened), tokens, chains).detail, "5 NEAR · opened your account");
  assert.equal(describe(safe, tokens, chains).detail, "12.5 USDC · in your Safe");
});

// Finding 10 (4 Nov): "Received 12 NEAR · opened your account" beside a Safe holding a little less, with the
// opening cost nowhere. The opening's row now says what of it paid to open the account (Copywriter: it is
// paid, never "kept"; at most 4 decimals); an account opened before the core recorded it keeps the plain line.
test("finding 10: the opening's row says what of it paid to open the account, at most 4 decimals", () => {
  const tokens = new Map<string, Token>();
  const chains: Chain[] = [{ id: "near", name: "NEAR" }] as Chain[];
  const kept = { ...opened, keptAmount: "134012345678901234567890" } as typeof opened;
  const m = receivedMovement(kept);
  assert.equal(m.openKept, "0.13401234567890123456789");
  assert.equal(describe(m, tokens, chains).detail, "5 NEAR · 0.134 NEAR of it paid to open your account");
  assert.equal(describe(receivedMovement(opened), tokens, chains).detail, "5 NEAR · opened your account", "control: no figure recorded");
});
