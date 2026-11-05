// The debit card: bring your own. The person opens a self-custody card with the issuer, in the issuer's own app and
// with the issuer's own ID check. Pay only tops it up from the balance, in one tap, to the card's own address.
//
// Honest words for the screen: the card spends from its own balance, which Pay tops up from the main balance. It does
// not spend straight from the main balance. ZeroFee runs no card programme and never sees card details.
//
// Each card tops up on exactly one chain with exactly one set of coins. Sending the wrong coin, or on the wrong chain,
// can lose the money, so the target is fixed per card and the address is checked against that chain.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { compare } from "../amount.ts";
import { chainsForAddress, chainName } from "../chains.ts";
import { readPayCode } from "../codes/parse.ts";
import { payProblems } from "../pay-problems.ts";
import type { PayTarget } from "../plan.ts";
import type { TokenDirectory } from "../tokens.ts";

export interface CardProduct {
  id: "etherfi-cash" | "gnosis-pay" | "tangem-pay" | "metamask-card";
  name: string;
  /** Opens in the system's browser sheet: the issuer's own consumer sign-up (not its business pages). */
  signupUrl: string;
  /** One line under "Get …": the issuer decides who it can give a card to, and checks it first (UI, a phone test). */
  signupNote: string;
  /** The one chain it tops up on, and the coins it takes there (ledger symbols). */
  chain: string;
  coins: string[];
  /** Where the person finds the address to paste, in the issuer's app. */
  addressHint: string;
  /** Said plainly before the first top-up. */
  topUpNote: string;
  reachNote: string;
  checked: string;
  /**
   * A plain hand-off (D35): the card is made in the issuer's own app and nothing on chain can prove its address is a
   * card (no card.check), so it's saved on the paste and checked by the person after its first, small top-up.
   */
  handOff?: boolean;
  /**
   * When the card stops working, as an instant (ISO, UTC): no new cards; an existing one is topped up until then, and
   * never after (Security's MUST 1). `withdraw` says where the money already in its account is taken out.
   */
  endsOn?: { at: string; withdraw: string };
  /**
   * Each coin's contract on its chain, where a live source says which one (Security's SHOULD on a7731f2): the issuer
   * names the coin and network, Circle's own list gives native USDC's contract (CIRCLE_USDC). A top-up sends exactly
   * it; money back needs Receive to take exactly it. A coin with none here: top-ups by its symbol (one match only, never
   * a guess), money back only "Open X".
   */
  contracts?: Readonly<Record<string, string>>;
}

/** Circle's USDC contracts, developers.circle.com/stablecoins/usdc-contract-addresses (read 27 Oct 2026). */
const CIRCLE_USDC = { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", pol: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" } as const;

