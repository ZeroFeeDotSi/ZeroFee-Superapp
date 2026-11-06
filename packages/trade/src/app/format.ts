// Numbers on the Trade screens. Dollars come before percent ("+$2.10  +8.4%"), a loss has a real minus sign (no red),
// coin prices keep four significant digits however small, and raw amounts never pass through a float until they are
// shortened for display.

const MINUS = "−";
/** Billions and up, short, never a thousands comma beside a suffix (QA's Sim walk, 5 Nov: "$1,613.64B" on the
 *  BTC page; before it "$1616.42B"): a trillion and more is "T". Three significant digits: "1.42B", "11.3B", "296B",
 *  "1.61T". */
const billions = (x: number): string => {
  const [d, u] = x >= 1e12 ? [1e12, "T"] : [1e9, "B"];
  const v = x / d, n = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  // a figure that rounds up to the next tier ("999.6B" → "1000B") says the next tier's
  return u === "B" && Number(n) >= 1000 ? `${(x / 1e12).toFixed(2)}T` : `${n}${u}`;
};
/** Millions, three significant digits like billions (the copy review's ruling, 5 Nov: "$850M", never "$850.00M"): "3.42M", "18.4M",
 *  "850M"; one that rounds to 1000M says "1.00B". */
const millions = (x: number): string => {
  const v = x / 1e6, n = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return Number(n) >= 1000 ? billions(1e9) : `${n}M`;
};
const sign = (n: number) => (n < 0 ? MINUS : "+");

/** "$25.00", "$1,240.50", "$0.002", "$1.42B". */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "—"; // never "$NaN" or "$InfinityB" (T-5 second review)
  const a = Math.abs(n), s = n < 0 ? MINUS : "";
  if (a >= 1e9) return `${s}$${billions(a)}`;
  if (a >= 1e6) return `${s}$${millions(a)}`;
  if (a >= 1) return `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (a === 0) return "$0.00";
  if (a >= 0.01) return `${s}$${a.toFixed(2)}`;
  // under a millionth, toPrecision turns to exponent form ("3e-7"), and cutting the exponent read "$3" (T-5 review H1):
  // said as under the least it can show instead, never a made-up figure
  if (a < 1e-6) return `${s}<$0.000001`;
  return `${s}$${a.toPrecision(1)}`.replace(/(\.\d*?)0+$/, "$1");
}
/** Market figures, short: "$3.42M", "$850M", "$1.42B"; under a million the full figure with commas, "$153,447"
 *  (the copy review's ruling, 5 Nov; everyday sums use usd()). */
export function compactUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${billions(a)}`;
  if (a >= 1e6) return `$${millions(a)}`;
  if (a >= 1e3) return `$${Math.round(a).toLocaleString("en-US")}`;
  return usd(n);
}
/** A list row's figure (the copy review's ruling, 5 Nov: rows keep suffixes; the full figure with commas is only on the coin page
 *  and receipts): "$980", "$3.1K", "$58K", "$153.4K", "$18.4M", "$1.61T", never a comma beside a suffix. */
export function rowUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return compactUsd(n);
  // just under a million rounds to "1000.0K": said as the next tier, "$1.00M"
  if (a >= 999_950) return `${n < 0 ? MINUS : ""}$${millions(a)}`;
  if (a >= 1e3) return `${n < 0 ? MINUS : ""}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${n < 0 ? MINUS : ""}$${Math.round(a)}`;
}
/** A coin's price: four significant digits, never in exponent form ("$0.00002134", "$8.37", "$2,416.10"). */
export function price(n: number): string {
  if (!(n > 0)) return "$0";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  // $10 and up: cents, as every dollar figure reads (e2e walk 3 Nov: "$70.204")
  if (n >= 10) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  const zeros = Math.max(0, -Math.floor(Math.log10(n)) - 1);
  return `$${n.toFixed(Math.min(20, zeros + 4)).replace(/0+$/, "")}`;
}
const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** A list row's price (copy review, 5 Nov: "$0.000000008808" pushed the name to "BLACKDRA…"): under $0.001 the compact trading
 *  form, "$0.0₈88": "0.0", the count of zeros after the point in subscript digits (10 and up as several, "₁₂"), then two
 *  significant digits cut toward zero (never more than it is), a trailing zero dropped ("$0.0₃9"). $0.001 and up, and
 *  every other screen (the coin page keeps the full figure), as price(). */
export function listPrice(n: number): string {
  if (!(n > 0) || n >= 0.001) return price(n);
  const zeros = -Math.floor(Math.log10(n)) - 1;
  const digits = String(Math.floor(n * 10 ** (zeros + 2) + 1e-9)).padStart(2, "0").slice(0, 2).replace(/0$/, "");
  return `$0.0${String(zeros).split("").map((d) => SUB[Number(d)]).join("")}${digits}`;
}
/** "+$2.10", "−$3.20": a change in dollars, always signed. */
export const usdChange = (n: number): string => `${sign(n)}${usd(Math.abs(n))}`;
/**
 * "+12.1%", "−4.3%", "+442%". Near 100% it is cut to one decimal toward zero, so a coin that still has a price never reads
 * "−100%". A change that rounds to nothing reads "0.0%", with no sign either way.
 */
