// The ledger's Move from Private (private-move.ts, the product's HARD RULE: every money move confidential): each leg one
// payment from Private (safe-send.ts's own) straight to the person's own wallet; Private short with the fill closed is
// refused before anything is priced, kept or signed; the fill (VITE_SAFE_FILL_OPEN) opens route B for this call ONLY,
// rounded up a whole step, while every other route B caller still sees it closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { fillStepUsd } from "@zerofee/core/private-route";
import { createApis, type Apis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import { LANDS_AS } from "./send-to.ts";
import { QUOTE_ADDRESS, fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";
import type { Movement } from "./types.ts";

const ME = "kid.near";
const POCKET = "a1".repeat(32);
const FLOAT = "f0".repeat(32);
const RELAY = "https://quotes.example";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const OUT = "d".repeat(64);
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const JOB = "move-private-0123456789abcdef0123";
type Wallets = { kind: string; id: string; chain: string; address: string }[];
const WALLETS: Wallets = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: "sw-trade-sol", chain: "sol", address: SOL }, { kind: "trade", id: "sw-trade-near", chain: "near", address: FLOAT }];

function setup(o: { pocketUnits?: string; fillOpen?: boolean; core?: ReturnType<typeof fakeCore>; now?: () => number; safe?: Parameters<typeof fakeNear>[1] } = {}) {
  const core = o.core ?? fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: o.pocketUnits ?? "10000000" }], subwallets: WALLETS as never });
  const asked: any[] = [];
  const submitted: unknown[] = [];
  const base = createApis(replayFetch({ privateQuotes: `${RELAY}/v0` }));
  const apis: Apis = {
    ...base,
    quote: async (req: any) => { asked.push(req); return { quote: { depositAddress: req.dry ? undefined : OUT, amountIn: req.amount, amountOut: "7000", minAmountOut: "6900" }, zerofeeStatusTag: "tag-for-this-quote-0001" } as any; },
    generateIntent: async () => ({ payload: { message: "{}", nonce: "n", recipient: "intents.far" } }),
    submitIntent: async (_via, signed) => { submitted.push(signed); return { intentHash: "h" }; },
    status: async (a: string, _via?: string, tag?: string) => ({ status: a === QUOTE_ADDRESS ? "SUCCESS" : "SUCCESS", ...(tag ? { swapDetails: { amountOut: "999999999999999999999999" } } : {}) } as any),
  };
  // as apps/web/src/core.ts: each app's bridge stamps its name (forApps), so the core lists as that app sees (Wallet: Private only)
  const bridgeFor = (app: string) => ({ call: (m: string, q?: Record<string, unknown>) => core.call(m, { ...(q ?? {}), app }), on: (e: string, h: (v: unknown) => void) => core.on(e, h) }) as Bridge;
  const ledger = createLedgerService({ bridgeFor, chain: fakeNear(ME, o.safe ?? { ledger: { [USDC]: "500000000" } }, { [QUOTE_ADDRESS]: { ledger: {} } }), apis, routes: { intents: false, nearOrigin: false }, trackMs: 2, readCall: async () => ({ kind: "ran" }), privateQuotes: RELAY, safeFillOpen: o.fillOpen ?? false, ...(o.now ? { now: o.now } : {}) });
  return { ledger, core, asked, submitted };
}
const pay = (s: ReturnType<typeof setup>, parts: unknown[], caller = "trade") => s.ledger.call<{ parts: { wallet: string; ids: string[]; stopped?: string }[] }>("ledger.moveFromPrivate", { parts, job: JOB, caller });

