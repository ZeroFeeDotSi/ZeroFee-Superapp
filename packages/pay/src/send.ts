// Send to a friend: by NEAR name, by address, or from contacts kept on this phone only.
//
// Who they are decides the route:
//   a ZeroFee person (their account holds coins in the ledger)  → a transfer inside the ledger: instant, no fee;
//   any other NEAR account                                       → paid out to their NEAR wallet;
//   an address on another chain                                  → paid out on that chain, converting if needed.
// The friend always receives exactly the amount typed; any fee is shown before confirming and comes from the sender.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { chain, chainsForAddress, isNamedNearAccount, isNearAccount, chainName } from "./chains.ts";
import type { ContactBook } from "./contacts.ts";
import type { RecipientInfo, Token } from "@zerofee/wallet/types.ts";
import { payProblems } from "./pay-problems.ts";
import type { PayTarget } from "./plan.ts";
import type { TokenDirectory } from "./tokens.ts";

export type Recipient =
  | { kind: "ledger"; accountId: string }
  | { kind: "near-wallet"; accountId: string }
  | { kind: "address"; chain: string | null; candidates: string[]; address: string; memo?: string };

export interface Found {
  recipient: Recipient;
  /** The saved contact, when the person typed a contact's name. */
  contactId?: string;
  /** What was read out of a pasted link or pay link: the name or address in it, and its amount (a `near:` link's NEAR). */
  fromLink?: { text: string; amount?: string };
}

/** Path parts that come right before an account in an explorer's address ("/address/bob.near", "/accounts/…"). */
const ACCOUNT_PARTS = /^(address|addresses|account|accounts|wallet|user|u)$/i;
const PAYMENT_PARTS = /^(tx|txs|txn|txns|transaction|transactions|receipt|receipts|block|blocks)$/i;
/** Path parts of a coin's own page (a token, contract, NFT or mint): the coin's address, never a person's (security
 *  review 2 Nov: `solscan.io/token/<mint>` and `nearblocks.io/token/usdt.tether-token.near` were read as the recipient). */
const COIN_PARTS = /^(token|contract|nft|mint)$/i;

/**
 * A pasted web link or pay link, read for the account or address in it (grade 02g, G19: a nearblocks address page and
 * `near:guest-book.testnet?amount=0.01` both got "That isn't a name or address we recognise"). An explorer's address
 * page gives its account; a `near:`/`solana:`/`ethereum:` link gives its target, and a `near:` link's amount too. A
 * link to a transaction, or with nothing in it, is a Problem that says so. Null: not a link at all.
 */
