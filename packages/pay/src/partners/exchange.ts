// "Your exchange" (D29's third tile, the product choice for PromptPay and other bank codes Pay can't pay itself): the
// person's own account at an exchange. They save its USDC deposit address once (network, memo if it needs one,
// the exchange's name); then sending there is one tap and Face ID at the last amount. The exchange sells it into their
// own bank, and they pay the bank code from their bank app: two apps, all in their own name.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { add, compare, sub } from "../amount.ts";
import { chain as chainInfo, chainsForAddress, chainName } from "../chains.ts";
import { payProblems } from "../pay-problems.ts";
import { ACTIVITY } from "./cards.ts";
import type { PayTarget } from "../plan.ts";
import type { TokenDirectory } from "../tokens.ts";

/**
 * A preset: an exchange-like service the product chose to offer by name (UI, D29). It's only words and a page to open (the
 * D28 way, inside ZeroFee): no recipe, because the service has no web sign-up to drive. The person signs up in its own
 * app in their own name, copies its USDC deposit address into the tile, and makes the payout in that app.
 */
export interface ExchangePreset {
  id: "pexx" | "binance-th" | "coins-ph" | "indodax" | "binance-br" | "quidax" | "paribu" | "kraken";
  name: string;
  /** How the tile names it, always saying what it is. */
  label: string;
  /** Its name on the form's one-tap chip, with a sourced fact where one matters (PEXX: Australia, its own site). */
  chip: string;
  /** "web": signs up on its own web page, in our window (the main path). "app": only in its own app (behind See all). */
  signup: "web" | "app";
  /** Its own page, where its app is. */
  site: string;
  /** Networks it takes USDC on (its own FAQ). */
  chains: readonly string[];
  /** Its own page that states the coin and those networks (the verifier checks it, Security's MUST on e9fcc17). */
  stated?: string;
  /** Where its deposit address is, in its own app. */
  how: string;
  /** What happens after: the payout, made by the person in its own app. */
  after: string;
}

export const EXCHANGE_PRESETS: readonly ExchangePreset[] = [
  {
    id: "pexx",
    name: "PEXX",
    // Security (SHOULD 2): a sourced fact, not our label: its own footer names PEXX Technology Pty Ltd, Australia.
    label: "PEXX · an exchange registered in Australia",
    chip: "PEXX (Australia)",
    signup: "app",
    site: "https://pexx.com",
    // faq.pexx.com, "Supported tokens & networks for crypto deposits": USDC on these. No NEAR.
    chains: ["base", "arb", "eth", "pol", "bsc", "sol"],
    how: "In the PEXX app: Deposit, USDC, its network. Copy the address.",
    after: "Then, in the PEXX app, send it on to their bank account or PromptPay. Use the account exactly as their bank has it.",
  },
  // D36's country table (countries.ts), one exchange per place where one takes USDC we can send and pays out to the
  // local rail. Networks are each one's own deposit pages, read 26 Oct 2026 (the research in backlog/pay.md).
  local("binance-th", "Binance TH", "https://www.binance.th", "web", ["base", "sol", "arb", "eth", "near"], "https://www.binance.th/en/faq/crypto-deposit-%7C-withdrawal/3d76576f070d4c19bddac5279f37bd10"),
  // Its own page (Oct 2026) states Base, Arbitrum and Ethereum, not Solana: only what it states.
  local("coins-ph", "Coins.ph", "https://coins.ph", "app", ["base", "arb", "eth"], "https://support.coins.ph/hc/en-us/articles/38460014842649"),
  local("indodax", "Indodax", "https://indodax.com", "web", ["base", "eth"], "https://blog.indodax.com/informasi-penambahan-jaringan-untuk-ten-dan-usdc/"),
  // Only Base has its own announcement on record; Arbitrum and NEAR come back when a page of its states them.
  local("binance-br", "Binance", "https://www.binance.com", "web", ["base"], "https://www.binance.com/en/support/announcement/binance-completes-integration-of-usd-coin-usdc-on-base-network-opens-deposits-39d389c0d3794c15944e04a7def9f2b1"),
  local("quidax", "Quidax", "https://www.quidax.io", "app", ["sol", "eth"], "https://support.quidax.io/hc/en-us/articles/360016166012"),
  local("paribu", "Paribu", "https://www.paribu.com", "web", ["sol", "eth"], "https://www.paribu.com/destek/crypto-transactions/usdc-deposit"),
  local("kraken", "Kraken", "https://www.kraken.com", "web", ["base", "sol", "arb", "eth"], "https://support.kraken.com/articles/stablecoins-supported-on-kraken"),
];

