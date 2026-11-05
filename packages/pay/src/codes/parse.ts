// Reads whatever the camera saw (or the person pasted) into one plain answer: what kind of code it is, who gets paid,
// on which chain, which coin and how much. No network, no guessing: when the code leaves something open (an EVM
// address without a network, a code without an amount), it says so and the screen asks.
//
// Formats: BIP-21 style (bitcoin:, litecoin:, …), EIP-681 (ethereum:), Solana Pay (solana:), TON (ton://transfer),
// XRP (xrpl:, ripple:), Stellar (web+stellar:pay), Tron (tron:), NEAR (near: or a plain account), ZeroFee request links,
// plain addresses, EMVCo bank QRs, UPI, EPC (SEPA) and Swiss QR-bills. Lightning, Solana Pay transaction requests,
// WalletConnect and ENS names are recognised and refused plainly.
import { wholeUnits } from "../amount.ts";
import { chain, chainByEvmId, chainsForAddress, isNearAccount } from "../chains.ts";
import { PAY_HOSTS, readRequest } from "../request.ts";
import type { PayRequest } from "../request.ts";
import { clean, readEmvQr } from "./emv.ts";
import { readIban } from "./iban.ts";
import type { BankQr } from "./emv.ts";

const CURRENCY = /^[A-Z]{3}$/;

/** Which coin the code asks for. Contracts are as the chain writes them (EVM lower-cased). */
export type TokenRef = { native: true } | { contract: string } | { symbol: string; issuer?: string };

/** How much: a decimal in the coin's own units, or whole base units (EIP-681, TON) that need the coin's decimals. */
export type CodeAmount = { decimal: string } | { units: string };

export interface CryptoCode {
  kind: "crypto";
  /** Null when the address fits several chains and the code doesn't say which (e.g. a bare 0x address). */
  chain: string | null;
  /** Every chain the address could be on; one when `chain` is set. */
  candidates: string[];
  address: string;
  token: TokenRef;
  amount?: CodeAmount;
  memo?: string;
  /** The name the code gives itself. Never checked by anyone: shown as "says it's …". */
  label?: string;
  message?: string;
  notes: CodeNote[];
}

export type CodeNote =
  /** Solana Pay: the shop looks for a reference key in the payment; a payment from the ledger can't carry it. */
  | "shop-may-not-see-it"
  /** Bitcoin-like chains take minutes to confirm. */
  | "slow-network"
  /** The code also offered a Lightning invoice; Pay uses the on-chain address instead. */
  | "lightning-skipped";

export type PayCode =
  | CryptoCode
  | { kind: "request"; request: PayRequest }
  /** A ZeroFee request link that is broken or changed. */
  | { kind: "bad-request" }
  | { kind: "bank"; bank: BankQr }
  /** A web page, e.g. a restaurant's "scan to order and pay". It opens in the system's browser sheet. */
  | { kind: "web"; url: string }
  | { kind: "unsupported"; what: UnsupportedWhat }
  | { kind: "damaged" }
  | { kind: "unknown" };

export type UnsupportedWhat = "lightning" | "solana-transaction" | "walletconnect" | "ens-name" | "evm-call" | "network";

export interface ReadOptions {
  /** Hosts whose https://<host>/pay#… links are ZeroFee requests. Empty until ZeroFee has a domain. */
  requestHosts?: readonly string[];
  /** The time a request link's expiry is read against (tests' fixed clock); now by default. */
  nowMs?: number;
}

export function readPayCode(input: string, options: ReadOptions = {}): PayCode {
  const text = input.trim();
  if (!text) return { kind: "unknown" };

  const emv = readEmvQr(text);
  if (emv) return "damaged" in emv ? { kind: "damaged" } : { kind: "bank", bank: emv.ok };
  if (/^BCD\r?\n/.test(text)) return epc(text);
  if (/^SPC\r?\n/.test(text)) return swiss(text);

  const request = readRequest(text, options.requestHosts ?? PAY_HOSTS, options.nowMs);
  if (request) return "problem" in request ? { kind: "bad-request" } : { kind: "request", request: request.ok };

  const lower = text.toLowerCase();
  if (/^(lightning:|lnbc|lntb|lnurl)/.test(lower)) return { kind: "unsupported", what: "lightning" };
  if (lower.startsWith("wc:")) return { kind: "unsupported", what: "walletconnect" };
  if (lower.startsWith("upi://")) return upi(text);
  if (lower.startsWith("https://")) return webPage(text);

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1].toLowerCase();
  if (scheme) {
    const body = text.slice(scheme.length + 1);
    switch (scheme) {
      case "ethereum":
        return eip681(body);
      case "solana":
        return solanaPay(body);
      case "ton":
        return tonLink(body);
      case "xrpl":
      case "ripple":
        return xrpLink(body);
      case "web+stellar":
        return stellarLink(body);
      case "near":
        return nearLink(body);
      case "tron":
        return simpleLink("tron", body);
      default: {
        const c = ["bitcoin", "litecoin", "dogecoin", "bitcoincash", "dash", "zcash"].includes(scheme)
          ? ({ bitcoin: "btc", litecoin: "ltc", dogecoin: "doge", bitcoincash: "bch", dash: "dash", zcash: "zec" } as Record<string, string>)[scheme]
          : undefined;
        if (c) return bip21(c, scheme === "bitcoincash" ? text : body);
        return { kind: "unknown" };
      }
    }
  }
  return plainAddress(text);
}

