// D117: AgentZero acts on the person's rows and Hidden inside one approved job scope (agent-act.ts). Each rule with a
// control: outside a scope, nothing; from the Safe, never; over the day, refused before anything is signed; "Ask me first";
// each kind reaches its one existing core path once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { act, actCall, actScope, type ActHost } from "./agent-act.ts";
import { AGENT_ACT } from "./agent-route.ts";
import { ASK_FIRST_CODE, setAskAbove } from "./agent-private.ts";
import { FLOAT_USDC } from "./float-moves.ts";
import type { PlainWords } from "./signer.ts";
import { MemoryVault } from "./vault.ts";

function rig(o: { answer?: boolean | (() => boolean); swapUsd?: number } = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const sheets: PlainWords[] = [];
  let stops = 0, strong = 0, clock = Date.parse("2026-11-03T03:00:00Z");
  const rec = (fn: string) => async (...args: unknown[]) => (calls.push({ fn, args }), { id: `${fn}-1`, status: "pending" });
  const h: ActHost = {
    // the person's own rows (D117) with AgentZero's own wallet explicitly off: the rules below are that path's (the
    // shipped default, on, is agent-sandbox.test.ts's)
    wallet: false,
    vault: new MemoryVault(),
    approve: async (w) => (sheets.push(w), typeof o.answer === "function" ? o.answer() : (o.answer ?? true)),
    strong: async () => void strong++,
    price: async (c) => ({ sol: 150, hood: 3000, bsc: 600, near: 3 })[c],
    stops: () => stops,
    now: () => clock,
    wallets: {
      floatOut: rec("floatOut"),
      floatIn: rec("floatIn"),
      floatHome: rec("floatHome"),
      privateHome: rec("privateHome"),
      agentSwap: async (...args: unknown[]) => {
        calls.push({ fn: "agentSwap", args });
        const cover = args[5] as (usd: number) => boolean;
        cover(o.swapUsd ?? 5); // the core's own price for it
        return { id: "swap-1", status: "pending" };
      },
    },
  };
  return { h, calls, sheets, stop: () => void stops++, strong: () => strong, tick: (ms: number) => void (clock += ms) };
}
const refused = (re: RegExp) => (e: any) => e?.problem?.code === "security.subwallet.refused" && re.test(String(e.problem.more));
const ALL = { kinds: ["send", "swap", "move", "pay", "trade"], places: ["sol", "hood", "near", "bsc", "spending", "hidden"], payees: [], dayUsd: 20, minutes: 60 };
let n = 0;
const key = () => `act-key-${String(++n).padStart(4, "0")}`;

