// The provider registry's seed (RECIPES.md §1, D38): one recipe per provider, bound to its domain. What Pay lists comes
// from here, never from a hand-kept list per country; every claim has a source. A recipe NEVER carries an address
// (Security §4.3): a deposit address only ever comes from the person's own paste (D33). ZeroFee ranks, endorses and
// stands behind none of them (the product rule): screens list them A–Z with what they are and who says what.
//
// "verified" is the user robot's result (tools/pay/verify-recipes.mjs, RECIPES §3); in this seed it records the
// research read of the date given. Only "green" shows; "research" is a note that never shows (Peer, a PromptPay rail).
import { CARDS, type CardProduct } from "./partners/cards.ts";
import { EXCHANGE_PRESETS, type ExchangePreset } from "./partners/exchange.ts";
import { VERIFIED } from "./verified.ts";

export type Kind = "card" | "bank" | "exchange" | "voucher" | "rail";

/** A published cost, and who says it: the provider itself (its own page) or a review. Never guessed. */
export interface CostFact {
  says: string;
  by: "itself" | "a review";
}

export interface Recipe {
  recipe: 1;
  id: string;
  name: string;
  /** Exact host, the trust anchor (RECIPES §4.1). Shown beside the name. */
  domain: string;
  kind: Kind;
  signup: { url: string; where: "web" | "app" };
  /**
   * How money reaches it. address: it shows a deposit address the person pastes. checkout: its checkout shows an
   * address and an exact amount to pay. unknown: its own page doesn't say which coin and network, so Pay never sends.
   */
  funding: {
    how: "address" | "checkout" | "unknown";
    coins: readonly { coin: string; networks: readonly string[] }[];
    minimum: string | null;
    /** Its own page that states the coin and each network Pay sends on (one of `source`): the verifier checks it there. */
    stated?: string;
  };
  /** What it pays out to: "visa-card", "mastercard", "bank-transfer", "iban", "codes" (gift cards and top-ups). */
  payout: readonly string[];
  /** Places Pay asks about ("*" every one); the provider's own decision, never said on screen (D26). */
  countries: { include: readonly string[]; exclude: readonly string[] };
  fees: readonly CostFact[];
  /** Other facts in its own words (each from `source`): who runs it, what can happen to the money. */
  facts: readonly string[];
  /** Its ID check: "provider" always, "some" only for some of its products (a no-ID path exists), "none" never. */
  identity: "provider" | "some" | "none";
  /**
   * What the person does at the provider before it's usable (product decision, 27 Oct), in order, from its own
   * pages: each one thing they do themselves (make the account, install its app, its ID check, buy or order the card,
   * set up a wallet). Waiting for a review isn't a step. Listed only with MAX_STEPS or fewer; none on record: not listed.
   */
  steps?: readonly string[];
  /** Bank codes it pays (repo recipes only, Security §4.4). */
  scan: readonly string[];
  balance: { readable: "onchain" | "api" | "none" };
  /** What it is, one line. Never where it's available (D26), never a judgement. */
  line: string;
  source: readonly string[];
  verified: { at: string; by: string; result: "green" | "red" | "changed" | "research" };
  /** A closing notice found on its site: top-ups stop at `at` (RECIPES §4.9). */
  closing?: { at: string; withdraw: string };
  /** Its own refund or support page, on its own registrable domain (Security's MUST d). */
  refund?: string;
  /** Pay's own screen for it, when there is one. */
  card?: CardProduct["id"];
  preset?: ExchangePreset["id"];
}

/** Security's lines beside providerLine for a card with no ID check (RECIPES §4b.7). */
export const NO_ID_LINES = [
  "No ID check also means no one can unfreeze or recover this card for you. Keep only what you'll spend.",
  "Check that prepaid cards are allowed where you live.",
];

const ALL = { include: ["*"], exclude: [] };
const READ = (at: string) => ({ at, by: "pay-session research", result: "green" as const });

