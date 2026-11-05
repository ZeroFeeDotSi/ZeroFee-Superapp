// Home's Send (the Home plan §1.3, E3, E4): who a private Send pays and the coin it lands as, checked once for both of its
// starts (a wallet: hidden-row.ts; the Safe: safe-send.ts). An address is checked for its own network before anything is
// quoted (addresses.ts), a NEAR account by NEAR's own rule; the coin is the destination chain's own (send-to.ts LANDS_AS)
// unless the caller names another 1Click lists there. Nothing here moves money.
import { ProblemError } from "@zerofee/core/problem";
import { nearAccountKind, segwitLower } from "./addresses.ts";
import { validSendAddress } from "./send-reach.ts";
import type { Catalogue, Coin } from "./catalogue.ts";
import { ACCOUNT_ID } from "./send.ts";
import { LANDS_AS, isSendToChain } from "./send-to.ts";
import type { Payee } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";

/**
 * Home's Send (D128): the pocket is the lane every Send travels, not a place a person sets up, so a Send makes it when
 * there's none yet (a key from the backup words, nothing on chain). Never for a child's account (D30).
 */
export function pocketMaker(x: { pocketOf: () => Promise<{ id: string; address: string } | null>; notForChild: () => Promise<void>; core: <T>(method: string, params?: Record<string, unknown>) => Promise<T>; privateQuotes: string | undefined }) {
  return async (): Promise<{ id: string; address: string }> => {
    const had = await x.pocketOf();
    if (had) return had;
    await x.notForChild();
    if (!x.privateQuotes) throw new ProblemError(walletProblems.privateUnavailable());
    await x.core("subwallet.create", { kind: "private", chain: "near" });
    const made = await x.pocketOf();
    if (!made) throw new ProblemError(walletProblems.privateUnavailable());
    return made;
  };
}

/**
 * A NEAR account a Send may pay on NEAR itself (row 1, 5 Nov: a valid NEAR address was refused): any account NEAR's
 * own rule allows: a name with dots ("alice.near", "shop.tg", "a.b.near"), a top-level one ("aurora"), a 64-hex implicit
 * one, or a lower-case 0x one (NEP-518; the form offers NEAR for it only once NEAR says it exists). Only on `chain: "near"`.
 */
export const nearPayable = (a: string): boolean => ACCOUNT_ID.test(a) && (nearAccountKind(a) !== null || !/^0x/.test(a));

/**
 * `to` as the caller gave it, checked: {kind: "chain", chain: one of LANDS_AS, address} or {kind: "ledger", accountId} (a
 * NEAR account's own balance in NEAR Intents). `toTokenId`: the coin it lands as; LANDS_AS's when not given. Throws the
 * Problem that says why not.
 */
export function sendTarget(cat: Catalogue, given: unknown, toTokenId: unknown): { to: Payee; toTokenId: string; toCoin: Coin } {
  const t = given as Partial<Payee> & { address?: unknown; accountId?: unknown; chain?: unknown; memo?: unknown } | null;
  let to: Payee;
  if (t?.kind === "ledger" && typeof t.accountId === "string") {
    const id = t.accountId.trim();
    if (!ACCOUNT_ID.test(id)) throw new ProblemError(walletProblems.recipientInvalid());
    to = { kind: "ledger", accountId: id, ...((t as { confidential?: unknown }).confidential === true ? { confidential: true as const } : {}) };
  } else if (t?.kind === "chain" && typeof t.address === "string" && typeof t.chain === "string" && isSendToChain(t.chain)) {
    const address = segwitLower(t.address.trim());
    const ok = t.chain === "near" ? nearPayable(address) : validSendAddress(t.chain, address);
    // a memo is never carried on this path: an address that needs one is refused, never paid without it
    if (!ok || t.memo) throw new ProblemError(walletProblems.addressInvalid(LANDS_AS[t.chain].network));
    to = { kind: "chain", chain: t.chain, address };
  } else {
    const chain = typeof t?.chain === "string" ? t.chain : "";
    throw new ProblemError(walletProblems.addressInvalid(cat.network(chain)?.name ?? "that network"));
  }
  const home = to.kind === "chain" ? to.chain : "near";
  const id = typeof toTokenId === "string" && toTokenId ? toTokenId : LANDS_AS[home as keyof typeof LANDS_AS].tokenId;
  const toCoin = cat.coin(id);
  // the coin must be one 1Click lists on that very chain (never ETH on Base for a Robinhood Chain address)
  if (!toCoin || toCoin.chain !== home) throw new ProblemError(walletProblems.quoteUnavailable(`That coin doesn't land on ${LANDS_AS[home as keyof typeof LANDS_AS].network}.`));
  return { to, toTokenId: id, toCoin };
}

/**
 * QA's real-test condition (b), 5 Nov: a coin other than NEAR (USDC, any NEP-141) paid out to a NEAR account
 * arrives by that coin's own transfer, which an account not set up for the coin (no storage on its contract) refuses, and
 * the money would wait with 1Click. So it is read first, on the coin's own contract, before any price is asked: not set
 * up, or not readable, it is refused by name and nothing moves. Paying it from here (storage_deposit) would be a public
 * transaction from the person's own account naming the payee, so it is never done on a private Send.
 * Untouched (c): NEAR (wrapped, LANDS_AS.near) as before; a payee's NEAR Intents balance (kind ledger) needs nothing.
 */
export async function payeeTakes(to: Payee, toCoin: { tokenId: string; symbol: string }, registered: ((contract: string, accountId: string) => Promise<boolean>) | undefined): Promise<void> {
  if (to.kind !== "chain" || to.chain !== "near" || toCoin.tokenId === LANDS_AS.near.tokenId || !toCoin.tokenId.startsWith("nep141:")) return;
  const contract = toCoin.tokenId.slice("nep141:".length);
  let ok: boolean;
  try {
    ok = !!registered && (await registered(contract, to.address));
  } catch {
    throw new ProblemError(walletProblems.nodesUnreachable());
  }
  if (!ok) throw new ProblemError(walletProblems.payeeNotSetUp(to.address, toCoin.symbol));
}
