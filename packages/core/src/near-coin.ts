// The NEAR coin wallet's own door (Rhea trades, 3 Nov; amends D96): its trades, its coin accounts, its balance, what it can
// move and its Put away's payment, loaded with the first NEAR coin call so Home's first load never carries it (its JS
// budget). SubWallets hands it what it needs of itself (NearCoinCtx); nothing here is reachable but through SubWallets.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Chain } from "./chain.ts";
import { txHashOf } from "./chain.ts";
import { NEAR_CLOSED, NEAR_COIN_WALLET, NEAR_GATE, NEAR_STORAGE_MAX_YOCTO, REF_EXCHANGE_ID, WNEAR } from "./near-gate.ts";
import { nearAskRefusal, type NearTradeAsk } from "./near-trade.ts";
import { NearTradeRefused, buildNearRegister, buildNearTrade, buildRheaAdd, buildRheaClaim, buildRheaRoomBack, buildRheaSwap, buildRheaWithdraw, nearPublicKey, rheaAccountAt, signNearBuilt, type NearBuilt } from "./near-trade-sign.ts";
import { RHEA_HELD_LINE, type RheaRule } from "./near-rhea.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";
import { base58, utf8 } from "./sol/bytes.ts";
import { isAccountId, sameTransaction, serialize, signedBase64, type CoreAction, type UnsignedTx } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";
import type { Vault } from "./vault.ts";

/** What SubWallets lends this door of itself. */
export interface NearCoinCtx {
  o: { near?: Chain; vault: Vault; approve: (words: PlainWords) => Promise<boolean>; tokenPrice?: (tokenId: string) => Promise<{ usd: number } | null>; marketPrice?: (chain: "near", coin: string) => Promise<number | null> };
  /** The last nonce the NEAR coin wallet's key signed on this phone. */
  nonces: Map<string, bigint>;
  turn<T>(key: string, run: () => Promise<T>): Promise<T>;
  wallet(): Promise<{ id: string; address: string }>;
  find(id: string): Promise<{ id: string; address: string }>;
  secret(w: { id: string; address: string }): Promise<Uint8Array>;
  priceSoon(chain: "near"): Promise<number | null>;
  capGate(usd: number | null): Promise<string | null>;
}
/** The NEAR coin wallet's signature: its bytes and hash; for a trade, the coin-out balance at the build block (two nodes). */
export type NearSignedAnswer = { signedTx: string; hash: string; signerId: string; beforeOut?: string; atHeight?: number } | { declined: true };
/** The coins whose account the NEAR coin wallet opened, and when: one a day per coin (review M2). */
const NEAR_REGISTERS = "near-registers";
/** NEAR the NEAR coin wallet always keeps for its own gas (a put-away of "all" leaves it). */
const NEAR_GAS_KEEP = 50_000_000_000_000_000_000_000n;
const DAY_MS = 86_400_000;
/** A NEAR coin trade whose coin (or wNEAR) has no account in the NEAR coin wallet yet: Trade makes it, then trades. Here,
 *  not in security-problems.ts (Home's first load); its row is in errors.md all the same. */
export const nearRegisterFirst = (coin: string): import("./problem.ts").Problem => ({
  code: "security.near.register",
  whatHappened: "This coin needs its account in your wallet first. Nothing was signed.",
  money: { state: "safe", where: "in that wallet" },
  next: { kind: "retry", label: "Try again" },
  more: coin,
});
/** A NEAR coin trade on the wallet's Rhea balance that needs the wallet readied first: its room in Rhea (`more` "room":
 *  Trade tops it up before the tap, Ready NEAR's own call) or its account there (`more` "ready": the person's one tap). */
export const nearRheaFirst = (more: "room" | "ready"): import("./problem.ts").Problem => ({
  code: "security.near.rhea",
  whatHappened: more === "room" ? "Rhea needs a little more NEAR to hold this coin. Nothing was signed." : "Ready your NEAR for trading first. Nothing was signed.",
  money: { state: "safe", where: "in that wallet" },
  next: { kind: "retry", label: "Try again" },
  more,
});
const nearText = (yocto: bigint) => `${(Number(yocto) / 1e24).toLocaleString("en-US", { maximumFractionDigits: 4 })} NEAR`;
/** An implicit account's own key, from its 64-hex id (the ed25519 public key itself). */
const nearKeyOf = (implicit: string) => `ed25519:${base58(Uint8Array.from(implicit.match(/../g)!.map((h) => parseInt(h, 16))))}`;