test("outside an approved job every kind is refused by name, and nothing moves; from the Safe is refused for every kind, scope or not", async () => {
  const r = rig();
  for (const kind of ["send", "swap", "move", "pay", "trade"]) {
    await assert.rejects(act({ kind, from: "spending", to: "sol", usd: 1, key: key() }, r.h), refused(/AgentZero isn't allowed to act today/), kind);
    await assert.rejects(act({ kind, from: "safe", to: "sol", usd: 1, key: key() }, r.h), refused(/never takes money from your Safe/), kind);
  }
  await actScope({ set: ALL }, r.h);
  for (const kind of ["send", "swap", "move", "pay", "trade"]) await assert.rejects(act({ kind, from: "safe", to: "spending", usd: 1, key: key() }, r.h), refused(/never takes money from your Safe/), kind);
  assert.equal(r.calls.length, 0);
});

test("the job's scope: one sheet (and D103's check) to allow it; narrower or an end at once; a Stop during the sheet or after ends it", async () => {
  const r = rig();
  const s = await actScope({ set: { ...ALL, kinds: ["move"], places: ["spending", "sol"], dayUsd: 10 } }, r.h);
  assert.ok("scope" in s && s.scope);
  assert.equal(r.sheets.length, 1);
  assert.equal(r.strong(), 1);
  assert.equal(r.sheets[0]!.title, "Let AgentZero act for you");
  // A-12: the dry run first, its most being the scope's own day limit.
  assert.deepEqual(r.sheets[0]!.lines.slice(0, 2), ["Here's what I'd do:", "1. When you ask, move money: up to $10 in all."]);
  assert.match(r.sheets[0]!.lines.join(" "), /2\. Only from your NEAR wallet, your SOL wallet\. 3\. Stop at .*, or when you say\. 3 steps, \$10 most\. Never takes from your Safe\./);
  await actScope({ set: { ...ALL, kinds: ["move"], places: ["spending", "sol"], dayUsd: 5, minutes: 30 } }, r.h);
  assert.equal(r.sheets.length, 1, "narrower: no sheet");
  await actScope({ set: { ...ALL, kinds: ["move", "swap"], places: ["spending", "sol"], dayUsd: 5, minutes: 30 } }, r.h);
  assert.equal(r.sheets.length, 2, "more: the sheet again");
  r.stop();
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, r.h), refused(/isn't allowed to act today/), "a Stop ends it");
  // a Stop while the sheet is open: nothing allowed
  const q = rig();
  q.h.approve = async () => (q.stop(), true);
  await assert.rejects(actScope({ set: ALL }, q.h), refused(/AgentZero was stopped/));
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, q.h), refused(/isn't allowed/));
  // a no on the sheet allows nothing; an end is at once
  const no = rig({ answer: false });
  assert.deepEqual(await actScope({ set: ALL }, no.h), { declined: true });
  const e = rig();
  await actScope({ set: ALL }, e.h);
  assert.deepEqual(await actScope({ end: true }, e.h), { scope: null });
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, e.h), refused(/isn't allowed/));
});

test("the day's limit: counted before anything is signed; over it refused and nothing called; its time ends it", async () => {
  const r = rig();
  await actScope({ set: { ...ALL, dayUsd: 10 } }, r.h);
  await act({ kind: "move", from: "spending", to: "sol", usd: 6, key: key() }, r.h);
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 5, key: key() }, r.h), refused(/Today's \$10 for this job is used up/));
  assert.equal(r.calls.length, 1, "the refused one called nothing");
  await act({ kind: "move", from: "spending", to: "sol", usd: 4, key: key() }, r.h);
  r.tick(61 * 60_000);
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, r.h), refused(/isn't allowed/));
});

test("Ask me first: over it, AgentZero asks first by name and nothing moves; control: at it, it moves", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  await setAskAbove(3, { vault: r.h.vault, approve: async () => true, strong: async () => undefined });
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 3.5, key: key() }, r.h), (e: any) => e.problem.code === ASK_FIRST_CODE);
  assert.equal(r.calls.length, 0);
  await act({ kind: "move", from: "spending", to: "sol", usd: 3, key: key() }, r.h);
  assert.equal(r.calls.length, 1);
});

