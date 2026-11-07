// Home's Send FROM the Safe (the Home plan §1.3, E4; D128): the Safe's coin into the pocket (route B, the core's own quote,
// `through`), then the pocket's payment to ANY address on any chain 1Click pays, as one saved job. Loaded with its first
// use, never in Home's first load (speed budget); the ledger hands over the pieces it needs.
//
// Order, so nothing can rest half-way by surprise: leg 2 is priced and signed FIRST (the core's sheet for the pocket's
// payment, joined to leg 1 by inDeposit: it pays only what leg 1 promises), then leg 1 is signed (the Safe's own sheet). A
// No at either sends nothing. The job (leg 2's signature included) is kept on this device and followed: leg 2 is handed
// to 1Click only after 1Click says leg 1 landed with enough; back, short or slow, the money is in the person's private
// balance on NEAR, said in a line. A held leg 1 (the Safe's safety wait) keeps the job until the hold ends.
import { ProblemError } from "@zerofee/core/problem";
import { payeeAsk } from "./payee-ask.ts";
import { fromUnits, toUnits } from "./amount.ts";
import { QuoteRefused, type Apis, type QuoteRequest } from "./apis.ts";
import type { Catalogue, Coin } from "./catalogue.ts";
import { payeeTakes, pocketMaker, sendTarget } from "./send-target.ts";
import { LANDS_AS } from "./send-to.ts";
import type { Movement, Payee } from "./types.ts";
import { PartWent, pocketPartWent, walletProblems } from "./wallet-problems.ts";
import { SEND_QUOTE_MS, deadlineOf, type SendJob, type SendJobs } from "./send-job.ts";
import { askedShare, inflowUp, maxSend } from "@zerofee/core/inflow-grid";
import { fillStepUsd, PRIVATE_BUFFER_USD } from "@zerofee/core/private-route";
import type { Problem } from "@zerofee/core/problem";

type Caller = string;
interface Plan { cat: Catalogue; coin: Coin; units: bigint; accountId: string; pocket: string; route?: string }
type Signed = { txHash: string; explorerUrls: string[]; hold?: Movement["held"]; unsent?: number };
type PrivateInQuote = { depositAddress: string; amountIn: string; minAmountOut: string; statusTag?: string };
/** The Safe's sheet marker (to-private.ts payIntoPocket): true, a Move's fill (its legs); "send", a Send to someone
 *  else (the payout joined to it: the payee in full and what they get, core intents.ts sendBlock); false, none. A Move's
 *  fill may carry its whole Move (`plan`: each part's units, TxRequest.movePlan) and say it is a Swap (`swap`,
 *  TxRequest.moveSwap): words only, the core checks both against what it built (the copy review's (a) and (c), 7 Nov). */
export type FillMark = boolean | "send" | MoveMark;
export interface MoveMark { plan?: string[]; swap?: true }
/** What a Send's fill may leave in Private (QA's MUST 2, 5 Nov): core private-route.ts, shared with the Sim. */
export { PRIVATE_BUFFER_USD };

export interface SafeSendDeps {
  notForChild: () => Promise<void>;
  privateQuotes: string | undefined;
  pocketOf: () => Promise<{ id: string; address: string } | null>;
  /** the core, as Wallet (Send from the Safe is Wallet's own): the pocket's balance, its quote in, its payment */
  core: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  catalogue: () => Promise<Catalogue>;
  /** route B is open (CONVERT_ROUTES.nearOrigin): the Safe's own part can go */
  routeOpen: () => boolean;
  /** route B's plan for this coin and amount (refused while route B is off, unless `open`: this one call's fill, the
   *  Move route's own switch); `through`: no pot cap. */
  privatePlan: (tokenId: string, amount: string, ready: boolean, through: boolean, open?: boolean) => Promise<Plan>;
  /** leg 1 on the Safe's own sheet (signAll): exactly plan.units to 1Click's NEAR address. */
  payIntoPocket: (plan: never, tokenId: string, depositAddress: string, why: string, caller: Caller, mark?: FillMark, since?: number, job?: string) => Promise<Signed>;
  /** the coin as 1Click names it ("near" is quoted as wNEAR). */
  originAsset: (tokenId: string) => string;
  privatePayRequest: (o: { fromTokenId: string; toTokenId: string; to: Payee; inUnits?: bigint; pocket: string; dry: boolean; deadlineMs?: number }) => QuoteRequest;
  askPrivate: (r: QuoteRequest) => Promise<{ quote: { amountIn: string; amountOut: string; minAmountOut?: string; depositAddress?: string }; zerofeeStatusTag?: string }>;
  apis: Apis;
  relayed: string | undefined;
  remember: (m: Movement) => Promise<void>;
  emit: (event: string, payload: unknown) => void;
  /** a held leg 1: how the ledger's hold machinery follows it once it ends (its next is "job": moving, never done). */
  followHeld: (movementId: string, signer: string, unsent?: number) => Promise<void>;
  iso: () => string;
  now: () => number;
  label: (v: unknown) => string | undefined;
  payeeText: (to: Payee) => string;
  text: (v: unknown) => string;
  /** The saved Sends (send-job.ts): one per Send, followed to its end, a restart too. */
  jobs: () => Promise<SendJobs>;
  /** Is `accountId` set up on the coin's own NEAR contract (storage_balance_of)? (b): read before any price. */
  registered?: (contract: string, accountId: string) => Promise<boolean>;
}

