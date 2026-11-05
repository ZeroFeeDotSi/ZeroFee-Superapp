// AgentZero's pocket session (D90 job 1, P3; D107): one Face ID a day, then AgentZero's own trades from its own pocket
// go without a sheet, inside that day's limits. QA's five conditions, each a test with a control:
//   1. it signs only from the pocket's address;
//   2. Trade's allow-list only, at most $5 a trade, at most the day's total, counted before signing;
//   3. Stop ends it at once (Stop AgentZero, pause, the job's end), whatever NEAR answers;
//   4. it never outlives its day: up to 24 h, and a new day is a new Face ID;
//   5. P1's refusal stays: subwallet.signTx refuses the pocket for every caller, "agent" too.
// And the security review's fixes (M1 the price now, M2 the sheet's fee room, M3 a Stop during the Face ID, L1 one day at
// a time, L2 a Stop while the key is read, L3 sales after the total, L4 a broken price). The core's doors (who reaches
// account.agent.pocket*, Stop and pause, D103) are in demo-core.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { base58 } from "./sol/bytes.ts";
import { SubWallets } from "./subwallets.ts";
import { buy, pocketNode, sell, send } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

const COIN = base58(new Uint8Array(32).fill(44));

async function wallets(o: { answer?: boolean | ((w: SubWallets) => boolean); price?: () => number | null } = {}) {
  const shown: PlainWords[] = [];
  const ended: unknown[] = [];
  let w!: SubWallets;
  w = new SubWallets({
    vault: new MemoryVault(),
    sol: pocketNode(),
    evm: {} as never,
    usdPrice: async (c) => (c === "sol" ? (o.price ? o.price() : 150) : null),
    approve: async (words) => (shown.push(words), typeof o.answer === "function" ? o.answer(w) : (o.answer ?? true)),
    emit: (e, p) => void (e === "subwallet.session.ended" && ended.push(p)),
    // D107's pocket on the SOL row: AgentZero's own wallet explicitly off (on, its leg is agent/sol: agent-sandbox.test.ts)
    agentWallet: { on: false },
  });
  // D117: AgentZero's day trades from the SOL row's own wallet (the one Trade uses), never a separate pocket.
  const pocket = await w.agentSolRow();
  return { w, pocket, shown, ended };
}

const refusedWith = (re: RegExp) => (e: any) => e?.problem?.code === "security.subwallet.refused" && re.test(String(e.problem.more));
/** refusedWith, for a wallet's own trade refused (its own code, security.trade.not-signed). */
const refusedWithTrade = (re: RegExp) => (e: any) => e?.problem?.code === "security.trade.not-signed" && re.test(String(e.problem.more));

test("D107 (4): the day starts with one Face ID that says the limits, fee room included (M2); none without it; never longer than 24 h, more than $5 a trade or $50 a day", async () => {
  const { w, pocket, shown } = await wallets();
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 3)), refusedWith(/AgentZero didn't trade: its trading for today isn't approved/));
  assert.equal(shown.length, 0, "a trade never asks for a sheet; the person isn't there");
  for (const [p, t, m] of [[6, 20, 60], [5, 51, 60], [5, 20, 1441], [0, 20, 60], [5, 4, 60], [5, 20, 0], [5, 20, 1.5], [Number.NaN, 20, 60]]) {
    await assert.rejects(w.agentPocketStart(p, t, m), (e: any) => e.problem.code === "security.request.invalid", `${p}/${t}/${m}`);
  }
  assert.equal(shown.length, 0, "nothing out of bounds reaches the sheet");
  const day = await w.agentPocketStart(5, 20, 24 * 60);
  assert.ok("endsAtIso" in day);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.title, "Let AgentZero trade today");
  assert.match(shown[0]!.lines[0]!, /^From your SOL wallet: up to \$5 a trade plus \$1 of network fees, and \$20 in all with fees, until /);
  assert.match(shown[0]!.lines.join(" "), /Only on known exchanges\. It can't touch your Safe\./);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 3))), "control: inside the day, signed");
  const no = await wallets({ answer: false });
  assert.deepEqual(await no.w.agentPocketStart(5, 20, 60), { declined: true });
  await assert.rejects(no.w.agentPocketSign(buy(no.pocket.address, 1)), refusedWith(/isn't approved/));
});

test("D107 (4), L1: one day at a time: a second Face ID while it runs is refused (its count isn't reset); at its end it ends, and a new day is a new Face ID", async (t) => {
  const { w, pocket, shown, ended } = await wallets();
  const t0 = Date.now();
  t.mock.method(Date, "now", () => t0);
  await w.agentPocketStart(5, 20, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 2))), "control: before its end");
  await assert.rejects(w.agentPocketStart(5, 20, 60), refusedWith(/AgentZero can already trade until /));
  assert.equal(shown.length, 1, "no second sheet");
  t.mock.method(Date, "now", () => t0 + 60 * 60_000);
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 2)), refusedWith(/isn't approved/));
  assert.deepEqual(ended.at(-1), { id: "agentzero-pocket", reason: "time" });
  await w.agentPocketStart(5, 20, 60);
  assert.equal(shown.length, 2, "the new day asked for Face ID again");
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 2))));
});