const card = (id: CardProduct["id"]) => CARDS.find((c) => c.id === id)!;

/** Where each exchange is listed (its own pages; research of 26 Oct 2026). */
const EXCHANGE_PLACES: Record<string, readonly string[]> = {
  pexx: ["TH", "ZZ"],
  "binance-th": ["TH"],
  "coins-ph": ["PH"],
  indodax: ["ID"],
  "binance-br": ["BR"],
  quidax: ["NG"],
  paribu: ["TR"],
  kraken: ["EU", "GB"],
};

/** Sourced facts, in its own words (Security, SHOULD 2: a fact, never our label). */
const EXCHANGE_FACTS: Record<string, readonly string[]> = {
  pexx: ["Run by PEXX Technology Pty Ltd, Australia. Registered with AUSTRAC as a digital currency exchange (its own site)."],
};

/**
 * Each exchange's own steps before it takes a USDC deposit (the product's "fewer than 5", 27 Oct), from its own help pages:
 * support.kraken.com, binance.th FAQ, support.coins.ph, indodax.com, binance.com (pt-BR), paribu.com/destek.
 */
const EXCHANGE_STEPS: Record<string, readonly string[]> = {
  kraken: ["an account", "its ID check", "a deposit address"],
  "binance-th": ["an account", "its ID check", "its suitability test"],
  "coins-ph": ["an account", "its ID check"],
  indodax: ["an account", "install its app", "its ID check"],
  "binance-br": ["an account", "its ID check"],
  paribu: ["an account", "install its app", "its ID check", "a lira deposit from your own bank"],
};

const EXCHANGE_FEES: Record<string, readonly CostFact[]> = {
  "binance-th": [{ says: "Taking money out to your bank costs ฿20.", by: "itself" }],
  kraken: [{ says: "Taking money out to your bank costs about €1 (SEPA Instant) or £1.95 (Faster Payments).", by: "itself" }],
};

