// Rules 3 and 9 (5 Nov): a Solana Buy said "Solana didn't answer", then "two Solana servers didn't
// agree", and its retry was refused ("This wallet can't approve this"). The trade's checks (its test run, its blockhash,
// its route's programs, its lookup tables) ran on free nodes only, and one free node failing or a few slots behind refused
// the trade. Now they ask the paid doors first (the relay's Helius, then its Alchemy), a failed door is replaced by the
// next one silently, the free nodes answer only when no paid door did, and a one-server check (Trade's own buy or sale)
// is never turned into a refusal by a second answer that differs. Each case kills a door mid-trade, with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain } from "./solana.ts";
import { relayTakes, setSolProxy } from "./sol-proxy.ts";
import { base58Encode } from "./key-handle.ts";
// @ts-ignore: plain JS, the relay's own check
import { solReadOf } from "../../../apps/quotes/sol-read.mjs";

const HELIUS = "https://relay.test/v0/sol/read";
const ALCHEMY = `${HELIUS}?door=alchemy`;
const FREE_A = "https://free-a.test", FREE_B = "https://free-b.test";
const WALLET = "GBPDDnczHRaVUgKFXrPhkcRYjyhCb7JsTdaeuJqhpTJJ";  // generated sample
const SYSTEM = "11111111111111111111111111111111";

type Door = "ok" | "dead" | "busy" | "slow" | { spend: number };
/** fetch standing in for every door: each answers the test run as its `Door` says (spend: lamports the run takes). */
function doors(o: Record<string, Door>) {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const u = String(url);
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    asked.push(`${u === HELIUS ? "helius" : u === ALCHEMY ? "alchemy" : u === FREE_A ? "free-a" : u === FREE_B ? "free-b" : u}:${method}`);
    const d = o[u] ?? "dead";
    if (d === "dead") throw new TypeError("fetch failed");
    if (d === "busy") return new Response("{}", { status: 429 });
    if (d === "slow") await new Promise((r) => setTimeout(r, 1_500));
    const spend = typeof d === "object" ? d.spend : 5_000_000;
    const send = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "getBalance") return send({ context: { slot: 1 }, value: 1_000_000_000 });
    if (method === "simulateTransaction") return send({ context: { slot: 1 }, value: { err: null, accounts: [{ lamports: 1_000_000_000 - spend, owner: SYSTEM, data: ["", "base64"], executable: false }] } });
    if (method === "isBlockhashValid") return send({ context: { slot: 1 }, value: true });
    if (method === "getMultipleAccounts") return send({ context: { slot: 1 }, value: (params[0] as string[]).map(() => ({ executable: false, lamports: 1, owner: SYSTEM, data: ["", "base64"] })) });
    return send(null);
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}
const chain = (paid = [HELIUS, ALCHEMY]) => new RpcSolChain([FREE_A, FREE_B], [FREE_A, FREE_B], 120, 10, 10, () => paid);
const free = (asked: string[]) => asked.filter((a) => a.startsWith("free"));

test("phone bugs: a trade's test run asks the paid doors only; the free nodes are never asked (control: no relay, the free nodes answer as before)", async () => {
  const n = doors({ [HELIUS]: "ok", [ALCHEMY]: "ok", [FREE_A]: "ok", [FREE_B]: "ok" });
  try {
    const s = await chain().simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(s.ok, true);
    assert.deepEqual(free(n.asked), [], "no free node is asked when a paid door answers");
    // control: no paid door (the free build): the free nodes run it
    n.asked.length = 0;
    const c = await chain([]).simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(c.ok, true);
    assert.ok(free(n.asked).length > 0);
  } finally { n.restore(); }
});

