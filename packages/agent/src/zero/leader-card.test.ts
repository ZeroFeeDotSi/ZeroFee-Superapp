// ST-C: the leader's report card, from Solana's own record, never guessed. Each rule with a control: a trade is one coin
// one way and SOL the other in a pump.fun transaction (wrapped SOL counted); won/lost only for coins bought and sold all
// of inside the window; a figure that can't be read is "Not known"; dollars first at today's SOL price, said so; QA: a
// refusal (429) backs off and stops at "Solana didn't answer." with bounded calls (control: answers read fully).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKOFF_MS, PACE_MS, cardTitle, cardNotes, cardRows, MAX_TXS, NEXT_LINE, NO_ANSWER_LINE, NOT_KNOWN, readCard, readMove, SAMPLE_LINE, SELF_TRADE_LINE, STOPPED, summarize, type LeaderMove } from "./leader-card.ts";

const W = "Leader1111111111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const WSOL = "So11111111111111111111111111111111111111112";
const SOL = 1_000_000_000;
const T0 = Date.UTC(2026, 10, 3, 5, 0);
const DAY = 86_400_000;

function tx(o: { coin?: [number, number]; mint?: string; lamports: [number, number]; wsol?: [number, number]; program?: string; err?: unknown; other?: boolean; extraCoin?: boolean; t?: number; signer?: boolean; listedOnly?: boolean; inner?: boolean }) {
  const owner = o.other ? "Someone11111111111111111111111111111111111" : W;
  const bal = (k: 0 | 1) => [
    ...(o.coin ? [{ owner, mint: o.mint ?? "COINmint", uiTokenAmount: { amount: String(o.coin[k]) } }] : []),
    ...(o.wsol ? [{ owner, mint: WSOL, uiTokenAmount: { amount: String(o.wsol[k]) } }] : []),
    ...(o.extraCoin ? [{ owner, mint: "OTHERmint", uiTokenAmount: { amount: String(k ? 5 : 1) } }] : []),
  ];
  return {
    blockTime: Math.floor((o.t ?? T0 - DAY) / 1000),
    transaction: { message: { accountKeys: [{ pubkey: W, signer: o.signer ?? true }, { pubkey: o.program ?? PUMP, signer: false }], instructions: o.listedOnly || o.inner ? [{ programId: "ComputeBudget111111111111111111111111111111" }] : [{ programId: o.program ?? PUMP }] } },
    meta: { innerInstructions: o.inner ? [{ index: 0, instructions: [{ programId: o.program ?? PUMP }] }] : [], err: o.err ?? null, preBalances: [o.lamports[0], 0], postBalances: [o.lamports[1], 0], preTokenBalances: bal(0), postTokenBalances: bal(1) },
  };
}

test("a trade is one coin one way and SOL the other, in a pump.fun or PumpSwap transaction, wrapped SOL counted; anything else is no trade (controls)", () => {
  assert.deepEqual(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL] }), W), { mint: "COINmint", side: "buy", units: 1000n, lamports: -1n * BigInt(SOL), t: T0 - DAY });
  assert.deepEqual(readMove(tx({ coin: [1000, 0], lamports: [4 * SOL, 6 * SOL] }), W)?.side, "sell");
  // PumpSwap pays in wrapped SOL: the lamports barely move, the wSOL does
  const viaWsol = readMove(tx({ coin: [0, 10], lamports: [SOL, SOL - 5000], wsol: [2 * SOL, SOL], program: SWAP }), W);
  assert.equal(viaWsol?.lamports, -1n * BigInt(SOL) - 5000n);
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], program: "Tokenkeg11111111111111111111111111111111111" }), W), null, "not pump.fun");
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], err: { x: 1 } }), W), null, "failed");
  assert.equal(readMove(tx({ lamports: [5 * SOL, 5 * SOL - 5000] }), W), null, "a fee only");
  assert.equal(readMove(tx({ coin: [1000, 0], lamports: [5 * SOL, 5 * SOL - 5000] }), W), null, "a coin sent away (no SOL back)");
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], extraCoin: true }), W), null, "two coins at once");
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], other: true }), W), null, "someone else's coin");
  const crafted = tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL] });
  crafted.meta.postTokenBalances[0]!.uiTokenAmount.amount = "1e3";
  assert.equal(readMove(crafted, W), null, "a crafted amount");
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL] }), "Notthere111111111111111111111111111111111111"), null, "not the wallet's transaction");
  // review M1: the wallet must sign it and a pump.fun instruction must run (control: inside an inner instruction counts)
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], signer: false }), W), null, "signed by someone else");
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], listedOnly: true }), W), null, "pump.fun only listed, never run");
  assert.equal(readMove(tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL], inner: true }), W)?.side, "buy", "control: run as an inner instruction");
  // a transaction with no time takes its signature's
  const noTime: any = tx({ coin: [0, 1000], lamports: [5 * SOL, 4 * SOL] });
  delete noTime.blockTime;
  assert.equal(readMove(noTime, W, 123_000)?.t, 123_000);
});