test("Private covers the Move: each leg one payment from Private straight to its wallet (SOL to the SOL wallet's address, the NEAR wallet's share into its private balance); the Safe signs nothing; the job's payments are kept by its key", async () => {
  const s = setup();
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 6 }, { wallet: "near", usd: 4 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.parts.map((p) => [p.wallet, p.ids.map((id) => id.split(":")[0])]), [["sw-trade-sol", ["pocket-send"]], ["near", ["pocket-send"]]]);
  const real = s.asked.filter((q) => !q.dry);
  // the smallest leg first (Private pays it whole), then the next
  assert.deepEqual(real.map((q) => [q.depositType, q.recipient, q.recipientType, q.destinationAsset, q.amount, q.refundTo, q.refundType]), [
    ["CONFIDENTIAL_INTENTS", FLOAT, "CONFIDENTIAL_INTENTS", USDC, "4000000", POCKET, "CONFIDENTIAL_INTENTS"],
    ["CONFIDENTIAL_INTENTS", SOL, "DESTINATION_CHAIN", LANDS_AS.sol.tokenId, "6000000", POCKET, "CONFIDENTIAL_INTENTS"],
  ], "from Private, a refund back to Private, never the Safe's public leg");
  assert.deepEqual([s.core.signed.length, s.core.privateIns.length], [0, 0], "the Safe signs nothing, nothing fills Private");
  assert.deepEqual(s.core.privatePays.map((p) => p.send), [true, true], "the pocket's own payment (NEP-413, no sheet under the caps)");
  const st = await s.ledger.call<{ parts: { moves: { id: string }[] }[] }>("ledger.privateMoveStatus", { job: JOB });
  assert.ok("ok" in st && st.ok);
  assert.deepEqual(st.ok.parts.map((p) => p.moves.map((m) => m.id)), r.ok.parts.map((p) => p.ids), "read back by the job's key (a page closed mid-job)");
});

test("Private short, the fill closed (VITE_SAFE_FILL_OPEN off): refused before anything is priced, kept or signed, saying why; never the public leg instead (control: a Move Private covers goes)", async () => {
  const s = setup({ pocketUnits: "3000000" });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 6 }]);
  assert.ok("problem" in r);
  assert.deepEqual([r.problem.code, r.problem.whatHappened], ["ledger.private.short", "Nothing moved. Private has $3.00, and this needs $6.00."]);
  assert.deepEqual([s.asked.length, s.core.privatePays.length, s.core.signed.length, s.core.privateIns.length], [0, 0, 0, 0]);
  assert.equal(s.core.store.get("private-moves") ?? null, null, "no job kept");
  const empty = setup({ pocketUnits: "0" });
  const e = await pay(empty, [{ wallet: "sw-trade-sol", usd: 6 }]);
  assert.ok("problem" in e);
  assert.equal(e.problem.whatHappened, "Private is empty. Nothing moved.");
  assert.ok("ok" in (await pay(setup({ pocketUnits: "6000000" }), [{ wallet: "sw-trade-sol", usd: 6 }])), "control");
});

test("the fill open: route B opens for THIS call only; Private's share pays first, the Safe fills the rest by a whole step (fill ≠ payout, the extra stays in Private), and the payout goes only after the fill landed (controls: every other route B caller still sees it closed)", async () => {
  const s = setup({ pocketUnits: "12500000", fillOpen: true });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["pocket-send", "safe-send"]);
  // short $17.50: its fill is $20 (a $10 step over $17.50 and its 3 % gap), never $17.50
  const fill = Number(s.core.privateIns[0]!.amount) / 1e6;
  assert.ok(fill >= 19.9 && fill <= 20.1, String(fill));
  assert.notEqual(Math.round(fill * 100), 1750);
  assert.equal(s.core.signed.length, 1, "the Safe's own sheet (Face ID) for the fill");
  // the payout is the asked share of what the fill promises (send-job.ts hands it over only once 1Click says it landed with enough)
  const leg2 = s.asked.filter((q) => !q.dry).at(-1);
  assert.equal(leg2.recipient, SOL);
  assert.ok(BigInt(leg2.amount) < BigInt(s.core.privateIns[0]!.amount as string), "the payout is under the fill: the extra stays in Private");
  // controls: the fill is this call's own; route B for everyone stays closed
  const c = setup({ pocketUnits: "12500000", fillOpen: true });
  const q = await c.ledger.call("ledger.quoteToPrivate", { tokenId: USDC, amount: "5" });
  assert.ok("problem" in q && q.problem.code === "ledger.private.unavailable", "the Private screen's move in: closed");
  const send = await c.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "20", to: { kind: "chain", chain: "sol", address: SOL } });
  assert.ok("problem" in send && send.problem.code === "ledger.safe-send.most", "a Send without `fill`: as before");
  const pocket = await c.ledger.call<{ canAdd?: boolean }>("ledger.private", {});
  assert.ok("ok" in pocket && pocket.ok.canAdd === false, "Private's Add stays closed");
  const off = setup({ pocketUnits: "12500000" });
  const f = await off.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "20", to: { kind: "chain", chain: "sol", address: SOL }, fill: true });
  assert.ok("problem" in f && f.problem.code === "ledger.safe-send.most", "`fill` with the switch off opens nothing");
});