test("phone bugs: Helius dead or busy mid-trade: Alchemy's answer is the check, silently, and no free node is asked (control: both paid doors up agree as two servers)", async () => {
  for (const dead of ["dead", "busy"] as const) {
    const n = doors({ [HELIUS]: dead, [ALCHEMY]: "ok", [FREE_A]: "ok", [FREE_B]: "ok" });
    try {
      const s = await chain().simulate("AA==", WALLET, [], { firstFull: true });
      assert.equal(s.ok, true, dead);
      assert.equal(s.servers, 1, dead);
      assert.equal(s.lamportsBefore - s.lamportsAfter, 5_000_000n, dead);
      assert.deepEqual(free(n.asked), [], dead);
    } finally { n.restore(); }
  }
  const n = doors({ [HELIUS]: "ok", [ALCHEMY]: "ok" });
  try {
    const s = await chain().simulate("AA==", WALLET, []);
    assert.equal(s.agreed, true);
    assert.equal(s.servers, 2);
  } finally { n.restore(); }
});

test("phone bugs: every paid door dead mid-trade: the free nodes run it silently (control: every door dead is no answer, never a made-up one)", async () => {
  const n = doors({ [HELIUS]: "dead", [ALCHEMY]: "busy", [FREE_A]: "ok", [FREE_B]: "ok" });
  try {
    const s = await chain().simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(s.ok, true);
    assert.ok(free(n.asked).length > 0);
  } finally { n.restore(); }
  const d = doors({});
  try {
    const s = await chain().simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(s.ok, false);
    assert.equal(s.servers, 0);
  } finally { d.restore(); }
});

test("phone bugs: a one-server check (Trade's own buy) whose second answer differs is the first door's check, never 'two servers didn't agree' (control: a site's request, two that differ, is a disagreement)", async () => {
  const n = doors({ [HELIUS]: { spend: 5_000_000 }, [ALCHEMY]: { spend: 90_000_000 } });
  try {
    const s = await chain().simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(s.ok, true);
    assert.equal(s.agreed, false);
    assert.equal(s.servers, 1, "one server's check (B36), not a refusal");
    assert.equal(s.lamportsBefore - s.lamportsAfter, 5_000_000n, "Helius's answer, the first door's");
    const c = await chain().simulate("AA==", WALLET, []);
    assert.equal(c.agreed, false);
    assert.equal(c.servers, 2, "control: two that differ, a disagreement");
  } finally { n.restore(); }
});

test("phone bugs: a slow Helius never holds the tap: Alchemy's answer decides inside the speed bar (control: the slow door alone takes its time)", async () => {
  const n = doors({ [HELIUS]: "slow", [ALCHEMY]: "ok" });
  try {
    const t = performance.now();
    const s = await chain().simulate("AA==", WALLET, [], { firstFull: true });
    const ms = performance.now() - t;
    assert.equal(s.ok, true);
    assert.ok(ms < 1_000, `decided in ${ms.toFixed(0)} ms`);
    const t2 = performance.now();
    await chain([HELIUS]).simulate("AA==", WALLET, [], { firstFull: true });
    assert.ok(performance.now() - t2 >= 1_400, "control: with only the slow door, it waits for it");
  } finally { n.restore(); }
});

test("phone bugs: the blockhash and the route's programs read on the paid doors; a dead door is replaced by the next (control: every door dead fails the read, never 'valid')", async () => {
  const n = doors({ [HELIUS]: "dead", [ALCHEMY]: "ok", [FREE_A]: "dead", [FREE_B]: "ok" });
  try {
    assert.equal(await chain().blockhashValid("11111111111111111111111111111111"), true);
    assert.deepEqual(await chain().executable([WALLET]), [false], "two answers, from Alchemy and the next live door");
  } finally { n.restore(); }
  const d = doors({});
  try {
    await assert.rejects(chain().blockhashValid("11111111111111111111111111111111"));
    await assert.rejects(chain().executable([WALLET]));
  } finally { d.restore(); }
});