/** A local exchange's words: the same three steps everywhere, in its own app or page. */
function local(id: ExchangePreset["id"], name: string, site: string, signup: "web" | "app", chains: string[], stated?: string): ExchangePreset {
  return {
    id,
    name,
    ...(stated ? { stated } : {}),
    label: `${name} · an exchange`,
    chip: name,
    signup,
    site,
    chains,
    how: `In ${name}: Deposit, USDC, its network. Copy the address.`,
    after: `Then, in ${name}, sell the USDC and send the money to your bank.`,
  };
}

export const presetFor = (id: ExchangePreset["id"] | undefined) => EXCHANGE_PRESETS.find((p) => p.id === id);

export interface SavedExchange {
  /** The exchange's name, as the person calls it (their own words), or the preset's. */
  name: string;
  /** Saved from a preset (PEXX): its own words and networks apply. */
  preset?: ExchangePreset["id"];
  chain: string;
  address: string;
  /** A deposit memo or tag, when the network needs one to know whose money it is. */
  memo?: string;
  /** The last amount sent, so the next is one tap. */
  lastAmount?: string;
  /** Set after the first send went through. */
  used?: boolean;
  /**
   * The person said a send arrived: the test is over (UI's product call, Security's SHOULD on 1ea4d90). Until then a
   * new address is a test, up to FIRST_SEND_MAX in total (`tested`), like a shop's first purchase.
   */
  confirmed?: boolean;
  /** What went to this address while it was a test (held sends too). */
  tested?: string;
}

/**
 * Saving details again: the test's answer stays only for the same account, the same chain, address AND memo (on a memo
 * network the memo picks the account: Security's MUST on 2cce8bd). Anything changed starts a new test.
 */
export function keepTest(prev: SavedExchange | null, next: SavedExchange): SavedExchange {
  const memo = (e: SavedExchange) => e.memo?.trim() ?? "";
  const same = prev && prev.chain === next.chain && prev.address.trim() === next.address.trim() && memo(prev) === memo(next);
  const { used: _u, confirmed: _c, tested: _t, ...rest } = next;
  return same ? { ...rest, ...(prev.used ? { used: true } : {}), ...(prev.confirmed ? { confirmed: true } : {}), ...(prev.tested ? { tested: prev.tested } : {}) } : rest;
}

/** A new exchange address is a test, up to this in total, until the person says a send arrived. */
export const FIRST_SEND_MAX = "25";

/** What the test still allows; null once the person said a send arrived. */
export const testLeft = (e: Pick<SavedExchange, "confirmed" | "tested">): string | null => {
  if (e.confirmed) return null;
  const spent = e.tested ?? "0";
  return compare(FIRST_SEND_MAX, spent) > 0 ? sub(FIRST_SEND_MAX, spent) : "0";
};

const KEY = "exchange.v1";

/** Networks a send to an exchange can use: USDC is listed there, and a memo, if the network needs one, can be sent. */
export function exchangeNetworks(tokens: TokenDirectory, preset?: ExchangePreset["id"]): string[] {
  return (presetFor(preset)?.chains ?? ["base", "sol", "arb", "pol", "eth", "bsc", "op", "near", "xrp", "avax"]).filter((id) => {
    const info = chainInfo(id);
    return info && info.memoSendable !== false && tokens.find(id, { symbol: "USDC" });
  });
}

