// The total as Home counts it, read once (BalanceTotal.ts readBalanceParts, loaded on its first ask: never in Home's
// first load). Moved from BalanceTotal.ts as it was, with AgentZero's own wallet joined to the wallets as Home joins it
// (agent-row.ts; QA 5 Nov: its $1.99 was in neither total).
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Balance, Chain, PrivatePocket, Token } from "../types.ts";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import { balanceTotal, earnParts, forChild, safeHeld } from "./format.ts";
import { nearOwnCoins } from "./near-coins.ts";
import { tradingUsd, type HeldCoin } from "./trading.ts";
import { walletsWithAgent } from "./agent-row.ts";

type Position = Parameters<typeof earnParts>[0][number];
const NONE: PrivatePocket = { available: false, ready: false, rows: [], defaultOn: false };

/** The same total and whether a part is still missing (`partial`: Spending's wallets not read yet),
 *  so a screen waits for the whole figure (QA 5 Nov: the Sim's set-up said $5,288.01, the Safe alone, while
 *  Home opened on $5,510.55). Null when the balances can't be read. */
export async function readBalanceParts(bridge: Bridge): Promise<{ usd: string; partial: boolean } | null> {
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
  // a kid's account has no wallets: whole without them; Spending not read yet (the set-up screen's first reads) is partial.
  // A wallet Home itself shows as "updating" (tradingUsd's own partial) is not: Home's figure counts without it too.
  const partial = !kid && !t;
  return { usd: balanceTotal(balances.ok, "ok" in chains ? chains.ok : [], earning, own, t ? t.usd : null), partial };
}

/**
 * One Safe coin's one figure, as Home's line shows it (format.ts safeHeld; product decision, 5 Nov: Home = Send = Swap =
 * the coin page), for a screen outside Wallet (Trade's coin page). `tokenId`: the coin page's asset; its symbol is the
 * Safe row's (wrapped NEAR's page is NEAR's line). Null: none held, or the balances can't be read.
 */
export async function readSafeHeld(bridge: Bridge, tokenId: string): Promise<{ amount: string; usd: string; symbol: string } | null> {
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
  return held ? { ...held, symbol } : null;
}
