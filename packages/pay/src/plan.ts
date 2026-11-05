// Which coin pays. The receiver asked for an exact amount of one coin on one chain; the person may hold anything.
//
// Order, fastest and cheapest first:
//   1. the very coin asked for (no conversion; inside the ledger it's an instant transfer);
//   2. the same coin on another chain (USDC on NEAR paying USDC on Base);
//   3. another dollar stablecoin, when dollars are asked for;
//   4. anything else worth enough, biggest first (so small balances aren't emptied).
// The person's remembered choice goes first when it can cover the amount, unless they hold the very coin asked for.
// Estimates rank only: the quote decides.
//
// Where a coin is held (S3, one place per payment, never the two added together):
//   - "ledger" rows pay anything: a transfer inside the ledger, a payout to NEAR, a payout to the coin's own chain;
//   - "account" rows (coins sent from a NEAR wallet) pay into someone's ledger or to a NEAR account, never to another
//     network; native NEAR (always on the account, the fee reserve already left out) pays NEAR to a NEAR account;
//   - a row the ledger can't name (`listed: false`) never pays: its symbol could be a fake "USDC".
//
// Paying from a DIFFERENT coin needs 1Click to accept a plain mt_transfer as funding for an INTENTS quote (1Click's docs
// fund those with a signed intent, which post-quantum accounts can't make). Until an operator-run mainnet dust test proves
// it, `anyCoin` stays off and only the coin asked for pays. Same-coin payments never touch 1Click.
import { compare, isDecimal, isZero, mul } from "./amount.ts";
import type { Balance, Payee, Token } from "@zerofee/wallet/types.ts";
import type { CodeNote } from "./codes/parse.ts";
import { isUsdStable } from "./tokens.ts";

export interface PayTarget {
  to: Payee;
  /** What the receiver gets. */
  token: Token;
  /** Exactly how much they get, in the token's units. */
  amount: string;
  /** The name the code gives itself. Unchecked: shown as "says it's …". */
  label?: string;
  /** Who the person knows the payee as: a saved contact, a partner, their card. ZeroFee's words, not the code's. */
  name?: string;
  /** How the person's own Recent names it, when it's a provider ("Card top-up · ether.fi"): never its address. */
  activity?: string;
  message?: string;
  notes: CodeNote[];
  /** A request's own reference, sent along with a transfer so the requester can match it. */
  ref?: string;
}

export interface Source {
  balance: Balance;
  /** The coin the ledger is asked to spend: the row's own, except native NEAR, which pays a wrapped-NEAR target. */
  payTokenId: string;
  /** "transfer": the same coin, inside the ledger, no quote. "quote": anything that needs 1Click. */
  route: "transfer" | "quote";
  sameCoin: boolean;
}

/** Leaves room for price movement and fees when guessing whether a balance can cover a conversion. */
const HEADROOM = "1.03";
const NATIVE_NEAR = "near";
const WRAPPED_NEAR = "nep141:wrap.near";

/** Whether this row can pay this payee at all, and which coin id the ledger spends for it. */
function usable(b: Balance, target: PayTarget): string | null {
  if (b.listed === false) return null;
  const toNear = target.to.kind === "chain" && target.to.chain === "near";
  if (b.tokenId === NATIVE_NEAR) return toNear && target.token.assetId === WRAPPED_NEAR ? WRAPPED_NEAR : null;
  if (b.held === "account" && target.to.kind === "chain" && !toNear) return null;
  return b.tokenId;
}

export function sourcesFor(target: PayTarget, balances: readonly Balance[], preferredTokenId?: string, options: { anyCoin?: boolean } = {}): Source[] {
  const symbol = target.token.symbol.toUpperCase();
  const stable = isUsdStable(symbol);
  // A price that isn't a plain decimal (e.g. "1e-7" for a tiny one) is no price: the coin is then valued by itself only.
  const price = target.token.priceUsd && isDecimal(target.token.priceUsd) ? target.token.priceUsd : undefined;
  const needUsd = price ? mul(target.amount, price) : stable ? target.amount : undefined;

  const ranked: { source: Source; group: number; usd: string }[] = [];
  for (const b of balances) {
    if (!isDecimal(b.amount) || isZero(b.amount)) continue;
    const payTokenId = usable(b, target);
    if (!payTokenId) continue;
    const sameCoin = payTokenId === target.token.assetId;
    let group: number;
    if (sameCoin) {
      if (compare(b.amount, target.amount) < 0) continue;
      group = 1;
    } else {
      if (!options.anyCoin) continue;
      const bothStable = stable && isUsdStable(b.symbol);
      const value = b.usd !== undefined && isDecimal(b.usd) ? b.usd : bothStable ? b.amount : undefined;
      if (!value || !needUsd || compare(value, mul(needUsd, HEADROOM)) < 0) continue;
      group = b.symbol.toUpperCase() === symbol ? 2 : bothStable ? 3 : 4;
    }
    const route = sameCoin && target.to.kind === "ledger" ? "transfer" : "quote";
    ranked.push({ source: { balance: b, payTokenId, route, sameCoin }, group, usd: b.usd !== undefined && isDecimal(b.usd) ? b.usd : b.amount });
  }
  ranked.sort((x, y) => x.group - y.group || compare(y.usd, x.usd));
  // The same coin in two places (ledger and account) is one choice: the ledger picks the place that covers it. When the
  // person picked one of the two (Send's "12.5 NEAR ready to send" is the account's NEAR), that row is the choice, so
  // the payment never refuses the very coin the screen offered (grade 02h, H3: "We can't pay this with your NEAR").
  const one = new Map<string, Source>();
  for (const { source } of ranked) {
    const kept = one.get(source.payTokenId);
    if (!kept || (preferredTokenId !== undefined && source.balance.tokenId === preferredTokenId && kept.balance.tokenId !== preferredTokenId)) one.set(source.payTokenId, source);
  }
  const sources = [...one.values()];
  // A remembered choice beats every estimate, but not the coin asked for itself: that needs no conversion at all.
  const preferred = sources.findIndex((s) => s.balance.tokenId === preferredTokenId);
  if (preferred > 0 && !sources[0].sameCoin) sources.unshift(...sources.splice(preferred, 1));
  return sources;
}