export const CARDS: readonly CardProduct[] = [
  {
    // D35 (UI): the card a new person gets. Made in ether.fi's own sign-up (its page, a plain partner
    // window); its account has one deposit address that takes deposits on Base, so Pay tops it up with USDC on Base.
    id: "etherfi-cash",
    name: "ether.fi",
    signupUrl: "https://www.ether.fi/app/cash/sign-up",
    signupNote: "ether.fi checks your ID in its own screens.",
    chain: "base",
    coins: ["USDC"],
    contracts: { USDC: CIRCLE_USDC.base },
    // help.ether.fi "USDC and USDT deposit networks and addresses" (2026-10): USDC on Base goes to the main Vault address
    // shown after picking USDC, then Base; a separate look-alike "provider" address serves other networks. No stated
    // minimum, so the first top-up is called a test (Security's MUST 2).
    addressHint: "In the ether.fi app: Deposit, USDC, Base. Copy the address it shows.",
    topUpNote: "Pay sends USDC on Base to your ether.fi card's address.",
    reachNote: "A Visa card from ether.fi, topped up from your Safe.",
    checked: "etherfi.gitbook.io (Cash, technical documentation), 2026-10-26: one deposit address per account, deposits from Ethereum, Base and Arbitrum reach its Vault. The owner checks in its app that USDC is a supported asset.",
    handOff: true,
  },
  {
    id: "gnosis-pay",
    name: "Gnosis Pay",
    // The consumer app (sign up → ID check → order the card → the Safe address), not gnosispay.com's business page.
    signupUrl: "https://app.gnosispay.com",
    signupNote: "Only where Gnosis Pay issues cards. It checks that first.",
    chain: "gnosis",
    coins: ["EURe", "GBPe", "USDC"],
    addressHint: "In the Gnosis Pay app: your account's address (Gnosis Chain).",
    topUpNote: "Your card spends EURe in Europe, GBPe in the UK, or USDC. Pay sends the one you choose to your card's account on Gnosis Chain.",
    // D26: what the card is, never where it's available (the issuer checks that in its own screens).
    reachNote: "Your own Visa debit card.",
    checked: "docs.gnosispay.com, 2026-10-25. All three coins are on NEAR Intents' list on Gnosis.",
    // Gnosis Pay's formal notice (21 Sep 2026): its consumer card stops at 23:59 UTC on 20 December 2026, and the web
    // app stays open for withdrawals only.
    endsOn: { at: "2026-12-20T23:59:00Z", withdraw: "Your money there is still yours. Open app.gnosispay.com and tap Withdraw." },
  },
  {
    id: "tangem-pay",
    name: "Tangem Pay",
    signupUrl: "https://tangem.com/en/tgnm-pay/",
    signupNote: "Only where Tangem Pay issues cards. It checks that first.",
    chain: "pol",
    coins: ["USDC"],
    // Its own page says native USDC on Polygon (checked below); Circle's list gives that contract.
    contracts: { USDC: CIRCLE_USDC.pol },
    addressHint: "In the Tangem app: your Tangem Pay top-up address (Polygon).",
    topUpNote: "Your card takes native USDC on Polygon only. Pay sends exactly that.",
    reachNote: "Native USDC on Polygon. Needs a Tangem wallet.",
    checked: "tangem.com, 2026-10-25: an external wallet may top it up with native USDC on Polygon.",
  },
  {
    id: "metamask-card",
    name: "MetaMask Card",
    signupUrl: "https://metamask.io/card",
    signupNote: "Only where MetaMask Card is issued. It checks that first.",
    chain: "base",
    coins: ["USDC"],
    contracts: { USDC: CIRCLE_USDC.base },
    addressHint: "In MetaMask: your account address. Set the card's spending limit there too.",
    topUpNote: "This card spends from your MetaMask account on Base, within the limit you set in MetaMask. Pay sends USDC there.",
    reachNote: "Spends from your MetaMask account on Base, within a limit you set.",
    checked: "support.metamask.io, 2026-10-25: funds in the MetaMask account, spent through an on-chain spending limit.",
  },
];

/** The first top-up to a newly added card is small, to be sure it lands where the person expects (UI's review). */
export const FIRST_TOPUP_MAX = "5";

