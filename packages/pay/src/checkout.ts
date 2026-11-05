// Paying a shop's own checkout from the balance (D38 kind "voucher": Bitrefill's gift cards and top-ups), under
// Security's rules (UI, 26 Oct, MUSTs a–e). The person opens the shop's checkout in Pay's window, picks USDC and a
// network there, and pastes the address and the exact amount it shows: Pay never reads the page or the code (e).
// (a) Caps in Pay's own ledger: the first purchase is a test, up to $25; once the person says it arrived, up to $100
//     a purchase and $250 a week. (b) The address and the exact amount come only from the person's paste, on one of
//     the recipe's networks. (c) It must be paid within a window from the paste, or refused (the shop may not count a
//     late payment). Kept on this phone only: the shop's name, and Pay's own receipts.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { add, compare, isDecimal, sub } from "./amount.ts";
import { chainsForAddress, chainName } from "./chains.ts";
import { payProblems } from "./pay-problems.ts";
import type { PayTarget } from "./plan.ts";
import { ACTIVITY } from "./partners/cards.ts";
import type { Recipe } from "./registry.ts";
import type { TokenDirectory } from "./tokens.ts";

export const FIRST_MAX = "25";
export const BUY_MAX = "100";
export const WEEK_MAX = "250";
/** Minutes from the paste: Pay can't read the checkout's own timer, so it keeps to a short one and says so (c). */
export const PAY_WITHIN_MIN = 10;
const WEEK_MS = 7 * 86_400_000;

export interface CheckoutLedger {
  /** The person said a purchase arrived and works: the first-purchase cap is lifted. */
  confirmed: boolean;
  buys: { at: string; amount: string }[];
  /** A No already cleared the test once: a second No leaves it at $0 (Security's MUST 3 on 61fcaef). */
  retried?: boolean;
}

const KEY = "checkout.v1";

export async function loadLedgers(bridge: Bridge): Promise<Record<string, CheckoutLedger>> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if (!("ok" in r) || !r.ok.value) return {};
  try {
    return JSON.parse(r.ok.value) as Record<string, CheckoutLedger>;
  } catch {
    return {};
  }
}

const ledgerOf = (all: Record<string, CheckoutLedger>, id: string): CheckoutLedger => all[id] ?? { confirmed: false, buys: [] };

async function saveLedger(bridge: Bridge, id: string, l: CheckoutLedger): Promise<void> {
  const all = await loadLedgers(bridge);
  all[id] = l;
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(all) });
}

/**
 * The most this purchase may be. Until the person says one arrived, the test is $25 IN TOTAL per shop: every recorded
 * purchase (held ones too) comes off it (Security's MUST on a7ca3c5). Then a purchase cap, and what's left of the
 * week's (which counts every purchase, confirmed or not).
 */
export function capFor(l: CheckoutLedger, now = Date.now()): { max: string; first: boolean } {
  if (!l.confirmed) {
    const spent = l.buys.reduce((t, b) => add(t, b.amount), "0");
    return { max: compare(FIRST_MAX, spent) > 0 ? sub(FIRST_MAX, spent) : "0", first: true };
  }
  const week = l.buys.filter((b) => now - Date.parse(b.at) < WEEK_MS).reduce((t, b) => add(t, b.amount), "0");
  const left = compare(WEEK_MAX, week) > 0 ? sub(WEEK_MAX, week) : "0";
  return { max: compare(left, BUY_MAX) < 0 ? left : BUY_MAX, first: false };
}

/** The networks a pasted address can be on, among the shop's own (a Solana address: Solana; a 0x one: its EVM ones). */
export const networksFor = (recipe: Recipe, address: string): string[] => {
  const shop = recipe.funding.coins.find((c) => c.coin === "USDC")?.networks ?? [];
  const fits = chainsForAddress(address.trim());
  return shop.filter((n) => fits.includes(n));
};

export interface Pasted {
  address: string;
  amount: string;
  network: string;
  /** When the address was pasted (ms). */
  copiedAt: number;
}

/** What the sheet will pay: exactly the pasted amount of USDC, on the chosen network, to the pasted address. */
export function checkoutTarget(recipe: Recipe, p: Pasted, tokens: TokenDirectory, l: CheckoutLedger, now = Date.now()): { ok: PayTarget } | { problem: Problem } {
  if (now - p.copiedAt > PAY_WITHIN_MIN * 60_000) return { problem: payProblems.checkoutLate(recipe.name, PAY_WITHIN_MIN) };
  if (!networksFor(recipe, p.address).includes(p.network)) return { problem: payProblems.checkoutNetwork(recipe.name) };
  const amount = p.amount.trim();
  if (!isDecimal(amount) || compare(amount, "0") <= 0) return { problem: payProblems.checkoutAmount(recipe.name) };
  const cap = capFor(l, now);
  if (cap.first && compare(cap.max, "0") <= 0) return { problem: payProblems.checkoutWaiting(recipe.name) };
  if (compare(amount, cap.max) > 0) return { problem: payProblems.checkoutOverCap(recipe.name, cap.max, cap.first) };
  const token = tokens.find(p.network, { symbol: "USDC" });
  if (!token) return { problem: payProblems.coinUnsupported(`USDC on ${chainName(p.network)} isn't available to send right now.`) };
  // The network the person picked at a checkout that takes several rides on the sheet's hint too (Security's SHOULD).
  const picked = networksFor(recipe, p.address).length > 1 ? { message: `pay on ${chainName(p.network)}` } : {};
  return { ok: { to: { kind: "chain", chain: p.network, address: p.address.trim() }, token, amount, name: recipe.name, activity: `${ACTIVITY.voucher} · ${recipe.name}`, notes: [], ...picked } };
}

/**
 * A purchase that went through. Until the person answers, every test purchase stays in the total (never pruned by
 * age, Security's SHOULD on e1c6396); once confirmed, only the last week's count.
 */
export async function recordBuy(bridge: Bridge, id: string, amount: string, now = Date.now()): Promise<void> {
  const l = ledgerOf(await loadLedgers(bridge), id);
  const kept = l.confirmed ? l.buys.filter((b) => now - Date.parse(b.at) < WEEK_MS) : l.buys;
  await saveLedger(bridge, id, { ...l, buys: [...kept, { at: new Date(now).toISOString(), amount }] });
}

/**
 * The person's answer to "Did it arrive, and does it work?". Yes lifts the test (any time). The first No clears the
 * test's total for ONE more try; a second No leaves it at $0 (a shop that never delivers can't take $25 per No).
 */
export async function answerArrived(bridge: Bridge, id: string, yes: boolean): Promise<void> {
  const l = ledgerOf(await loadLedgers(bridge), id);
  if (yes) {
    if (!l.confirmed) await saveLedger(bridge, id, { ...l, confirmed: true });
  } else if (!l.confirmed && !l.retried) await saveLedger(bridge, id, { confirmed: false, buys: [], retried: true });
}

export const ledgerFor = async (bridge: Bridge, id: string) => ledgerOf(await loadLedgers(bridge), id);