/**
 * A NEAR coin trade on Rhea (product decision, 3 Nov; amends D96): the core builds the one transaction itself from the ask
 * (near-trade.ts: wrap.near's near_deposit and ft_transfer_call into one Rhea pool, or the coin's ft_transfer_call),
 * reads every figure it is held to at one block two nodes agree on (near-trade-sign.ts), decodes its own bytes again
 * and holds them to the same rules, then signs with the NEAR coin wallet's key: within D143's caps with no sheet,
 * past them on the one-tap sheet. Only Trade asks (demo-core). Nothing is sent here: Trade sends the bytes and reads
 * the outcome (a refunded swap is never "landed").
 */
export async function nearTrade(c: NearCoinCtx, ask: unknown): Promise<NearSignedAnswer> {
  if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
    const why = nearAskRefusal(ask);
  if (why) throw new ProblemError(securityProblems.requestInvalid(why));
  const a = ask as NearTradeAsk;
  return signed(c, async (chain, wallet, pk) => {
    // NEAR's price is read beside the block and the views (speed, 5 Nov), never before them
    const b = await buildNearTrade(chain, wallet, pk, a, { near: c.priceSoon("near"), coin: (id) => coinUsd(c, id) });
    // review L5: the sheet names the coin (its own contract's name), what goes in and the least that comes back
    const coin = (raw: string) => `${(Number(raw) / 10 ** b.decimals).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${b.symbol}`;
    const sheet = a.side === "buy"
      ? { title: `Buy ${b.symbol} with ${nearText(BigInt(a.amountIn))}`, lines: [`From your ${NEAR_COIN_WALLET}, on Rhea.`, `At least ${coin(a.minOut)} back.`] }
      : { title: `Sell ${coin(a.amountIn)} for NEAR`, lines: [`From your ${NEAR_COIN_WALLET}, on Rhea.`, `At least ${nearText(BigInt(a.minOut))} back.`] };
    return { b, sheet };
  }, a);
}

/**
 * A NEAR coin trade on the wallet's own Rhea balance (near-rhea.ts, the 2 s rule, 5 Nov): ONE swap call on Rhea, built
 * by the core from the same ask and held to the same pool, price and least checks as nearTrade (near-trade-sign.ts
 * buildRheaSwap), its bytes decoded again and held to rheaBytesRefusal, signed within D143's caps (past them, the one-tap
 * sheet). Only Trade asks. Nothing is sent here.
 */
export async function nearRheaSwap(c: NearCoinCtx, ask: unknown): Promise<NearSignedAnswer> {
  if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
  const why = nearAskRefusal(ask);
  if (why) throw new ProblemError(securityProblems.requestInvalid(why));
  const a = ask as NearTradeAsk;
  return signed(c, async (chain, wallet, pk) => {
    const b = await buildRheaSwap(chain, wallet, pk, a, { near: c.priceSoon("near"), coin: (id) => coinUsd(c, id) });
    const coin = (raw: string) => `${(Number(raw) / 10 ** b.decimals).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${b.symbol}`;
    const sheet = a.side === "buy"
      ? { title: `Buy ${b.symbol} with ${nearText(BigInt(a.amountIn))}`, lines: [`Paid from your NEAR on Rhea.`, `At least ${coin(a.minOut)} back.`] }
      : { title: `Sell ${coin(a.amountIn)} for NEAR`, lines: [`On Rhea, in your ${NEAR_COIN_WALLET}.`, `At least ${nearText(BigInt(a.minOut))} back.`] };
    return { b, sheet };
  }, { rhea: "swap", ask: a });
}

/**
 * "Ready NEAR for trading" (one tap, near-rhea.ts): the NEAR coin wallet's NEAR (`amount` yocto as text, "all", or "0" for
 * the room only) into its own account in Rhea, and its room there first when it has none or too little. Built, checked
 * and signed here, and sent here (each on two nodes, chain.send), in the wallet's one turn. No cap and no sheet: nothing
 * leaves the person's own accounts (the wallet's account in Rhea moves only by this wallet's key), and only Trade asks.
 */