// the audit's MUST (5 Nov): a lookup table decides which accounts a signed trade pays, and which accounts are programs decides
// whether a route is refused: never one party's word. A paid door (the relay) AND a direct public node, at once, must
// agree; what both agreed on is kept, so a preflighted tap reads nothing.
/** A lookup table's account data: the 56-byte header, then each entry's 32 bytes. */
const table = (fill: number[]) => {
  const b = new Uint8Array(56 + 32 * fill.length);
  fill.forEach((v, i) => b.fill(v, 56 + 32 * i, 56 + 32 * (i + 1)));
  return btoa(String.fromCharCode(...b));
};
function tables(o: Record<string, number[] | "dead">) {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const u = String(url);
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    asked.push(`${u === HELIUS ? "helius" : u === ALCHEMY ? "alchemy" : u === FREE_A ? "free-a" : u === FREE_B ? "free-b" : "spare"}:${method}`);
    const d = o[u] ?? "dead";
    if (d === "dead") throw new TypeError("fetch failed");
    const send = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "getAccountInfo") return send({ context: { slot: 1 }, value: { data: [table(d), "base64"], executable: false, lamports: 1, owner: SYSTEM } });
    if (method === "getMultipleAccounts") return send({ context: { slot: 1 }, value: (params[0] as string[]).map(() => ({ executable: d[0] === 9, lamports: 1, owner: SYSTEM, data: ["", "base64"] })) });
    return send(null);
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}
const ALT = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

test("the audit's MUST: a lookup table the relay says differently from a direct public node is refused (control: both agree, it is used)", async () => {
  const n = tables({ [HELIUS]: [1, 2, 3], [ALCHEMY]: [1, 2, 3], [FREE_A]: [1, 7, 3], [FREE_B]: [1, 7, 3] });
  try {
    await assert.rejects(chain().lookupTables([ALT], [3]), /don't agree/);
  } finally { n.restore(); }
  const c = tables({ [HELIUS]: [1, 2, 3], [FREE_A]: [1, 2, 3] });
  try {
    const [t] = await chain().lookupTables([ALT], [3]);
    assert.equal(t!.addresses.length, 3);
    assert.ok(c.asked.some((a) => a.startsWith("helius")) && c.asked.some((a) => a.startsWith("free-a")), "one read through the relay, one direct, at once");
  } finally { c.restore(); }
});

test("the audit's MUST: the relay alone (every public node dead) is one party's word: refused, never traded on (control: a public node back, it goes)", async () => {
  const n = tables({ [HELIUS]: [1, 2], [ALCHEMY]: [1, 2] });
  try {
    await assert.rejects(chain().lookupTables([ALT], [2]));
    await assert.rejects(chain().executable([WALLET]));
  } finally { n.restore(); }
  const c = tables({ [HELIUS]: [1, 2], [FREE_A]: "dead", [FREE_B]: [1, 2] });
  try {
    assert.equal((await chain().lookupTables([ALT], [2]))[0]!.addresses.length, 2, "the next public node answers silently");
    assert.deepEqual(await chain().executable([WALLET]), [false]);
  } finally { c.restore(); }
});

test("the audit's MUST: the relay says 'not a program' and a public node says it is one: it may be one (refused) (control: both say not, it isn't)", async () => {
  const n = tables({ [HELIUS]: [1], [FREE_A]: [9] });
  try {
    assert.deepEqual(await chain().executable([WALLET]), [true]);
  } finally { n.restore(); }
  const c = tables({ [HELIUS]: [1], [FREE_A]: [1] });
  try {
    assert.deepEqual(await chain().executable([WALLET]), [false]);
  } finally { c.restore(); }
});

test("the audit's MUST timing: a table and programs both agreed on are kept, so the tap (after the quote's preflight) reads nothing; a table the transaction uses past what is kept is read again (control: a new table waits for the parallel read)", async () => {
  const n = tables({ [HELIUS]: [1, 2, 3, 4], [FREE_A]: [1, 2, 3, 4] });
  try {
    const c = chain();
    let t = performance.now();
    await c.lookupTables([ALT], [2]);
    await c.executable([WALLET]);
    const firstMs = performance.now() - t;
    const reads = n.asked.length;
    assert.ok(reads >= 4, "the quote's preflight: a paid and a direct read of each");
    t = performance.now();
    await c.lookupTables([ALT], [4]);
    await c.executable([WALLET]);
    const tapMs = performance.now() - t;
    assert.equal(n.asked.length, reads, "the tap: kept, no read");
    console.log(`  timing: never-seen table + programs ${firstMs.toFixed(1)} ms (parallel paid + direct, mocked); kept ${tapMs.toFixed(2)} ms, 0 reads`);
    await c.lookupTables([ALT], [5]).catch(() => undefined);
    assert.ok(n.asked.length > reads, "an entry past what is kept is read again");
  } finally { n.restore(); }
});

test("rule 9a (audit, 5 Nov): every public node down, asked twice silently, is SolPublicDown: said plainly by the signer, nothing signed (control: a public node down on the first pass only answers on the silent retry, and nothing is said)", async () => {
  const { isSolPublicDown } = await import("./solana.ts");
  const { securityProblems } = await import("./security-problems.ts");
  const n = tables({ [HELIUS]: [1, 2], [ALCHEMY]: [1, 2] });
  try {
    await assert.rejects(chain().lookupTables([ALT], [2]), (e) => isSolPublicDown(e));
    assert.ok(n.asked.filter((a) => a === "free-a:getAccountInfo").length >= 2, "every public node asked again before it counts as down");
    await assert.rejects(chain().executable([WALLET]), (e) => isSolPublicDown(e));
  } finally { n.restore(); }
  // the words (the look builder's, 5 Nov): what is down, nothing traded or moved, where the money is, one calm step
  const p = securityProblems.solPublicDown("SOL wallet");
  assert.equal(p.whatHappened, "Solana's public servers aren't answering, so ZeroFee didn't trade. Nothing moved.");
  assert.equal(p.money.where, "in your SOL wallet");
  const { problemLine } = await import("./services.ts");
  assert.equal(problemLine(p), "Solana's public servers aren't answering, so ZeroFee didn't trade. Nothing moved. Your money is in your SOL wallet.", "the one line on screen");
  assert.equal(p.next.label, "Try again in a minute");
  assert.doesNotMatch(`${p.whatHappened} ${p.more}`, /busy|since|node|Helius|Alchemy/i, "never a provider's name, never 'busy since'");
  // control: a first pass that fails everywhere public, then a public node back: the retry answers, nothing is said
  const t = tables({ [HELIUS]: [1, 2], [FREE_A]: [1, 2], [FREE_B]: [1, 2] });
  const inner = globalThis.fetch;
  let publicAsks = 0;
  // the first pass (free-a, free-b) fails; the retry's free-b answers
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).startsWith("https://free") && ++publicAsks < 4) throw new TypeError("fetch failed");
    return inner(url, init);
  }) as typeof fetch;
  try {
    const [tb] = await chain().lookupTables([ALT], [2]);
    assert.equal(tb!.addresses.length, 2, "the silent retry's answer is the check");
    assert.ok(publicAsks >= 4);
  } finally { t.restore(); }
  // control: a disagreement is still a disagreement, never "public check down"
  const d = tables({ [HELIUS]: [1, 2, 3], [FREE_A]: [1, 7, 3] });
  try { await assert.rejects(chain().lookupTables([ALT], [3]), (e) => !isSolPublicDown(e) && /don't agree/.test(String(e))); } finally { d.restore(); }
});

