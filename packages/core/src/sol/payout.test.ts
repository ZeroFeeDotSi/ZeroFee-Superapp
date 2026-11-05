// Review M1 and M2 (3 Nov): where a swap pays out is checked from its bytes, with no server trusted (payoutRefusal), and
// a Jupiter route calls only programs ZeroFee knows (routeProgramsRefusal). Each attack is one account or one byte
// changed in a transaction Trade really built (packages/trade/src/sol/fixtures), and each has its control: the same
// transaction, rebuilt unchanged, passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base58, base64, cat, fromBase58, u32le, u64le } from "./bytes.ts";
import { KNOWN_PROGRAMS, KNOWN_ROUTE_PROGRAMS, decodeSolTx } from "./decode.ts";
import { PAYOUT_WORDS, payoutRefusal, routeProgramsRefusal } from "./payout.ts";
import { decodeTx, decompile, lookupTableAddresses, type LookupTable } from "./wire.ts";
import { SOL, ownTokenAccount, sessionRefusal } from "../solana.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../../trade/src/sol/fixtures/${f}`, import.meta.url), "utf8"));
const golden = load("sol-golden.json"), alt = load("web3-alt-vectors.json");
const OWNER = "GKreMsHvt8A79VApjboYDq3J4ZCXSJRYYQk9BscMbi1H"; // the fixtures' test wallet: BIP-39's public test phrase at m/44'/501'/0'/1' (trade sol/testing/replay.test.ts)
const THIEF = base58(new Uint8Array(32).fill(66));
const BLOCKHASH = base58(new Uint8Array(32).fill(5));
const JUP = SOL.jupiter, WSOL = SOL.wsol;
const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", DAMM2 = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const LAUNCHLAB = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
type Ix = { program: string; accounts: string[]; data: Uint8Array };

/** A legacy transaction, `payer` the only signer (as decode.test.ts builds them). */
function legacyTx(payer: string, ixs: Ix[]): string {
  const programs = [...new Set(ixs.map((i) => i.program))];
  const others = [...new Set(ixs.flatMap((i) => i.accounts))].filter((k) => k !== payer && !programs.includes(k));
  const keys = [payer, ...others, ...programs];
  const at = (k: string) => keys.indexOf(k);
  const parts: (Uint8Array | number[])[] = [[1, 0, programs.length], [keys.length], ...keys.map(fromBase58), fromBase58(BLOCKHASH), [ixs.length]];
  for (const ix of ixs) parts.push([at(ix.program), ix.accounts.length, ...ix.accounts.map(at), ix.data.length], ix.data);
  return base64(cat([1], new Uint8Array(64), cat(...parts)));
}
/** A real transaction's steps, to change one thing and build again. */
function stepsOf(tx: string, tables: LookupTable[] = []): { payer: string; ixs: Ix[] } {
  const { payer, instructions } = decompile(decodeTx(tx), tables);
  return { payer, ixs: instructions.map((i) => ({ program: i.programId, accounts: i.keys.map((k) => k.pubkey), data: i.data.slice() })) };
}
/** The payout check as a caller makes it: decoded first, then checked against the same bytes. */
const check = (tx: string, tables: LookupTable[] = [], wallet?: string) => {
  const d = decodeSolTx(tx, tables);
  return payoutRefusal(d, decodeTx(tx), tables, wallet ?? d.feePayer);
};
/** Build again with one venue step changed (the first step of `program`). */
function changed(tx: string, program: string, edit: (ix: Ix) => void, tables: LookupTable[] = [], more?: (ixs: Ix[]) => Ix[]): string {
  const { payer, ixs } = stepsOf(tx, tables);
  const ix = ixs.find((i) => i.program === program);
  assert.ok(ix, `the transaction has a ${KNOWN_PROGRAMS[program] ?? program} step`);
  edit(ix);
  return legacyTx(payer, more ? more(ixs) : ixs);
}
const caseOf = (name: string) => {
  const c = golden.cases.find((x: any) => x.name === name);
  assert.ok(c, name);
  return c.sims.at(-1) as string;
};
const altTables = (v: any): LookupTable[] => Object.entries(v.alts as Record<string, string>).map(([k, data]) => ({ key: k, addresses: lookupTableAddresses(Buffer.from(data, "base64")) }));
const jupiter = alt.vectors.map((v: any) => ({ name: v.name as string, tx: v.swapTransaction as string, tables: altTables(v) }));

