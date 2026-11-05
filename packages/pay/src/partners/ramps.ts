// Cash in and cash out, through licensed partners. ZeroFee only builds the link and reads the way back.
//
// - The partner's own screens do everything else: ID checks, card or bank details, terms and limits. ZeroFee stores
//   nothing about the person and runs no server.
// - Every partner here works with a plain link. "Level 1" needs no ZeroFee account at all. "Level 2" needs ZeroFee's
//   public partner id from a sign-up (the product call), and still no secret.
// - Partners that need a server secret (signed links, server-made sessions) are left out: MoonPay buy with a prefilled
//   address, Transak, Coinbase, Stripe, Onramper with wallets, Meld, Swapped, Wert, Topper. See ../../partners.md.
// - Cash in lands on a ledger deposit address (S3): USDC on Base by default, which every partner here sells.
// - Cash out is a normal payment from the balance to the address the partner names, checked before anything is signed.
import type { Problem } from "@zerofee/core/problem";
import { compare, isDecimal } from "../amount.ts";
import { chainsForAddress } from "../chains.ts";
import { payProblems } from "../pay-problems.ts";

export type RampKind = "buy" | "sell";
export type RampId = "banxa" | "ramp" | "moonpay" | "mt-pelerin";

/** Public values from the operator's partner sign-ups. Never secrets: each one is visible in the link anyway. */
export interface PartnerConfig {
  /** Banxa's partner subdomain, given at onboarding: https://<ref>.banxa.com */
  banxaRef?: string;
  banxaSandbox?: boolean;
  /** Ramp Network's public host key. */
  rampHostApiKey?: string;
  /** MoonPay's publishable key (sell only: buying with a prefilled address needs a signed link, so it's left out). */
  moonpayApiKey?: string;
  /** Where partners send the person back: zerofee://pay/return on the phone, the demo page on the web. */
  returnUrl?: string;
  appName?: string;
  logoUrl?: string;
}

export interface RampPartner {
  id: RampId;
  name: string;
  kinds: RampKind[];
  level: 1 | 2;
  /** Whether the link can carry the person's deposit address, so they never copy it by hand. */
  prefillsAddress: boolean;
  /** Sell: whether the partner hands back where to send and how much, so ZeroFee can prepare the payment. */
  returnsDeposit: boolean;
  /** Chains (Pay ids) the partner sells and buys USDC on, in Pay's order of preference. */
  usdcChains: string[];
  feeNote: string;
  reachNote: string;
  /** What was checked against the partner's own docs, and when. */
  checked: string;
}

export const RAMPS: readonly RampPartner[] = [
  {
    id: "banxa",
    name: "Banxa",
    kinds: ["buy", "sell"],
    level: 2,
    prefillsAddress: true,
    returnsDeposit: true,
    usdcChains: ["base", "sol", "arb", "op", "pol", "eth", "bsc"],
    feeNote: "Banxa shows its fee in its own screen before you pay.",
    reachNote: "Cards, Apple Pay and Google Pay in most countries, plus local bank transfers in many.",
    checked: "Referral link parameters and network codes: docs.banxa.com, 2026-10-25. Sell hand-back depends on the partner account's mode.",
  },
  {
    id: "ramp",
    name: "Ramp",
    kinds: ["buy"],
    level: 2,
    prefillsAddress: true,
    returnsDeposit: false,
    usdcChains: ["base", "eth"],
    feeNote: "0.99% to 3.9% depending on how you pay, at least €2.49.",
    reachNote: "Cards, Apple Pay, Google Pay and bank transfers; Ramp lists its countries.",
    checked: "Configuration parameters: docs.rampnetwork.com, 2026-10-25; fees from its assets API, 2026-10-23. Production link to confirm at sign-up.",
  },
  {
    id: "moonpay",
    name: "MoonPay",
    kinds: ["sell"],
    level: 2,
    prefillsAddress: false,
    returnsDeposit: true,
    usdcChains: ["sol", "base", "eth"],
    feeNote: "MoonPay shows its fee in its own screen before you confirm.",
    reachNote: "Payouts to bank accounts in many countries.",
    checked: "Hand-back field names from MoonPay's SDK docs, not re-checked (docs moved); confirm at sign-up. Needs an https return link.",
  },
  {
    id: "mt-pelerin",
    name: "Mt Pelerin",
    kinds: ["buy", "sell"],
    level: 1,
    prefillsAddress: false,
    returnsDeposit: false,
    usdcChains: ["base", "arb", "op", "pol", "eth", "bsc", "avax", "gnosis"],
    feeNote: "Bank transfer: free up to 500 a year, then 1.3%.",
    reachNote: "164 countries, by bank transfer.",
    checked: "Direct-link parameters and network ids: developers.mtpelerin.com, 2026-10-25. No ZeroFee account needed.",
  },
];