/** The card's end in words ("20 December 2026", or "20 Dec" short), from its instant, read in UTC. */
export function endsWords(product: CardProduct, short = false): string {
  if (!product.endsOn) return "";
  return new Date(product.endsOn.at).toLocaleDateString("en-GB", { day: "numeric", month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** Past its end: no top-up is sent (Security's MUST 1). */
export const cardStopped = (product: CardProduct, now = Date.now()) => Boolean(product.endsOn) && now >= Date.parse(product.endsOn!.at);

/** Its last week: the top-up screen says when it stops. */
export const cardEndingSoon = (product: CardProduct, now = Date.now()) => Boolean(product.endsOn) && !cardStopped(product, now) && now >= Date.parse(product.endsOn!.at) - 7 * 86_400_000;

/** The core's answer (card.check, S1): read on Gnosis Chain from two nodes; `why` says what it is instead. */
export interface CardAccount {
  isCard: boolean;
  why?: string;
}

/**
 * Proves a pasted address is a real card account before Pay saves it or sends to it: a wrong or swapped address would
 * send top-ups into the void, and nobody can check a 0x string by eye. The core's card.check reads it on Gnosis Chain
 * (a Safe set up exactly the Gnosis Pay way). It can't prove the card is THIS person's (a look-alike costs cents), so
 * the first top-up stays small and the person confirms it arrived before a bigger one (see confirmFirstTopUp).
 */
export async function checkCard(bridge: Bridge, product: CardProduct, address: string): Promise<{ ok: CardAccount } | { problem: Problem }> {
  const format = cardAddressProblem(product, address);
  if (format) return { problem: format };
  const r = await bridge.call<CardAccount>("card.check", { product: product.id, address: address.trim() });
  // A host that can't do this check at all (no such method) and one that can't right now both mean: not saved.
  if ("problem" in r) return { problem: /unknown$/.test(r.problem.code) ? payProblems.cardUnchecked(product.name) : r.problem };
  if (!r.ok.isCard) return { problem: payProblems.cardNotCard(product.name, r.ok.why) };
  return { ok: r.ok };
}

/** Whether this build can prove card addresses at all. Until it can, the card stays off screen (D13). */
export async function cardCheckLive(bridge: Bridge): Promise<boolean> {
  // Live only when the check really answers (a zero address is simply "not a card").
  const r = await bridge.call("card.check", { product: "gnosis-pay", address: "0x0000000000000000000000000000000000000000" });
  return "ok" in r;
}

export interface SavedCard {
  productId: CardProduct["id"];
  /** The card's own top-up address, pasted from the issuer's app. */
  address: string;
  /** Which of the card's coins to send. */
  coin: string;
  /** Set after the first (small) top-up went through. */
  confirmed?: boolean;
  /** The last top-up, so the next one is one tap (ALPHA: one-click use). */
  lastAmount?: string;
}

/** Several cards side by side (D38), at most one per product; the old single card (card.v1) moves over once. */
const KEY = "cards.v2";
const OLD_KEY = "card.v1";

/** Checks a pasted address against the card's one chain before it's saved. */
export function cardAddressProblem(product: CardProduct, address: string): Problem | null {
  const network = chainName(product.chain);
  if (!address.trim()) return payProblems.cardAddressNeeded(product.name);
  if (!chainsForAddress(address.trim()).includes(product.chain)) return payProblems.cardAddressWrong(product.name, network);
  return null;
}

/**
 * The card's address from what the person copied in the card's own app (or a code of it): a bare address, or a
 * payment link naming one. Null when it isn't an address on the card's chain.
 */
export function readCardAddress(text: string | null | undefined, product: CardProduct): string | null {
  const t = text?.trim();
  if (!t) return null;
  const code = readPayCode(t);
  const address = code.kind === "crypto" ? code.address : t;
  return chainsForAddress(address).includes(product.chain) ? address : null;
}

/** Proven on the card's chain first (card.check), then saved: never on a paste alone. The card, or the Problem to show. */
export async function checkAndSaveCard(bridge: Bridge, product: CardProduct, address: string, coin: string): Promise<{ ok: SavedCard } | { problem: Problem }> {
  // A hand-off card has nothing to prove on chain: saved on its chain's address shape, checked by its first small top-up.
  if (!product.handOff) {
    const proof = await checkCard(bridge, product, address);
    if ("problem" in proof) return proof;
  }
  const card: SavedCard = { productId: product.id, address: address.trim(), coin };
  const problem = await saveCard(bridge, card);
  return problem ? { problem } : { ok: card };
}

/** The amount a top-up starts at: the small first one until the person confirms it arrived, then the last one. */
export function nextTopUpAmount(card: SavedCard): string {
  return card.confirmed ? (card.lastAmount ?? "0") : FIRST_TOPUP_MAX;
}

/** Remembers a top-up that went through, so the next starts from it. */
export async function rememberTopUp(bridge: Bridge, amount: string, productId?: CardProduct["id"]): Promise<void> {
  const card = await loadCard(bridge, productId);
  if (card) await saveCard(bridge, { ...card, lastAmount: amount });
}

/** What a top-up sends: exactly the card's coin, on the card's chain, to the card's address. Never to a stopped card. */
/** The exact coin a card takes, from Pay's list: by its pinned contract, else by symbol when only one matches. */
export function coinToken(product: CardProduct, coin: string, tokens: TokenDirectory) {
  const contract = product.contracts?.[coin];
  return contract ? tokens.find(product.chain, { contract }) : tokens.find(product.chain, { symbol: coin });
}

/**
 * Money back from a card (D38): the asset Receive must take for it, only where the card's coin contract is pinned
 * (Security's SHOULD on a7731f2: USDC on Polygon isn't USDC.e). Undefined: Pay shows only "Open X", never an address.
 */
export function moneyBackAsset(productId: CardProduct["id"], coin: string, tokens: TokenDirectory): string | undefined {
  const product = CARDS.find((c) => c.id === productId);
  const contract = product?.contracts?.[coin];
  return product && contract ? tokens.find(product.chain, { contract })?.assetId : undefined;
}

export function topUpTarget(card: SavedCard, amount: string, tokens: TokenDirectory, now = Date.now()): { ok: PayTarget } | { problem: Problem } {
  const product = CARDS.find((c) => c.id === card.productId);
  if (!product) return { problem: payProblems.cardAddressNeeded("card") };
  if (product.endsOn && cardStopped(product, now)) return { problem: payProblems.cardStopped(product.name, endsWords(product, true), product.endsOn.withdraw) };
  const problem = cardAddressProblem(product, card.address);
  if (problem) return { problem };
  if (!product.coins.includes(card.coin)) return { problem: payProblems.coinUnsupported(`${product.name} doesn't take ${card.coin}.`) };
  if (!card.confirmed && compare(amount, FIRST_TOPUP_MAX) > 0) return { problem: payProblems.cardFirstSmall(FIRST_TOPUP_MAX, card.coin) };
  const token = coinToken(product, card.coin, tokens);
  if (!token) return { problem: payProblems.coinUnsupported(`${card.coin} on ${chainName(product.chain)} isn't available to send right now.`) };
  return {
    ok: { to: { kind: "chain", chain: product.chain, address: card.address.trim() }, token, amount, name: product.name, activity: `${ACTIVITY.card} · ${product.name}`, notes: [] },
  };
}

/** How Recent names a payment to a provider (the robot's final round): what it was, and to whom; never an address. */
export const ACTIVITY = { card: "Card top-up", voucher: "Gift card", exchange: "Exchange" } as const;

const FORGOTTEN_KEY = "card.forgotten.v1";

/** A forgotten address as a hash (Security's SHOULD): enough to recognise it, nothing to reuse. */
async function addressHash(productId: string, address: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${productId}:${address.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadForgotten(bridge: Bridge): Promise<string[]> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: FORGOTTEN_KEY });
  try {
    return "ok" in r && r.ok.value ? (JSON.parse(r.ok.value) as string[]) : [];
  } catch {
    return [];
  }
}

/** After "No, it didn't": that card's address, remembered only as a hash (the last 10). */
export async function rememberForgotten(bridge: Bridge, productId: CardProduct["id"], address: string): Promise<void> {
  const all = [...(await loadForgotten(bridge)), await addressHash(productId, address)].slice(-10);
  await bridge.call("device.store.set", { key: FORGOTTEN_KEY, value: JSON.stringify(all) });
}

/** The person pasted, for this card, an address their money didn't show at before. */
export async function wasForgotten(bridge: Bridge, productId: CardProduct["id"], address: string): Promise<boolean> {
  return (await loadForgotten(bridge)).includes(await addressHash(productId, address));
}

/** Every saved card, kept on this phone only (several side by side, one per product). */
export async function loadCards(bridge: Bridge): Promise<SavedCard[]> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if ("ok" in r && r.ok.value !== null) {
    try {
      const list = JSON.parse(r.ok.value) as unknown;
      return Array.isArray(list) ? (list as SavedCard[]) : [];
    } catch {
      return [];
    }
  }
  // The single card from before (card.v1), once.
  const old = await bridge.call<{ value: string | null }>("device.store.get", { key: OLD_KEY });
  if (!("ok" in old) || old.ok.value === null) return [];
  try {
    const card = JSON.parse(old.ok.value) as SavedCard;
    await bridge.call("device.store.set", { key: KEY, value: JSON.stringify([card]) });
    await bridge.call("device.store.set", { key: OLD_KEY, value: null });
    return [card];
  } catch {
    return [];
  }
}

/** A product's saved card, or (no product named) the first one. */
export async function loadCard(bridge: Bridge, productId?: CardProduct["id"]): Promise<SavedCard | null> {
  const cards = await loadCards(bridge);
  return (productId ? cards.find((c) => c.productId === productId) : cards[0]) ?? null;
}

async function storeCards(bridge: Bridge, cards: SavedCard[]): Promise<Problem | null> {
  const r = await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(cards) });
  return "problem" in r ? r.problem : null;
}