test("QA (5 Nov): a combined Move (Private's leg and the Safe's to one wallet) is one Safe sheet with Face ID, marked a Move's fill so the core says both legs from its own figures; the pocket's share goes first on its own payment; a Private-only Move asks no Face ID (controls: no app figures ride on the sheet; another Safe sheet carries no marker)", async () => {
  const s = setup({ pocketUnits: "12500000", fillOpen: true });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(s.core.signed.length, 1, "one Safe sheet: Face ID for the Safe's leg");
  assert.equal(s.core.signed[0]!.moveFill, true, "marked: the core's sheet says the legs");
  assert.equal((s.core.signed[0] as Record<string, unknown>).split, undefined, "never an app's figure");
  // the pocket's share (send) signed before the Safe's sheet, then leg 2 joined to its leg 1: the core's own record
  assert.deepEqual(s.core.privatePays.map((p) => [p.send === true, typeof p.inDeposit === "string"]), [[true, false], [false, true]]);
  const privOnly = setup({ pocketUnits: "12500000", fillOpen: true });
  assert.ok("ok" in (await pay(privOnly, [{ wallet: "sw-trade-sol", usd: 6 }])));
  assert.equal(privOnly.core.signed.length, 0, "Private alone: no Safe sheet, no Face ID");
  assert.equal(privOnly.core.privatePays.length, 1);
  // control: a Send's own Safe sheet with `fill` closed elsewhere (no Move fill) carries no marker
  const c = setup({ pocketUnits: "0", fillOpen: true });
  await c.ledger.call("ledger.sendFromSafe", { tokenId: USDC, amount: "20", to: { kind: "chain", chain: "sol", address: SOL } });
  assert.ok(c.core.signed.every((q) => q.moveFill === undefined));
});

test("the fill's step (QA's SHOULD): $10 under $100, $50 under $500, then $100, always over the payout and its 3 % gap, so the fill and the payout never share a figure", () => {
  for (const [short, fill] of [[9.95, 20], [17.5, 20], [10, 20], [95, 100], [97.09, 150], [100, 150], [480, 500], [490, 600], [1000, 1100]] as const) {
    assert.equal(fillStepUsd(short), fill, String(short));
    assert.ok(fill >= short * 1.03 && fill !== short, `${short}: fill ≠ payout`);
  }
  assert.equal(fillStepUsd(0), 0);
});

test("only the person's own wallets, and only Wallet and Trade (for Spending) may ask (control: a wallet of theirs goes)", async () => {
  const s = setup();
  const r = await pay(s, [{ wallet: "someone-else", usd: 6 }]);
  assert.ok("problem" in r && r.problem.code === "ledger.recipient.invalid", JSON.stringify(r));
  const pocket = await pay(s, [{ wallet: "sw-private", usd: 6 }]);
  assert.ok("problem" in pocket, "never the pocket itself");
  const p = await pay(s, [{ wallet: "sw-trade-sol", usd: 6 }], "pay");
  assert.ok("problem" in p && p.problem.code === "ledger.caller.refused", JSON.stringify(p));
  assert.equal(s.asked.length, 0);
  assert.ok("ok" in (await pay(s, [{ wallet: "sw-trade-sol", usd: 6 }], "wallet")));
});