test("rule 9a: the route-program check passes SolPublicDown up to the signer (its own words), any other failed read stays 'can't check the apps' (control)", async () => {
  const { routeProgramsRefusal, PAYOUT_WORDS } = await import("./sol/payout.ts");
  const { SolPublicDown } = await import("./solana.ts");
  const decoded = { routeAccounts: [WALLET] } as never;
  await assert.rejects(routeProgramsRefusal(decoded, async () => { throw new SolPublicDown(); }), (e) => e instanceof SolPublicDown);
  assert.equal(await routeProgramsRefusal(decoded, async () => { throw new Error("a node didn't answer"); }), PAYOUT_WORDS.appsUnread);
});

test("rule 9a at the signer: Trade's own sale with Solana's public nodes down is refused with the plain line, the money named in its wallet, nothing signed (control: any other failed read is not said as 'public check down')", async () => {
  const { SolPublicDown } = await import("./solana.ts");
  const { SubWallets } = await import("./subwallets.ts");
  const { MemoryVault } = await import("./vault.ts");
  const { POCKET_COIN, pocketNode, sell } = await import("./testing/pocket-tx.ts");
  const signer = async (fail: () => Error) => {
    const node = pocketNode();
    const sol = { blockhashValid: (b: string) => node.blockhashValid(b), lookupTables: async () => [], simulate: async () => { throw fail(); }, executable: async (k: string[]) => k.map(() => false), mintDecimals: async () => 6 } as never;
    const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => 20, approve: async () => false, emit: () => {} });
    const t = await w.create("trade", "sol");
    return w.signTx(t.id, sell(t.address, POCKET_COIN, 31), "", undefined, "Trade", undefined, "trade").then(() => null, (e: { problem?: { code: string; whatHappened: string; money: { where: string } } }) => e.problem ?? null);
  };
  const p = await signer(() => new SolPublicDown());
  assert.equal(p?.code, "security.sol.public-down");
  assert.equal(p?.whatHappened, "Solana's public servers aren't answering, so ZeroFee didn't trade. Nothing moved.");
  assert.match(p?.money.where ?? "", /^in your .*wallet$/i);
  const c = await signer(() => new Error("a node didn't answer"));
  assert.notEqual(c?.code, "security.sol.public-down", "control");
});

