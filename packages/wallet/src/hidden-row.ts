// Home's Send FROM a wallet, the SOL wallet or the ETH (RH) wallet (ledger.hiddenFromRow; the Home plan §1.3, E3). Loaded
// with its first use, never in Home's first load (speed budget): the ledger hands over the pieces it needs.
// Leg 1 is the wallet's own coin into the pocket (the core's own quote, `through`: money passing through, D128); leg 2 is
// the pocket's payment to ANY address on any chain 1Click pays, as that chain's own coin (send-to.ts LANDS_AS), the coin
// changed on the way when the chains differ. Both under the core's one Approve; leg 2 is submitted only after 1Click says
// leg 1 landed with enough.
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { quoteDeadline } from "@zerofee/core/quote-deadline";
import { payeeAsk } from "./payee-ask.ts";
import type { PayeeAsk } from "@zerofee/core/private-pocket";
import type { Bridge } from "@zerofee/core/bridge";
import { fromUnits, toUnits } from "./amount.ts";
import { QuoteRefused, type Apis, type QuoteRequest } from "./apis.ts";
import type { Catalogue } from "./catalogue.ts";
import { payeeTakes, pocketMaker, sendTarget } from "./send-target.ts";
import type { Movement, Payee } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";
import { SEND_QUOTE_MS, deadlineOf, type SendJob, type SendJobs } from "./send-job.ts";
import { askedShare, inflowUp, maxSend } from "@zerofee/core/inflow-grid";
import { hiddenCoin } from "@zerofee/core/hidden-coins";

