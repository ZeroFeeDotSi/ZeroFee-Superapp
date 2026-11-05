// D119 perps, landing 1's review leftover 2: Hyperliquid's own market rules, checked in the core BEFORE the agent signs.
// From Hyperliquid's docs (for-developers/api/tick-and-lot-size, read 3 Nov 2026):
// - "Prices can have up to 5 significant figures, but no more than MAX_DECIMALS - szDecimals decimal places where
//   MAX_DECIMALS is 6 for perps." "Integer prices are always allowed, regardless of the number of significant figures."
// - "Sizes are rounded to the szDecimals of that asset."
// From the exchange endpoint's own error: "Order must have minimum value of $10." The most leverage is the market's own
// `maxLeverage` in Hyperliquid's `meta` answer. A wrong order is refused here in plain words, so nothing malformed is
// ever signed (Hyperliquid would refuse it too; this keeps the words ours and the key unused).
import { ProblemError } from "../problem.ts";

/** One market as Hyperliquid's `meta` lists it (its index in the list is the order's `a`). */
export interface HlMarket { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean; onlyIsolated?: boolean }
export const PERP_MAX_DECIMALS = 6;
/** Hyperliquid's smallest order, in dollars. */
export const MIN_ORDER_USD = 10;

const refused = (why: string) => new ProblemError({ code: "perps.order.refused", whatHappened: why, money: { state: "safe", where: "on Hyperliquid (test money)" }, next: { kind: "fix-input", label: "Change it", field: "amount" } });

/** A decimal as Hyperliquid takes it: digits, no sign, no exponent, no trailing zeros after a point ("1.50" is "1.5"). */
const WIRE = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;
/** "1.500" → "1.5", "2.000" → "2", "100" stays "100" (only zeros after a point go). */
const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const decimalsOf = (s: string) => (s.includes(".") ? s.split(".")[1]!.length : 0);
const sigFigs = (s: string) => s.replace(".", "").replace(/^0+/, "").length;

/** Why a price isn't one Hyperliquid takes for this market, or null. */
export function priceRefusal(px: unknown, m: HlMarket): string | null {
  if (typeof px !== "string" || !WIRE.test(px) || !(Number(px) > 0)) return `That price isn't a number Hyperliquid takes.`;
  if (!px.includes(".")) return null; // integer prices are always allowed
  if (sigFigs(px) > 5) return `That price has too many digits for ${m.name}. Hyperliquid takes 5 at most.`;
  if (decimalsOf(px) > PERP_MAX_DECIMALS - m.szDecimals) return `That price has too many decimals for ${m.name}. Hyperliquid takes ${PERP_MAX_DECIMALS - m.szDecimals} at most.`;
  return null;
}

/** Why a size isn't one Hyperliquid takes for this market, or null. */
export function sizeRefusal(sz: unknown, m: HlMarket): string | null {
  if (typeof sz !== "string" || !WIRE.test(sz) || !(Number(sz) > 0)) return `That size isn't a number Hyperliquid takes.`;
  if (decimalsOf(sz) > m.szDecimals) return `That size is too exact for ${m.name}. Hyperliquid's smallest step is ${m.szDecimals === 0 ? "1" : `0.${"0".repeat(m.szDecimals - 1)}1`}.`;
  return null;
}

/** Why a leverage isn't one this market allows, or null. Hyperliquid's own limit is the market's maxLeverage. */
export function leverageRefusal(lev: unknown, m: HlMarket): string | null {
  if (typeof lev !== "number" || !Number.isInteger(lev) || lev < 1) return "Leverage is a whole number, 1 or more.";
  if (lev > m.maxLeverage) return `${m.name} goes up to ${m.maxLeverage}× on Hyperliquid.`;
  return null;
}

/** A price rounded the way Hyperliquid takes it: 5 significant figures, then at most 6 - szDecimals decimals. */
export function roundPrice(x: number, m: HlMarket): string {
  if (!(Number.isFinite(x) && x > 0)) throw refused("That price isn't a number Hyperliquid takes.");
  const five = Number(x.toPrecision(5));
  const s = trim(five.toFixed(PERP_MAX_DECIMALS - m.szDecimals));
  if (!(Number(s) > 0)) throw refused(`That price is too small for ${m.name} on Hyperliquid.`);
  return s;
}