test("QA's MUST: a fill's extra stays in Private: a Move's end never sweeps it home, nor a restart within 24 h of the fill (controls: with no fill, a restart sweeps as before; 24 h after the fill, it sweeps)", async () => {
  const until = async (ok: () => Promise<boolean> | boolean) => { for (let i = 0; i < 400 && !(await ok()); i++) await new Promise((res) => setTimeout(res, 3)); };
  const ended = async (l: ReturnType<typeof setup>) => until(async () => {
    const st = await l.ledger.call<{ parts: { moves: { status: string }[] }[] }>("ledger.privateMoveStatus", { job: JOB });
    return "ok" in st && !!st.ok && st.ok.parts.every((p) => p.moves.every((m) => m.status !== "moving" && m.status !== "waiting"));
  });
  let clock = Date.parse("2026-11-05T12:00:00Z");
  const now = () => clock;
  // Private holds $150 (over the sweep's $100), the Move asks $160: short $10, the Safe fills $20
  const s = setup({ pocketUnits: "150000000", fillOpen: true, now });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 160 }]);
  assert.ok("ok" in r && r.ok.parts[0]!.ids.some((id) => id.startsWith("safe-send:")), JSON.stringify(r));
  await ended(s);
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(s.core.privateHomes, [], "the Move's end: nothing goes home");
  // the app starts again an hour later: the start's sweep waits too
  clock += 3_600_000;
  const again = setup({ core: s.core, fillOpen: true, now });
  await again.ledger.call("ledger.activity", { caller: "wallet" });
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(s.core.privateHomes, [], "a restart within 24 h of the fill: nothing goes home");
  // control: 24 h after the fill, the start's sweep runs as before
  clock += 24 * 3_600_000;
  const later = setup({ core: s.core, fillOpen: true, now });
  await later.ledger.call("ledger.activity", { caller: "wallet" });
  await until(() => s.core.privateHomes.length > 0);
  assert.deepEqual(s.core.privateHomes.map((p) => p.tokenId), [USDC], "24 h on: home to the Safe");
  // control: no fill (Private covered it): the Move's end still never sweeps, a restart does
  const c = setup({ pocketUnits: "150000000", now });
  assert.ok("ok" in (await pay(c, [{ wallet: "sw-trade-sol", usd: 6 }])));
  await ended(c);
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(c.core.privateHomes, [], "a Move's end never sweeps");
  const restart = setup({ core: c.core, now });
  await restart.ledger.call("ledger.activity", { caller: "wallet" });
  await until(() => c.core.privateHomes.length > 0);
  assert.deepEqual(c.core.privateHomes.map((p) => p.tokenId), [USDC], "no fill in 24 h: the start's sweep as before");
});

test("QA's SHOULD: a damaged Move record holds the sweep (fail closed) 24 h from the read that found it, then lets it go (control: a record that reads, with no fill, sweeps at once)", async () => {
  const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((res) => setTimeout(res, 3)); };
  let clock = Date.parse("2026-11-05T12:00:00Z");
  const now = () => clock;
  const s = setup({ pocketUnits: "150000000", now });
  s.core.store.set("private-moves", "{not json");
  await s.ledger.call("ledger.activity", { caller: "wallet" });
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(s.core.privateHomes, [], "unreadable: held");
  clock += 23 * 3_600_000;
  await setup({ core: s.core, now }).ledger.call("ledger.activity", { caller: "wallet" });
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(s.core.privateHomes, [], "23 h on: still held (from the first read, not this one)");
  clock += 2 * 3_600_000;
  await setup({ core: s.core, now }).ledger.call("ledger.activity", { caller: "wallet" });
  await until(() => s.core.privateHomes.length > 0);
  assert.deepEqual(s.core.privateHomes.map((p) => p.tokenId), [USDC], "25 h on: home to the Safe");
  const c = setup({ pocketUnits: "150000000", now });
  c.core.store.set("private-moves", JSON.stringify({ old: { at: clock - 1000, parts: [] } }));
  await c.ledger.call("ledger.activity", { caller: "wallet" });
  await until(() => c.core.privateHomes.length > 0);
  assert.deepEqual(c.core.privateHomes.map((p) => p.tokenId), [USDC], "control: a record that reads, no fill: swept");
});