// the audit's condition on 8e6840d00 (5 Nov): the reads that skip the relay (sol-proxy relayTakes: an address the relay would
// refuse) must keep the phone-sol-path rule. They can't be a trade's lookup-table or program read: every key a
// transaction carries is 32 bytes, and base58 of any 32 bytes is 32 to 44 characters of the alphabet, which the relay
// takes. Pinned over the edges and 2,000 keys; and if one ever did skip, the check fails closed (refused), never one
// public node's word alone.
const SAMPLE = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";   // the Sim's sample wallet: no base58 (0, I, l)
test("the audit's condition: a trade's table and program reads are never skipped: every 32-byte key goes to the relay (control: the Sim's sample and a 31-byte key do skip)", () => {
  let x = 0x9e3779b9;   // xorshift, seeded: the same 2,000 keys every run
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 0xff; };
  const edges = [new Uint8Array(32), new Uint8Array(32).fill(0xff), Uint8Array.from({ length: 32 }, (_, i) => (i < 31 ? 0 : 1)), Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 0 : 0xff))];
  const keys = [...edges, ...Array.from({ length: 2_000 }, () => Uint8Array.from({ length: 32 }, next))].map(base58Encode);
  for (const k of keys) {
    assert.ok(relayTakes("getAccountInfo", [k, { encoding: "base64", commitment: "confirmed" }]), k);
    assert.notEqual(solReadOf({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [k, { encoding: "base64", commitment: "confirmed" }] }), null, `the relay takes ${k}`);
  }
  for (let i = 0; i < keys.length; i += 100) assert.ok(relayTakes("getMultipleAccounts", [keys.slice(i, i + 100), { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }]));
  assert.equal(relayTakes("getAccountInfo", [SAMPLE]), false, "control: the sample skips");
  assert.equal(relayTakes("getAccountInfo", [base58Encode(new Uint8Array(31))]), false, "control: 31 bytes is no key");
  assert.equal(relayTakes("getMultipleAccounts", [[keys[0]!, SAMPLE]]), false, "control: one bad key in a list skips the list");
});

test("the audit's condition: with the relay on, a table or program read of a key the relay won't take is refused, even with both public nodes agreeing (control: a real key, relay + a public node, is used)", async () => {
  setSolProxy(HELIUS);
  const n = tables({ [HELIUS]: [1, 2], [ALCHEMY]: [1, 2], [FREE_A]: [1, 2], [FREE_B]: [1, 2] });
  try {
    await assert.rejects(chain().lookupTables([SAMPLE], [2]), "one side only (the public one): never the decision");
    await assert.rejects(chain().executable([SAMPLE]));
    assert.ok(!n.asked.some((a) => a.startsWith("helius") || a.startsWith("alchemy")), "the relay was never asked");
    n.asked.length = 0;
    const [t] = await chain().lookupTables([ALT], [2]);
    assert.equal(t!.addresses.length, 2, "control: a real key is used");
    assert.ok(n.asked.some((a) => a.startsWith("helius")) && n.asked.some((a) => a.startsWith("free-")), "two parties: the relay and a direct public node");
  } finally { n.restore(); setSolProxy(null); }
});