function split(body: string): { path: string; params: URLSearchParams } {
  const q = body.indexOf("?");
  const raw = q < 0 ? body : body.slice(0, q);
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // A stray "%" in a code: keep it as written, and the address check below refuses it.
  }
  return { path, params: new URLSearchParams(q < 0 ? "" : body.slice(q + 1)) };
}

function decimalParam(v: string | null): CodeAmount | undefined | "bad" {
  if (v === null || v === "") return undefined;
  return /^\d+(\.\d+)?$/.test(v) ? { decimal: v } : "bad";
}

function onChain(c: string, address: string, extra: Partial<CryptoCode> = {}): PayCode {
  if (!chainsForAddress(address).includes(c)) return { kind: "unknown" };
  return { kind: "crypto", chain: c, candidates: [c], address, token: { native: true }, notes: [], ...extra };
}

function bip21(c: string, body: string): PayCode {
  const { path, params } = split(body);
  const address = c === "bch" ? path.replace(/^bitcoincash:/i, "") : path;
  const lightning = params.get("lightning");
  if (!address) return lightning ? { kind: "unsupported", what: "lightning" } : { kind: "unknown" };
  const amount = decimalParam(params.get("amount"));
  if (amount === "bad") return { kind: "unknown" };
  const notes: CodeNote[] = ["slow-network"];
  if (lightning) notes.push("lightning-skipped");
  return onChain(c, address, {
    amount,
    label: clean(params.get("label") ?? undefined),
    message: clean(params.get("message") ?? undefined),
    notes,
  });
}

function eip681(body: string): PayCode {
  const m = /^(?:pay-)?([^@/?]+)(?:@(\d+))?(?:\/([^?]+))?(\?.*)?$/.exec(body);
  if (!m) return { kind: "unknown" };
  const [, target, chainIdText, fn, query] = m;
  const params = new URLSearchParams((query ?? "").slice(1));
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) return { kind: "unsupported", what: "ens-name" };
  const c = chainByEvmId(Number(chainIdText ?? "1"));
  if (!c) return { kind: "unsupported", what: "network" };
  if (!fn) {
    const value = params.get("value");
    const units = value === null ? undefined : wholeUnits(value);
    if (units === null) return { kind: "unknown" };
    return onChain(c.id, target, { amount: units === undefined ? undefined : { units: units.toString() } });
  }
  if (fn !== "transfer") return { kind: "unsupported", what: "evm-call" };
  const to = params.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return { kind: "unknown" };
  const raw = params.get("uint256");
  const units = raw === null ? undefined : wholeUnits(raw);
  if (units === null) return { kind: "unknown" };
  return onChain(c.id, to, {
    token: { contract: target.toLowerCase() },
    amount: units === undefined ? undefined : { units: units.toString() },
  });
}

function solanaPay(body: string): PayCode {
  const { path, params } = split(body);
  if (/^https?:/i.test(path)) return { kind: "unsupported", what: "solana-transaction" };
  const amount = decimalParam(params.get("amount"));
  if (amount === "bad") return { kind: "unknown" };
  const mint = params.get("spl-token");
  const notes: CodeNote[] = params.getAll("reference").length ? ["shop-may-not-see-it"] : [];
  return onChain("sol", path, {
    token: mint ? { contract: mint } : { native: true },
    amount,
    memo: clean(params.get("memo") ?? undefined, 120),
    label: clean(params.get("label") ?? undefined),
    message: clean(params.get("message") ?? undefined),
    notes,
  });
}