type Caller = string;
export interface HiddenRowDeps {
  myAccount: (ready: boolean) => Promise<unknown>;
  /** The pocket, and what makes it when there's none yet (send-target.ts pocketMaker; D128: the lane, never a place). */
  pocketOf: () => Promise<{ id: string; address: string } | null>;
  notForChild: () => Promise<void>;
  core: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  privateQuotes: string | undefined;
  catalogue: () => Promise<Catalogue>;
  privatePayRequest: (o: { fromTokenId: string; toTokenId: string; to: Payee; outUnits?: bigint; inUnits?: bigint; pocket: string; dry: boolean; deadlineMs?: number }) => QuoteRequest;
  askPrivate: (r: QuoteRequest) => Promise<{ quote: { amountIn: string; amountOut: string; depositAddress?: string }; zerofeeStatusTag?: string }>;
  bridgeFor: (caller: never) => Bridge;
  apis: Apis;
  relayed: string | undefined;
  remember: (m: Movement) => Promise<void>;
  emit: (event: string, payload: unknown) => void;
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
/**
 * QA's MUST (5 Nov): the fee before the tap never tells the relay or 1Click who pays whom. Its dry quotes carry
 * these fixed stand-ins of the right shape, never the person's private balance or their payee: one 64-hex account for
 * the private side, and one valid address per chain Send reaches (a burn address, the system program, or a published
 * test vector; each passes its chain's own check, addresses.ts). The real Send asks with the real ones, after the tap.
 */
export const DRY_POCKET = "f".repeat(64);
export const DRY_PAYEE: Readonly<Record<string, string>> = Object.freeze({
  sol: "11111111111111111111111111111111",
  hood: "0x000000000000000000000000000000000000dEaD", eth: "0x000000000000000000000000000000000000dEaD", base: "0x000000000000000000000000000000000000dEaD",
  bsc: "0x000000000000000000000000000000000000dEaD", arb: "0x000000000000000000000000000000000000dEaD", op: "0x000000000000000000000000000000000000dEaD",
  pol: "0x000000000000000000000000000000000000dEaD", avax: "0x000000000000000000000000000000000000dEaD", gnosis: "0x000000000000000000000000000000000000dEaD",
  bera: "0x000000000000000000000000000000000000dEaD",
  btc: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", ltc: "ltc1qqypqxpq9qcrsszg2pvxq6rs0zqg3yyc5dyg36p", doge: "D596YFweJQuHY1BbjazZYmAbt8jJPbKehC",
  zec: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs", tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  sui: `0x${"0".repeat(63)}1`, aptos: `0x${"0".repeat(63)}1`,
});
type PrivateInQuote = { depositAddress: string; amountIn: string; minAmountOut: string; statusTag?: string };

export function createHiddenRow(x: HiddenRowDeps) {
  const ensurePocket = pocketMaker(x);
  const { myAccount, catalogue, privatePayRequest, askPrivate, apis, relayed, remember, emit, iso, label, payeeText, text } = x;
  const d = { privateQuotes: x.privateQuotes };
  const bridgeFor = (c: Caller) => x.bridgeFor(c as never);
  /** Each wallet's own coin, as 1Click names it, and its word in the lines (the coin is a parameter, never only SOL). */
  const ROW_COINS: Record<string, { id: string; symbol: string }> = { sol: { id: "nep141:sol.omft.near", symbol: "SOL" }, hood: { id: "nep141:hood.omft.near", symbol: "ETH" } };
  /** A request's exact amount (amountOut): leg 1 brings leg 2's price and this much more. */
  const HIDDEN_ROW_ROOM_BPS = 10_300n;
  /**
   * `p`: { chain: "sol" | "hood" (the wallet it leaves), to: Payee (send-target.ts), toTokenId? (LANDS_AS's by default),
   * amountIn (the wallet's coin, decimal: exactly this is paid) OR amountOut (the payee's coin, decimal: exactly this
   * arrives; a request), upTo? (the most the wallet can send, decimal), label? }. Answers the movement.
   *
   * Audit H1 (3 Nov, fix #3): the private balance pays first when it already holds enough of the wallet's coin (one
   * leg, nothing leaves the wallet: "pocket-send:…"). Otherwise leg 1 brings the amount rounded UP to the inflow grid
   * (core inflow-grid.ts: two figures, at least 3 % over) when the wallet holds that much (`upTo`), and the payment takes
   * exactly the asked share of it: the payee gets what was asked, and the rest stays in the private balance, shown there.
   */
  async function hiddenFromRow(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    await myAccount(true);
    if (!d.privateQuotes) throw new ProblemError(walletProblems.privateUnavailable());
    const own = p.chain === "sol" || p.chain === "hood" ? ROW_COINS[p.chain] : undefined;
    if (!own) throw new ProblemError(walletProblems.quoteUnavailable("A private send goes only from your SOL wallet or your Robinhood wallet."));
    // `coin` (the Send review, 5 Nov): a token the wallet holds, by 1Click's id; only a coin the core pins (hidden-coins.ts)
    const token = p.coin === undefined ? null : hiddenCoin(p.coin, p.chain);
    if (p.coin !== undefined && !token) throw new ProblemError(walletProblems.quoteUnavailable("Private can't take this yet."));
    const rowCoin = token ? { id: String(p.coin), symbol: token.symbol } : own;
    const coinIn = rowCoin.id;
    const cat = await catalogue();
    const inCoin = cat.coin(coinIn);
    if (!inCoin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const { to, toTokenId, toCoin } = sendTarget(cat, p.to, p.toTokenId);
    // (b): a NEAR account that can't take this coin (a request's USDC) is refused here, before any price or sheet
    await payeeTakes(to, { tokenId: toTokenId, symbol: toCoin.symbol }, x.registered);
    const exactIn = p.amountIn !== undefined;
    const pocket = await ensurePocket();
    const upTo = p.upTo === undefined ? undefined : toUnits(text(p.upTo), inCoin.decimals) ?? undefined;
    // the private balance already covers it: paid from there, one leg, nothing leaves the wallet (H1, fix #3)
    if (exactIn) {
      const units = toUnits(text(p.amountIn), inCoin.decimals);
      if (units === null || units <= 0n) throw new ProblemError(walletProblems.amountInvalid());
      const rows = await x.core<{ tokenId: string; amount: string }[]>("subwallet.private.balances").catch(() => null);
      const amount = Array.isArray(rows) ? rows.find((r) => r?.tokenId === coinIn)?.amount : undefined;
      const held = typeof amount === "string" && /^\d{1,40}$/.test(amount) ? BigInt(amount) : 0n;
      const owed = held > 0n ? await (await x.jobs()).reserved(coinIn) : 0n;
      if (held - owed >= units) return payFromPocket(pocket, coinIn, units, inCoin, rowCoin.symbol, to, toTokenId, label(p.label), caller);
    }
    let inUnits: bigint;
    /** What the payment is for, of what leg 1 brings (the rest, on the grid, stays in the private balance). */
    let paid: bigint;
    let leg1: PrivateInQuote;
    let real: Awaited<ReturnType<typeof askPrivate>>;
    // H4: what the person asked to pay, from their own payee, for the core's payee pin
    let payee: PayeeAsk;
    const quoteIn = async (units: bigint) => {
      const r = await bridgeFor(caller).call<PrivateInQuote>("subwallet.private.quoteIn", { tokenId: coinIn, amount: units.toString(), outside: true, through: true });
      if ("problem" in r) throw new ProblemError(r.problem);
      return r.ok;
    };
    if (exactIn) {
      // the normal Send: exactly this leaves the wallet; leg 2 pays exactly leg 1's own signed minimum, never more.
      // Max (all the wallet holds): leg 1 brings the grid amount under it, the payment keeps the grid's gap, the rest
      // stays in the private balance and the dust in the wallet (privacy audit, 4 Nov; core maxSend)
      const whole = toUnits(text(p.amountIn), inCoin.decimals)!;
      const max = upTo !== undefined && whole >= upTo ? maxSend(upTo) : null;
      const units = max ? max.asked : whole;
      // H1: leg 1 brings the grid's amount when the wallet holds it, else exactly what was asked (no upTo: as before)
      inUnits = max ? max.inflow : upTo === undefined ? units : inflowUp(units, upTo);
      leg1 = await quoteIn(inUnits);
      if (!/^\d{1,30}$/.test(String(leg1.minAmountOut)) || BigInt(leg1.minAmountOut) <= 0n) throw new ProblemError(walletProblems.quoteExpired());
      // the payment takes exactly the asked share of leg 1's signed minimum (no trim: D137; all of it when not gridded);
      // the rest stays in the private balance (H1)
      const pays = askedShare(BigInt(leg1.minAmountOut), units, inUnits);
      paid = units;
      const req = privatePayRequest({ fromTokenId: coinIn, toTokenId, to, inUnits: pays, pocket: pocket.address, dry: false, deadlineMs: SEND_QUOTE_MS });
      payee = payeeAsk(req);
      real = await askPrivate(req);
      if (!real.quote.depositAddress || BigInt(real.quote.amountIn) !== pays || !(BigInt(real.quote.amountOut || "0") > 0n)) throw new ProblemError(walletProblems.quoteExpired());
    } else {
      // a request: exactly this arrives. Leg 2 is priced first; leg 1 brings that and HIDDEN_ROW_ROOM_BPS more.
      const outUnits = toUnits(text(p.amountOut), toCoin.decimals);
      if (outUnits === null || outUnits <= 0n) throw new ProblemError(walletProblems.amountInvalid());
      const request = (dry: boolean) => privatePayRequest({ fromTokenId: coinIn, toTokenId, to, outUnits, pocket: pocket.address, dry, deadlineMs: SEND_QUOTE_MS });
      const ask = (dry: boolean) => askPrivate(request(dry));
      payee = payeeAsk(request(false), outUnits);
      const priced = await ask(true);
      const room = (BigInt(priced.quote.amountIn) * HIDDEN_ROW_ROOM_BPS + 9_999n) / 10_000n;
      // H1: on the inflow grid when the wallet holds it; the request still arrives exactly
      inUnits = upTo === undefined ? room : inflowUp(room, upTo);
      paid = room;
      leg1 = await quoteIn(inUnits);
      real = await ask(false);
      // the join, here too (the core checks it again from 1Click's signed quotes): leg 1's minimum covers what leg 2 takes
      if (!real.quote.depositAddress || BigInt(real.quote.amountIn) > BigInt(leg1.minAmountOut) || BigInt(real.quote.amountOut) < outUnits) throw new ProblemError(walletProblems.quoteExpired());
    }
    const outDeposit = real.quote.depositAddress!;
    let intent: Awaited<ReturnType<Apis["generateIntent"]>>;
    try {
      intent = await apis.generateIntent(relayed!, pocket.address, outDeposit);
    } catch (e) {
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
    const named = label(p.label);
    const r = await bridgeFor(caller).call<{ leg1: { status: string; explorerUrl?: string; problem?: Problem }; signedData?: unknown } | { declined: true }>("subwallet.hiddenFromRow", {
      chain: p.chain, ...(token ? { coin: coinIn } : {}), inDeposit: leg1.depositAddress, outDeposit, intent: { payload: intent.payload }, ...(real.zerofeeStatusTag ? { outTag: real.zerofeeStatusTag } : {}), ...(named ? { why: named } : {}), payee,
    });
    if ("problem" in r) throw new ProblemError(r.problem);
    if ("declined" in r.ok) throw new ProblemError(walletProblems.declined());
    const { leg1: sent, signedData } = r.ok;
    const at = iso();
    const movement: Movement = {
      id: `hidden-row:${outDeposit.slice(0, 24)}`, kind: "pay", status: "moving", from: coinIn, to: payeeText(to), toChain: to.kind === "chain" ? to.chain : "near", amount: fromUnits(paid, inCoin.decimals),
      ...(inUnits > paid ? { kept: fromUnits(inUnits - paid, inCoin.decimals) } : {}),
      startedAtIso: at, updatedAtIso: at, explorerUrls: sent.explorerUrl ? [sent.explorerUrl] : [], ...(named ? { label: named } : {}), caller, private: true,
    };
    // leg 1 not done on both nodes: no leg 2 here at all (the core keeps it back), and its own words say why. Sent but not
    // seen done by both nodes (security review 3 Nov, M): it may still land, in the pocket, so Activity keeps it, said plainly
    if (!signedData || sent.status !== "done") {
      const maybe = sent.problem?.code === "security.subwallet.unconfirmed" || sent.problem?.code === "security.nodes.disagree";
      if (!maybe) throw new ProblemError(sent.problem ?? walletProblems.quoteExpired());
      const slow = walletProblems.hiddenRowSlow(rowCoin.symbol);
      await remember({ ...movement, status: "problem", problem: slow });
      emit("ledger.balancesChanged", {});
      throw new ProblemError(slow);
    }
    // one saved job (send-job.ts): leg 2 is handed to 1Click only after leg 1 landed with enough, marked handed first,
    // then followed to its own end; a restart finds it (security review H1: an unknown outcome is never "not paid")
    const job: SendJob = { id: movement.id, inDeposit: leg1.depositAddress, ...(leg1.statusTag ? { inTag: leg1.statusTag } : {}), outDeposit, ...(real.zerofeeStatusTag ? { outTag: real.zerofeeStatusTag } : {}), signedData, leg2In: String(real.quote.amountIn), coin: rowCoin.symbol, coinId: coinIn, startedAtIso: at, ...deadlineOf(intent.payload) };
    // leg 1 went: a write that fails here is never "Nothing moved" and a second leg 1 (audit, 6 Nov)
    try {
      await remember(movement);
      await (await x.jobs()).start(job);
    } catch (e) {
      throw e instanceof ProblemError ? e : new ProblemError(walletProblems.hiddenRowSlow(rowCoin.symbol));
    }
    emit("ledger.balancesChanged", {});
    return movement;
  }

  /** H1, fix #3: the private balance's own share of the wallet's coin pays it all, straight out: EXACT_INPUT of exactly
   *  that, the core's Send sheet, submitted; one leg, nothing leaves the wallet. As safe-send.ts's pocket share. */
  async function payFromPocket(pocket: { id: string; address: string }, coinId: string, units: bigint, coin: { decimals: number }, symbol: string, to: Payee, toTokenId: string, named: string | undefined, caller: Caller): Promise<Movement> {
    const req = privatePayRequest({ fromTokenId: coinId, toTokenId, to, inUnits: units, pocket: pocket.address, dry: false });
    const real = await askPrivate(req);
    const depositAddress = real.quote.depositAddress;
    if (!depositAddress || BigInt(real.quote.amountIn) !== units || !(BigInt(real.quote.amountOut || "0") > 0n)) throw new ProblemError(walletProblems.quoteExpired());
    let intent: Awaited<ReturnType<Apis["generateIntent"]>>;
    try {
      intent = await apis.generateIntent(relayed!, pocket.address, depositAddress);
    } catch (e) {
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
    const why = named ?? `Send ${fromUnits(units, coin.decimals)} ${symbol} to ${payeeText(to)}`;
    const signed = await x.core<{ signedData?: unknown; declined?: true }>("subwallet.privatePay", { id: pocket.id, depositAddress, intent: { payload: intent.payload }, why, ...(real.zerofeeStatusTag ? { statusTag: real.zerofeeStatusTag } : {}), send: true, payee: payeeAsk(req) });   // H4: the core pins the payee
    if (signed.declined || !signed.signedData) throw new ProblemError(walletProblems.declined());
    const at = iso();
    const movement: Movement = {
      id: `pocket-send:${depositAddress.slice(0, 24)}`, kind: "pay", status: "moving", from: coinId, to: payeeText(to), toChain: to.kind === "chain" ? to.chain : "near", amount: fromUnits(units, coin.decimals),
      startedAtIso: at, updatedAtIso: at, explorerUrls: [], ...(named ? { label: named } : {}), caller, private: true,
    };
    // H1 (send review): kept, movement and job, before it is handed over; followed by 1Click's own status of it
    const jobs = await x.jobs();
    const job: SendJob = { id: movement.id, outDeposit: depositAddress, ...(real.zerofeeStatusTag ? { outTag: real.zerofeeStatusTag } : {}), signedData: signed.signedData, leg2In: units.toString(), coin: symbol, coinId, startedAtIso: at };
    await remember(movement);
    await jobs.start(await jobs.hand(job, movement));
    emit("ledger.balancesChanged", {});
    return movement;
  }

  /**
   * The fee before the tap (QA's real-money check, 5 Nov: "the real figure, before the tap"): both legs priced
   * DRY by 1Click, exactly as the Send would ask them (leg 1: the wallet's coin into the private balance; leg 2: that
   * leg's own amount out, to the payee's chain), nothing signed, kept or reserved, no pocket made, and never the real
   * private balance or payee (DRY_POCKET, DRY_PAYEE). `{ inUsd, outUsd }` as 1Click says them; null when anything is
   * missing (no price, a refusal): the core's own sheet says it.
   * `p`: { chain: "sol" | "hood", coin?, to: Payee, toTokenId?, amountIn }.
   */
  async function sendFee(p: Record<string, unknown>): Promise<{ inUsd: string; outUsd: string } | null> {
    try {
      if (!d.privateQuotes) return null;
      const own = p.chain === "sol" || p.chain === "hood" ? ROW_COINS[p.chain] : undefined;
      const token = p.coin === undefined ? null : hiddenCoin(p.coin, p.chain);
      if (!own || (p.coin !== undefined && !token)) return null;
      const coinIn = token ? String(p.coin) : own.id;
      const cat = await catalogue();
      const inCoin = cat.coin(coinIn);
      if (!inCoin) return null;
      const { to: real, toTokenId } = sendTarget(cat, p.to, p.toTokenId);
      // stand-ins only (QA's MUST): the payee's chain and the amount are all a dry quote learns
      const stand = real.kind === "chain" ? DRY_PAYEE[real.chain] : DRY_POCKET;
      if (!stand) return null;
      const to: Payee = real.kind === "chain" ? { kind: "chain", chain: real.chain, address: stand } : { kind: "ledger", accountId: stand };
      const units = toUnits(text(p.amountIn), inCoin.decimals);
      if (units === null || units <= 0n) return null;
      const leg1 = await askPrivate({
        dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: coinIn, depositType: "ORIGIN_CHAIN", destinationAsset: coinIn, amount: units.toString(),
        refundTo: DRY_POCKET, refundType: "CONFIDENTIAL_INTENTS", recipient: DRY_POCKET, recipientType: "CONFIDENTIAL_INTENTS",
        deadline: quoteDeadline(x.now(), 10 * 60_000), confidentiality: "basic",
      } as unknown as QuoteRequest);
      const mid = /^\d{1,30}$/.test(String((leg1.quote as { minAmountOut?: string }).minAmountOut ?? leg1.quote.amountOut)) ? BigInt((leg1.quote as { minAmountOut?: string }).minAmountOut ?? leg1.quote.amountOut) : 0n;
      if (mid <= 0n) return null;
      const leg2 = await askPrivate(privatePayRequest({ fromTokenId: coinIn, toTokenId, to, inUnits: mid, pocket: DRY_POCKET, dry: true }));
      const inUsd = (leg1.quote as { amountInUsd?: string }).amountInUsd, outUsd = (leg2.quote as { amountOutUsd?: string }).amountOutUsd;
      const ok = (v: unknown): v is string => typeof v === "string" && /^\d{1,12}(\.\d{1,18})?$/.test(v);
      return ok(inUsd) && ok(outUsd) && Number(outUsd) <= Number(inUsd) && Number(inUsd) > 0 ? { inUsd, outUsd } : null;
    } catch {
      return null;
    }
  }

  return { hiddenFromRow, sendFee };
}