export function nearRheaAdd(c: NearCoinCtx, amount: unknown): Promise<{ hashes: string[]; amount: string }> {
  if (!NEAR_GATE.open) return Promise.reject(new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED)));
  if (!(amount === "all" || (typeof amount === "string" && /^\d{1,30}$/.test(amount)))) return Promise.reject(new ProblemError(securityProblems.requestInvalid('amount is yoctoNEAR, as text, or "all"')));
  return c.turn("near-coin-key", async () => {
    const chain = c.o.near;
    if (!chain) throw new ProblemError(securityProblems.subwalletRefused("NEAR coin trades aren't set up on this phone."));
    const w = await c.find((await c.wallet()).id);
    const pk = nearKeyOf(w.address);
    let made: Awaited<ReturnType<typeof buildRheaAdd>>;
    try { made = await buildRheaAdd(chain, w.address, pk, amount === "all" ? "all" : BigInt(amount as string)); } catch (e) {
      if (e instanceof NearTradeRefused) throw new ProblemError(securityProblems.subwalletRefused(e.message));
      throw e;
    }
    const secret = await c.secret(w);
    const hashes: string[] = [];
    if (made.room) hashes.push((await sendBuilt(c, chain, w.address, secret, made.room, { rhea: "room" })).hash);
    if (made.deposit) {
      const r = await sendBuilt(c, chain, w.address, secret, made.deposit, { rhea: "deposit", amount: made.amount });
      hashes.push(r.hash);
      // ft_transfer_call answers what Rhea USED: all of it, or it came back to the wallet (Rhea refused it)
      if (r.partly || usedOf(r.value) !== made.amount) throw new ProblemError(securityProblems.subwalletRefused("Rhea didn't take it. Your NEAR is still in your wallet."));
    }
    return { hashes, amount: made.amount.toString() };
  });
}

/** One built NEAR coin wallet transaction, its nonce past the last this core signed, checked, signed and sent (two nodes).
 *  Inside the wallet's one turn only. */
const usedOf = (value: string | null): bigint | null => {
  try { const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value ?? ""), (ch) => ch.charCodeAt(0)))); return typeof v === "string" && /^\d{1,39}$/.test(v) ? BigInt(v) : null; } catch { return null; }
};
async function sendBuilt(c: NearCoinCtx, chain: Chain, wallet: string, secret: Uint8Array, b: NearBuilt, rule: RheaRule): Promise<{ hash: string; value: string | null; partly?: boolean }> {
  const last = c.nonces.get(wallet) ?? 0n;
  if (b.tx.nonce <= last) b.tx.nonce = last + 1n;
  let signedTx: string, hash: string;
  try { ({ signedTx, hash } = signNearBuilt(b, wallet, secret, rule)); } catch (e) {
    if (e instanceof NearTradeRefused) throw new ProblemError(securityProblems.subwalletRefused(e.message));
    throw e;
  }
  c.nonces.set(wallet, b.tx.nonce);
  const r = await chain.send(signedTx, hash, wallet);
  if (r.status !== "done") throw new ProblemError(securityProblems.subwalletRefused("NEAR didn't take it."));
  return { hash, value: r.value, ...(r.partly ? { partly: true } : {}) };
}

/**
 * A coin's (or wNEAR's) account in the NEAR coin wallet, before its first buy (or sale): at most 0.00125 NEAR, only for
 * a coin Rhea trades against NEAR (`poolId`, checked on chain), at most once a day per coin (review M2).
 */