function tonLink(body: string): PayCode {
  const { path, params } = split(body.replace(/^\/\//, ""));
  const address = path.replace(/^transfer\//, "");
  const raw = params.get("amount");
  const units = raw === null ? undefined : wholeUnits(raw);
  if (units === null) return { kind: "unknown" };
  const jetton = params.get("jetton");
  return onChain("ton", address, {
    token: jetton ? { contract: jetton } : { native: true },
    amount: units === undefined ? undefined : { units: units.toString() },
    memo: clean(params.get("text") ?? undefined, 120),
  });
}

/** A web page, opened as the site it really is: a "name@" before the site only disguises it, so it's dropped. */
function webPage(text: string): PayCode {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "unknown" };
  }
  if (url.protocol !== "https:" || !url.hostname) return { kind: "unknown" };
  url.username = "";
  url.password = "";
  return { kind: "web", url: url.href };
}

/**
 * The site a page opens, to show before opening it (a sticker over a code can point anywhere). The name is in its
 * plain-letter form; one written with other alphabets (xn--…) can look like a site it isn't, so it's marked.
 */
export function siteOf(url: string): { site: string; lookalike: boolean } {
  const site = new URL(url).hostname;
  return { site, lookalike: site.split(".").some((label) => label.startsWith("xn--")) };
}

function xrpLink(body: string): PayCode {
  const { path, params } = split(body.replace(/^\/\//, ""));
  const amount = decimalParam(params.get("amount"));
  if (amount === "bad") return { kind: "unknown" };
  const tag = params.get("dt") ?? params.get("tag") ?? undefined;
  if (tag !== undefined && !/^\d{1,10}$/.test(tag)) return { kind: "unknown" };
  return onChain("xrp", path, { amount, memo: tag });
}

function stellarLink(body: string): PayCode {
  const { path, params } = split(body);
  if (path !== "pay") return { kind: "unknown" };
  const amount = decimalParam(params.get("amount"));
  if (amount === "bad") return { kind: "unknown" };
  const code = params.get("asset_code");
  const issuer = params.get("asset_issuer") ?? undefined;
  // Stellar's own limits: an asset code is 1–12 letters or digits, an issuer a G… account.
  if (code !== null && !/^[A-Za-z0-9]{1,12}$/.test(code)) return { kind: "unknown" };
  if (issuer !== undefined && !/^G[A-Z2-7]{55}$/.test(issuer)) return { kind: "unknown" };
  return onChain("stellar", params.get("destination") ?? "", {
    token: code ? { symbol: code, issuer } : { native: true },
    amount,
    memo: clean(params.get("memo") ?? undefined, 120),
  });
}

function nearLink(body: string): PayCode {
  const { path, params } = split(body.replace(/^\/\//, ""));
  if (!isNearAccount(path)) return { kind: "unknown" };
  const amount = decimalParam(params.get("amount"));
  if (amount === "bad") return { kind: "unknown" };
  const token = params.get("token");
  return onChain("near", path, {
    token: token ? { contract: token } : { native: true },
    amount,
    label: clean(params.get("label") ?? undefined),
  });
}

function simpleLink(c: string, body: string): PayCode {
  const { path, params } = split(body);
  const amount = decimalParam(params.get("amount"));
  if (amount === "bad") return { kind: "unknown" };
  const token = params.get("token") ?? params.get("contract");
  return onChain(c, path, { token: token ? { contract: token } : { native: true }, amount });
}

function plainAddress(text: string): PayCode {
  const candidates = chainsForAddress(text);
  if (candidates.length === 0) return { kind: "unknown" };
  const address = text.replace(/^bitcoincash:/i, "");
  const only = candidates.length === 1 ? candidates[0] : null;
  const notes: CodeNote[] = only && chain(only)?.kind === "utxo" ? ["slow-network"] : [];
  return { kind: "crypto", chain: only, candidates, address, token: { native: true }, notes };
}

function upi(text: string): PayCode {
  let params: URLSearchParams;
  try {
    params = new URL(text).searchParams;
  } catch {
    return { kind: "unknown" };
  }
  const am = params.get("am");
  // Only ever a three-letter code: text from a code never reaches ZeroFee's own words.
  const cu = params.get("cu") ?? "INR";
  if (!CURRENCY.test(cu)) return { kind: "unknown" };
  return {
    kind: "bank",
    bank: {
      scheme: "UPI",
      country: "IN",
      currency: cu,
      amount: am && /^\d+(\.\d+)?$/.test(am) ? am : undefined,
      merchantName: clean(params.get("pn") ?? undefined),
      reference: clean(params.get("tr") ?? undefined),
      dynamic: Boolean(params.get("tr")),
      cardNetworks: [],
    },
  };
}

function epc(text: string): PayCode {
  const lines = text.split(/\r?\n/);
  const m = /^([A-Z]{3})(\d+(?:\.\d{1,2})?)$/.exec(lines[7] ?? "");
  // EPC069-12: line 5 the BIC (optional), 7 the IBAN. Only an IBAN whose check digits hold is kept.
  const iban = readIban(lines[6]);
  const bic = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(lines[4] ?? "") ? lines[4] : undefined;
  return {
    kind: "bank",
    bank: {
      scheme: "SEPA transfer",
      ...(iban ? { account: { iban, ...(bic ? { bic } : {}) } } : {}),
      currency: m?.[1] ?? "EUR",
      amount: m?.[2],
      merchantName: clean(lines[5]),
      reference: clean(lines[9] || lines[10]),
      dynamic: false,
      cardNetworks: [],
    },
  };
}

function swiss(text: string): PayCode {
  const lines = text.split(/\r?\n/);
  // Swiss QR-bill: line 4 is the account, 6 the creditor's name, 19 the amount and 20 the currency.
  const amount = lines[18];
  const currency = lines[19] || "CHF";
  if (!CURRENCY.test(currency)) return { kind: "unknown" };
  const iban = readIban(lines[3]);
  return {
    kind: "bank",
    bank: {
      scheme: "QR-bill",
      ...(iban ? { account: { iban } } : {}),
      country: "CH",
      currency,
      amount: amount && /^\d+(\.\d+)?$/.test(amount) ? amount : undefined,
      merchantName: clean(lines[5]),
      reference: clean(lines[28]),
      dynamic: false,
      cardNetworks: [],
    },
  };
}