// ---------------------------------------------------------------------------------------------------------------------
// The control: every swap Trade really built pays only the wallet, and passes, as recorded and rebuilt unchanged.

test("M1 control: every transaction Trade really built (13 native, 2 Jupiter) pays only the wallet's own accounts", () => {
  let n = 0;
  for (const c of golden.cases.filter((x: any) => !x.error)) {
    const tx = c.sims.at(-1);
    assert.equal(check(tx), null, c.name);
    const { payer, ixs } = stepsOf(tx);
    assert.equal(check(legacyTx(payer, ixs)), null, `${c.name}, rebuilt unchanged`);
    n++;
  }
  assert.equal(n, 13);
  for (const j of jupiter) {
    assert.equal(check(j.tx, j.tables), null, j.name);
    const { payer, ixs } = stepsOf(j.tx, j.tables);
    assert.equal(check(legacyTx(payer, ixs)), null, `${j.name}, rebuilt unchanged`);
  }
  // every venue is among them, both sides where Trade recorded both
  const venues = new Set(golden.cases.filter((x: any) => !x.error).flatMap((c: any) => decodeSolTx(c.sims.at(-1)).swaps.map((s) => `${s.venue} ${s.side}`)));
  for (const v of ["pump.fun buy", "pump.fun sell", "PumpSwap buy", "PumpSwap sell", "Raydium buy", "Raydium sell", "Meteora DBC buy", "Meteora DAMM v2 buy", "Raydium LaunchLab buy", "Raydium LaunchLab sell"]) assert.ok(venues.has(v), v);
});

// ---------------------------------------------------------------------------------------------------------------------
// A buy's coin paid into someone else's account: each venue, at its output position.