test("QA's proof lap: a Move's wallet as Trade names it (\"trade-sol-…\") is found through Trade's own list, never Wallet's (which holds only Private); control: an id that isn't the person's is refused with words", async () => {
  const ID = "trade-sol-7f3a9c";
  const core = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "trade", id: ID, chain: "sol", address: SOL }] as never });
  const s = setup({ core });
  const r = await pay(s, [{ wallet: ID, usd: 2.11 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(s.asked.filter((q) => !q.dry).at(-1).recipient, SOL, "paid to the SOL wallet's own address");
  const bad = await pay(setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: [{ kind: "trade", id: ID, chain: "sol", address: SOL }] as never }) }), [{ wallet: "trade-sol-not-theirs", usd: 2.11 }]);
  assert.ok("problem" in bad && bad.problem.code === "ledger.recipient.invalid" && bad.problem.whatHappened.length > 0, "refused, with words for the sheet");
});

test("a site's top-up (pump.fun, GMGN): the site's own SOL wallet, as Trade sees it (kind site), is found and paid at its address; control: a site wallet id that isn't listed is refused", async () => {
  const PUMP = "site-pump.fun-sol-EyyZf9", GMGN = "site-gmgn.ai-sol-4Rf8kL";
  const A = "8JVZpqUZfQMEc8kMduTS9SkVxP9v8rgunJNcV4qNYGYZ", B = "4Rf8kLqQ2WmHG1oHk5jBu7m1Y5Cz6ZfjE6vY3oXbUJmN";
  const wallets = [{ kind: "private", id: "sw-private", chain: "near", address: POCKET }, { kind: "site", id: PUMP, chain: "sol", address: A }, { kind: "site", id: GMGN, chain: "sol", address: B }];
  for (const [id, addr] of [[PUMP, A], [GMGN, B]] as const) {
    const s = setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: wallets as never }) });
    const r = await pay(s, [{ wallet: id, usd: 3 }]);
    assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
    assert.equal(s.asked.filter((q) => !q.dry).at(-1).recipient, addr, id);
  }
  const c = setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: wallets as never }) });
  const bad = await pay(c, [{ wallet: "site-pump.fun-sol-000000", usd: 3 }]);
  assert.ok("problem" in bad && bad.problem.code === "ledger.recipient.invalid");
});

test("QA (5 Nov, one bridge leg): the fill is paid inside intents.near: the Safe signs exactly one mt_transfer to 1Click's deposit address for the quote's amount, quoted INTENTS (no storage, no withdraw out and back); control: the switch off quotes nothing INTENTS", async () => {
  const s = setup({ pocketUnits: "12500000", fillOpen: true });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(s.core.privateIns.length, 1);
  assert.equal(s.core.privateIns[0]!.intents, true, "the fill's quote is INTENTS: paid inside intents.near");
  assert.equal(s.core.signed.length, 1, "one sheet, one Face ID");
  const tx = s.core.signed[0]!;
  const all = [tx, ...(((tx as unknown as { then?: unknown[] }).then ?? []) as typeof tx[])];
  const actions = all.flatMap((t) => t.actions.map((a) => ({ receiverId: t.receiverId, a })));
  assert.equal(actions.length, 1, `exactly one action: ${JSON.stringify(actions)}`);
  const { receiverId, a } = actions[0]! as { receiverId: string; a: { kind?: string; method?: string; methodName?: string; args?: Record<string, unknown> } };
  assert.equal(receiverId, "intents.near", "on intents.near, the contract's moves() path (bands, waits, daily total)");
  assert.match(String(a.method ?? a.methodName), /^mt_transfer$/);
  assert.equal(a.args?.receiver_id, QUOTE_ADDRESS, "to the quote's deposit address");
  assert.equal(a.args?.amount, s.core.privateIns[0]!.amount, "for the quote's amount");
  // control: the Safe's coin on its account, not in NEAR Intents: not this path (no INTENTS quote)
  const c = setup({ pocketUnits: "12500000" });
  await pay(c, [{ wallet: "sw-trade-sol", usd: 30 }]);
  assert.equal(c.core.privateIns.filter((p) => p.intents === true).length, 0, "the fill closed: nothing quoted INTENTS");
});