export async function nearRegister(c: NearCoinCtx, coin: unknown, poolId?: unknown): Promise<NearSignedAnswer> {
  if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
  if (!isAccountId(coin) || coin === REF_EXCHANGE_ID) throw new ProblemError(securityProblems.requestInvalid("the coin is a NEAR coin's contract"));
  if (coin !== WNEAR && !(typeof poolId === "number" && Number.isInteger(poolId) && poolId >= 0 && poolId <= 1_000_000_000)) throw new ProblemError(securityProblems.requestInvalid("the pool is Rhea's pool number"));
    return signed(c, async (chain, wallet, pk) => {
    const raw = await c.o.vault.get(NEAR_REGISTERS);
    let kept: Record<string, number> = {};
    try { kept = raw ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, number>) : {}; } catch { kept = {}; }
    const at = kept[coin];
    if (typeof at === "number" && Date.now() - at < DAY_MS && Date.now() >= at) throw new NearTradeRefused("This coin's account was opened today already.");
    const b = await buildNearRegister(chain, wallet, pk, coin, poolId as number | undefined, await c.priceSoon("near"));
    return { b, sheet: { title: `Open a ${b.symbol} account in your ${NEAR_COIN_WALLET}`, lines: [`It costs ${nearText(b.valueYocto)}, kept for the coin's account.`] }, after: async () => { await c.o.vault.put(NEAR_REGISTERS, utf8(JSON.stringify({ ...kept, [coin]: Date.now() }))); } };
  }, { register: coin });
}

/**
 * A kept trade's coin back from Ref's lost and found (the audit's MUST, 7 Nov): Ref's claim_lostfound for the coin, 1 yocto,
 * built only while Ref holds some of it for the wallet at an agreed block, its bytes held to rheaBytesRefusal's "claim"
 * (exactly that method, deposit and { token_id }). The same key and caps as a trade (nothing new to approve: 1 yocto out).
 * Only Trade asks. Nothing is sent here.
 */
export async function nearRheaClaim(c: NearCoinCtx, coin: unknown): Promise<NearSignedAnswer> {
  if (!NEAR_GATE.open) throw new ProblemError(securityProblems.subwalletRefused(NEAR_CLOSED));
  if (!isAccountId(coin) || coin === REF_EXCHANGE_ID) throw new ProblemError(securityProblems.requestInvalid("the coin is a NEAR coin's contract"));
  return signed(c, async (chain, wallet, pk) => {
    const b = await buildRheaClaim(chain, wallet, pk, coin);
    // the copy review's words (7 Nov): the sheet, when the caps ask for one (only 1 yocto leaves, so they rarely do)
    const about = `${(Number(b.held) / 10 ** b.decimals).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${b.symbol}`;
    return { b, sheet: { title: `Get your ${b.symbol} back from Rhea`, lines: [`Your NEAR wallet gets · about ${about}`, "Rhea sends it to your NEAR wallet."] } };
  }, { rhea: "claim", token: coin });
}

/** A NEAR coin's dollar price from a source the app doesn't control: 1Click's token list, else the relay's market read. */
async function coinUsd(c: NearCoinCtx, coin: string): Promise<number | null> {
  const listed = c.o.tokenPrice ? await c.o.tokenPrice(`nep141:${coin}`).catch(() => null) : null;
  if (listed && listed.usd > 0) return listed.usd;
  const market = c.o.marketPrice ? await c.o.marketPrice("near", coin).catch(() => null) : null;
  return market && market > 0 ? market : null;
}

/**
 * The NEAR coin wallet's one signature at a time (review L6: two asks at once never read the same nonce), each built
 * and checked first, then D143's one rolling cap at the core's own prices (past it, or with no price: the one-tap sheet,
 * naming the coin and the amounts); the key read out only to sign.
 */