const m = (mint: string, side: "buy" | "sell", units: number, sol: number, t: number): LeaderMove => ({ mint, side, units: BigInt(side === "buy" ? units : -units), lamports: BigInt(Math.round((side === "buy" ? -sol : sol) * SOL)), t });

test("won and lost only for coins bought and sold all of in the window; still held and bought before have no result", () => {
  const c = summarize([
    m("A", "buy", 100, 1, 1), m("A", "sell", 100, 1.5, 2), // won +0.5
    m("B", "buy", 100, 1, 1), m("B", "sell", 60, 0.3, 2), m("B", "sell", 40, 0.1, 3), // lost −0.6
    m("C", "buy", 100, 2, 1), m("C", "sell", 50, 3, 2), // half still held
    m("D", "sell", 100, 4, 1), // bought before the window
  ], { full: true }, 0);
  assert.deepEqual([c.trades, c.won, c.lost, c.stillHeld, c.boughtBefore, c.coins], [8, 1, 1, 1, 1, 4]);
  assert.equal(c.resultLamports, -100_000_000n, "+0.5 − 0.6 SOL, only the closed coins");
  assert.equal(summarize([m("C", "buy", 1, 1, 1)], { full: true }, 0).resultLamports, null, "control: nothing closed, no result");
  // a buy and its sale in the same second (moves come newest first): bought then sold, never "bought before"
  const same = summarize([m("E", "sell", 10, 2, 5), m("E", "buy", 10, 1, 5)], { full: true }, 0);
  assert.deepEqual([same.won, same.boughtBefore], [1, 0]);
});

test("the card's words: dollars first at today's SOL price, said so; SOL alone without a price; Not known when a trade couldn't be read; the next line", () => {
  const c = summarize([m("A", "buy", 100, 1, 1), m("A", "sell", 100, 3.5, 2)], { full: true }, 0);
  assert.deepEqual(cardRows(c, 150), [{ label: "Trades", value: "2" }, { label: "Coins won", value: "1" }, { label: "Coins lost", value: "0" }, { label: "Result", value: "about +$375.00 (+2.50 SOL)" }]);
  assert.equal(cardTitle(c), "This wallet, last 30 days");
  // review M2: coins still held are never hidden behind a whole-wallet result
  const some = summarize([m("A", "buy", 100, 1, 1), m("A", "sell", 100, 3.5, 2), ...Array.from({ length: 4 }, (_, i) => m(`R${i}`, "buy", 100, 1, 1))], { full: true }, 0);
  assert.deepEqual(cardRows(some, 150)[3], { label: "Result on 1 of 5 coins", value: "about +$375.00 (+2.50 SOL)" });
  assert.equal(cardRows(c, undefined)[3]!.value, "+2.50 SOL");
  const notes = cardNotes(c, 150);
  assert.ok(notes.includes("Read from Solana: its pump.fun trades in the last 30 days."));
  assert.ok(notes.includes("The result counts coins it bought and sold all of. Dollars are at today's SOL price."));
  assert.deepEqual(notes.slice(-2), ["Past trades don't say what it does next.", "A wallet can trade with itself to look good. This can't tell."], "QA: the self-trade limit on every card, under the next line");
  assert.equal(SELF_TRADE_LINE, "A wallet can trade with itself to look good. This can't tell.");
  assert.equal(NEXT_LINE, "Past trades don't say what it does next.");
  const lost = summarize([m("A", "buy", 100, 2, 1), m("A", "sell", 100, 0.5, 2)], { full: true }, 0);
  assert.equal(cardRows(lost, 150)[3]!.value, "about −$225.00 (−1.50 SOL)");
  const partial = summarize([m("A", "buy", 100, 1, 1), m("A", "sell", 100, 3.5, 2)], { full: true }, 2);
  assert.ok(cardRows(partial, 150).every((r) => r.value === NOT_KNOWN), "a trade not read: every figure Not known, never a made-up one");
  assert.ok(cardNotes(partial, 150).includes("2 trades couldn't be read, so these figures are Not known."));
  const short = summarize([], { full: false, fromMs: Date.UTC(2026, 10, 1, 9, 30) }, 0);
  assert.match(cardNotes(short, 150)[0]!, /^Read from Solana: only its trades since Nov 1, \d{1,2}:30 [AP]M could be read\. Older ones: Not known\.$/);
  assert.match(cardTitle(short), /^This wallet, since Nov 1, \d{1,2}:30 [AP]M$/, "review M3: the title says the window the figures are for");
  // review M3: nothing read with a time: every figure Not known, never "Trades 0"
  const none = summarize([], { full: false }, 0);
  assert.ok(cardRows(none, 150).every((r) => r.value === NOT_KNOWN));
  assert.equal(cardNotes(none, 150)[0], "Its trades couldn't be read from Solana, so these figures are Not known.");
  assert.equal(cardTitle(none), "This wallet");
  assert.equal(cardRows(short, 150)[3]!.value, NOT_KNOWN, "no closed coin: Not known");
  for (const k of [partial, short, none]) assert.equal(cardNotes(k, 150).at(-1), SELF_TRADE_LINE, "every card, read or not");
  for (const line of [...cardNotes(c, 150), ...cardNotes(partial, 150), ...cardNotes(short, 150)]) assert.doesNotMatch(line, /NaN|undefined|Infinity|Private|Spending/);
});