const BANXA_CHAIN: Record<string, string> = { base: "BASE", sol: "SOL", arb: "ARB", op: "OPTIMISM", pol: "MATIC", eth: "ETH", bsc: "BSC", avax: "AVAX-C" };
const RAMP_CHAIN: Record<string, string> = { base: "BASE", eth: "ETH" };
const MOONPAY_CODE: Record<string, string> = { sol: "usdc_sol", base: "usdc_base", eth: "usdc" };
const PELERIN_NET: Record<string, string> = {
  base: "base_mainnet", arb: "arbitrum_mainnet", op: "optimism_mainnet", pol: "matic_mainnet", eth: "mainnet",
  bsc: "bsc_mainnet", avax: "avalanche_mainnet", gnosis: "xdai_mainnet",
};

/** The partners this build can open for buying or selling, best first. Level 2 ones appear once their id is set. */
export function rampsFor(kind: RampKind, config: PartnerConfig): RampPartner[] {
  const ready: Record<RampId, boolean> = {
    banxa: Boolean(config.banxaRef),
    ramp: Boolean(config.rampHostApiKey),
    moonpay: Boolean(config.moonpayApiKey),
    "mt-pelerin": true,
  };
  return RAMPS.filter((p) => p.kinds.includes(kind) && ready[p.id]);
}

function returnUrl(config: PartnerConfig, partner: RampId, order: string): string | undefined {
  if (!config.returnUrl) return undefined;
  const u = new URL(config.returnUrl);
  u.searchParams.set("partner", partner);
  u.searchParams.set("order", order);
  return u.toString();
}

export interface BuyLink {
  /** The ledger deposit address for USDC on `chain` (ledger.depositAddress). */
  address: string;
  chain: string;
  fiat?: string;
  fiatAmount?: string;
  /** How much USDC to buy, when the person typed it in USDC rather than in their own money. */
  usdcAmount?: string;
  /** A one-time id for this purchase, so the way back can be matched. */
  order: string;
}

/** The partner's own page, ready to buy USDC straight into the person's balance. Null if it can't do that chain. */
export function buyLink(id: RampId, b: BuyLink, config: PartnerConfig): string | null {
  const back = returnUrl(config, id, b.order);
  switch (id) {
    case "banxa": {
      if (!config.banxaRef || !BANXA_CHAIN[b.chain]) return null;
      const u = new URL(`https://${config.banxaRef}.${config.banxaSandbox ? "banxa-sandbox" : "banxa"}.com/`);
      u.searchParams.set("coinType", "USDC");
      u.searchParams.set("blockchain", BANXA_CHAIN[b.chain]);
      u.searchParams.set("walletAddress", b.address);
      if (b.fiat) u.searchParams.set("fiatType", b.fiat);
      if (b.fiatAmount) u.searchParams.set("fiatAmount", b.fiatAmount);
      else if (b.usdcAmount) u.searchParams.set("coinAmount", b.usdcAmount);
      if (back) u.searchParams.set("returnUrl", back);
      u.searchParams.set("theme", "dark");
      return u.toString();
    }
    case "ramp": {
      if (!config.rampHostApiKey || !RAMP_CHAIN[b.chain]) return null;
      const u = new URL("https://app.rampnetwork.com/");
      u.searchParams.set("hostApiKey", config.rampHostApiKey);
      u.searchParams.set("hostAppName", config.appName ?? "ZeroFee");
      if (config.logoUrl) u.searchParams.set("hostLogoUrl", config.logoUrl);
      u.searchParams.set("enabledFlows", "ONRAMP");
      u.searchParams.set("swapAsset", `${RAMP_CHAIN[b.chain]}_USDC`);
      u.searchParams.set("userAddress", b.address);
      if (b.fiat) u.searchParams.set("fiatCurrency", b.fiat);
      if (b.fiatAmount) u.searchParams.set("fiatValue", b.fiatAmount);
      if (back) u.searchParams.set("finalUrl", back);
      return u.toString();
    }
    case "mt-pelerin": {
      if (!PELERIN_NET[b.chain]) return null;
      // Mt Pelerin can't take the address in the link without a wallet signature, so the sheet shows it to copy.
      const u = new URL("https://widget.mtpelerin.com/");
      u.searchParams.set("type", "direct-link");
      u.searchParams.set("tabs", "buy");
      u.searchParams.set("tab", "buy");
      u.searchParams.set("bdc", "USDC");
      u.searchParams.set("dnet", PELERIN_NET[b.chain]);
      if (b.usdcAmount) u.searchParams.set("bda", b.usdcAmount);
      if (b.fiat) u.searchParams.set("bsc", b.fiat);
      return u.toString();
    }
    default:
      return null;
  }
}