test("QA's MUST (audit 4 Nov, finding 2): after a words change, \"near\" pays the NEW NEAR float, never the old one listed first; control: an old-words chain wallet's id is refused, and a current one still goes", async () => {
  const OLD_FLOAT = "0f".repeat(32), OLD_SOL = "8wGBr9oLdWoRdS1111111111111111111111111111";
  const wallets = [
    { kind: "private", id: "sw-private", chain: "near", address: POCKET },
    { kind: "trade", id: "trade-near-old", chain: "near", address: OLD_FLOAT, oldWords: true },
    { kind: "trade", id: "trade-sol-old", chain: "sol", address: OLD_SOL, oldWords: true },
    { kind: "trade", id: "trade-near-new", chain: "near", address: FLOAT },
    { kind: "trade", id: "trade-sol-new", chain: "sol", address: SOL },
  ];
  const mk = () => setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: wallets as never }) });
  const s = mk();
  const r = await pay(s, [{ wallet: "near", usd: 3 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  const to = s.asked.filter((q) => !q.dry).at(-1);
  assert.equal(to.recipient, FLOAT, "the new float");
  assert.notEqual(to.recipient, OLD_FLOAT);
  const old = await pay(mk(), [{ wallet: "trade-sol-old", usd: 3 }]);
  assert.ok("problem" in old && old.problem.code === "ledger.recipient.invalid", "an old-words wallet is refused");
  const c = mk();
  const cur = await pay(c, [{ wallet: "trade-sol-new", usd: 3 }]);
  assert.ok("ok" in cur);
  assert.equal(c.asked.filter((q) => !q.dry).at(-1).recipient, SOL);
});

test("QA's lap (5 Nov): a fresh account's first Move sets Private up on the way (the pocket, a key from the backup words, nothing on chain) and goes, never \"Your private balance isn't set up on this phone yet\" (control: a child's account still has no Private)", async () => {
  const wallets: Wallets = WALLETS.filter((w) => w.kind !== "private");
  const created: unknown[] = [];
  const base = fakeCore({ accountId: ME, pocket: [], subwallets: wallets as never });
  const core = Object.assign(Object.create(base) as typeof base, {
    call: async (m: string, q: Record<string, unknown> = {}) => {
      if (m === "subwallet.create") { created.push(q); if (!wallets.some((w) => w.kind === "private")) wallets.unshift({ kind: "private", id: "sw-private", chain: "near", address: POCKET }); return { ok: { id: "sw-private" } }; }
      return base.call(m, q);
    },
  });
  const s = setup({ core, fillOpen: true });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 2.1 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(created.length, 1, "Private set up once, on the way");
  assert.deepEqual([(created[0] as { kind: string }).kind, (created[0] as { chain: string }).chain], ["private", "near"]);
  assert.deepEqual(r.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["safe-send"], "the Safe fills Private, then the payout");
  assert.equal(s.core.signed.length, 1, "one Safe sheet (Face ID): the fill");
  // control: a child's account (D30) never gets a pocket made
  const kidWallets: Wallets = WALLETS.filter((w) => w.kind !== "private");
  const kidBase = fakeCore({ accountId: ME, pocket: [], subwallets: kidWallets as never, kid: true });
  const kid = setup({ core: kidBase, fillOpen: true });
  const k = await pay(kid, [{ wallet: "sw-trade-sol", usd: 2.1 }]);
  assert.ok("problem" in k, JSON.stringify(k));
  assert.ok(!kidWallets.some((w) => w.kind === "private"));
});

test("QA's matrix (5 Nov, real money): Private pays a Move to the Robinhood wallet straight to its address, as SOL's (control: a wallet that isn't the person's is refused)", async () => {
  const HOOD = "0x" + "ab".repeat(20);
  const wallets: Wallets = [...WALLETS, { kind: "trade", id: "sw-trade-hood", chain: "hood", address: HOOD }];
  const s = setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: wallets as never }) });
  const r = await pay(s, [{ wallet: "sw-trade-hood", usd: 4 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.deepEqual(r.ok.parts[0]!.ids.map((id) => id.split(":")[0]), ["pocket-send"]);
  const q = s.asked.filter((x) => !x.dry).at(-1);
  assert.deepEqual([q.depositType, q.recipient, q.recipientType, q.refundTo], ["CONFIDENTIAL_INTENTS", HOOD, "DESTINATION_CHAIN", POCKET]);
  assert.equal(s.core.signed.length, 0, "the Safe signs nothing: Private covers it");
  const bad = await pay(s, [{ wallet: "sw-trade-hood-not-mine", usd: 4 }]);
  assert.ok("problem" in bad && bad.problem.code === "ledger.recipient.invalid");
});

test("failure paths (rules file, 5 Nov): a dead node on Private's read refuses before anything is signed or kept; a retry after a refusal goes, once; a reload mid-Move finds the job's payments again (controls in each)", async () => {
  // a dead node: Private's balance can't be read; nothing priced, signed or kept, and a Problem comes back (never a throw)
  const base = fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: WALLETS as never });
  let dead = true;
  const flaky = Object.assign(Object.create(base) as typeof base, {
    call: async (m: string, q: Record<string, unknown> = {}) => (dead && m === "subwallet.private.balances" ? { problem: { code: "ledger.nodes.unreachable", whatHappened: "NEAR's servers didn't answer.", money: { state: "safe", where: "in Private" }, next: { kind: "retry", label: "Try again" } } } : base.call(m, q)),
  });
  const s = setup({ core: flaky });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 4 }]);
  assert.ok("problem" in r, JSON.stringify(r));
  assert.deepEqual([s.asked.filter((q) => !q.dry).length, s.core.signed.length, base.privatePays.length], [0, 0, 0]);
  assert.equal(base.store.get("private-moves") ?? null, null, "no job kept");
  // retry after the refusal, the node back: it goes, once, under the same job key
  dead = false;
  const again = await pay(s, [{ wallet: "sw-trade-sol", usd: 4 }]);
  assert.ok("ok" in again, "problem" in again ? again.problem.whatHappened : "");
  assert.equal(base.privatePays.length, 1, "one payment, never two");
  // reload mid-Move: a new ledger over the same device store reads the job's payments back by its key
  const reloaded = setup({ core: base });
  const st = await reloaded.ledger.call<{ parts: { wallet: string; moves: { id: string }[] }[] } | null>("ledger.privateMoveStatus", { job: JOB });
  assert.ok("ok" in st && st.ok, JSON.stringify(st));
  assert.deepEqual(st.ok.parts.map((p) => [p.wallet, p.moves.map((m) => m.id)]), again.ok.parts.map((p) => [p.wallet, p.ids]));
  // control: a job never kept reads as none
  const none = await reloaded.ledger.call("ledger.privateMoveStatus", { job: "never-0123456789abcdef" });
  assert.ok("ok" in none && none.ok === null);
});