/** A fake node: the wallet's signatures newest first (pages of 100 with `before`), each transaction by signature. */
function node(sigs: { signature: string; blockTime: number }[], txs: Map<string, unknown>, refuse?: (method: string, n: number) => boolean) {
  const calls: string[] = [];
  const rpc = async (method: string, params: any[]) => {
    calls.push(method);
    if (refuse?.(method, calls.length)) throw new Error("HTTP 429");
    if (method === "getSignaturesForAddress") {
      const { limit, before } = params[1];
      const from = before ? sigs.findIndex((s) => s.signature === before) + 1 : 0;
      return sigs.slice(from, from + limit);
    }
    return txs.get(params[0]) ?? null;
  };
  return { rpc, calls };
}
const history = (n: number, everyMs: number) => {
  const sigs: { signature: string; blockTime: number }[] = [];
  const txs = new Map<string, unknown>();
  for (let i = 0; i < n; i++) {
    const t = T0 - (i + 1) * everyMs;
    const sig = `s${i}`;
    sigs.push({ signature: sig, blockTime: Math.floor(t / 1000) });
    // pairs: an older buy (i odd) and a newer sale (i even) of the same coin, a win of 0.5 SOL each
    const coin = `C${Math.floor(i / 2)}`;
    txs.set(sig, i % 2 ? tx({ mint: coin, coin: [0, 100], lamports: [5 * SOL, 4 * SOL], t }) : tx({ mint: coin, coin: [100, 0], lamports: [4 * SOL, 5.5 * SOL], t }));
  }
  return { sigs, txs };
};

test("readCard: back to 30 days, pages of 100, 10 transactions at once; the answers read fully with no wait (control for the back-off)", async () => {
  const h = history(40, DAY / 2); // 20 days of trades, then older ones
  const old = history(10, DAY * 4);
  const all = [...h.sigs, ...old.sigs.map((s, i) => ({ signature: `old${i}`, blockTime: s.blockTime - 30 * 86_400 }))];
  const n = node(all, h.txs);
  const waits: number[] = [], paced: number[] = [];
  const c = await readCard({ rpc: n.rpc, wallet: W, now: () => T0, wait: async (ms) => void waits.push(ms), pause: async (ms) => void paced.push(ms) });
  assert.deepEqual([c.trades, c.won, c.lost, c.full, c.unread], [40, 20, 0, true, 0]);
  assert.deepEqual(paced, [PACE_MS, PACE_MS, PACE_MS], "review M5: a pause between the 4 batches, never a burst");
  assert.equal(c.resultLamports, 20n * 500_000_000n);
  assert.deepEqual(waits, [], "no refusal, no wait");
  assert.equal(n.calls.filter((x) => x === "getTransaction").length, 40, "only the window's transactions");
});

test("readCard: a busy wallet reads at most MAX_TXS and says from when (never a 30-day claim)", async () => {
  const h = history(MAX_TXS + 50, 60_000);
  const n = node(h.sigs, h.txs);
  const c = await readCard({ rpc: n.rpc, wallet: W, now: () => T0, wait: async () => undefined, pause: async () => undefined });
  assert.equal(c.full, false);
  assert.equal(c.trades, MAX_TXS);
  assert.equal(c.fromMs, h.sigs[MAX_TXS - 1]!.blockTime * 1000);
  assert.equal(n.calls.filter((x) => x === "getTransaction").length, MAX_TXS);
});