/** One call's own way through (never route B for everyone): `fillOpen`, the Safe → Private fill opens for this call only
 *  (VITE_SAFE_FILL_OPEN, safe-fill-open.ts), rounded up to a whole step (fillStepUsd) with the extra kept in Private;
 *  `short`, the refusal said when Private is short and the fill is closed (before anything is signed); `ownWallet`, a Move's
 *  leg to the person's own wallet (private-move.ts): a Send's same-coin exact-pay check (QA's (a)) is for a payee. */
export interface SafeSendRoute {
  fillOpen?: boolean; short?: (have: bigint, need: bigint) => Problem; ownWallet?: boolean;
  /** A site's top-up (QA): Private short, the fill pays it whole, so ONE fill then ONE exit; Private's own share
   *  stays (never Private's part plus the fill's part, two exits). Covered by Private: one exit, no fill, as before. */
  whole?: boolean;
  /** A Move's whole plan (private-move.ts: every part's units in this coin) and whether it is a Swap: carried to the
   *  Safe's sheet only (FillMark), never into what is signed. */
  plan?: string[]; swap?: true;
  /** The Move's or Swap's own key (private-move.ts `job`): its Safe sheet's request carries it (TxRequest.job), so the
   *  core's approval.asked names this job (the audit's MUST, 7 Nov). A label, never signed. */
  job?: string;
}

/** The payout's quoted least in the payee's coin (its minAmountOut: the quoted out less slippage; none: its amountOut),
 *  so a Move's tick waits for a read that shows it (audit, 5 Nov; trade float-private chainReads). */
const leastOf = (q: { amountOut: string; minAmountOut?: string }): { minOut: string } | Record<string, never> => {
  const n = /^\d{1,40}$/.test(q.minAmountOut ?? "") ? q.minAmountOut! : q.amountOut;
  return /^\d{1,40}$/.test(n) ? { minOut: n } : {};
};

/** the audit's R2 (6 Nov): may the fill pay a Move whole, Private's own share staying in Private? Only when Private's share plus
 *  the fill's whole step over the payout stays at or under PRIVATE_BUFFER_USD (a table: one-faceid.test.ts). No price:
 *  no fold. */
export function foldsWhole(share: bigint, wanted: bigint, coin: Pick<Coin, "symbol" | "decimals" | "priceUsd">): boolean {
  const px = /^USD[CT]$/i.test(coin.symbol) ? 1 : Number(coin.priceUsd);
  if (!(px > 0) || wanted <= 0n) return false;
  const scale = 10 ** coin.decimals;
  const usd = (Number(wanted) / scale) * px;
  const extra = Math.max(0, fillStepUsd(usd) - usd);
  return (Number(share) / scale) * px + extra <= PRIVATE_BUFFER_USD;
}

/** A Move's fill marker: its plan and Swap marker when the call carried them, else a plain true. */
const moveMark = (route: SafeSendRoute): FillMark => (route.plan?.length || route.swap ? { ...(route.plan?.length ? { plan: [...route.plan] } : {}), ...(route.swap ? { swap: true as const } : {}) } : true);