test("the fill with the Safe's coin on its own account, not inside NEAR Intents (QA, 5 Nov): never the INTENTS mt_transfer; today it takes the old route, quoted ORIGIN_CHAIN, the Safe signing one ft_transfer on the coin's own contract to the quote's deposit address for the quote's amount (control: the coin in NEAR Intents goes by the one mt_transfer)", async () => {
  const s = setup({ pocketUnits: "12500000", fillOpen: true, safe: { ledger: {}, account: { [USDC]: "500000000" } } });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 30 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal(s.core.privateIns.length, 1);
  assert.notEqual(s.core.privateIns[0]!.intents, true, "never quoted INTENTS: the Safe holds nothing inside intents.near");
  assert.equal(s.core.signed.length, 1, "one sheet, one Face ID");
  const tx = s.core.signed[0]!;
  const all = [tx, ...(((tx as unknown as { then?: unknown[] }).then ?? []) as typeof tx[])];
  assert.deepEqual(all.filter((t) => t.receiverId === "intents.near"), [], "nothing signed on intents.near");
  const actions = all.flatMap((t) => t.actions.map((a) => ({ receiverId: t.receiverId, a })));
  assert.equal(actions.length, 1, `exactly one action: ${JSON.stringify(actions)}`);
  const { receiverId, a } = actions[0]! as { receiverId: string; a: { method?: string; methodName?: string; args?: Record<string, unknown> } };
  assert.equal(`nep141:${receiverId}`, USDC, "on the coin's own contract");
  assert.equal(String(a.method ?? a.methodName), "ft_transfer");
  assert.equal(a.args?.receiver_id, QUOTE_ADDRESS, "to the quote's deposit address");
  assert.equal(a.args?.amount, s.core.privateIns[0]!.amount, "for the quote's amount");
  // control: the coin in the Safe's NEAR Intents balance: the fill goes by its one mt_transfer on intents.near
  const c = setup({ pocketUnits: "12500000", fillOpen: true });
  assert.ok("ok" in (await pay(c, [{ wallet: "sw-trade-sol", usd: 30 }])));
  assert.equal(c.core.signed[0]!.receiverId, "intents.near");
  assert.equal(c.core.privateIns[0]!.intents, true);
});

