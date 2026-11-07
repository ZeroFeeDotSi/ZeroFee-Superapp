// A Safe coin into the pocket (route B: a coin native to NEAR, paid on NEAR), for the Private screen's move in and the
// Safe's part of Home's Send (safe-send.ts). Loaded with its first use, never in Home's first load (speed budget, 3 Nov):
// the ledger hands over what it needs. The rules are the ledger's own, moved here unchanged.
import type { Bridge } from "@zerofee/core/bridge";
import type { Block, Chain as Near, ChainAccount } from "@zerofee/core/chain";
import { INTENTS, nep141Contract } from "@zerofee/core/intents";
import { ACCOUNT_POLICY } from "@zerofee/core/known-contracts";
import { ProblemError } from "@zerofee/core/problem";
import type { AccountInfo, TxRequest } from "@zerofee/core/signer";
import { fromUnits, toUnits, usdOf } from "./amount.ts";
import type { QuoteRequest } from "./apis.ts";
import { NATIVE_NEAR, WRAPPED_NEAR, type Catalogue } from "./catalogue.ts";
import { fundingSteps, originAsset, routeFor, type ConvertRoute } from "./convert.ts";
import { WRAP_STORAGE_YOCTO, wrapRegistered } from "./moves.ts";
import { PRIVATE_KIND, type Movement, type Quote } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";
import { quoteDeadline } from "@zerofee/core/quote-deadline";

type Caller = string;
type Signed = { txHash: string; explorerUrls: string[]; hold?: Movement["held"]; unsent?: number };
export interface ToPrivateDeps {
  myAccount: (ready: boolean) => Promise<AccountInfo>;
  pocketOf: () => Promise<{ id: string; address: string } | null>;
  privateQuotes: string | undefined;
  routeOpen: () => boolean;
  catalogue: (o: { live: boolean }) => Promise<Catalogue>;
  chain: Near;
  accountCoins: readonly string[];
  capUsd: number;
  spendable: (a: ChainAccount | null) => bigint;
  notForChild: () => Promise<void>;
  askPrivate: (r: QuoteRequest) => Promise<{ quote: { amountOut: string; minAmountOut: string; timeEstimate?: number } }>;
  bridgeFor: (caller: Caller) => Bridge;
  signAll: (requests: TxRequest[], caller: Caller, since?: number) => Promise<Signed>;
  approvals: (steps: TxRequest[], canChain: boolean, caller?: string) => TxRequest[];
  /** The move in, kept and followed as the ledger follows any sent request (landed, or held for later). */
  finish: (m: Movement, signed: Signed, follow: { signer: string; depositAddress: string; sender: string }) => Promise<Movement>;
  now: () => number;
  iso: () => string;
  quoteTtlMs: number;
}

const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);
const text = (v: unknown) => (typeof v === "string" ? v : "");