/** The saved exchange, checked again; null when there's none or it no longer reads right. */
export async function loadExchange(bridge: Bridge): Promise<SavedExchange | null> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if ("problem" in r || r.ok.value === null) return null;
  try {
    const e = JSON.parse(r.ok.value) as SavedExchange;
    return exchangeProblem(e) ? null : e;
  } catch {
    return null;
  }
}

/** Why an exchange's details can't be used: an address that isn't on its network, a memo that's needed and missing. */
export function exchangeProblem(e: Pick<SavedExchange, "name" | "chain" | "address" | "memo" | "preset">): Problem | null {
  const info = chainInfo(e.chain);
  if (!info || !e.name.trim()) return payProblems.copiedNone("your exchange's deposit address", "your exchange");
  if (!chainsForAddress(e.address.trim()).includes(e.chain)) return payProblems.cashOutMismatch(e.name.trim());
  const preset = presetFor(e.preset);
  if (preset && !preset.chains.includes(e.chain)) return payProblems.cashOutMismatch(preset.name);
  if (info.memo && !e.memo?.trim()) return payProblems.exchangeMemoNeeded(info.name);
  return null;
}

export async function saveExchange(bridge: Bridge, e: SavedExchange): Promise<Problem | null> {
  const problem = exchangeProblem(e);
  if (problem) return problem;
  const clean: SavedExchange = { ...e, name: e.name.trim(), address: e.address.trim(), ...(e.memo?.trim() ? { memo: e.memo.trim() } : {}) };
  const r = await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(clean) });
  return "problem" in r ? r.problem : null;
}

export async function removeExchange(bridge: Bridge): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: null });
}

/** What a send to the exchange pays: USDC on its network, to its address with its memo, named for what it is. */
export function exchangeTarget(e: SavedExchange, amount: string, tokens: TokenDirectory): { ok: PayTarget } | { problem: Problem } {
  const problem = exchangeProblem(e);
  if (problem) return { problem };
  const left = testLeft(e);
  if (left !== null && compare(left, "0") <= 0) return { problem: payProblems.exchangeWaiting(e.name) };
  if (left !== null && compare(amount, left) > 0) return { problem: payProblems.exchangeOverTest(e.name, left) };
  const token = tokens.find(e.chain, { symbol: "USDC" });
  if (!token) return { problem: payProblems.coinUnsupported(`USDC isn't available on ${chainName(e.chain)} right now.`) };
  return { ok: { to: { kind: "chain", chain: e.chain, address: e.address, ...(e.memo ? { memo: e.memo } : {}) }, token, amount, name: `Your ${e.name} account`, activity: `${ACTIVITY.exchange} · ${e.name}`, notes: [] } };
}

/** After a send went through (or is held): the next starts from it; while it's a test, it counts against the test. */
export async function rememberExchangeSend(bridge: Bridge, amount: string): Promise<SavedExchange | null> {
  const e = await loadExchange(bridge);
  if (!e) return null;
  const next = { ...e, lastAmount: amount, used: true, ...(e.confirmed ? {} : { tested: add(e.tested ?? "0", amount) }) };
  await saveExchange(bridge, next);
  return next;
}

/** "Did it arrive?" for a test send: Yes ends the test; No forgets the address (it may be a look-alike). */
export async function answerExchangeArrived(bridge: Bridge, answer: "yes" | "no" | "not-yet"): Promise<SavedExchange | null> {
  const e = await loadExchange(bridge);
  if (!e) return null;
  if (answer === "no") {
    await removeExchange(bridge);
    return null;
  }
  if (answer === "yes" && !e.confirmed) {
    const next = { ...e, confirmed: true };
    await saveExchange(bridge, next);
    return next;
  }
  return e;
}