export async function saveCard(bridge: Bridge, card: SavedCard): Promise<Problem | null> {
  const product = CARDS.find((c) => c.id === card.productId);
  if (!product) return payProblems.cardAddressNeeded("card");
  const problem = cardAddressProblem(product, card.address);
  if (problem) return problem;
  const cards = (await loadCards(bridge)).filter((c) => c.productId !== card.productId);
  return storeCards(bridge, [...cards, { ...card, address: card.address.trim() }]);
}

/**
 * The card's own wallet (Security F): a small separate wallet on Gnosis Chain that owns the card's Safe, with its own
 * standard key, never the Browser wallet's; it signs only Pay's card flows and the Gnosis Pay window's (pinned to
 * app.gnosispay.com). One per phone: asking again gives the same one. Made before Gnosis Pay opens, so its sign-up
 * finds it as the wallet.
 */
export async function ensureCardWallet(bridge: Bridge): Promise<{ ok: { address: string } } | { problem: Problem }> {
  const r = await bridge.call<{ address: string }>("subwallet.create", { kind: "pay", chain: "gnosis" });
  return "problem" in r ? r : { ok: { address: r.ok.address } };
}

/** Security's words for it (F3): said where the card is set up. */
export const CARD_WALLET_WORDS = "Pay makes a small, separate wallet for your card. Its key is a standard one, not as strong as your Safe's. Keep only what you'll spend in it.";