test("each kind inside the scope reaches its one existing core path once; what has no path today is refused by name", async () => {
  const r = rig({ swapUsd: 4.2 });
  await actScope({ set: ALL }, r.h);
  const out = await act({ kind: "move", from: "spending", to: "sol", usd: 3, key: key() }, r.h);
  assert.deepEqual(r.calls.at(-1), { fn: "floatOut", args: ["sol", undefined, "20000000", r.calls.at(-1)!.args[3]] }, "$3 of SOL at $150 = 0.02 SOL");
  assert.equal(out.line, "Moved $3 from your NEAR wallet to your SOL wallet.");
  await act({ kind: "move", from: "hood", to: "spending", usd: 3, key: key() }, r.h);
  assert.equal(r.calls.at(-1)!.fn, "floatIn");
  assert.equal(r.calls.at(-1)!.args[2], "1000000000000000", "$3 of ETH at $3,000 = 0.001 ETH");
  await act({ kind: "move", from: "spending", to: "safe", usd: 2, key: key() }, r.h);
  assert.deepEqual(r.calls.at(-1)!.args.slice(0, 1), ["2000000"]);
  assert.equal(r.calls.at(-1)!.fn, "floatHome");
  await act({ kind: "move", from: "hidden", to: "safe", usd: 1, key: key() }, r.h);
  assert.deepEqual(r.calls.at(-1)!.args.slice(0, 2), [FLOAT_USDC, "1000000"]);
  const sw = await act({ kind: "swap", from: "spending", usd: 4, side: "buy", coin: "nep141:wrap.near", key: key() }, r.h);
  assert.equal(r.calls.at(-1)!.fn, "agentSwap");
  assert.equal(sw.usd, 4.2, "counted at the core's own price");
  const tr = await act({ kind: "trade", from: "sol", usd: 2, side: "buy", coin: "BonkMint", key: key() }, r.h);
  assert.equal((tr.done as { go: boolean }).go, true);
  assert.match(String((tr.done as { ticket: string }).ticket), /^tk-/, "a ticket for the signing it allows");
  assert.equal(r.calls.length, 5, "a trade calls no wallet here: the trading day signs it");
  await assert.rejects(act({ kind: "trade", from: "hood", usd: 1, key: key() }, r.h), refused(/AgentZero trades on Solana for now/));
  for (const kind of ["send", "pay"]) await assert.rejects(act({ kind, from: "sol", to: "kim.near", usd: 1, key: key() }, r.h), refused(new RegExp(`can't ${kind} from your SOL wallet yet`)));
  await assert.rejects(act({ kind: "move", from: "sol", to: "hood", usd: 1, key: key() }, r.h), refused(/can't move from your SOL wallet to your Robinhood wallet yet/));
  await assert.rejects(act({ kind: "move", from: "spending", to: "bsc", usd: 1, key: key() }, r.h), refused(/can't move money on your BNB wallet yet/));
  assert.equal(r.calls.length, 5);
});

test("a place the job doesn't name is refused by name; junk is refused before the scope is read", async () => {
  const r = rig();
  await actScope({ set: { ...ALL, places: ["spending", "sol"] } }, r.h);
  await assert.rejects(act({ kind: "move", from: "hidden", to: "safe", usd: 1, key: key() }, r.h), refused(/doesn't let AgentZero use your NEAR wallet/));
  await assert.rejects(act({ kind: "move", from: "spending", to: "hood", usd: 1, key: key() }, r.h), refused(/doesn't let AgentZero use your Robinhood wallet/));
  for (const bad of [{ kind: "steal" }, { kind: "move", from: "moon" }, { kind: "move", from: "spending", to: "sol", usd: Number.NaN }, { kind: "move", from: "spending", to: "sol", usd: 1, key: "x" }]) {
    await assert.rejects(act({ key: key(), usd: 1, ...bad }, r.h), (e: any) => e.problem.code === "security.request.invalid", JSON.stringify(bad));
  }
  assert.equal(r.calls.length, 0);
});

test("a kind the job doesn't name is refused by name; control: the kind it names goes", async () => {
  const r = rig();
  await actScope({ set: { ...ALL, kinds: ["move"] } }, r.h);
  await assert.rejects(act({ kind: "swap", from: "spending", usd: 1, side: "buy", coin: "nep141:wrap.near", key: key() }, r.h), refused(/This job doesn't let AgentZero swap/));
  await assert.rejects(act({ kind: "trade", from: "sol", usd: 1, side: "buy", key: key() }, r.h), refused(/doesn't let AgentZero trade/));
  assert.equal(r.calls.length, 0);
  await act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, r.h);
  assert.equal(r.calls.length, 1);
});

test("paused or stopped on this phone: no act and no new scope, even with a saved scope still in the vault (its delete is async); control: not paused, it goes", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  let paused = true;
  const h = { ...r.h, stopped: () => paused };
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, h), refused(/AgentZero is paused/));
  await assert.rejects(actScope({ set: ALL }, h), refused(/AgentZero is paused/));
  assert.equal(r.calls.length, 0);
  paused = false;
  await act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, h);
  assert.equal(r.calls.length, 1);
});

test("the switch (QA, 3 Nov): account.agent.act and actScope refuse by name while AGENT_ACT is off, before any scope, sheet or move", async () => {
  assert.equal(AGENT_ACT, true, "on after three independent reviews");
  const calls: string[] = [];
  const h = new Proxy({}, { get: (_t, k) => (...a: unknown[]) => (calls.push(String(k)), Promise.resolve(null)) }) as unknown as ActHost;
  for (const m of ["account.agent.act", "account.agent.actScope"]) {
    await assert.rejects(actCall(m, { kind: "move", from: "spending", to: "sol", usd: 1 }, h, false), (e: any) => e.problem.code === "security.request.not-allowed" && /can't do this yet/.test(String(e.problem.more)), m);
  }
  assert.deepEqual(calls, [], "nothing asked of the host");
});

// The independent review of 5ffd7020 (FIX NOW): each finding's scenario, failing on that commit.
import { ticketCharge } from "./agent-act.ts";
const swapOf = (side: string, coin: string) => ({ swaps: [{ side, coin }] });

test("review High: a Stop while the act waits on its price moves nothing, the scope isn't saved again, and after Resume a new act needs the sheet", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  r.h.price = async () => (await gate, 150);
  const pending = act({ kind: "move", from: "spending", to: "sol", usd: 2, key: key() }, r.h);
  // the person taps Stop: demo-core counts it and deletes the saved scope
  r.stop();
  await r.h.vault.delete("agent-act-scope");
  release();
  await assert.rejects(pending, refused(/AgentZero was stopped\. Nothing moved\./));
  assert.equal(r.calls.filter((c) => c.fn === "floatOut").length, 0, "no move after Stop");
  assert.equal(await r.h.vault.get("agent-act-scope"), null, "the stopped scope isn't written back");
  // after Resume (the paused flag clears), a new act has no scope: the sheet is needed again
  await assert.rejects(act({ kind: "move", from: "spending", to: "sol", usd: 1, key: key() }, r.h), refused(/isn't allowed to act today/));
  const sheets = r.sheets.length;
  await actScope({ set: ALL }, r.h);
  assert.equal(r.sheets.length, sheets + 1, "a new job asks again");
});

test("review Medium (trade): the act binds coin, side and dollars; the signing it allows is charged at the core's value, once; another coin, side or a bigger buy is refused", async () => {
  const r = rig();
  await actScope({ set: { ...ALL, dayUsd: 10 } }, r.h);
  const t = await act({ kind: "trade", from: "sol", usd: 3, side: "buy", coin: "BonkMint", key: key() }, r.h);
  const id = (t.done as { ticket: string }).ticket;
  assert.throws(() => ticketCharge(id, 3, swapOf("buy", "OtherMint")), refused(/isn't the trade AgentZero was asked for/));
  assert.throws(() => ticketCharge(id, 3, swapOf("sell", "BonkMint")), refused(/isn't the trade AgentZero was asked for/));
  assert.throws(() => ticketCharge(id, 4.5, swapOf("buy", "BonkMint")), refused(/costs more than the \$3 asked/));
  ticketCharge(id, 3.4, swapOf("buy", "BonkMint")); // the core's own value, inside the $1 of fees
  assert.throws(() => ticketCharge(id, 3.4, swapOf("buy", "BonkMint")), refused(/isn't allowed/), "once");
  const s = await actScope({}, r.h);
  assert.equal(("scope" in s && s.scope?.spentUsd)?.toFixed?.(2), "3.40", "counted at the core's value, not the app's $3");
  // a sale's worth is the core's value too: over the job's day it's refused before signing
  const sale = await act({ kind: "trade", from: "sol", usd: 0.01, side: "sell", coin: "BonkMint", key: key() }, r.h);
  assert.throws(() => ticketCharge((sale.done as { ticket: string }).ticket, 8, swapOf("sell", "BonkMint")), refused(/Today's \$10 for this job is used up/));
});

test("review Medium (trade): 'Ask me first' on the signing, at the core's value; a Stop between the act and the signing refuses it", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  await setAskAbove(2, { vault: r.h.vault, approve: async () => true, strong: async () => undefined });
  const t = await act({ kind: "trade", from: "sol", usd: 1, side: "sell", coin: "BonkMint", key: key() }, r.h);
  assert.throws(() => ticketCharge((t.done as { ticket: string }).ticket, 9, swapOf("sell", "BonkMint")), (e: any) => e.problem.code === ASK_FIRST_CODE);
  const t2 = await act({ kind: "trade", from: "sol", usd: 1, side: "buy", coin: "BonkMint", key: key() }, r.h);
  r.stop();
  assert.throws(() => ticketCharge((t2.done as { ticket: string }).ticket, 1, swapOf("buy", "BonkMint")), refused(/AgentZero was stopped/));
});

test("review Medium (swap sell): 'Ask me first' is checked at the core's price inside the swap, not the app's dollars", async () => {
  const r = rig({ swapUsd: 9 }); // the core prices the sale at $9
  await actScope({ set: ALL }, r.h);
  await setAskAbove(5, { vault: r.h.vault, approve: async () => true, strong: async () => undefined });
  await assert.rejects(act({ kind: "swap", from: "spending", usd: 0.01, side: "sell", coin: "nep141:wrap.near", amount: "1000000000000000000000000000", key: key() }, r.h), (e: any) => e.problem.code === ASK_FIRST_CODE);
  const ok = rig({ swapUsd: 4 });
  await actScope({ set: ALL }, ok.h);
  await setAskAbove(5, { vault: ok.h.vault, approve: async () => true, strong: async () => undefined });
  const done = await act({ kind: "swap", from: "spending", usd: 0.01, side: "sell", coin: "nep141:wrap.near", amount: "1", key: key() }, ok.h);
  assert.equal(done.usd, 4, "control: under it, counted at the core's $4");
});

test("review Low: asking again with the same key counts once", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  const k = key();
  await act({ kind: "move", from: "spending", to: "sol", usd: 2, key: k }, r.h);
  await act({ kind: "move", from: "spending", to: "sol", usd: 2, key: k }, r.h);
  const s = await actScope({}, r.h);
  assert.equal("scope" in s && s.scope?.spentUsd, 2);
  await act({ kind: "move", from: "spending", to: "sol", usd: 2, key: key() }, r.h);
  assert.equal("scope" in (await actScope({}, r.h)) && ((await actScope({}, r.h)) as { scope: { spentUsd: number } }).scope.spentUsd, 4, "control: a new key counts");
});

// ── The second review (FIX FIRST) ───────────────────────────────────────────────────────────────────────────────────
import { pocketCall } from "./agent-pocket.ts";

test("second review Medium: one key, one trade: five $4 buys asked with one key on a $5 job sign once and count $4", async () => {
  const r = rig();
  await actScope({ set: { ...ALL, dayUsd: 5 } }, r.h);
  const k = key();
  const first = await act({ kind: "trade", from: "sol", usd: 4, side: "buy", coin: "BonkMint", key: k }, r.h);
  // a second ticket minted with the same key before the first was charged: charged once only
  const twin = await act({ kind: "trade", from: "sol", usd: 4, side: "buy", coin: "BonkMint", key: k }, r.h);
  ticketCharge((first.done as { ticket: string }).ticket, 4, swapOf("buy", "BonkMint"));
  // (the twin has the same ticket id, so it's gone with the first; either way it never charges or signs again)
  assert.throws(() => ticketCharge((twin.done as { ticket: string }).ticket, 4, swapOf("buy", "BonkMint")), refused(/already made|isn't allowed/));
  for (let i = 0; i < 3; i++) {
    await assert.rejects(act({ kind: "trade", from: "sol", usd: 4, side: "buy", coin: "BonkMint", key: k }, r.h), refused(/That trade was already made/));
  }
  const s = await actScope({}, r.h);
  assert.equal("scope" in s && s.scope?.spentUsd, 4, "the job counts $4");
});

test("second review Medium: a trade with no ticket (the copy job's) still asks first above 'Ask me first' on a buy, at the core's value; a sale is never held", async () => {
  const vault = new MemoryVault();
  await setAskAbove(1, { vault, approve: async () => true, strong: async () => undefined });
  const signed: string[] = [];
  const wallets = {
    agentPocketSign: async (tx: unknown, charge?: (v: number, d: { swaps: { side: string; coin?: string }[] }) => void) => {
      const [side, v] = String(tx).split(":");
      charge?.(Number(v), swapOf(side!, "BonkMint"));
      signed.push(String(tx));
      return { signedTx: `signed-${tx}` };
    },
  };
  const c = { vault, wallets } as unknown as Parameters<typeof pocketCall>[2];
  await assert.rejects(pocketCall("account.agent.pocketSign", { tx: "buy:3" }, c), (e: any) => e.problem.code === ASK_FIRST_CODE && /over your \$1/.test(String(e.problem.more)));
  assert.deepEqual(signed, [], "nothing signed");
  assert.deepEqual(await pocketCall("account.agent.pocketSign", { tx: "buy:0.5" }, c), { signedTx: "signed-buy:0.5" }, "control: under it");
  assert.deepEqual(await pocketCall("account.agent.pocketSign", { tx: "sell:8" }, c), { signedTx: "signed-sell:8" }, "a sale brings money back");
});

test("second review Low: a trade's ticket ends with its job, even inside its two minutes", async () => {
  const r = rig();
  await actScope({ set: { ...ALL, minutes: 1 } }, r.h);
  const t = await act({ kind: "trade", from: "sol", usd: 2, side: "buy", coin: "BonkMint", key: key() }, r.h);
  r.tick(61_000);
  assert.throws(() => ticketCharge((t.done as { ticket: string }).ticket, 2, swapOf("buy", "BonkMint")), refused(/This job has ended/));
});

test("second review Low: a Stop that lands while the move itself runs: the line says the move had started, never a clean 'Moved'", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  r.h.wallets.floatOut = async (...args: unknown[]) => (r.calls.push({ fn: "floatOut", args }), r.stop(), { id: "fo-1", status: "pending" });
  const done = await act({ kind: "move", from: "spending", to: "sol", usd: 2, key: key() }, r.h);
  assert.match(done.line, /^You stopped AgentZero while it was moving \$2.* That move had already started\. Check Activity\.$/);
  const ok = rig();
  await actScope({ set: ALL }, ok.h);
  assert.match((await act({ kind: "move", from: "spending", to: "sol", usd: 2, key: key() }, ok.h)).line, /^Moved \$2/, "control");
});

test("third check Low: lowering 'Ask me first' after a trade's ticket was made holds at once (the lower of the two)", async () => {
  const r = rig();
  await actScope({ set: ALL }, r.h);
  const t = await act({ kind: "trade", from: "sol", usd: 4, side: "buy", coin: "BonkMint", key: key() }, r.h);
  const id = (t.done as { ticket: string }).ticket;
  assert.throws(() => ticketCharge(id, 4, swapOf("buy", "BonkMint"), 1), (e: any) => e?.problem?.code === "security.agent.ask-first" && /over your \$1/.test(String(e.problem.more)), "lowered to $1 after the ticket");
  ticketCharge(id, 4, swapOf("buy", "BonkMint"), null); // control: none set now, the ticket's own (none) holds
});

test("a routine's run day (A-2, one Face ID each run day): its scope's sheet is that day's dry run, the most equal to the routine's limit", async () => {
  const r = rig();
  // A weekly move routine's scope (packages/agent routines.ts routineScope): moves from Spending, at most $50, for the day.
  await actScope({ set: { kinds: ["move"], places: ["spending"], payees: [], dayUsd: 50, minutes: 24 * 60 } }, r.h);
  const lines = r.sheets.at(-1)!.lines;
  assert.equal(lines[0], "Here's what I'd do:");
  assert.ok(lines.includes("1. When you ask, move money: up to $50 in all."));
  assert.ok(lines.some((l) => /^3 steps, \$50 most\.$/.test(l)), lines.join(" | "));
  assert.ok(lines.includes("Never takes from your Safe."));
});
