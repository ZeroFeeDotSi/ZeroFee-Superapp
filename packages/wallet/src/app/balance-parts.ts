// The total as Home counts it, read once (BalanceTotal.ts readBalanceParts, loaded on its first ask: never in Home's
// first load). Moved from BalanceTotal.ts as it was, with AgentZero's own wallet joined to the wallets as Home joins it
// (agent-row.ts; QA 5 Nov: its $1.99 was in neither total).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Balance, Chain, PrivatePocket, Token } from "../types.ts";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import { balanceTotal, earnParts, forChild, privateAllUsd, safeHeld } from "./format.ts";
import { nearOwnCoins } from "./near-coins.ts";
import { tradingUsd, type HeldCoin } from "./trading.ts";
import { walletsWithAgent } from "./agent-row.ts";

type Position = Parameters<typeof earnParts>[0][number];
const NONE: PrivatePocket = { available: false, ready: false, rows: [], defaultOn: false };

/** The one total and its parts: `safeUsd` is the Safe's pill (Private inside it), `privateUsd` Private's part of it,
 *  `hotUsd` Hot's pill (null: Spending not read). `usd` = `safeUsd` + `hotUsd`. */
export type BalanceParts = { usd: string; partial: boolean; safeUsd: string; privateUsd: string; hotUsd: string | null };

/** The same total and whether a part is still missing (`partial`: Spending's wallets not read yet),
 *  so a screen waits for the whole figure (QA 5 Nov: the Sim's set-up said $5,288.01, the Safe alone, while
 *  Home opened on $5,510.55). Null when the balances can't be read. */
export async function readBalanceParts(bridge: Bridge): Promise<BalanceParts | null> {
  const [balances, chains, tokens, positions, pocket, state, spending, held, wallets, float] = await Promise.all([
    bridge.call<Balance[]>("ledger.balances"),
    bridge.call<Chain[]>("ledger.chains"),
    bridge.call<Token[]>("ledger.tokens"),
    bridge.call<Position[]>("earn.positions"),
    bridge.call<PrivatePocket>("ledger.private"),
    bridge.call<{ kid?: boolean }>("account.state"),
    bridge.call<SpendingStatus>("spending.status"),
    bridge.call<HeldCoin[]>("trade.positions"),
    // AgentZero's own wallet, as Home's row counts it
    walletsWithAgent<BridgeResult<SpendingWallet[]>>((m) => bridge.call(m)),
    // the NEAR wallet's own coins (a coin bought in place: in neither reserveUsd nor Trade's positions), as Home counts them
    bridge.call<{ tokens?: { tokenId: string; amount: string }[] }>("subwallet.float.balance"),
  ]);
  if (!("ok" in balances)) return null;
  const nearPrice = "ok" in tokens ? tokens.ok.find((t) => t.assetId === "nep141:wrap.near")?.priceUsd : undefined;
  const earning = earnParts("ok" in positions && Array.isArray(positions.ok) ? positions.ok : [], nearPrice);
  const kid = !("ok" in state) || state.ok?.kid === true;
  const own = forChild("ok" in pocket ? pocket.ok : NONE, kid);
  const s = !kid && "ok" in spending && spending.ok.loaded && !spending.ok.unread ? spending.ok : null;
  const listed = new Map(("ok" in tokens && Array.isArray(tokens.ok) ? tokens.ok : []).map((x) => [x.assetId, x]));
  const nearOwn = "ok" in float && Array.isArray(float.ok?.tokens) ? nearOwnCoins(float.ok.tokens, (id) => listed.get(id)) : null;
  const t = s ? tradingUsd(s, "ok" in held && Array.isArray(held.ok) ? held.ok : null, "ok" in wallets && Array.isArray(wallets.ok) ? wallets.ok : null, nearOwn) : null;
  // a kid's account has no wallets: whole without them; Spending not read yet (the set-up screen's first reads) is partial,
  // and so is a Spending answer still missing Solana's or Robinhood's wallet (the copy review's A2-3, 8 Nov: set-up said $5,342.95, the
  // Safe and the sites without the SOL and ETH (RH) wallets, while Home said "Updating…"; D111: never a NEAR-only figure).
  // A wallet Home itself shows as "updating" (a site's unread wallet) is not: Home's figure counts without it too.
  const partial = !kid && (!t || !s || !CHAIN_ROWS.every((c) => s.networks.some((n) => n.network === c)));
  // A2-3: the one total (format.ts balanceTotal, as Home's pills add up: the Safe with Private inside it, then Hot), with
  // its parts so a screen names Private inside it
  const usd = balanceTotal(balances.ok, "ok" in chains ? chains.ok : [], earning, own, t ? t.usd : null);
  const safeUsd = balanceTotal(balances.ok, "ok" in chains ? chains.ok : [], earning, own);
  const privateUsd = own.available ? privateAllUsd(own) : "0.00";
  return { usd, partial, safeUsd, privateUsd, hotUsd: t ? t.usd : null };
}
/** The wallets every Spending answer must name before its figure is whole (trading.ts tradingUsd's own rule). */
const CHAIN_ROWS = ["sol", "hood"] as const;

/**
 * One Safe coin's one figure, as Home's line shows it (format.ts safeHeld; product decision, 5 Nov: Home = Send = Swap =
 * the coin page), for a screen outside Wallet (Trade's coin page). `tokenId`: the coin page's asset; its symbol is the
 * Safe row's (wrapped NEAR's page is NEAR's line). Null: none held, or the balances can't be read.
 */
export async function readSafeHeld(bridge: Bridge, tokenId: string): Promise<{ amount: string; usd: string; symbol: string; rest?: SafeRest[] } | null> {
  const [balances, tokens, positions, pocket, state] = await Promise.all([
    bridge.call<Balance[]>("ledger.balances"),
    bridge.call<Token[]>("ledger.tokens"),
    bridge.call<Position[]>("earn.positions"),
    bridge.call<PrivatePocket>("ledger.private"),
    bridge.call<{ kid?: boolean }>("account.state"),
  ]);
  if (!("ok" in balances) || !Array.isArray(balances.ok)) return null;
  const own = forChild("ok" in pocket ? pocket.ok : NONE, !("ok" in state) || state.ok?.kid === true);
  const rows = [...balances.ok, ...(own.available ? own.rows : [])];
  const symbol = rows.find((b) => b.tokenId === tokenId && b.listed !== false)?.symbol;
  if (!symbol) return null;
  const nearPrice = "ok" in tokens ? tokens.ok.find((t) => t.assetId === "nep141:wrap.near")?.priceUsd : undefined;
  const earning = earnParts("ok" in positions && Array.isArray(positions.ok) ? positions.ok : [], nearPrice);
  const held = safeHeld(rows, symbol, earning);
  if (!held) return null;
  // builder 22's item 5: where the part Sell can't pay from sits (Private's rows, NEAR with validators), so the coin
  // page's "Up to N NEAR can go in one sell." says why in one line
  const rest: SafeRest[] = [];
  if (own.available && own.rows.some((b) => b.symbol === symbol && Number(b.amount) > 0)) rest.push("private");
  if (symbol === "NEAR" && earning.some((e) => Number(e.amount) > 0)) rest.push("staked");
  return { ...held, symbol, ...(rest.length ? { rest } : {}) };
}
/** Where a Safe coin's figure holds more than Sell pays from: Private, or NEAR staked with validators. */
export type SafeRest = "private" | "staked";