test("QA: a 429 backs off (1 s, 2 s, 4 s) and then stops at \"Solana didn't answer.\" with bounded calls; one refusal backs off once and asks only that one again", async () => {
  const h = history(30, DAY / 4);
  // every transaction read refused
  const n = node(h.sigs, h.txs, (method) => method === "getTransaction");
  const waits: number[] = [];
  await assert.rejects(readCard({ rpc: n.rpc, wallet: W, now: () => T0, wait: async (ms) => void waits.push(ms), pause: async () => undefined }), (e: Error) => e.message === NO_ANSWER_LINE);
  assert.deepEqual(waits, [...BACKOFF_MS]);
  assert.equal(n.calls.length, 1 + 10 + BACKOFF_MS.length, `bounded: the list, one batch of 10, then one at a time (${n.calls.length} calls)`);
  // the list itself refused
  const l = node(h.sigs, h.txs, (method) => method === "getSignaturesForAddress");
  const lw: number[] = [];
  await assert.rejects(readCard({ rpc: l.rpc, wallet: W, now: () => T0, wait: async (ms) => void lw.push(ms), pause: async () => undefined }), (e: Error) => e.message === NO_ANSWER_LINE);
  assert.equal(l.calls.length, BACKOFF_MS.length + 1);
  // one refusal mid-way: one wait, only the refused one asked again, the card whole
  const once = node(h.sigs, h.txs, (method, k) => method === "getTransaction" && k === 5);
  const ow: number[] = [];
  const c = await readCard({ rpc: once.rpc, wallet: W, now: () => T0, wait: async (ms) => void ow.push(ms), pause: async () => undefined });
  assert.deepEqual(ow, [BACKOFF_MS[0]]);
  assert.equal(once.calls.filter((x) => x === "getTransaction").length, 31);
  assert.deepEqual([c.trades, c.unread], [30, 0]);
});

test("a transaction the node answers as not found is counted unread (Not known), never as no trade; control: all found", async () => {
  const h = history(10, DAY);
  h.txs.delete("s3");
  const c = await readCard({ rpc: node(h.sigs, h.txs).rpc, wallet: W, now: () => T0, wait: async () => undefined, pause: async () => undefined });
  assert.equal(c.unread, 1);
  assert.ok(cardRows(c, 150).every((r) => r.value === NOT_KNOWN));
});