export function readPasted(input: string): { ok: { text: string; amount?: string } } | { problem: Problem } | null {
  const t = input.trim();
  const pay = /^(near|solana|ethereum|bitcoin|zerofee-pay):(?:\/\/)?([^?\s#]+)(?:\?([^\s#]*))?$/i.exec(t);
  if (pay && !/^https?$/i.test(pay[1])) {
    // a broken escape (`near:%E0`) is a plain line, never a Paste that silently does nothing (security review 2 Nov)
    let to: string;
    try {
      to = decodeURIComponent(pay[2].split("@")[0]).replace(/\/$/, "");
    } catch {
      return { problem: payProblems.recipientLinkUnreadable() };
    }
    const amount = new URLSearchParams(pay[3] ?? "").get("amount") ?? undefined;
    const near = pay[1].toLowerCase() === "near";
    return { ok: { text: near ? to.toLowerCase() : to, ...(near && amount && /^\d+(\.\d+)?$/.test(amount) ? { amount } : {}) } };
  }
  if (!/^https?:\/\//i.test(t)) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return { problem: payProblems.recipientLink() };
  }
  const parts = url.pathname.split("/").map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).filter(Boolean);
  // A coin's own page names the coin (its mint, its contract): money sent there is lost, so it is never the recipient.
  if (parts.some((p) => COIN_PARTS.test(p))) return { problem: payProblems.recipientCoinLink() };
  const isAccount = (p: string) => isNamedNearAccount(p.toLowerCase()) || /^[0-9a-f]{64}$/.test(p.toLowerCase()) || chainsForAddress(p).length > 0;
  const after = parts.findIndex((p, i) => ACCOUNT_PARTS.test(p) && parts[i + 1] !== undefined && isAccount(parts[i + 1]));
  if (after >= 0) return { ok: { text: parts[after + 1] } };
  // A transaction's page names a hash, which can look like an address: said for what it is, never paid to.
  if (parts.some((p) => PAYMENT_PARTS.test(p))) return { problem: payProblems.recipientPaymentLink() };
  const named = [...parts, ...url.searchParams.values()].find((p) => isNamedNearAccount(p.toLowerCase()));
  if (named) return { ok: { text: named.toLowerCase() } };
  const address = [...parts, ...url.searchParams.values()].find((p) => chainsForAddress(p).length > 0);
  return address ? { ok: { text: address } } : { problem: payProblems.recipientLink() };
}

/** Letters apart, stopping early (insert, delete, change, swap two side by side). */
function apart(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** "Did you mean" for a NEAR name that has no account (grade 02g, F21): the closest name this person has paid or saved,
 *  at most two letters apart. Only names they already know: never a stranger's look-alike. */
export function didYouMean(typed: string, known: readonly string[]): string | null {
  let best: { name: string; n: number } | null = null;
  for (const name of new Set(known)) {
    if (name === typed) continue;
    const n = apart(typed, name, 2);
    if (n <= 2 && (!best || n < best.n)) best = { name, n };
  }
  return best?.name ?? null;
}

/** Turns what the person typed into who gets the money. Checks NEAR names on the network (two nodes, S3). */
export async function findRecipient(
  bridge: Bridge,
  input: string,
  options: { contacts?: ContactBook; self?: string } = {},
): Promise<{ ok: Found } | { problem: Problem }> {
  const pasted = readPasted(input);
  if (pasted && "problem" in pasted) return pasted;
  const text = pasted ? pasted.ok.text : input.trim();
  const contact = options.contacts?.byName(text);
  if (contact) return { ok: { recipient: contact.to, contactId: contact.id } };
  const found = await findTyped(bridge, text, options);
  return pasted && "ok" in found ? { ok: { ...found.ok, fromLink: pasted.ok } } : found;
}

async function findTyped(bridge: Bridge, text: string, options: { self?: string }): Promise<{ ok: Found } | { problem: Problem }> {
  const lower = text.toLowerCase();
  if (isNamedNearAccount(lower) || /^[0-9a-f]{64}$/.test(lower)) {
    if (lower === options.self) return { problem: payProblems.recipientSelf() };
    const info = await bridge.call<RecipientInfo>("ledger.recipientInfo", { accountId: lower });
    if ("problem" in info) {
      // Until the ledger can check names, pay out to the NEAR wallet: that reaches any NEAR account.
      if (info.problem.code === "security.method.unknown") return { ok: { recipient: { kind: "near-wallet", accountId: lower } } };
      return info;
    }
    // A 64-hex implicit account is made by the first NEAR sent to it, so "not there yet" is no reason to refuse it.
    if (!info.ok.exists && !/^[0-9a-f]{64}$/.test(lower)) return { problem: payProblems.recipientMissing(lower) };
    return { ok: { recipient: { kind: info.ok.hasLedgerBalance ? "ledger" : "near-wallet", accountId: lower } } };
  }

  const candidates = chainsForAddress(text).filter((c) => c !== "near");
  // row 1: a top-level NEAR account ("aurora", "sweat"), typed in lower case and no other chain's address, is a
  // NEAR account when NEAR says it exists; a word that isn't one stays "isn't an account or an address". Only under 32
  // letters (the registrar's names): a lowercased Solana or other address is never read as one
  if (candidates.length === 0 && text === lower && lower.length < 32 && isNearAccount(lower) && !/^0x/.test(lower)) {
    if (lower === options.self) return { problem: payProblems.recipientSelf() };
    const info = await bridge.call<RecipientInfo>("ledger.recipientInfo", { accountId: lower });
    if ("ok" in info && info.ok.exists) return { ok: { recipient: { kind: info.ok.hasLedgerBalance ? "ledger" : "near-wallet", accountId: lower } } };
    return { problem: payProblems.recipientInvalid() };
  }
  if (candidates.length === 0) return { problem: payProblems.recipientInvalid() };
  return { ok: { recipient: { kind: "address", chain: candidates.length === 1 ? candidates[0] : null, candidates, address: text } } };
}

/**
 * What the friend receives: the coin the sender picked, on the friend's chain. USDC sent to a Solana address arrives
 * as USDC on Solana, whichever USDC the sender holds.
 */
export function targetForSend(
  recipient: Recipient,
  sending: Token,
  amount: string,
  tokens: TokenDirectory,
  options: { network?: string; memo?: string; message?: string } = {},
): { ok: PayTarget } | { problem: Problem; ask?: "network"; networks?: string[] } {
  const onChain = (chainId: string): Token | undefined =>
    sending.chain === chainId ? sending : tokens.find(chainId, { symbol: sending.symbol });

  if (recipient.kind === "ledger") {
    return { ok: { to: { kind: "ledger", accountId: recipient.accountId }, token: sending, amount, notes: [], ref: options.memo, message: options.message } };
  }
  if (recipient.kind === "near-wallet") {
    if (!isNearAccount(recipient.accountId)) return { problem: payProblems.recipientInvalid() };
    const token = onChain("near");
    if (!token) return { problem: payProblems.coinUnsupported(`You can't send ${sending.symbol} to a NEAR wallet.`) };
    return { ok: { to: { kind: "chain", chain: "near", address: recipient.accountId }, token, amount, notes: [] } };
  }
  const network = recipient.chain ?? (options.network && recipient.candidates.includes(options.network) ? options.network : null);
  if (!network) return { problem: payProblems.networkNeeded(), ask: "network", networks: recipient.candidates };
  const token = onChain(network);
  if (!token) {
    return { problem: payProblems.coinUnsupported(`${sending.symbol} isn't available on ${chainName(network)}.`) };
  }
  const memo = recipient.memo ?? options.memo;
  if (memo && chain(network)?.memoSendable === false) return { problem: payProblems.memoUnsupported(chain(network)!.name) };
  return {
    ok: { to: { kind: "chain", chain: network, address: recipient.address, ...(memo ? { memo } : {}) }, token, amount, notes: [] },
  };
}