export interface SellLink {
  /** The chain whose USDC the person sells. Pay converts from whatever they hold. */
  chain: string;
  /** USDC to sell, decimal. */
  amount: string;
  fiat?: string;
  order: string;
}

export function sellLink(id: RampId, s: SellLink, config: PartnerConfig): string | null {
  const back = returnUrl(config, id, s.order);
  switch (id) {
    case "banxa": {
      if (!config.banxaRef || !BANXA_CHAIN[s.chain]) return null;
      const u = new URL(`https://${config.banxaRef}.${config.banxaSandbox ? "banxa-sandbox" : "banxa"}.com/`);
      u.searchParams.set("orderType", "sell");
      u.searchParams.set("coinType", "USDC");
      u.searchParams.set("blockchain", BANXA_CHAIN[s.chain]);
      u.searchParams.set("coinAmount", s.amount);
      if (s.fiat) u.searchParams.set("fiatType", s.fiat);
      if (back) u.searchParams.set("returnUrl", back);
      u.searchParams.set("theme", "dark");
      return u.toString();
    }
    case "moonpay": {
      if (!config.moonpayApiKey || !MOONPAY_CODE[s.chain] || !back?.startsWith("https://")) return null;
      const u = new URL("https://sell.moonpay.com/");
      u.searchParams.set("apiKey", config.moonpayApiKey);
      u.searchParams.set("baseCurrencyCode", MOONPAY_CODE[s.chain]);
      u.searchParams.set("baseCurrencyAmount", s.amount);
      if (s.fiat) u.searchParams.set("quoteCurrencyCode", s.fiat.toLowerCase());
      u.searchParams.set("redirectURL", back);
      return u.toString();
    }
    case "mt-pelerin": {
      if (!PELERIN_NET[s.chain]) return null;
      const u = new URL("https://widget.mtpelerin.com/");
      u.searchParams.set("type", "direct-link");
      u.searchParams.set("tabs", "sell");
      u.searchParams.set("tab", "sell");
      u.searchParams.set("ssc", "USDC");
      u.searchParams.set("snet", PELERIN_NET[s.chain]);
      // Its documented sell parameters carry no crypto amount: the person types it in Mt Pelerin's own screen.
      if (s.fiat) u.searchParams.set("sdc", s.fiat);
      return u.toString();
    }
    default:
      return null;
  }
}

/** Where the partner asked the person to send their USDC, read from the way back. */
export interface SellDeposit {
  partner: RampId;
  order: string;
  chain: string;
  address: string;
  memo?: string;
  amount: string;
  partnerOrderId?: string;
}

/** What the partner's own records say the sale is: where to send, how much, on which chain. */
export interface SellOrder {
  address: string;
  memo?: string;
  amount: string;
  chain: string;
}

/**
 * Asks the partner's own records (its order API, through ZeroFee's relay when that API needs a server key) for the sale
 * with this partner order id. Null: no answer.
 */
export type SellOrderLookup = (partner: RampId, partnerOrderId: string) => Promise<SellOrder | null>;