function signed(c: NearCoinCtx, build: (chain: Chain, wallet: string, publicKey: string) => Promise<{ b: NearBuilt; sheet: { title: string; lines: string[] }; after?: () => Promise<void> }>, rule: NearTradeAsk | { register: string } | RheaRule): Promise<NearSignedAnswer> {
  return c.turn("near-coin-key", async () => {
    const chain = c.o.near;
    if (!chain) throw new ProblemError(securityProblems.subwalletRefused("NEAR coin trades aren't set up on this phone."));
        const w = await c.find((await c.wallet()).id);
    let made: Awaited<ReturnType<typeof build>>;
    try {
      made = await build(chain, w.address, nearKeyOf(w.address));
    } catch (e) {
      if (e instanceof NearTradeRefused) {
        if (e.code === "near.rhea.room" || e.code === "near.rhea.unregistered") throw new ProblemError(nearRheaFirst(e.code === "near.rhea.room" ? "room" : "ready"));
        if (e.code) throw new ProblemError(nearRegisterFirst(e.code === "near.wnear.unregistered" ? WNEAR : "rhea" in rule && rule.rhea === "claim" ? rule.token : (rule as NearTradeAsk).coin));
        throw new ProblemError(securityProblems.subwalletRefused(e.message));
      }
      throw e;
    }
    const asks = await c.capGate(made.b.usd);
    if (asks) {
      const sheet: PlainWords = { title: made.sheet.title, lines: made.sheet.lines, warnings: [{ kind: "effect-unknown", text: asks }], effect: [], tap: true };
      if (!(await c.o.approve(sheet).catch(() => false))) return { declined: true as const };
    }
    // two asks back to back read the same nonce on chain (neither is sent yet): the next one this core signs is always
    // past the last it signed, so both can land (review L6)
    const last = c.nonces.get(w.address) ?? 0n;
    if (made.b.tx.nonce <= last) made.b.tx.nonce = last + 1n;
    const secret = await c.secret(w);
    try {
      // a trade's coin-out balance at its build block (two nodes), for Trade's M3 fallback, with the bytes
      const signed = { ...signNearBuilt(made.b, w.address, secret, rule), signerId: w.address, ...(made.b.beforeOut !== undefined ? { beforeOut: made.b.beforeOut, atHeight: made.b.block.height } : {}) };
      c.nonces.set(w.address, made.b.tx.nonce);
      await made.after?.();
      return signed;
    } catch (e) {
      if (e instanceof NearTradeRefused) throw new ProblemError(securityProblems.subwalletRefused(e.message));
      throw e;
    }
  });
}

/**
 * The NEAR coin wallet, read at a block two nodes agree on (Home's own row, 3 Nov): its address, its NEAR (all of it,
 * and what it can move: past its storage and the gas it keeps), its wNEAR, and their dollars at the core's own price.
 * No account yet: all 0. Read only; open or shut.
 */
export async function nearCoinBalance(c: NearCoinCtx): Promise<{ id: string; address: string; label: string; nearYocto: string; wnearYocto: string; rheaYocto: string; roomYocto: string; movableYocto: string; usd: number | null; open: boolean; line?: string }> {
  const w = await c.wallet();
  const chain = c.o.near;
  const zero = { id: w.id, address: w.address, label: NEAR_COIN_WALLET, nearYocto: "0", wnearYocto: "0", rheaYocto: "0", roomYocto: "0", movableYocto: "0", usd: 0, open: NEAR_GATE.open };
  if (!chain) return zero;
  const block = await chain.commonBlock();
  const [acc, wnear, rhea, price] = await Promise.all([chain.account(w.address, block), chain.view(WNEAR, "ft_balance_of", { account_id: w.address }, block), rheaAccountAt(chain, w.address, block), c.priceSoon("near")]);
  if (!acc) return zero;
  const wn = typeof wnear === "string" && /^\d{1,39}$/.test(wnear) ? BigInt(wnear) : 0n;
  // its NEAR ready for trading, in its own account in Rhea (near-rhea.ts): the wallet's all the same, never missing
  const rh = rhea.deposits[WNEAR] ?? 0n;
  // its room in Rhea, the unused part: the wallet's too, back on Put away (outOfRhea)
  const room = rhea.roomYocto;
  const locked = acc.storageBytes * 10n ** 19n + NEAR_GAS_KEEP;
  const movable = (acc.balanceYocto > locked ? acc.balanceYocto - locked : 0n) + wn + rh + room;
  const total = acc.balanceYocto + wn + rh + room;
  return { ...zero, nearYocto: acc.balanceYocto.toString(), wnearYocto: wn.toString(), rheaYocto: rh.toString(), roomYocto: room.toString(), movableYocto: movable.toString(), usd: price ? (Number(total / 10n ** 18n) / 1e6) * price : null, ...(rh > 0n ? { line: RHEA_HELD_LINE } : {}) };
}

/** The yoctos a Put away's Rhea steps attach (1 each): the withdraw when NEAR sits on Rhea, the room back when it has room. */
const rheaYoctos = (rhea: { deposits: Record<string, bigint>; roomYocto: bigint }): bigint => ((rhea.deposits[WNEAR] ?? 0n) > 0n ? 1n : 0n) + (rhea.roomYocto > 0n ? 1n : 0n);