test("the audit (5 Nov): each part says the least its wallet is promised (the payout quote's minAmountOut, the quoted out less slippage), so its tick waits for a read that shows it (control: the NEAR wallet's Move too, from its own quote)", async () => {
  const s = setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: WALLETS as never }) });
  const r = await pay(s, [{ wallet: "sw-trade-sol", usd: 4 }]);
  assert.ok("ok" in r, "problem" in r ? `${r.problem.code} ${r.problem.whatHappened}` : "");
  assert.equal((r.ok.parts[0] as { minOut?: string }).minOut, "6900", "the quote's minAmountOut, never its amountOut (7000)");
});

test("the audit (5 Nov): every NEW part the real ledger pays carries its minOut, whichever way it went (Private alone, Private then the Safe's fill, the fill alone for a whole site top-up, two wallets): a part without one is only an older build's row or the Sim's (control: the sum of its payments' least)", async () => {
  const runs: { what: string; s: ReturnType<typeof setup>; parts: unknown[]; whole?: true }[] = [
    { what: "Private alone", s: setup({ core: fakeCore({ accountId: ME, pocket: [{ tokenId: USDC, amount: "10000000" }], subwallets: WALLETS as never }) }), parts: [{ wallet: "sw-trade-sol", usd: 4 }] },
    { what: "Private, then the fill", s: setup({ pocketUnits: "12500000", fillOpen: true }), parts: [{ wallet: "sw-trade-sol", usd: 30 }] },
    { what: "two wallets", s: setup({ pocketUnits: "12500000", fillOpen: true }), parts: [{ wallet: "sw-trade-sol", usd: 5 }, { wallet: "sw-trade-sol", usd: 20 }] },
  ];
  for (const run of runs) {
    const r = await pay(run.s, run.parts);
    assert.ok("ok" in r, `${run.what}: ${"problem" in r ? r.problem.whatHappened : ""}`);
    for (const p of r.ok.parts as { ids: string[]; minOut?: string }[]) {
      if (!p.ids.length) continue;
      assert.match(p.minOut ?? "", /^[1-9]\d*$/, `${run.what}: a paid part names its least`);
      assert.equal(p.minOut, String(6900 * p.ids.length), `${run.what}: the sum of its payments' quoted least (minAmountOut 6900 each)`);
    }
  }
  // the code: both payouts (Private's own, and the fill's exit) stamp it from their quote
  const src = (await import("node:fs")).readFileSync(new URL("./safe-send.ts", import.meta.url), "utf8");
  assert.equal(src.match(/private: true, \.\.\.leastOf\(real\.quote\)/g)?.length, 2);
});