/**
 * The way back, checked against the partner's own record of the order (iOS audit, finding 2). The return link is opened
 * by the partner's page, so any script in that page can write it, the deposit address too, and the order id it carries
 * is in the page's own address. So the address is never taken from the link: it comes from `lookup`, by the partner's
 * order id, and the link must say the same address, amount, chain and memo, or nothing is prepared. Without a lookup
 * (none exists yet: Banxa's order API needs a server-held secret) every hand-back stops here, and Cash uses the person's
 * own copy from the partner's screen instead.
 */
export async function verifySellReturn(url: string, expected: { partner: RampId; order: string; chain: string; amount: string }, lookup?: SellOrderLookup): Promise<{ ok: SellDeposit } | { problem: Problem }> {
  const read = readSellReturn(url, expected);
  if ("problem" in read) return read;
  const name = RAMPS.find((r) => r.id === expected.partner)?.name ?? "The partner";
  const id = read.ok.partnerOrderId;
  const order = lookup && id ? await lookup(expected.partner, id).catch(() => null) : null;
  if (!order) return { problem: payProblems.cashOutUnchecked(name) };
  if (order.address !== read.ok.address || order.chain !== expected.chain || !isDecimal(order.amount) || compare(order.amount, expected.amount) !== 0 || (order.memo ?? "") !== (read.ok.memo ?? "")) {
    return { problem: payProblems.cashOutMismatch(name) };
  }
  if (!chainsForAddress(order.address).includes(expected.chain)) return { problem: payProblems.cashOutMismatch(name) };
  const { memo: _memo, ...rest } = read.ok;
  return { ok: { ...rest, address: order.address, ...(order.memo ? { memo: order.memo } : {}) } };
}

/**
 * Reads the link a partner sends the person back with, after they confirmed a sale in the partner's screens. It must
 * match what the person chose (the partner, this order, the chain and the amount) and name a real address on that
 * chain. Anything else stops with a Problem before a payment is even prepared. Only a first read: the page can write
 * this link, so its address is used only once the partner's own record agrees (verifySellReturn).
 */
export function readSellReturn(url: string, expected: { partner: RampId; order: string; chain: string; amount: string }): { ok: SellDeposit } | { problem: Problem } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { problem: payProblems.cashOutMismatch("The partner") };
  }
  const p = u.searchParams;
  const name = RAMPS.find((r) => r.id === expected.partner)?.name ?? "The partner";
  if (p.get("partner") !== expected.partner || p.get("order") !== expected.order) return { problem: payProblems.cashOutMismatch(name) };

  let fields: { address: string | null; memo: string | null; amount: string | null; chainCode: string | null; id: string | null };
  if (expected.partner === "banxa") {
    fields = { address: p.get("providerWalletAddress"), memo: p.get("providerWalletAddressTag"), amount: p.get("coinAmount"), chainCode: p.get("blockchain"), id: p.get("orderId") };
    if (fields.chainCode !== BANXA_CHAIN[expected.chain] || p.get("coinType") !== "USDC") return { problem: payProblems.cashOutMismatch(name) };
  } else if (expected.partner === "moonpay") {
    fields = { address: p.get("depositWalletAddress"), memo: p.get("depositWalletAddressTag"), amount: p.get("baseCurrencyAmount"), chainCode: p.get("baseCurrencyCode"), id: p.get("transactionId") };
    if (fields.chainCode !== MOONPAY_CODE[expected.chain]) return { problem: payProblems.cashOutMismatch(name) };
  } else {
    return { problem: payProblems.cashOutMismatch(name) };
  }
  const { address, amount } = fields;
  if (!address || !amount || !isDecimal(amount) || compare(amount, expected.amount) !== 0) return { problem: payProblems.cashOutMismatch(name) };
  if (!chainsForAddress(address).includes(expected.chain)) return { problem: payProblems.cashOutMismatch(name) };
  return {
    ok: {
      partner: expected.partner,
      order: expected.order,
      chain: expected.chain,
      address,
      ...(fields.memo ? { memo: fields.memo } : {}),
      amount,
      ...(fields.id ? { partnerOrderId: fields.id } : {}),
    },
  };
}