/** What the NEAR coin wallet can move out: its NEAR past its storage and the gas it keeps, and its wNEAR. */
export async function nearSpendable(c: NearCoinCtx): Promise<bigint> {
  const chain = c.o.near;
  if (!chain) return 0n;
  const w = await c.wallet();
  const block = await chain.commonBlock();
  const [acc, wnear, rhea] = await Promise.all([chain.account(w.address, block), chain.view(WNEAR, "ft_balance_of", { account_id: w.address }, block), rheaAccountAt(chain, w.address, block)]);
  if (!acc) return 0n;
  // its storage, the gas it keeps, room for two wNEAR accounts a Put away may open (its own, the deposit address's) and
  // the 1 yoctoNEAR its ft_transfer attaches (and the 1 each Rhea step of a Put away attaches: withdraw, room back)
  const locked = acc.storageBytes * 10n ** 19n + NEAR_GAS_KEEP + 2n * NEAR_STORAGE_MAX_YOCTO + 1n + rheaYoctos(rhea);
  const free = acc.balanceYocto > locked ? acc.balanceYocto - locked : 0n;
  // its NEAR ready for trading in Rhea moves too, and its room there once that is all out: Put away takes them first (nearPay)
  return free + (typeof wnear === "string" && /^\d{1,39}$/.test(wnear) ? BigInt(wnear) : 0n) + (rhea.deposits[WNEAR] ?? 0n) + rhea.roomYocto;
}

/**
 * The NEAR coin wallet's payment into a confidential 1Click quote for nep141:wrap.near (Put away; re-review H, 3 Nov):
 * paid as wNEAR, never native NEAR, as Wallet's convert pays a NEAR deposit address (moves.ts nearAsWnearTo): one
 * transaction to wrap.near, built here (never an app's bytes): the wallet's own wNEAR account and the deposit address's
 * when either has none (each at wrap.near's 0.00125 NEAR), near_deposit of only what isn't wNEAR yet, then ft_transfer
 * of exactly `amount` to `to`, a 64-hex one-time address 1Click gave this very move (nearIn checks the quote first).
 * Signed in the NEAR coin wallet's one turn, its nonce past the last this core signed. The hash once two nodes have it.
 */
export function nearPay(c: NearCoinCtx, to: string, amount: bigint): Promise<string> {
  return c.turn("near-coin-key", async () => {
    const chain = c.o.near;
    if (!chain) throw new ProblemError(securityProblems.subwalletRefused("NEAR coin trades aren't set up on this phone."));
    if (!/^[0-9a-f]{64}$/.test(to)) throw new ProblemError(securityProblems.subwalletRefused("It pays only a one-time NEAR address."));
    const w = await c.find((await c.wallet()).id);
    const publicKey = nearKeyOf(w.address);
    // its NEAR ready for trading comes out of Rhea first, as wNEAR, when the wallet itself holds less (near-rhea.ts)
    await outOfRhea(c, chain, w, publicKey, amount);
    const block = await chain.commonBlock();
    const [acc, key, wnear, selfReg, toReg] = await Promise.all([
      chain.account(w.address, block),
      chain.accessKey(w.address, publicKey, block),
      chain.view(WNEAR, "ft_balance_of", { account_id: w.address }, block),
      chain.view(WNEAR, "storage_balance_of", { account_id: w.address }, block),
      chain.view(WNEAR, "storage_balance_of", { account_id: to }, block),
    ]);
    if (!acc || !key || key.permission.kind !== "full") throw new ProblemError(securityProblems.subwalletRefused("The NEAR coin wallet has no NEAR yet."));
    const held = typeof wnear === "string" && /^\d{1,39}$/.test(wnear) ? BigInt(wnear) : 0n;
    const wrap = amount > held ? amount - held : 0n;
    const storage = (account_id: string): CoreAction => ({ kind: "call", method: "storage_deposit", args: utf8(JSON.stringify({ account_id, registration_only: true })), gas: 10_000_000_000_000n, depositYocto: NEAR_STORAGE_MAX_YOCTO });
    const actions: CoreAction[] = [
      ...(selfReg === null ? [storage(w.address)] : []),
      ...(toReg === null ? [storage(to)] : []),
      ...(wrap > 0n ? [{ kind: "call" as const, method: "near_deposit", args: utf8("{}"), gas: 10_000_000_000_000n, depositYocto: wrap }] : []),
      { kind: "call", method: "ft_transfer", args: utf8(JSON.stringify({ receiver_id: to, amount: amount.toString() })), gas: 30_000_000_000_000n, depositYocto: 1n },
    ];
    // what it attaches never takes the wallet under its storage and the gas it keeps
    const attached = actions.reduce((n, a) => n + (a.kind === "call" ? a.depositYocto : 0n), 0n);
    if (acc.balanceYocto < acc.storageBytes * 10n ** 19n + NEAR_GAS_KEEP + attached) throw new ProblemError(securityProblems.subwalletRefused("Your NEAR coin wallet doesn't have that much to move."));
    const last = c.nonces.get(w.address) ?? 0n;
    const nonce = key.nonce + 1n > last ? key.nonce + 1n : last + 1n;
    const tx: UnsignedTx = { signerId: w.address, publicKey, nonce, receiverId: WNEAR, blockHash: block.hash, actions };
    const bytes = serialize(tx);
    if (!sameTransaction(decodeTransaction(bytes), tx)) throw new ProblemError(securityProblems.subwalletRefused("ZeroFee can't read every part of it."));
    const secret = await c.secret(w);
    if (nearPublicKey(secret) !== publicKey) throw new ProblemError(securityProblems.subwalletRefused("This wallet's key doesn't match it."));
    const hash = txHashOf(bytes);
    c.nonces.set(w.address, nonce);
    const r = await chain.send(signedBase64(tx, ed25519.sign(sha256(bytes), secret)), hash, w.address);
    if (r.status !== "done") throw new ProblemError(securityProblems.subwalletRefused("NEAR didn't take it."));
    return hash;
  });
}