export function createToPrivate(x: ToPrivateDeps) {
  const { myAccount, pocketOf, catalogue, chain, now, iso } = x;
  const privateQuotes = new Map<string, { quote: Quote; units: bigint; minOutUnits: bigint; pocket: string; route: ConvertRoute }>();

  /** The move into the pocket, read at one block on two nodes: route B only (a coin native to NEAR, paid on NEAR).
   *  `through`: Home's Send from the Safe (E4, D128): the money only passes through the pocket, so the pot's $100 isn't
   *  checked (the quote relay's own limit is, on the quote). `open`: route B for this one call only (the Move route's
   *  fill, VITE_SAFE_FILL_OPEN), never for the Private screen's move in or any other caller. */
  async function privatePlan(tokenId: string, amount: string, ready: boolean, through = false, open = false) {
    const { accountId } = await myAccount(ready);
    const pocket = await pocketOf();
    if (!pocket || !x.privateQuotes || !(x.routeOpen() || (through && open))) throw new ProblemError(walletProblems.privateUnavailable());
    // Private's $100 cap is checked at a price read now (B28)
    const [cat, block] = await Promise.all([catalogue({ live: true }), chain.commonBlock()]);
    const native = tokenId === NATIVE_NEAR;
    const coin = native ? cat.coin(WRAPPED_NEAR) : cat.coin(tokenId);
    if (!coin || (!native && coin.route !== "near")) throw new ProblemError(walletProblems.privateCoin(coin?.symbol ?? "This coin"));
    const amountUnits = toUnits(amount, coin.decimals);
    if (amountUnits === null || amountUnits <= 0n) throw new ProblemError(walletProblems.amountInvalid());
    const usd = Number(usdOf(amount, coin.priceUsd) ?? NaN);
    if (!through && Number.isFinite(usd) && usd > x.capUsd) throw new ProblemError(walletProblems.privateCap(x.capUsd.toFixed(2)));
    const contract = nep141Contract(originAsset(tokenId));
    const [account, inLedger, onAccount] = await Promise.all([
      chain.account(accountId, block),
      native ? Promise.resolve("0") : chain.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: tokenId }, block),
      !native && contract && x.accountCoins.includes(tokenId) ? chain.view(contract, "ft_balance_of", { account_id: accountId }, block) : Promise.resolve("0"),
    ]);
    const held = { ledger: units(inLedger) ?? 0n, account: native ? x.spendable(account) : units(onAccount) ?? 0n };
    // Move's fill (`open`, one bridge leg, QA 5 Nov): the Safe's NEAR Intents balance pays inside intents.near
    // (one mt_transfer, no storage, no withdraw); everything else as before
    const route = routeFor({ tokenId, coin: native ? undefined : coin, held, units: amountUnits, routes: { intents: through && open, nearOrigin: true } });
    if (!route) throw new ProblemError(walletProblems.balanceLow(amount, native ? "NEAR" : coin.symbol));
    return { accountId, pocket: pocket.address, cat, block: block as Block, coin, units: amountUnits, route, contract, canChain: account?.codeHash === ACCOUNT_POLICY.codeHashBase58 };
  }

  /** The same coin, from this account's ledger (or account) into the pocket in Confidential Intents; refunds go there too. */
  const privateRequest = (o: { tokenId: string; units: bigint; pocket: string; dry: boolean }) => ({
    dry: o.dry,
    swapType: "EXACT_INPUT" as const,
    slippageTolerance: 100,
    originAsset: originAsset(o.tokenId),
    depositType: "ORIGIN_CHAIN" as const,
    destinationAsset: originAsset(o.tokenId),
    amount: o.units.toString(),
    refundTo: o.pocket,
    refundType: "CONFIDENTIAL_INTENTS" as const,
    recipient: o.pocket,
    recipientType: "CONFIDENTIAL_INTENTS" as const,
    deadline: quoteDeadline(now(), 10 * 60_000),
    confidentiality: "basic" as const,
  });

  async function quoteToPrivate(p: Record<string, unknown>): Promise<Quote> {
    await x.notForChild();
    const tokenId = text(p.tokenId), amount = text(p.amount);
    const plan = await privatePlan(tokenId, amount, false);
    const r = await x.askPrivate(privateRequest({ tokenId, units: plan.units, pocket: plan.pocket, dry: true }) as QuoteRequest);
    const quote: Quote = {
      id: `pq-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      from: tokenId,
      to: PRIVATE_KIND,
      amountIn: amount,
      amountOut: fromUnits(r.quote.amountOut, plan.coin.decimals),
      minOut: fromUnits(r.quote.minAmountOut, plan.coin.decimals),
      feeNote: "The swap fee is in this price. Anyone can see this move into Private.",
      ...(typeof r.quote.timeEstimate === "number" ? { etaSeconds: r.quote.timeEstimate } : {}),
      expiresAtIso: new Date(now() + x.quoteTtlMs).toISOString(),
    };
    privateQuotes.set(quote.id, { quote, units: plan.units, minOutUnits: BigInt(r.quote.minAmountOut), pocket: plan.pocket, route: plan.route });
    return quote;
  }

  /** Route B into the pocket: exactly plan.units to 1Click's NEAR address for it (storage first when the address has
   *  none), one ft_withdraw out of the ledger or the account's own transfer, on the main key's sheet. `moveFill`: a Move's
   *  fill (TxRequest.moveFill, a marker): the core's sheet says its legs from its own figures. */
  async function payIntoPocket(plan: Awaited<ReturnType<typeof privatePlan>>, tokenId: string, depositAddress: string, why: string, caller: Caller, moveFill: boolean | "send" | { plan?: string[]; swap?: true } = false, since?: number, job?: string): Promise<Signed> {
    let registered = true;
    let storageYocto = WRAP_STORAGE_YOCTO;
    // NEAR on the account wraps on wrap.near: the Safe's own storage step only when it isn't set up there (or unknown)
    const wraps = plan.route === "near-account" && tokenId === NATIVE_NEAR;
    const meP = wraps ? wrapRegistered((c, m, a) => chain.view(c, m, a, plan.block), plan.accountId) : Promise.resolve(false);
    if (plan.contract) {
      const [balance, bounds] = await Promise.all([
        chain.view(plan.contract, "storage_balance_of", { account_id: depositAddress }, plan.block),
        chain.view(plan.contract, "storage_balance_bounds", {}, plan.block),
      ]);
      registered = balance !== null;
      const min = (bounds as { min?: unknown } | null)?.min;
      if (typeof min === "string" && /^\d+$/.test(min)) storageYocto = min;
    }
    const meRegistered = await meP;
    const steps = fundingSteps(plan.route, { tokenId, units: plan.units, depositAddress, registered, storageYocto, me: plan.accountId, meRegistered, why }).map((s, i, all) => (i !== all.length - 1 || !moveFill ? s : moveFill === "send" ? { ...s, sendFill: true as const } : { ...s, moveFill: true as const, ...(typeof moveFill === "object" && moveFill.plan ? { movePlan: moveFill.plan } : {}), ...(typeof moveFill === "object" && moveFill.swap ? { moveSwap: true as const } : {}) })).map((s) => (job ? { ...s, job } : s));
    return x.signAll(x.approvals(steps, plan.canChain, caller), caller, since);
  }

  /** Move into Private: a real quote now (refused if it promises less than shown), paid on NEAR like Convert's route B. */
  async function toPrivate(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    await x.notForChild();
    const held = privateQuotes.get(text(p.quoteId));
    if (!held || Date.parse(held.quote.expiresAtIso) < now()) throw new ProblemError(walletProblems.quoteExpired());
    const { quote } = held;
    const plan = await privatePlan(quote.from, quote.amountIn, true);
    if (plan.pocket !== held.pocket) throw new ProblemError(walletProblems.quoteExpired());
    // The real quote is the core's own (Security, the outside study's item 2): it asks the relay itself, for the pocket
    // by its own list, and reads it back as 1Click signed it, so the main sheet says "Move … to Private" from it. The
    // dry quote above was only for the numbers shown.
    const r = await x.bridgeFor(caller).call<{ depositAddress: string; amountIn: string; minAmountOut: string }>("subwallet.private.quoteIn", { tokenId: originAsset(quote.from), amount: plan.units.toString() });
    if ("problem" in r) throw new ProblemError(r.problem);
    const depositAddress = r.ok.depositAddress;
    const fair = typeof depositAddress === "string" && /^[0-9a-f]{64}$/.test(depositAddress) && /^\d+$/.test(String(r.ok.minAmountOut)) && /^\d+$/.test(String(r.ok.amountIn));
    if (!fair || BigInt(r.ok.minAmountOut) < held.minOutUnits || BigInt(r.ok.amountIn) !== plan.units) throw new ProblemError(walletProblems.quoteExpired());
    privateQuotes.delete(quote.id);
    const why = `Move ${quote.amountIn} ${quote.from === NATIVE_NEAR ? "NEAR" : plan.coin.symbol} to Private`;
    const signed = await payIntoPocket(plan, quote.from, depositAddress, why, caller);
    const at = iso();
    const movement: Movement = {
      id: `private:${signed.txHash}`,
      kind: "private",
      status: signed.hold ? "waiting" : "moving",
      from: quote.from,
      to: PRIVATE_KIND,
      amount: quote.amountIn,
      startedAtIso: at,
      updatedAtIso: at,
      explorerUrls: signed.explorerUrls,
      ...(signed.hold ? { held: signed.hold } : {}),
      caller,
    };
    return x.finish(movement, signed, { signer: plan.accountId, depositAddress, sender: plan.route === "near-ledger" ? INTENTS.account : plan.accountId });
  }

  return { privatePlan, quoteToPrivate, payIntoPocket, toPrivate };
}