export function pct(n: number): string {
  const a = Math.abs(n);
  const s = a >= 100 ? String(Math.round(a)) : a >= 99.5 ? (Math.floor(a * 10) / 10).toFixed(1) : a.toFixed(1);
  return Number(s) === 0 ? "0.0%" : `${sign(n)}${s}%`;
}
/** Dollars next to percent: "+$2.10  +8.4%". */
/** Dollars too small to show (under a millionth: a memecoin's move) leave the percent alone, never "+<$0.000001 +1.8%"
 *  (QA's crawl, 5 Nov; the Copywriter). */
export const change = (dollars: number, percent?: number): string => (percent === undefined || !Number.isFinite(percent) ? usdChange(dollars) : Math.abs(dollars) > 0 && Math.abs(dollars) < 1e-6 ? pct(percent) : `${usdChange(dollars)} ${pct(percent)}`);
/** The coin page's change line over a range: its change, or "No change" when the percent rounds to nothing. */
export const moveWords = (dollars: number, percent: number): string => (pct(percent) === "0.0%" ? "No change" : change(dollars, percent));

/** A raw amount in coin units, exactly: 1171402n with 5 decimals -> "11.71402". */
export function units(raw: string | bigint, decimals: number): string {
  const v = BigInt(raw), base = 10n ** BigInt(decimals);
  const whole = v / base, frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
/** A coin amount for people: "1,171,402", "50.3", "1.17M", "0.0042". */
export function amount(raw: string | bigint, decimals: number): string {
  const v = Number(units(raw, decimals));
  if (v >= 1e9) return billions(v);
  if (v >= 1e7) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v === 0) return "0";
  return v.toPrecision(2).replace(/e.*$/, "");
}
/** "1.2 s", "850 ms". */
/** How long a trade took, in plain words, never shorter than it was: "done in under a second", and from a second on
 *  rounded UP, "done in under 2 seconds" for 1.68 s (grade 1 Nov, item 3: 1,684 ms read "done in 1 second"). */
/** A route as the screen names it (product decision, 5 Nov: the protocol is NEAR Intents on screen): a NEAR trade's route is "1Click"
 *  in the data (near/engine.ts) and stays so; only its display changes. Any other route is its own name. */
export const routeName = (route: string): string => (route === "1Click" ? "NEAR Intents" : route);
export const tookWords = (ms: number): string => (ms < 1000 ? "done in under a second" : `done in under ${Math.floor(ms / 1000) + 1} seconds`);
export const seconds = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
/** "2 min", "3 h", "Yesterday". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 172800) return "Yesterday";
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** What a coin's page says when nothing names it (the ledger's word for the same coin). */
export const UNNAMED_COIN = "An unnamed coin";
/** A contract id, or an address cut short, where a name belongs: "xrp.omft.near", "nep141:…", "0x1234…abcd", 32 or more
 *  letters and digits. `address`: the coin's own, so any spelling of it counts. */
export function isRawCoinId(s: string, address?: string): boolean {
  const t = s.trim().toLowerCase();
  const own = address?.trim().toLowerCase();
  if (own && (t === own || t === own.replace(/^nep\d+:/, ""))) return true;
  return /^nep\d+:/.test(t) || /…/.test(t) || /^0x[0-9a-f]{4,}/.test(t) || /^\S+\.(near|tg)$/.test(t) || /^[0-9a-z]{32,}$/.test(t);
}
/** A coin page's headline: its name, else its symbol, never an id; nothing to call it: UNNAMED_COIN. */
export function coinHeadline(name: string | undefined, symbol: string | undefined, address?: string): string {
  const said = (s: string | undefined) => (s && s.trim() && !isRawCoinId(s, address) ? s : undefined);
  return said(name) ?? said(symbol) ?? UNNAMED_COIN;
}

/** GeckoTerminal's dex id in words: "pumpswap" -> "PumpSwap", "raydium-clmm" -> "Raydium". */
export function dexName(dex: string): string {
  const known: Record<string, string> = { "near-intents": "NEAR Intents", pumpswap: "PumpSwap", "pump-fun": "pump.fun", raydium: "Raydium", "raydium-clmm": "Raydium", "raydium-launchlab": "LaunchLab", "meteora-dbc": "Meteora", "meteora-damm-v2": "Meteora", meteora: "Meteora", orca: "Orca", "four-meme": "four.meme", "pons-v2": "Pons", "rhea-finance": "Rhea", "ref-finance": "Rhea" };
  if (known[dex]) return known[dex];
  // the big families by their own names, whatever version or chain GeckoTerminal adds ("pancakeswap-v3-bsc" → PancakeSwap)
  const family = ([["pancakeswap", "PancakeSwap"], ["uniswap", "Uniswap"], ["sushiswap", "SushiSwap"], ["aerodrome", "Aerodrome"], ["raydium", "Raydium"], ["meteora", "Meteora"], ["flap", "Flap"], ["hood-fun", "hood.fun"], ["robinfun", "RobinFun"]] as const).find(([k]) => dex.startsWith(k));
  return family ? family[1] : dex.split(/[-_]/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

/** Under a buy's "to spend": what the wallet keeps for its network fees (the copywriter's line). */
export const keptLine = (kept: string): string => `${kept} stays in the wallet for network fees.`;