test("D107 (2): at most $5 a trade plus the $1 fee room, and the day's total in all, counted before signing; a refused trade counts nothing", async () => {
  const { w, pocket } = await wallets();
  await w.agentPocketStart(5, 10, 60);
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 6.5)), refusedWith(/is more than \$5 a trade/));
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 3))), "$3");
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 3.01))), "$6.01: the refused $6.50 wasn't counted");
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 4)), refusedWith(/today's \$10 is used up/));
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 3.9))), "control: what still fits");
});

test("L3: when the day's total is used, a sale still brings the coins back (it counts only the SOL that leaves it), even one worth more than $5", async () => {
  const { w, pocket } = await wallets();
  await w.agentPocketStart(5, 5, 60);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 4.99))));
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/today's \$5 is used up/), "buys stop at the total");
  assert.ok("signedTx" in (await w.agentPocketSign(sell(pocket.address, COIN, 8))), "an $8 sale after the total");
});

test("D107 (2): only a trade Trade's session would cover: SOL sent to an address, or a buy with no minimum back, is refused by name", async () => {
  const { w, pocket } = await wallets();
  await w.agentPocketStart(5, 20, 60);
  const drainer = base58(new Uint8Array(32).fill(77));
  await assert.rejects(w.agentPocketSign(send(pocket.address, drainer, 1)), refusedWith(/^AgentZero didn't trade: /));
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1, 0n)), refusedWith(/AgentZero didn't trade: it has no minimum you get back/));
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 1))), "control: a pump.fun buy of the same $1, with its floor");
});

test("D117 / D107 (1): it signs only from the SOL row's own wallet (the one Trade uses): a trade paid by a site's wallet or an old AgentZero pocket is refused before any test run", async () => {
  const { w, pocket } = await wallets();
  assert.equal((await w.create("trade", "sol")).id, pocket.id, "the SOL row is Trade's Solana wallet");
  const pump = await w.create("site", "sol", undefined, "pump");
  const old = await w.create("site", "sol", undefined, "agentzero");
  await w.agentPocketStart(5, 20, 60);
  for (const other of [pump, old]) await assert.rejects(w.agentPocketSign(buy(other.address, 1)), refusedWith(/./), other.id);
  const signed = await w.agentPocketSign(buy(pocket.address, 1));
  const raw = Uint8Array.from(atob(signed.signedTx), (c) => c.charCodeAt(0));
  assert.ok(raw.slice(1, 65).some((b) => b !== 0), "the pocket's own signature is in");
});

test("D107 (3): ending the day stops it at once, with its event; ending twice says it once", async () => {
  const { w, pocket, ended } = await wallets();
  await w.agentPocketStart(5, 20, 60);
  w.endAgentPocket("stopped");
  assert.deepEqual(ended.at(-1), { id: "agentzero-pocket", reason: "stopped" });
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/isn't approved/));
  w.endAgentPocket("stopped");
  assert.equal(ended.length, 1);
});