/** Forgets the card on this phone (the card itself is untouched, in the issuer's own app). */
export async function removeCard(bridge: Bridge, productId?: CardProduct["id"]): Promise<void> {
  const cards = await loadCards(bridge);
  const gone = productId ?? cards[0]?.productId;
  await storeCards(bridge, cards.filter((c) => c.productId !== gone));
}

/** After the first top-up goes through, later ones aren't capped. */
export async function markConfirmed(bridge: Bridge, productId?: CardProduct["id"]): Promise<void> {
  const card = await loadCard(bridge, productId);
  if (card && !card.confirmed) await saveCard(bridge, { ...card, confirmed: true });
}

/**
 * After the first, small top-up: did it arrive in the card's own app? Only "yes" unlocks normal top-ups to this
 * address. "No" forgets the address and says to copy it again from the card's app: the address may be a look-alike.
 * "Not yet" leaves it as it is, still capped, and asks again after the next small top-up.
 */
export async function confirmFirstTopUp(bridge: Bridge, answer: "yes" | "no" | "not-yet", productId?: CardProduct["id"]): Promise<Problem | null> {
  if (answer === "yes") {
    await markConfirmed(bridge, productId);
    return null;
  }
  if (answer === "no") {
    // Only that card's address goes (it may be a look-alike); the others stay.
    const card = await loadCard(bridge, productId);
    if (card) await removeCard(bridge, card.productId);
    return payProblems.cardNotArrived(CARDS.find((c) => c.id === card?.productId)?.name ?? "your card");
  }
  return null;
}