/** A size rounded DOWN to the market's step (never more than asked), as Hyperliquid takes it; "0" when under one step. */
export function roundSize(x: number, m: HlMarket): string {
  if (!(Number.isFinite(x) && x > 0)) return "0";
  const step = 10 ** m.szDecimals;
  return trim((Math.floor(x * step + 1e-9) / step).toFixed(m.szDecimals));
}

const marketAt = (a: unknown, universe: readonly HlMarket[]): HlMarket => {
  const m = Number.isInteger(a) && (a as number) >= 0 ? universe[a as number] : undefined;
  if (!m || m.isDelisted || !Number.isInteger(m.szDecimals) || m.szDecimals < 0 || !Number.isInteger(m.maxLeverage) || m.maxLeverage < 1) throw refused("Hyperliquid doesn't list that market.");
  return m;
};

/**
 * Every order, change of order and leverage in a trading action checked against Hyperliquid's rules for its market.
 * Throws a plain refusal; returns nothing. Cancels and the dead-man switch need no market. Anything else is refused.
 */
export function checkTrade(action: Record<string, unknown> & { type: string }, universe: readonly HlMarket[] | undefined): void {
  if (action.type === "cancel" || action.type === "cancelByCloid" || action.type === "scheduleCancel") return;
  if (!universe?.length) throw refused("Hyperliquid's markets couldn't be read, so nothing was signed.");
  const only = (o: unknown, keys: string[]) => {
    if (!o || typeof o !== "object" || Object.keys(o).some((k) => !keys.includes(k))) throw refused("That order isn't one Hyperliquid takes.");
  };
  const orderOk = (o: any) => {
    only(o, ["a", "b", "p", "s", "r", "t", "c"]);
    const m = marketAt(o?.a, universe);
    for (const why of [priceRefusal(o?.p, m), sizeRefusal(o?.s, m)]) if (why) throw refused(why);
    if (typeof o.b !== "boolean" || typeof o.r !== "boolean") throw refused("That order isn't one Hyperliquid takes.");
    const trig = o.t?.trigger;
    if (trig) {
      const why = priceRefusal(trig.triggerPx, m);
      if (why) throw refused(why);
      if (trig.tpsl !== "tp" && trig.tpsl !== "sl") throw refused("That order isn't one Hyperliquid takes.");
    } else if (!["Alo", "Ioc", "Gtc"].includes(o.t?.limit?.tif)) throw refused("That order isn't one Hyperliquid takes.");
    // a reduce-only order only closes what is open, so the smallest-order rule is Hyperliquid's to judge there
    if (!o.r && Number(o.p) * Number(o.s) < MIN_ORDER_USD) throw refused(`Hyperliquid's smallest trade is $${MIN_ORDER_USD}.`);
  };
  if (action.type === "order") {
    // only the fields the core builds (no builder fee, nothing else rides along)
    only(action, ["type", "orders", "grouping"]);
    if (!["na", "normalTpsl", "positionTpsl"].includes(action.grouping as string)) throw refused("That order isn't one Hyperliquid takes.");
    if (!Array.isArray(action.orders) || action.orders.length === 0) throw refused("That order isn't one Hyperliquid takes.");
    action.orders.forEach(orderOk);
  } else if (action.type === "modify") orderOk(action.order);
  else if (action.type === "batchModify") {
    if (!Array.isArray(action.modifies) || action.modifies.length === 0) throw refused("That order isn't one Hyperliquid takes.");
    action.modifies.forEach((x: any) => orderOk(x?.order));
  }
  else if (action.type === "updateLeverage") {
    const why = leverageRefusal(action.leverage, marketAt(action.asset, universe));
    if (why) throw refused(why);
    if (typeof action.isCross !== "boolean") throw refused("That leverage change isn't one Hyperliquid takes.");
    if (action.isCross && marketAt(action.asset, universe).onlyIsolated) throw refused(`${marketAt(action.asset, universe).name} trades with its own margin only on Hyperliquid.`);
  } else if (action.type === "updateIsolatedMargin") marketAt(action.asset, universe);
  else throw refused("The trading key only trades. It can't move money out.");
}