export const REGISTRY: readonly Recipe[] = [
  {
    recipe: 1, id: "etherfi-cash", name: "ether.fi", domain: "www.ether.fi", kind: "card",
    signup: { url: card("etherfi-cash").signupUrl, where: "web" },
    funding: { how: "address", coins: [{ coin: "USDC", networks: ["base"] }], minimum: null, stated: "https://help.ether.fi/en/articles/833702-usdc-and-usdt-deposit-networks-and-addresses" },
    payout: ["visa-card"], countries: ALL,
    // Security (bc69ead, SHOULD 1): no figure from a review without its URL. Its own help pages (27 Oct 2026): the first
    // virtual card is free for Core members and $10 in some regions; a $10 deposit comes before its ID check, every region.
    fees: [{ says: "Core members normally get one free virtual card; in some regions the first one costs $10.", by: "itself" }],
    facts: [], identity: "provider", steps: ["an account", "a $10 deposit", "its ID check", "add the card"], scan: [], balance: { readable: "none" },
    line: card("etherfi-cash").reachNote,
    source: ["https://etherfi.gitbook.io/etherfi/products/cash/technical-documentation", "https://help.ether.fi/en/articles/833702-usdc-and-usdt-deposit-networks-and-addresses", "https://help.ether.fi/en/articles/833743", "https://help.ether.fi/en/articles/758781"],
    verified: READ("2026-10-26"), card: "etherfi-cash",
  },
  {
    recipe: 1, id: "metamask-card", name: "MetaMask Card", domain: "metamask.io", kind: "card",
    signup: { url: card("metamask-card").signupUrl, where: "app" },
    funding: { how: "address", coins: [{ coin: "USDC", networks: ["base"] }], minimum: null, stated: "https://support.metamask.io/trade/metamask-card/funding/" },
    payout: ["mastercard"], countries: { include: ["BR", "EU", "GB", "ZZ"], exclude: [] },
    fees: [{ says: "The virtual card is free.", by: "itself" }],
    facts: [], identity: "provider", steps: ["a MetaMask wallet", "a card account", "its ID check", "a spending limit"], scan: [], balance: { readable: "none" },
    line: card("metamask-card").reachNote,
    source: ["https://support.metamask.io/trade/metamask-card/what-is-metamask-card/", "https://support.metamask.io/trade/metamask-card/funding/"],
    verified: READ("2026-10-26"), card: "metamask-card",
  },
  {
    recipe: 1, id: "redotpay", name: "RedotPay", domain: "www.redotpay.com", kind: "card",
    signup: { url: "https://www.redotpay.com", where: "app" },
    funding: { how: "unknown", coins: [], minimum: null },
    payout: ["visa-card"], countries: { include: ["TH", "PH", "VN", "NG", "ZZ"], exclude: [] },
    fees: [], facts: ["Which networks it takes, and the least it takes, show only in its own app."],
    identity: "provider", steps: ["install its app", "an account", "its ID check", "pay the card fee", "apply for the card"], scan: [], balance: { readable: "none" },
    line: "A Visa card, made and topped up in its own app.",
    source: ["https://www.redotpay.com/", "https://helpcenter.redotpay.com/en/articles/10693364-supported-cryptocurrencies-networks-minimum-deposit"],
    verified: READ("2026-10-26"),
  },
  {
    recipe: 1, id: "bleap", name: "Bleap", domain: "www.bleap.finance", kind: "card",
    signup: { url: "https://www.bleap.finance", where: "app" },
    funding: { how: "unknown", coins: [], minimum: null },
    payout: ["mastercard"], countries: { include: ["BR", "EU"], exclude: [] },
    fees: [{ says: "No fee for spending in other currencies.", by: "itself" }], facts: [],
    identity: "provider", steps: ["install its app", "an account", "its ID check", "the virtual card"], scan: [], balance: { readable: "none" },
    line: "A Mastercard, made and topped up in its own app.",
    source: ["https://www.bleap.finance/"],
    verified: READ("2026-10-26"),
  },
  {
    // UI's decision (D38): listed as what it is, an account card, in its own words (terms of 27 Sep 2026). Pay sends to
    // it only once its deposit coin and network are known (its product page names neither).
    recipe: 1, id: "solcard", name: "SolCard", domain: "solcard.cc", kind: "card",
    signup: { url: "https://solcard.cc", where: "web" },
    funding: { how: "unknown", coins: [], minimum: null },
    payout: ["visa-card"], countries: ALL,
    // The dormancy charge is a cost: said before the pill, with the others (Security's SHOULD on 1ea4d90).
    fees: [
      { says: "Top-ups cost 5%, plus $10 for each new card.", by: "itself" },
      { says: "After 90 days unused, it may take 10% a month of what's left.", by: "itself" },
    ],
    facts: [
      "Run by SC Payments Ltd (Hong Kong). The card's issuer isn't named.",
      "You need an account; some cards need an ID check.",
      "A balance under its minimum isn't paid back.",
      "It can suspend a card without notice.",
      ...NO_ID_LINES,
    ],
    identity: "some", steps: ["an account", "buy the card"], scan: [], balance: { readable: "none" },
    line: "A prepaid card topped up with crypto, in an account with it.",
    source: ["https://solcard.cc/product", "https://solcard.cc/terms"],
    verified: READ("2026-10-26"),
  },
  {
    recipe: 1, id: "mt-pelerin", name: "Mt Pelerin", domain: "app.mtpelerin.com", kind: "bank",
    signup: { url: "https://app.mtpelerin.com", where: "web" },
    funding: { how: "address", coins: [{ coin: "USDC", networks: ["arb", "base", "eth"] }], minimum: null, stated: "https://www.mtpelerin.com/bridge/usdc" },
    payout: ["iban"],
    // Only outside the EU and UK until a product decision (its site: not offered to EU/UK residents, not MiCA-authorised);
    // not where it says it can't serve (ID).
    countries: { include: ["TH", "PH", "VN", "IN", "BR", "NG", "TR", "ZZ"], exclude: [] },
    fees: [], facts: [], identity: "provider", steps: ["an account", "its ID check", "ask for your IBAN"], scan: ["SEPA transfer", "QR-bill"], balance: { readable: "none" },
    line: "Your own bank account number (IBAN).",
    source: ["https://www.mtpelerin.com/sell-usdc", "https://www.mtpelerin.com/bridge/usdc"],
    verified: READ("2026-10-26"),
  },
  ...EXCHANGE_PRESETS.map((p): Recipe => ({
    recipe: 1, id: p.id, name: p.name, domain: new URL(p.site).hostname, kind: "exchange",
    signup: { url: p.site, where: p.signup },
    funding: { how: "address", coins: [{ coin: "USDC", networks: p.chains }], minimum: null, ...(p.stated ? { stated: p.stated } : {}) },
    payout: ["bank-transfer"],
    countries: { include: EXCHANGE_PLACES[p.id] ?? [], exclude: [] },
    fees: EXCHANGE_FEES[p.id] ?? [], facts: EXCHANGE_FACTS[p.id] ?? [], identity: "provider", ...(EXCHANGE_STEPS[p.id] ? { steps: EXCHANGE_STEPS[p.id] } : {}), scan: [], balance: { readable: "none" },
    line: sentence(p.label.split(" · ")[1] ?? ""),
    source: [p.site, ...(p.stated ? [p.stated] : [])],
    verified: READ("2026-10-26"), preset: p.id,
  })),
  {
    // Gift cards and top-ups (D38: kind "voucher"): its checkout in Pay's window, the person pastes the invoice's address
    // and exact amount, Pay's sheet pays, the code comes by email. Its docs (16 Mar 2026) list these USDC networks.
    recipe: 1, id: "bitrefill", name: "Bitrefill", domain: "www.bitrefill.com", kind: "voucher",
    signup: { url: "https://www.bitrefill.com", where: "web" },
    funding: { how: "checkout", coins: [{ coin: "USDC", networks: ["base", "sol", "arb", "eth"] }], minimum: null, stated: "https://docs.bitrefill.com/docs/crypto-payments" },
    payout: ["codes"], countries: ALL,
    fees: [{ says: "Each price is shown at its checkout.", by: "itself" }],
    facts: [
      "No account needed: the code is sent to your email.",
      "Without an account it allows up to $500 each day and $1,000 a month.",
      "A failed order is refunded; a code you've opened isn't.",
    ],
    identity: "none", steps: ["pick a gift card and pay"], scan: [], balance: { readable: "none" },
    line: "Gift cards and phone top-ups, paid in crypto.",
    source: ["https://docs.bitrefill.com/docs/crypto-payments", "https://help.bitrefill.com/hc/en-us/articles/360019310820-Do-I-need-a-Bitrefill-Account", "https://docs.bitrefill.com/docs/refunds"],
    refund: "https://docs.bitrefill.com/docs/refunds",
    verified: READ("2026-10-26"),
  },
  {
    // A research note, never shown (UI, 26 Oct): Peer's escrow is USDC on Base; it reaches THB only through Wise or
    // Revolut payers; no PromptPay rail (Peer adds rails, not anyone; Thai bank web sessions are nearly gone).
    recipe: 1, id: "peer", name: "Peer", domain: "peer.xyz", kind: "rail",
    signup: { url: "https://peer.xyz", where: "web" },
    funding: { how: "address", coins: [{ coin: "USDC", networks: ["base"] }], minimum: null },
    payout: ["wise", "revolut", "upi"], countries: { include: [], exclude: [] },
    fees: [], facts: [], identity: "none", scan: [], balance: { readable: "onchain" },
    line: "Sell USDC to people who pay you by Wise, Revolut or UPI.",
    source: ["https://docs.peer.xyz/protocol/v3/v3-overview", "https://github.com/zkp2p/peer-link/issues/256"],
    verified: { at: "2026-10-26", by: "pay-session research", result: "research" },
  },
];