export function createSafeSend(x: SafeSendDeps) {
  const { apis, relayed, remember, emit, iso, text } = x;
  const ensurePocket = pocketMaker(x);

  /**
   * `p`: { tokenId (a Safe coin: the Safe's own id, "near" for NEAR on the account, or the pocket's nep141 id), amount
   * (that coin, decimal: exactly this leaves), to: Payee (send-target.ts), toTokenId? (LANDS_AS's by default), label? }.
   * Home counts the pocket's coins under the Safe, so the coin may sit partly in the pocket: each part is paid from where
   * it really is, the pocket's share FIRST (straight out, its own sheet), then the rest from the Safe (E4: its own two
   * sheets). Answers Movement[], one per part in that order: the pocket's ("pay:…", moving), then the Safe's
   * ("safe-send:…", moving, or waiting while the Safe's safety wait holds it). While the Safe's part can't go (route B off,
   * the real core today) only the pocket's share can: more is refused before any sheet, saying the most that can go.
   * `upTo` (decimal, the most the coin can send, the pocket's share included): audit H1 (fix #3), the Safe's leg 1 brings
   * its part rounded UP to the inflow grid when the Safe holds that much (core inflow-grid.ts), the payee gets exactly
   * what was asked, and the rest stays in the private balance, shown there. No `upTo`: exactly as asked, as before.
   */
  /** What of this coin (the pocket's id) Private can pay now: its balance less what open Sends still need from it. */
  async function pocketShare(pocketCoin: string): Promise<bigint> {
    const inPocket = (await x.pocketOf()) ? BigInt((await x.core<{ tokenId: string; amount: string }[]>("subwallet.private.balances")).find((r) => r.tokenId === pocketCoin)?.amount ?? "0") : 0n;
    const owed = inPocket > 0n ? await (await x.jobs()).reserved(pocketCoin) : 0n;
    return inPocket > owed ? inPocket - owed : 0n;
  }

  async function sendFromSafe(p: Record<string, unknown>, caller: Caller, route: SafeSendRoute = {}): Promise<Movement[]> {
    // the money sheet closed while this got ready: its signature requests answer No (money-closed.ts), each of them
    const since = x.now();
    await x.notForChild();
    // the Send's own key (SendSheet's, or the Move's: route.job): its Safe sheet's request carries it (TxRequest.job)
    const jobKey = route.job ?? (typeof p.job === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(p.job) ? p.job : undefined);
    const tokenId = text(p.tokenId);
    const amount = text(p.amount).trim();
    const pocketCoin = x.originAsset(tokenId);
    const cat = await x.catalogue();
    const coin = cat.coin(pocketCoin);
    if (!coin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const wanted = toUnits(amount, coin.decimals);
    if (wanted === null || wanted <= 0n) throw new ProblemError(walletProblems.amountInvalid());
    const { to, toTokenId, toCoin } = sendTarget(cat, p.to, p.toTokenId);
    // (b): a NEAR account that can't take this coin is refused here, before any price or sheet
    await payeeTakes(to, { tokenId: toTokenId, symbol: toCoin.symbol }, x.registered);
    const symbol = coin.symbol;
    // the pocket's share of this coin, as the core reads it there (no pocket yet: none), less what open Sends still need
    // from it (security review L5: a wallet's Send whose first step landed there and whose payment hasn't gone yet)
    const share = await pocketShare(pocketCoin);
    // route B for everyone (closed today), or this call's own fill (the Move route's switch, and Send's); nothing else opens it
    const fill = !x.routeOpen() && route.fillOpen === true;
    // a site's top-up Private can't cover alone: the fill pays it whole (one fill, one exit), Private's share stays.
    // The one Face ID (bug report, 6 Nov): a Move whose Private share pays part folds the same way, so the Safe's one sheet
    // is the action's only ask, while Private then stays under its buffer (the audit's R2: foldsWhole); past it, Private's own
    // part pays first as before (no Face ID: a hot key), then the Safe's one sheet
    const fold = route.ownWallet === true && share > 0n && foldsWhole(share, wanted, coin);
    const whole = (route.whole === true || fold) && p.upTo === undefined && wanted > share && (fill || x.routeOpen());
    // a Send's fill (product decision, 5 Nov: Send from the Safe, through NEAR Confidential): Private short, the Safe pays the
    // WHOLE Send through Private, so it is ONE payout and ONE sheet (QA's MUST 1: the Safe's Face ID says the
    // payee in full and what they get); Private's own share stays where it is. Private covers it: Private pays, as before.
    const sendFill = fill && route.ownWallet !== true && wanted > share;
    const fromPocket = whole || sendFill ? 0n : wanted < share ? wanted : share;
    // the Safe's part read before any sheet (its route, its balance), so a short Safe stops here, with nothing signed;
    // H1: on the inflow grid when the Safe holds it. Max (all the coin): leg 1 brings the grid amount under what the Safe
    // holds, the payment keeps the grid's gap, the rest stays in the private balance and the dust in the Safe (privacy
    // audit, 4 Nov; core maxSend)
    const upTo = p.upTo === undefined ? undefined : toUnits(text(p.upTo), coin.decimals) ?? undefined;
    const max = upTo !== undefined && wanted >= upTo && upTo > fromPocket ? maxSend(upTo, fromPocket) : null;
    const rest = max ? max.asked : wanted - fromPocket;
    // Max: the pocket pays at most what keeps the whole payout under the gap (core maxSend); the rest stays in Private
    const pocketPart = max ? max.pocketPays : fromPocket;
    if (rest > 0n && !x.routeOpen() && !fill) {
      if (route.short) throw new ProblemError(route.short(share, wanted));
      if (fromPocket === 0n) throw new ProblemError(walletProblems.privateUnavailable());
      throw new ProblemError(walletProblems.safeSendMost(fromUnits(share, coin.decimals), symbol));
    }
    // the pocket is made before the plan reads it (QA's lap, 5 Nov: a fresh account's first Move was refused "Your
    // private balance isn't set up on this phone yet"): it is the lane every payment travels (D128), a key from the
    // backup words with nothing on chain, so the Move sets it up on the way, as a Send does
    const pocket = await ensurePocket();
    const gridded = max ? max.inflow : rest > 0n && upTo !== undefined && upTo > fromPocket ? inflowUp(rest, upTo - fromPocket) : rest;
    // the fill (QA's SHOULD): a whole step over the payout, the extra kept in Private; a Safe that can't
    // cover the step fills the grid amount above instead (still over the payout when the Safe holds it)
    const stepped = fill && rest > 0n && !max ? fillUnits(rest, coin, share) : null;
    const plan = rest > 0n ? await (stepped ? x.privatePlan(tokenId, fromUnits(stepped, coin.decimals), true, true, true).catch((e) => {
      if (e instanceof ProblemError && e.problem.code === "ledger.balance.low") return x.privatePlan(tokenId, fromUnits(gridded, coin.decimals), true, true, true);
      throw e;
    }) : x.privatePlan(tokenId, fromUnits(gridded, coin.decimals), true, true, fill)) : null;
    if (plan && plan.pocket !== pocket.address) throw new ProblemError(walletProblems.privateUnavailable());
    const named = x.label(p.label);
    const why = named ?? `Send ${max ? fromUnits(pocketPart + rest, coin.decimals) : amount} ${symbol} to ${x.payeeText(to)}`;
    const out: Movement[] = [];
    // M9 (the audit's audit): Private pays the whole Send (no Safe part follows): its signature is the last, so it carries the Send's key
    if (pocketPart > 0n) out.push(await payFromPocket(pocket, pocketCoin, pocketPart, coin, to, toTokenId, why, named, caller, route.ownWallet === true, undefined, !plan && route.ownWallet !== true ? jobKey : undefined));
    if (plan) {
      // the Move's fill (QA, 5 Nov): its one Safe sheet says Private's leg and the Safe's to this wallet, and
      // their sum, from the core's own figures (the bytes; its record of the pocket's share above): a marker, no figures
      try {
        out.push(await fromSafe(plan, tokenId, fromUnits(rest, coin.decimals), rest, symbol, pocket, to, toTokenId, why, named, caller, route.ownWallet === true ? (fill && !max ? moveMark(route) : false) : "send", since, jobKey));
      } catch (e) {
        // the pocket's part already went: it is in Activity, and the line says so with why the rest didn't
        // A No on the Safe's sheet here is not "nothing was sent" (the Send sheet takes a ".declined" code as nothing
        // moved, and drops its job): it is said as a part that went
        // a plain throw too: it proves nothing about the Safe's part, and Private's part went all the same
        if (out.length) throw new PartWent(pocketPartWent(e instanceof ProblemError ? e.problem : walletProblems.unexpectedMoney(e instanceof Error ? e.message : String(e))), out);
        throw e;
      }
    }
    return out;
  }

  /** `rest` (the coin's units) as a whole fill step in dollars (fillStepUsd), at the catalogue's price; none: no price, or
   *  Private's share (`kept`, units) plus the step's extra would pass PRIVATE_BUFFER_USD. */
  function fillUnits(rest: bigint, coin: Coin, kept = 0n): bigint | null {
    // a dollar coin at $1 each (the step is in dollars); any other at its price
    const px = /^USD[CT]$/i.test(coin.symbol) ? 1 : Number(coin.priceUsd);
    if (!(px > 0)) return null;
    const scale = 10 ** coin.decimals;
    const usd = (Number(rest) / scale) * px;
    const units = BigInt(Math.ceil((fillStepUsd(usd) / px) * scale));
    if (((Number(kept) + Number(units - rest)) / scale) * px > PRIVATE_BUFFER_USD) return null;
    return units > rest ? units : null;
  }

  /** The pocket's own share, straight out: EXACT_INPUT of exactly that, the core's Send sheet (no pot cap), submitted. */
  async function payFromPocket(pocket: { id: string; address: string }, pocketCoin: string, units: bigint, coin: Coin, to: Payee, toTokenId: string, why: string, named: string | undefined, caller: Caller, ownWallet = false, moveJob?: string, sendJob?: string): Promise<Movement> {
    const req = x.privatePayRequest({ fromTokenId: pocketCoin, toTokenId, to, inUnits: units, pocket: pocket.address, dry: false });
    const real = await x.askPrivate(req);
    const depositAddress = real.quote.depositAddress;
    if (!depositAddress || BigInt(real.quote.amountIn) !== units || !(BigInt(real.quote.amountOut || "0") > 0n)) throw new ProblemError(walletProblems.quoteExpired());
    // QA's (a): the same coin in and out (USDC to USDC) pays exactly what was typed, by 1Click's own figure;
    // (c) NEAR (wrapped) as before
    if (!ownWallet && pocketCoin === toTokenId && toTokenId !== LANDS_AS.near.tokenId && BigInt(real.quote.amountOut) !== units) throw new ProblemError(walletProblems.sameCoinShort(coin.symbol));
    const intent = await generate(pocket.address, depositAddress);
    const signed = await x.core<{ signedData?: unknown; declined?: true }>("subwallet.privatePay", { id: pocket.id, depositAddress, intent: { payload: intent.payload }, why, ...(real.zerofeeStatusTag ? { statusTag: real.zerofeeStatusTag } : {}), send: true, payee: payeeAsk(req), ...(moveJob ? { job: moveJob } : {}), ...(sendJob ? { sendJob } : {}) });
    if (signed.declined || !signed.signedData) throw new ProblemError(walletProblems.declined());
    const at = iso();
    const movement: Movement = {
      id: `pocket-send:${depositAddress.slice(0, 24)}`, kind: "pay", status: "moving", from: pocketCoin, to: x.payeeText(to), toChain: to.kind === "chain" ? to.chain : "near", amount: fromUnits(units, coin.decimals),
      startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...(named ? { label: named } : {}), caller, private: true, ...leastOf(real.quote),
    };
    // H1: kept (movement and job) before it is handed over; a submit that errors is "may have gone", followed by 1Click's
    // own status of this payment, never a Try again that could pay twice
    const jobs = await x.jobs();
    const job: SendJob = { id: movement.id, outDeposit: depositAddress, ...(real.zerofeeStatusTag ? { outTag: real.zerofeeStatusTag } : {}), signedData: signed.signedData, leg2In: units.toString(), coin: coin.symbol, coinId: pocketCoin, startedAtIso: at };
    await remember(movement);
    await jobs.start(await jobs.hand(job, movement));
    emit("ledger.balancesChanged", {});
    return movement;
  }

  const generate = async (signer: string, depositAddress: string) => {
    try {
      return await apis.generateIntent(relayed!, signer, depositAddress);
    } catch (e) {
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
  };

  /** The Safe's part (E4): leg 2 signed first, joined to leg 1; then leg 1 on the Safe's own sheet; then the saved job. */
  async function fromSafe(plan: Plan, tokenId: string, amount: string, asked: bigint, symbol: string, pocket: { id: string; address: string }, to: Payee, toTokenId: string, why: string, named: string | undefined, caller: Caller, mark: FillMark = false, since?: number, jobKey?: string): Promise<Movement> {
    const fromId = x.originAsset(tokenId);
    // leg 1: the core's own quote (through: the money passes through), exactly plan.units in
    // the Safe's NEAR Intents balance pays it inside intents.near (Move's fill: one mt_transfer, one bridge leg in all)
    const leg1 = await x.core<PrivateInQuote>("subwallet.private.quoteIn", { tokenId: fromId, amount: plan.units.toString(), through: true, ...(plan.route === "intents" ? { intents: true } : {}) });
    const fair = /^[0-9a-f]{64}$/.test(String(leg1.depositAddress)) && /^\d{1,30}$/.test(String(leg1.amountIn)) && /^\d{1,30}$/.test(String(leg1.minAmountOut)) && BigInt(leg1.amountIn) === plan.units && BigInt(leg1.minAmountOut) > 0n;
    if (!fair) throw new ProblemError(walletProblems.quoteExpired());
    // leg 2: exactly the asked share of what leg 1 promises to bring (its signed minimum, no trim: D137; all of it off
    // the grid), from the pocket, to the payee as their chain's own coin; the rest stays in the private balance (H1).
    // Its quote lives through leg 1's own time.
    const pays = askedShare(BigInt(leg1.minAmountOut), asked, plan.units);
    const req = x.privatePayRequest({ fromTokenId: fromId, toTokenId, to, inUnits: pays, pocket: pocket.address, dry: false, deadlineMs: SEND_QUOTE_MS });
    const real = await x.askPrivate(req);
    const outDeposit = real.quote.depositAddress;
    if (!outDeposit || BigInt(real.quote.amountIn) !== pays || !(BigInt(real.quote.amountOut || "0") > 0n)) throw new ProblemError(walletProblems.quoteExpired());
    const intent = await generate(pocket.address, outDeposit);
    // the pocket's payment, joined to leg 1 (the core checks the join from 1Click's signed quotes) and HELD by the core for
    // the Safe's one sheet (the audit's c1, 6 Nov): signed only once the chip's signature of leg 1 checks, then kept in the core's
    // sealed vault before leg 1 is sent (the audit's MUST: the job here says `sealed`, never its signature); the core hands it to
    // 1Click itself, only once leg 1 reads SUCCESS with its tag (send-job.ts hand)
    const two = await x.core<{ signedData?: unknown; declined?: true; pair?: { hash: string } }>("subwallet.privatePay", { id: pocket.id, depositAddress: outDeposit, intent: { payload: intent.payload }, why, ...(real.zerofeeStatusTag ? { statusTag: real.zerofeeStatusTag } : {}), inDeposit: leg1.depositAddress, payee: payeeAsk(req), pair: true });
    if (two.declined || (!two.signedData && !two.pair)) throw new ProblemError(walletProblems.declined());
    const at = iso();
    const noted: Movement = {
      id: `safe-send:${outDeposit.slice(0, 24)}`, kind: "pay", status: "moving", from: tokenId, to: x.payeeText(to), toChain: to.kind === "chain" ? to.chain : "near", amount,
      ...(plan.units > asked ? { kept: fromUnits(plan.units - asked, plan.coin.decimals) } : {}),
      startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...(named ? { label: named } : {}), caller, private: true, ...leastOf(real.quote),
    };
    const job: SendJob = { id: noted.id, ...(mark === "send" ? { filled: true as const } : {}), inDeposit: leg1.depositAddress, ...(leg1.statusTag ? { inTag: leg1.statusTag } : {}), outDeposit, ...(real.zerofeeStatusTag ? { outTag: real.zerofeeStatusTag } : {}), ...(two.pair ? { signedData: null, sealed: true as const } : { signedData: two.signedData }), leg2In: String(real.quote.amountIn), coin: symbol, coinId: fromId, startedAtIso: at, ...deadlineOf(intent.payload) };
    // security review L2: the movement and the job are on the device BEFORE leg 1's sheet, so a crash after it leaves
    // both (a restart follows leg 1's own status). A No sends nothing, a sheet that errored hands nothing over: both
    // taken back, and leg 2's signature with them.
    const jobs = await x.jobs();
    await jobs.keep(job, noted);
    let one: Signed;
    try {
      one = await x.payIntoPocket(plan as never, tokenId, leg1.depositAddress, why, caller, mark, since, jobKey);
    } catch (e) {
      await jobs.discard(job.id);
      throw e;
    }
    const movement: Movement = { ...noted, status: one.hold ? "waiting" : "moving", explorerUrls: one.explorerUrls, ...(one.hold ? { held: one.hold } : {}) };
    await remember(movement);
    await jobs.start(job);
    if (one.hold) await x.followHeld(movement.id, plan.accountId, one.unsent);
    emit("ledger.balancesChanged", {});
    return movement;
  }


  /** The Safe's route for a Move's one fill (`units`, as the core's plan sized it), read before anything is paid, so a
   *  Safe that can't cover the fill's step says so while the plan can still be sized down (ledger.balance.low). */
  async function fillRoute(tokenId: string, units: bigint): Promise<Plan> {
    const coin = (await x.catalogue()).coin(x.originAsset(tokenId));
    if (!coin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const pocket = await ensurePocket();
    const plan = await x.privatePlan(tokenId, fromUnits(units, coin.decimals), true, true, true);
    if (plan.pocket !== pocket.address) throw new ProblemError(walletProblems.privateUnavailable());
    return plan;
  }

  /** One part of a Move that Private pays from its own share (the whole part, or its share of the first part the fill
   *  pays): straight out to the person's own wallet, a leg of the Move's kept plan (`job`). No Safe sheet. */
  async function payOwn(o: { tokenId: string; units: bigint; to: unknown; toTokenId?: unknown; label?: unknown; job: string }, caller: Caller): Promise<Movement> {
    await x.notForChild();
    const pocketCoin = x.originAsset(o.tokenId);
    const cat = await x.catalogue();
    const coin = cat.coin(pocketCoin);
    if (!coin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const { to, toTokenId, toCoin } = sendTarget(cat, o.to, o.toTokenId);
    await payeeTakes(to, { tokenId: toTokenId, symbol: toCoin.symbol }, x.registered);
    const named = x.label(o.label);
    const why = named ?? `Send ${fromUnits(o.units, coin.decimals)} ${coin.symbol} to ${x.payeeText(to)}`;
    return payFromPocket(await ensurePocket(), pocketCoin, o.units, coin, to, toTokenId, why, named, caller, true, o.job);
  }

  /**
   * A Move's ONE fill (the audit's ruling, 7 Nov, over the owner's "prompt, success, prompt"): one leg 1 from the Safe into Private
   * for every part the plan's fill pays (`legs`, each its wallet and its units, the smallest first), then each part's leg
   * 2 (Private's payment to that wallet, its share of what the fill promises), all held by the core for the Safe's ONE
   * sheet: one approval, one Face ID. The core signs every leg 2 only after the chip's signature checks, and hands each to
   * 1Click only once leg 1 reads SUCCESS with its tag, the legs that fit what landed, smallest first (subwallets pairHand;
   * the follower's own check, send-job fits). Answers one movement per leg, in the order asked. Nothing is sent on a No.
   */
  async function fillMove(o: { tokenId: string; route: Plan; legs: { to: unknown; toTokenId?: unknown; units: bigint }[]; label?: unknown; job: string; plan?: string[]; swap?: true }, caller: Caller): Promise<Movement[]> {
    const since = x.now();
    await x.notForChild();
    const fromId = x.originAsset(o.tokenId);
    const cat = await x.catalogue();
    const coin = cat.coin(fromId);
    if (!coin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const targets = o.legs.map((l) => sendTarget(cat, l.to, l.toTokenId));
    for (const t of targets) await payeeTakes(t.to, { tokenId: t.toTokenId, symbol: t.toCoin.symbol }, x.registered);
    const pocket = await ensurePocket();
    const route = o.route;
    if (route.pocket !== pocket.address) throw new ProblemError(walletProblems.privateUnavailable());
    const sum = o.legs.reduce((n, l) => n + l.units, 0n);
    const named = x.label(o.label);
    const why = named ?? `Move ${fromUnits(sum, coin.decimals)} ${coin.symbol}`;
    // leg 1: the core's own quote of exactly the plan's one fill (the core refuses any other amount for this Move)
    const leg1 = await x.core<PrivateInQuote>("subwallet.private.quoteIn", { tokenId: fromId, amount: route.units.toString(), through: true, ...(route.route === "intents" ? { intents: true } : {}), job: o.job });
    const fair = /^[0-9a-f]{64}$/.test(String(leg1.depositAddress)) && /^\d{1,30}$/.test(String(leg1.amountIn)) && /^\d{1,30}$/.test(String(leg1.minAmountOut)) && BigInt(leg1.amountIn) === route.units && BigInt(leg1.minAmountOut) > 0n;
    if (!fair) throw new ProblemError(walletProblems.quoteExpired());
    // each leg 2: its share of what leg 1 promises (its signed minimum), so their sum never passes it
    const pays = o.legs.map((l) => askedShare(BigInt(leg1.minAmountOut), l.units, route.units));
    const jobs = await x.jobs();
    const made: { job: SendJob; noted: Movement }[] = [];
    const at = iso();
    let one: Signed;
    try {
      for (const [i, l] of o.legs.entries()) {
        const { to, toTokenId } = targets[i]!;
        const req = x.privatePayRequest({ fromTokenId: fromId, toTokenId, to, inUnits: pays[i]!, pocket: pocket.address, dry: false, deadlineMs: SEND_QUOTE_MS });
        const real = await x.askPrivate(req);
        const outDeposit = real.quote.depositAddress;
        if (!outDeposit || BigInt(real.quote.amountIn) !== pays[i]! || !(BigInt(real.quote.amountOut || "0") > 0n)) throw new ProblemError(walletProblems.quoteExpired());
        const intent = await generate(pocket.address, outDeposit);
        const two = await x.core<{ signedData?: unknown; declined?: true; pair?: { hash: string } }>("subwallet.privatePay", { id: pocket.id, depositAddress: outDeposit, intent: { payload: intent.payload }, why, ...(real.zerofeeStatusTag ? { statusTag: real.zerofeeStatusTag } : {}), inDeposit: leg1.depositAddress, payee: payeeAsk(req), pair: true, job: o.job });
        if (two.declined || (!two.signedData && !two.pair)) throw new ProblemError(walletProblems.declined());
        const noted: Movement = {
          id: `safe-send:${outDeposit.slice(0, 24)}`, kind: "pay", status: "moving", from: o.tokenId, to: x.payeeText(to), toChain: to.kind === "chain" ? to.chain : "near", amount: fromUnits(l.units, coin.decimals),
          // what the one fill brings over every part stays in Private: said once, on the first leg
          ...(i === 0 && route.units > sum ? { kept: fromUnits(route.units - sum, coin.decimals) } : {}),
          startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...(named ? { label: named } : {}), caller, private: true, ...leastOf(real.quote),
        };
        const job: SendJob = { id: noted.id, inDeposit: leg1.depositAddress, ...(leg1.statusTag ? { inTag: leg1.statusTag } : {}), outDeposit, ...(real.zerofeeStatusTag ? { outTag: real.zerofeeStatusTag } : {}), ...(two.pair ? { signedData: null, sealed: true as const } : { signedData: two.signedData }), leg2In: String(real.quote.amountIn), coin: coin.symbol, coinId: fromId, startedAtIso: at, ...deadlineOf(intent.payload), ...(o.legs.length > 1 ? { fit: { legs: pays.map(String), at: i } } : {}) };
        // L2: each movement and job on the device BEFORE the Safe's one sheet
        await jobs.keep(job, noted);
        made.push({ job, noted });
      }
      one = await x.payIntoPocket(route as never, o.tokenId, leg1.depositAddress, why, caller, o.plan?.length || o.swap ? { ...(o.plan?.length ? { plan: [...o.plan] } : {}), ...(o.swap ? { swap: true as const } : {}) } : true, since, o.job);
    } catch (e) {
      // a No, or a refusal before the sheet: nothing sent; every leg taken back, and the core's held legs with them
      for (const m of made) await jobs.discard(m.job.id);
      await x.core("subwallet.pairEnd", { inDeposit: leg1.depositAddress }).catch(() => undefined);
      throw e;
    }
    const out: Movement[] = [];
    for (const { job, noted } of made) {
      const movement: Movement = { ...noted, status: one.hold ? "waiting" : "moving", explorerUrls: one.explorerUrls, ...(one.hold ? { held: one.hold } : {}) };
      await remember(movement);
      await jobs.start(job);
      if (one.hold) await x.followHeld(movement.id, route.accountId, one.unsent);
      out.push(movement);
    }
    emit("ledger.balancesChanged", {});
    return out;
  }

  return { sendFromSafe, pocketShare, fillRoute, payOwn, fillMove };
}