test("the card on the copy sheet: read-only, lazy, under the wallet to copy; sample money says so and reads nothing", () => {
  assert.equal(SAMPLE_LINE, "Sample money: no real wallet to check.");
  const card = readFileSync(new URL("../app/LeaderCard.tsx", import.meta.url), "utf8");
  assert.match(card, /if \(sample\) return <p className="zf-small ag-under" data-testid="leader-card-sample">\{SAMPLE_LINE\}<\/p>;/);
  assert.match(card, /\{cardNotes\(read\.card, read\.solUsd\)\.map\(\(l\) => <p className="zf-small ag-under" key=\{l\}>\{l\}<\/p>\)\}/, "every note line renders, the self-trade line with them");
  assert.match(card, /import\("\.\.\/zero\/leader-read\.ts"\)/, "its reads load only when the card shows");
  assert.doesNotMatch(card, /from "@zerofee\/trade|from "\.\.\/zero\/leader-read/, "never a static import of Trade's engine");
  const glue = readFileSync(new URL("./leader-read.ts", import.meta.url), "utf8");
  assert.match(glue, /readCard\(\{ rpc: historyCall\(rpc\), wallet, /, "Trade's own Solana nodes, one per call");
  assert.match(glue, /rpc \?\?= createSolRpc\(\{ nodes: HISTORY_NODES \}\);/, "one node list shared by every card this run");
  assert.doesNotMatch(glue, /fetch\(|https?:\/\//);
  assert.doesNotMatch(card, /fetch\(|https?:\/\//, "no host of its own: Trade's Solana nodes only");
  const app = readFileSync(new URL("../app/AgentApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\{terms\.kind === "copy" && !isRunning && <LeaderCard wallet=\{terms\.leader\} sample=\{sample\} \/>\}/);
  const mod = readFileSync(new URL("./leader-card.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mod, /fetch\(|https?:\/\/|sendTransaction|signTransaction|secretKey/, "read-only: no host, no signing");
  assert.match(mod, /maxSupportedTransactionVersion: 1/, "newer transactions are read too");
});

test("a card that was left (the address changed, the sheet closed) stops reading at its next step (control: not left, it reads on)", async () => {
  const h = history(40, DAY / 4);
  for (const leave of [true, false]) {
    const n = node(h.sigs, h.txs);
    let left = false;
    const r = readCard({ rpc: async (m, p) => { const v = await n.rpc(m, p); if (leave && m === "getTransaction") left = true; return v; }, wallet: W, now: () => T0, wait: async () => undefined, pause: async () => undefined, stopped: () => left });
    if (leave) await assert.rejects(r, (e: Error) => e.message === STOPPED);
    else await r;
    const tx = n.calls.filter((x) => x === "getTransaction").length;
    if (leave) assert.equal(tx, 10, "one batch, then it stopped"); else assert.equal(tx, 40);
  }
  const card = readFileSync(new URL("../app/LeaderCard.tsx", import.meta.url), "utf8");
  assert.match(card, /const t = setTimeout\(\(\) => \{/, "a typed address is read once it stands still");
  assert.match(card, /m\.readLeader\(w, \(\) => entry\.viewers === 0\)/, "a read nobody looks at stops");
  assert.match(card, /if \(k && \(!k\.done \|\| Date\.now\(\) - k\.at < KEEP_MS\)\) \{ if \(!k\.done\) setRead\(null\); return watch\(k\); \}/, "a second look joins the read under way");
  assert.match(card, /return \(\) => \{ live = false; clearTimeout\(t\); leave\?\.\(\); \};/);
});

test("review H2/M4: the window is whole only when a signature from before it was seen; a short list or null is never 30 days; one node per call, publicnode left out, an answered error is a trade not read", async () => {
  // a node that keeps only a day: a short list, no error
  const h = history(6, DAY / 6);
  const c = await readCard({ rpc: node(h.sigs, h.txs).rpc, wallet: W, now: () => T0, wait: async () => undefined, pause: async () => undefined });
  assert.equal(c.full, false);
  assert.equal(c.fromMs, h.sigs.at(-1)!.blockTime * 1000);
  assert.match(cardTitle(c), /^This wallet, since /);
  // a null list is no answer: backs off, then the line
  const waits: number[] = [];
  await assert.rejects(readCard({ rpc: async () => null, wallet: W, now: () => T0, wait: async (ms) => void waits.push(ms), pause: async () => undefined }), (e: Error) => e.message === NO_ANSWER_LINE);
  assert.deepEqual(waits, [...BACKOFF_MS]);
  // a node repeating its first page (no signature at the end) never counts a trade twice
  const rep = history(4, DAY);
  const page = [...rep.sigs, ...Array.from({ length: 96 }, () => ({ blockTime: rep.sigs[0]!.blockTime }))];
  let asks = 0;
  const twice = await readCard({ rpc: async (m, p: any) => (m === "getSignaturesForAddress" ? (asks++, page) : rep.txs.get(p[0]) ?? null), wallet: W, now: () => T0, wait: async () => undefined, pause: async () => undefined });
  assert.equal(twice.trades, 4);
  assert.equal(asks, 1);
  // a node that ignores "before" and gives its first full page again: each signature read once
  const full = history(100, DAY / 10);
  let pages = 0;
  const again = await readCard({ rpc: async (m, p: any) => (m === "getSignaturesForAddress" ? (pages++, full.sigs) : full.txs.get(p[0]) ?? null), wallet: W, now: () => T0, wait: async () => undefined, pause: async () => undefined });
  assert.equal(again.trades, 100);
  assert.equal(pages, 2, "the repeat ends the list");
  // the glue: one node per call; refusals throw (back off), an answered error is null (not read)
  const { historyCall, HISTORY_NODES, REFUSAL } = await import("./leader-read.ts");
  assert.ok(HISTORY_NODES.length >= 1 && HISTORY_NODES.every((n) => !n.includes("publicnode")));
  const asked: number[] = [];
  const call = (answer: { ok: true; value: unknown } | { ok: false; error: string }) => historyCall({ askNodes: async (_m: string, _p: unknown[], max?: number) => (asked.push(max ?? 0), [{ ...answer, node: "x" }]) } as never);
  assert.deepEqual(await call({ ok: true, value: [1] })("getSignaturesForAddress", []), [1]);
  for (const e of ["HTTP 429", "HTTP 403", "HTTP 503", "timed out", "Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
    await assert.rejects(call({ ok: false, error: e })("getTransaction", []), undefined, e);
    assert.ok(REFUSAL.test(e));
  }
  assert.equal(await call({ ok: false, error: "Transaction version (2) is not supported by the requesting client." })("getTransaction", []), null, "an answer, not a refusal");
  assert.ok(asked.every((x) => x === 1), "one node per call");
});