function sentence(s: string): string {
  return s ? `${s[0].toUpperCase()}${s.slice(1)}.` : s;
}

/** The recipe's last verification: the verifier's run (verified.ts) over the seed's research read. */
export const verifiedOf = (r: Recipe): Recipe["verified"] & { why?: string } => (r.verified.result === "research" ? r.verified : VERIFIED[r.id] ?? r.verified);

const DAY_MS = 86_400_000;

/** Days since its last check. */
export const checkedDaysAgo = (r: Recipe, now = Date.now()) => Math.floor((now - Date.parse(verifiedOf(r).at)) / DAY_MS);

/**
 * Shown (RECIPES §2, amended 27 Oct so the app never empties itself): a green check up to 30 days old. From 7 days
 * its row says "Last checked N days ago" (lastChecked); older than 30 days, red, "changed" and research notes hide.
 */
/** At most this many steps at the provider to be listed (product decision, 27 Oct: fewer than 5, "simple, fast"). */
export const MAX_STEPS = 4;

/** Simple and fast enough to list: its steps are on record and there are MAX_STEPS or fewer. */
export const simple = (r: Recipe) => r.steps !== undefined && r.steps.length > 0 && r.steps.length <= MAX_STEPS;

/**
 * D77 + D98 (QA, 2 Nov): Mt Pelerin's bank tile has its sign-up type a person's legal name and date of birth into its
 * own KYC form, and the app never asks for or shows a person's name. While no card or bank account ships this quarter,
 * the tile is OFF: kept in code, never offered in What's available, never on Pay's Home, its page unreachable.
 */