test("M3: a Stop while the day's Face ID is open: the day doesn't start; control: a yes with no Stop starts it", async () => {
  const { w, pocket } = await wallets({ answer: (wallets) => (wallets.endAgentPocket("stopped"), true) });
  await assert.rejects(w.agentPocketStart(5, 20, 60), refusedWith(/AgentZero was stopped\. Its day didn't start\./));
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/isn't approved/));
  // a Stop before the core's own checks finished (agentPocketDay passes the count it read first): the same
  const ok = await wallets();
  const before = ok.w.agentPocketStopCount();
  ok.w.endAgentPocket("stopped");
  await assert.rejects(ok.w.agentPocketStart(5, 20, 60, before), refusedWith(/didn't start/));
  assert.ok("endsAtIso" in (await ok.w.agentPocketStart(5, 20, 60)), "control");
});

test("L-b: two asks for a day at once: one day starts, the other is refused after its Face ID, and the count isn't reset", async () => {
  const { w, pocket } = await wallets();
  const [a, b] = await Promise.allSettled([w.agentPocketStart(5, 10, 60), w.agentPocketStart(5, 10, 60)]);
  assert.deepEqual([a.status, b.status].sort(), ["fulfilled", "rejected"]);
  assert.ok(b.status === "rejected" && refusedWith(/AgentZero can already trade until /)(b.reason));
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))));
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 4.9))));
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/today's \$10 is used up/), "one day's count");
});

test("L2: a Stop while the pocket's key is read: nothing signed leaves", async () => {
  const { w, pocket } = await wallets();
  await w.agentPocketStart(5, 20, 60);
  const raw = (w as any).secret.bind(w);
  (w as any).secret = async (x: unknown) => (w.endAgentPocket("stopped"), raw(x));
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/AgentZero didn't trade: it was stopped\./));
});

test("M1: SOL's price is read at each trade and never taken under the day's own; L4: no price, or a broken one, no trade", async (t) => {
  let price: number | null = 150;
  const { w, pocket } = await wallets({ price: () => price });
  const t0 = Date.now();
  t.mock.method(Date, "now", () => t0);
  await w.agentPocketStart(5, 50, 600);
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 5))), "$5 at $150");
  price = 300; // SOL doubled: the same SOL is $10 now
  t.mock.method(Date, "now", () => t0 + 31_000); // past the 30 s a price is kept
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 5)), refusedWith(/\$10\.00 is more than \$5 a trade/));
  price = 100; // cheaper: still counted at the day's $150, never less
  t.mock.method(Date, "now", () => t0 + 62_000);
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 6.5)), refusedWith(/\$6\.50 is more than \$5 a trade/));
  price = null;
  t.mock.method(Date, "now", () => t0 + 93_000);
  await assert.rejects(w.agentPocketSign(buy(pocket.address, 1)), refusedWith(/SOL's price couldn't be read/));
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, 0]) {
    const b = await wallets({ price: () => bad });
    await assert.rejects(b.w.agentPocketStart(5, 20, 60), (e: any) => typeof e?.problem?.code === "string", String(bad));
    assert.equal(b.shown.length, 0, `no sheet at a broken price (${bad})`);
  }
});

test("D117: only AgentZero's own screen reaches the old pocket's move (the bridge); the fill is gone", async () => {
  const { appMayCall } = await import("./bridge.ts");
  assert.equal(appMayCall("agent", "account.agent.pocketEmpty"), true);
  for (const app of ["trade", "social", "browser", "chat", "wallet", "pay"] as const) assert.equal(appMayCall(app, "account.agent.pocketEmpty"), false, app);
  const { w } = await wallets();
  assert.equal((w as unknown as Record<string, unknown>).agentPocketFill, undefined, "no fill door");
});