/**
 * Put away's first step when the wallet's NEAR is ready for trading (near-rhea.ts): what the wallet itself lacks of
 * `amount` (its free NEAR and its wNEAR), up to all its wNEAR in Rhea, withdrawn back to it as wNEAR and sent here (two
 * nodes). Then the payment reads the wallet afresh. Inside the wallet's one turn only.
 */
async function outOfRhea(c: NearCoinCtx, chain: Chain, w: { id: string; address: string }, publicKey: string, amount: bigint): Promise<void> {
  const block = await chain.commonBlock();
  const [acc, wnear, rhea] = await Promise.all([chain.account(w.address, block), chain.view(WNEAR, "ft_balance_of", { account_id: w.address }, block), rheaAccountAt(chain, w.address, block)]);
  const inRhea = rhea.deposits[WNEAR] ?? 0n;
  if (!acc || (inRhea === 0n && rhea.roomYocto === 0n)) return;
  const locked = acc.storageBytes * 10n ** 19n + NEAR_GAS_KEEP + 2n * NEAR_STORAGE_MAX_YOCTO + 1n + rheaYoctos(rhea);
  const have =(acc.balanceYocto > locked ? acc.balanceYocto - locked : 0n) + (typeof wnear === "string" && /^\d{1,39}$/.test(wnear) ? BigInt(wnear) : 0n);
  if (have >= amount) return;
  const take = amount - have < inRhea ? amount - have : inRhea;
  if (take > 0n) {
    let b: NearBuilt;
    try { b = await buildRheaWithdraw(chain, w.address, publicKey, take); } catch (e) {
      if (e instanceof NearTradeRefused) throw new ProblemError(securityProblems.subwalletRefused(e.message));
      throw e;
    }
    const r = await sendBuilt(c, chain, w.address, await c.secret(w), b, { rhea: "withdraw", amount: take });
    if (r.partly) throw new ProblemError(securityProblems.subwalletRefused("Rhea didn't send your NEAR back yet. It's still yours in Rhea."));
  }
  // all its NEAR is out of Rhea now: its room there (up to 0.05 NEAR, the unused part) comes back too, Ref's own
  // storage_withdraw (the audit's SHOULD, 5 Nov); a trade later readies the room again before its tap
  if (take === inRhea) {
    const back = await buildRheaRoomBack(chain, w.address, publicKey);
    if (back) await sendBuilt(c, chain, w.address, await c.secret(w), back.b, { rhea: "roomBack", amount: back.amount });
  }
}