import { BANK_TILE_ON } from "./bank-tile.ts";
export { BANK_TILE_ON };

export const shown = (r: Recipe, now = Date.now()) => (r.id !== "mt-pelerin" || BANK_TILE_ON) && verifiedOf(r).result === "green" && checkedDaysAgo(r, now) <= 30 && simple(r);

/** "Last checked N days ago" for a green check 7–30 days old; nothing when it's fresh. Never a "verified" badge. */
export const lastChecked = (r: Recipe, now = Date.now()): string | null => {
  const days = checkedDaysAgo(r, now);
  return shown(r, now) && days >= 7 ? `Last checked ${days} days ago` : null;
};

/**
 * How each network is written on providers' own pages (any of these counts), for the verifier's funding check: "green"
 * means the coin and every network Pay sends on are still stated (Security's MUST on e9fcc17). Each is matched as a whole
 * word, case as written (Security's MUST on 67a357d): "Coinbase" and "database" aren't Base, "display" isn't SPL.
 */
export const NETWORK_WORDS: Record<string, readonly string[]> = {
  base: ["Base", "BASE", "usdc_base"],
  sol: ["Solana", "SOLANA", "usdc_solana", "SPL"],
  arb: ["Arbitrum", "ARBITRUM", "usdc_arbitrum"],
  eth: ["Ethereum", "ETHEREUM", "ERC20", "ERC-20", "usdc_erc20"],
  pol: ["Polygon", "POLYGON"],
  bsc: ["BNB", "BEP20", "BEP-20", "BSC"],
  near: ["NEAR"],
};

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A page's text states this network: one of its words, whole, as written. Unknown network: never. */
export const statesNetwork = (text: string, network: string): boolean =>
  (NETWORK_WORDS[network] ?? []).some((w) => new RegExp(`(^|[^A-Za-z0-9_])${escape(w)}([^A-Za-z0-9_]|$)`).test(text));

/** Pay can send to it: its funding coin and network are known (never "unknown"). */
export const fundable = (r: Recipe) => r.funding.how !== "unknown" && r.funding.coins.length > 0;