test("D117, D143: AgentZero's day covers ONLY its own door; Trade's own signing on the same SOL row is the core's checks alone (no day leaks into Trade)", async () => {
  const { w, pocket, shown } = await wallets();
  await w.agentPocketStart(5, 20, 60);
  const sheets = shown.length;
  // Trade's checked buy on the row signs with no sheet (a hot key never asks), day or not.
  assert.ok((await w.signTx(pocket.id, buy(pocket.address, 1), "", undefined, undefined, undefined, "trade")).signedTx);
  // The day opens nothing for Trade: a plain send out of the row from Trade's call is refused, nothing signed.
  await assert.rejects(w.signTx(pocket.id, send(pocket.address, base58(new Uint8Array(32).fill(45)), 1), "", undefined, undefined, undefined, "trade"), refusedWithTrade(/Nothing was signed\.$/));
  assert.equal(shown.length, sheets, "no sheet for Trade's calls");
  assert.ok("signedTx" in (await w.agentPocketSign(buy(pocket.address, 1))), "control: AgentZero's own door, no sheet");
  assert.equal(shown.length, sheets);
});

test("D117: an old AgentZero pocket moves to the SOL row on the core's sheet: a yes sends once, from the pocket to the SOL row; a no sends nothing; no pocket, nothing to move", async () => {
  const sent: string[] = [];
  const node = Object.assign(pocketNode(), {
    balance: async () => 50_005_000n,
    latestBlockhash: async () => base58(new Uint8Array(32).fill(5)),
    send: async (tx: string) => (sent.push(tx), true),
    status: async () => ["ok", "ok"] as ("ok" | "failed" | null)[],
  });
  const make = (answer: boolean) => {
    const shown: PlainWords[] = [];
    const w = new SubWallets({ vault: new MemoryVault(), sol: node, evm: {} as never, usdPrice: async () => 150, approve: async (words) => (shown.push(words), answer), emit: () => {}, confirm: { everyMs: 1, forMs: 5 }, agentWallet: { on: false } });
    return { w, shown };
  };
  const none = make(true);
  await assert.rejects(none.w.agentPocketEmpty(), refusedWith(/There's no AgentZero pocket to move\./));
  const no = make(false);
  await no.w.create("site", "sol", undefined, "agentzero");
  assert.deepEqual(await no.w.agentPocketEmpty(), { declined: true });
  assert.equal(sent.length, 0, "a no sends nothing");
  const yes = make(true);
  const old = await yes.w.create("site", "sol", undefined, "agentzero");
  const row = await yes.w.agentSolRow();
  const r = await yes.w.agentPocketEmpty();
  assert.equal((r as { status: string }).status, "done");
  assert.equal(sent.length, 1, "sent once");
  assert.equal(yes.shown.at(-1)!.title, "Move AgentZero's pocket to your SOL wallet");
  assert.match(yes.shown.at(-1)!.lines[0]!, /^0\.05 SOL moves to your SOL wallet\.$/);
  const { decodeSolTx } = await import("./sol/decode.ts");
  const d = decodeSolTx(sent[0]!);
  assert.equal(d.feePayer, old.address, "from the old pocket");
  assert.deepEqual(d.transfers.map((t) => t.to), [row.address], "to the SOL row only");
});

test("QA 5 Nov: Wallet, Trade and Pay may read AgentZero's balance (Home's row and the one total), and nothing else of account.agent.* (control: the rest stays AgentZero's)", async () => {
  const { appMayCall } = await import("./bridge.ts");
  for (const app of ["wallet", "trade", "pay", "agent"] as const) assert.equal(appMayCall(app, "account.agent.balance"), true, app);
  for (const app of ["social", "browser", "chat", "extension"] as const) assert.equal(appMayCall(app, "account.agent.balance"), false, app);
  // the audit's NIT: the exact name only, so a later trailing-dot edit ("account.agent.balance.") can't open a family
  for (const app of ["wallet", "trade", "pay"] as const) for (const m of ["account.agent.wallet", "account.agent.balanceX", "account.agent.balance.set", "account.agent.balance.", "account.agent.act", "account.agent.pocketSign"]) assert.equal(appMayCall(app, m), false, `${app} ${m}`);
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("./bridge.ts", import.meta.url), "utf8"), /^const AZ_BALANCE = "account\.agent\.balance";$/m, "control: the allowlisted name has no trailing dot");
});