test("M1: a buy whose coin is paid into someone else's account is refused, every venue", () => {
  const thiefs = (mint: string) => ownTokenAccount(THIEF, mint, SOL.token2022);
  const buys: [string, string, number, number][] = [
    // case, program, the coin's account position, the coin's mint position
    ["pump.fun buy $1 (PUMPE)", PUMP, 9, 1],
    ["PumpSwap buy $2.50 (MONEYBIZ)", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", 5, 3],
    ["cpmm buy $1 (ZEREBRO, its market)", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", 5, 11],
    ["dbc buy $1 (native curve)", DBC, 4, 7],
    ["damm2 buy $1 (native curve)", DAMM2, 3, 6],
    ["launchlab buy $1 (native curve)", LAUNCHLAB, 5, 9],
  ];
  for (const [name, program, at, mintAt] of buys) {
    const tx = caseOf(name);
    for (const to of [THIEF, (() => { const { ixs } = stepsOf(tx); return thiefs(ixs.find((i) => i.program === program)!.accounts[mintAt]!); })()]) {
      const bad = changed(tx, program, (ix) => void (ix.accounts[at] = to));
      assert.equal(decodeSolTx(bad).swaps[0]?.side, "buy", `${name}: still read as a buy`);
      assert.equal(check(bad), PAYOUT_WORDS.notYours, `${name}: the coin paid to ${to === THIEF ? "a stranger" : "a stranger's own coin account"}`);
    }
  }
});

test("M1: a sale whose SOL is paid into someone else's account is refused, every venue Trade sells on", () => {
  const sells: [string, string, number][] = [
    ["pump.fun sell half", PUMP, 10],
    ["PumpSwap sell all", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", 6],
    ["cpmm sell all (ZEREBRO)", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", 5],
    ["launchlab sell all (native curve)", LAUNCHLAB, 6],
  ];
  for (const [name, program, at] of sells) {
    const tx = caseOf(name);
    for (const to of [THIEF, ownTokenAccount(THIEF, WSOL)]) {
      const bad = changed(tx, program, (ix) => void (ix.accounts[at] = to));
      assert.equal(decodeSolTx(bad).swaps[0]?.side, "sell", `${name}: still read as a sale`);
      assert.equal(check(bad), PAYOUT_WORDS.notYours, `${name}: SOL paid to ${to === THIEF ? "a stranger" : "a stranger's wSOL account"}`);
    }
  }
});

test("M1: a Meteora DBC or DAMM v2 sale pays its SOL into the wallet's own wSOL account (control), never another", () => {
  // Trade's buys turned into sales: no wrap, the coin account in, the wSOL account out
  for (const [name, program, input, output] of [["dbc buy $1 (native curve)", DBC, 3, 4], ["damm2 buy $1 (native curve)", DAMM2, 2, 3]] as const) {
    const sale = (to?: string) => changed(caseOf(name), program, (ix) => {
      const [i, o] = [ix.accounts[input]!, ix.accounts[output]!];
      ix.accounts[input] = o;
      ix.accounts[output] = to ?? i;
    }, [], (ixs) => ixs.filter((x) => x.program !== SOL.system && !(x.program === SOL.token && x.data[0] === 17)));
    const ok = sale();
    assert.equal(decodeSolTx(ok).swaps[0]?.side, "sell", name);
    assert.equal(check(ok), null, `${name}: control, the wallet's own wSOL account`);
    assert.equal(check(sale(ownTokenAccount(THIEF, WSOL))), PAYOUT_WORDS.notYours, `${name}: a stranger's wSOL account`);
  }
});

test("M1: a coin paid into the wallet's own account under either token program passes (Token-2022 coins, as Trade's own check)", () => {
  const tx = caseOf("pump.fun buy $1 (PUMPE)");
  const coin = decodeSolTx(tx).swaps[0]!.coin!;
  // recorded: the Token-2022 account; the same coin's Token account is also the wallet's own
  assert.equal(stepsOf(tx).ixs.find((i) => i.program === PUMP)!.accounts[9], ownTokenAccount(OWNER, coin, SOL.token2022));
  assert.equal(check(changed(tx, PUMP, (ix) => void (ix.accounts[9] = ownTokenAccount(OWNER, coin)))), null);
  // the wallet's own account, but for another coin: not where this coin lands
  assert.equal(check(changed(tx, PUMP, (ix) => void (ix.accounts[9] = ownTokenAccount(OWNER, WSOL)))), PAYOUT_WORDS.notYours);
});

// ---------------------------------------------------------------------------------------------------------------------
// Fees for someone else, and layouts not certain: refused, never guessed.

test("M1: a referral on Meteora DBC or DAMM v2, or LaunchLab's share fee, is a fee for someone else", () => {
  assert.equal(check(changed(caseOf("dbc buy $1 (native curve)"), DBC, (ix) => void (ix.accounts[12] = THIEF))), PAYOUT_WORDS.fee, "DBC's referral account @12");
  assert.equal(check(changed(caseOf("damm2 buy $1 (native curve)"), DAMM2, (ix) => void (ix.accounts[11] = THIEF))), PAYOUT_WORDS.fee, "DAMM v2's referral account @11");
  const ll = caseOf("launchlab buy $1 (native curve)");
  assert.equal(check(changed(ll, LAUNCHLAB, (ix) => void ix.data.set(u64le(1n), 24))), PAYOUT_WORDS.fee, "share_fee_rate 1");
  assert.equal(check(changed(ll, LAUNCHLAB, (ix) => void (ix.data = cat(ix.data, u64le(0n))))), PAYOUT_WORDS.unread, "LaunchLab data of another length isn't read");
});

test("M1: a pump.fun step whose quote isn't wSOL, a venue step not read as a swap, or another transaction's reading: refused", () => {
  const buy = caseOf("pump.fun buy $1 (PUMPE)");
  assert.equal(check(changed(buy, PUMP, (ix) => void (ix.accounts[2] = THIEF))), PAYOUT_WORDS.unread, "pump.fun quoted in another coin");
  // a Raydium step with another instruction: decode counts it unread
  assert.equal(check(changed(caseOf("cpmm buy $1 (ZEREBRO, its market)"), "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", (ix) => void (ix.data[0] = 0))), PAYOUT_WORDS.unread);
  // the reading of one transaction checked against another's bytes
  const other = caseOf("PumpSwap buy $2.50 (MONEYBIZ)");
  assert.equal(payoutRefusal(decodeSolTx(other), decodeTx(buy), [], OWNER), PAYOUT_WORDS.unread);
  // a wallet that doesn't pay for it
  assert.equal(payoutRefusal(decodeSolTx(buy), buy, [], THIEF), PAYOUT_WORDS.notPayer);
  // control: the same transaction, as a string or decoded
  assert.equal(payoutRefusal(decodeSolTx(buy), buy, [], OWNER), null);
  assert.equal(payoutRefusal(decodeSolTx(buy), "not a transaction", [], OWNER), PAYOUT_WORDS.unread);
});

// ---------------------------------------------------------------------------------------------------------------------
// Jupiter: route and shared_accounts_route.

test("M1: a Jupiter route paying someone else (@3), naming another destination (@4), or with a platform fee is refused", () => {
  for (const j of jupiter) {
    const coin = decodeSolTx(j.tx, j.tables).swaps[0]!.coin!;
    const route = (edit: (ix: Ix) => void) => changed(j.tx, JUP, edit, j.tables);
    assert.equal(check(route(() => {})), null, `${j.name}: control`);
    assert.equal(check(route((ix) => void (ix.accounts[3] = ownTokenAccount(THIEF, coin)))), PAYOUT_WORDS.notYours, `${j.name}: user_destination_token_account a stranger's`);
    assert.equal(check(route((ix) => void (ix.accounts[4] = ownTokenAccount(THIEF, coin)))), PAYOUT_WORDS.notYours, `${j.name}: destination_token_account a stranger's`);
    assert.equal(check(route((ix) => void (ix.accounts[4] = ix.accounts[3]!))), PAYOUT_WORDS.notYours, `${j.name}: destination_token_account named at all (None only)`);
    assert.equal(check(route((ix) => void (ix.data[ix.data.length - 1] = 255))), PAYOUT_WORDS.fee, `${j.name}: platform_fee_bps 255 (2.55%)`);
    assert.equal(check(route((ix) => void (ix.data[ix.data.length - 1] = 1))), PAYOUT_WORDS.fee, `${j.name}: platform_fee_bps 1`);
    // the session check alone lets each of these through: this is the check that catches them
    assert.equal(sessionRefusal(route((ix) => void (ix.accounts[3] = THIEF)), OWNER), null, `${j.name}: sessionRefusal doesn't see where it pays`);
  }
});

const JUP_SHARED = [0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81];
/** shared_accounts_route: token program, program authority, user authority @2, source @3, program's source @4, program's
 *  destination @5, destination @6, source mint @7, destination mint @8, platform fee (None), token-2022 (None), event
 *  authority, Jupiter; data: id u8, a route plan, in_amount, quoted_out, slippage_bps, platform_fee_bps. */
function sharedRoute(o: { sale?: boolean; to?: string; fee?: number }) {
  const coin = base58(new Uint8Array(32).fill(44)), wsol = ownTokenAccount(OWNER, WSOL), mine = ownTokenAccount(OWNER, coin);
  const [src, srcMint, dstMint, dst] = o.sale ? [mine, coin, WSOL, o.to ?? wsol] : [wsol, WSOL, coin, o.to ?? mine];
  const route: Ix = {
    program: JUP,
    accounts: [SOL.token, base58(new Uint8Array(32).fill(45)), OWNER, src, base58(new Uint8Array(32).fill(46)), base58(new Uint8Array(32).fill(47)), dst, srcMint, dstMint, JUP, JUP, base58(new Uint8Array(32).fill(48)), JUP],
    data: cat(JUP_SHARED, [3], [1, 0, 0, 0, 7, 100, 0, 1], u64le(1_000_000n), u64le(5_000n), [50, 0], [o.fee ?? 0]),
  };
  const wrap: Ix[] = o.sale ? [] : [
    { program: SOL.system, accounts: [OWNER, wsol], data: cat(u32le(2), u64le(1_000_000n)) },
    { program: SOL.token, accounts: [wsol], data: new Uint8Array([17]) },
  ];
  return legacyTx(OWNER, [...wrap, route]);
}

test("M1: Jupiter's shared_accounts_route pays only the wallet's own account (@6), with no platform fee", () => {
  for (const sale of [false, true]) {
    const ok = sharedRoute({ sale });
    assert.equal(decodeSolTx(ok).swaps[0]?.side, sale ? "sell" : "buy", "control: read as a swap");
    assert.equal(check(ok), null, `control: the ${sale ? "sale" : "buy"} pays the wallet's own account`);
    assert.equal(check(sharedRoute({ sale, to: THIEF })), PAYOUT_WORDS.notYours, `a ${sale ? "sale" : "buy"} paid to a stranger`);
    assert.equal(check(sharedRoute({ sale, fee: 50 })), PAYOUT_WORDS.fee, `a ${sale ? "sale" : "buy"} with a platform fee`);
  }
  assert.equal(check(sharedRoute({ sale: true, to: OWNER })), PAYOUT_WORDS.notYours, "a Jupiter sale pays a token account: the wallet itself isn't one");
});

// ---------------------------------------------------------------------------------------------------------------------
// M2: the programs a route calls inside.

/** What the network says, for the recorded routes: only their real programs are executable. */
const PROGRAMS = new Set([...Object.keys(KNOWN_PROGRAMS), ...Object.keys(KNOWN_ROUTE_PROGRAMS)]);
const network = (also: string[] = []) => {
  const asked: string[][] = [];
  return { asked, executable: async (keys: string[]) => (asked.push(keys), keys.map((k) => PROGRAMS.has(k) || also.includes(k))) };
};

test("M2 control: the recorded Jupiter routes call only known programs (the memo program among them); only unknown accounts are asked", async () => {
  for (const j of jupiter) {
    const d = decodeSolTx(j.tx, j.tables);
    const n = network();
    assert.equal(await routeProgramsRefusal(d, n.executable), null, j.name);
    assert.equal(n.asked.length, 1, `${j.name}: one read`);
    assert.ok(n.asked[0]!.every((k) => !PROGRAMS.has(k)), `${j.name}: known programs aren't asked`);
    assert.ok(d.routeAccounts.includes("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"), `${j.name}: routes through Orca`);
  }
  assert.ok(decodeSolTx(jupiter[0].tx, jupiter[0].tables).routeAccounts.includes("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), "SOL -> WIF passes the memo program");
});

test("M2: a route through a program ZeroFee doesn't know is refused; so is a read that fails or comes back short", async () => {
  const j = jupiter[0];
  const d = decodeSolTx(j.tx, j.tables);
  const pool = d.routeAccounts.find((a) => !PROGRAMS.has(a) && a !== d.feePayer)!;
  assert.equal(await routeProgramsRefusal(d, network([pool]).executable), PAYOUT_WORDS.unknownApp, "one account the network says is a program");
  assert.equal(await routeProgramsRefusal(d, async () => { throw new Error("no node answered"); }), PAYOUT_WORDS.appsUnread);
  assert.equal(await routeProgramsRefusal(d, async (keys) => keys.slice(1).map(() => false)), PAYOUT_WORDS.appsUnread, "a short answer");
  assert.equal(await routeProgramsRefusal(d, async (keys) => keys.map(() => null as unknown as boolean)), PAYOUT_WORDS.unknownApp, "no answer for a key is a program");
  // a program added inside the route's accounts, not as a step of its own
  const added = changed(j.tx, JUP, (ix) => void ix.accounts.push(THIEF), j.tables);
  assert.equal(await routeProgramsRefusal(decodeSolTx(added), network([THIEF]).executable), PAYOUT_WORDS.unknownApp);
  assert.equal(await routeProgramsRefusal(decodeSolTx(added), network().executable), null, "control: the same account, not a program");
});

test("M2: a transaction with no Jupiter route asks the network nothing", async () => {
  const n = network();
  assert.equal(await routeProgramsRefusal(decodeSolTx(caseOf("pump.fun buy $1 (PUMPE)")), n.executable), null);
  assert.equal(n.asked.length, 0);
});
