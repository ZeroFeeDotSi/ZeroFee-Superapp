// The Sim's simulated sites (product decision, 5 Nov: "these apps shouldn't lead to a dead screen, we want people to feel the
// pump.fun app and GMGN and the browser, we want them to see everything how it'll look like a full sim"). Everything
// here is made up: coin names no real coin is known by here, no person's name, no site's logo or art. The pages are
// drawn by ZeroFee in its own style (SimSitePage.tsx): a launchpad board in pump.fun's place, trenches in GMGN's, a
// plain page for any other address. Pure, so node tests it (sim-sites.test.ts).
import { onDemoPage, simPage } from "@zerofee/shell-api/release.ts";
import { TOR_IN_PHONE_BUILD } from "../privacy.ts";

/** Is the Sim on here? The public Sim (simPage), or the sample demo (?demo) in a browser. On the phone app, never:
 *  there a site opens in ZeroFee's real window. */
export function simSitesOn(env: { sim?: boolean; demo?: boolean; phone?: boolean } = {}): boolean {
  const sim = env.sim ?? simPage();
  const demo = env.demo ?? onDemoPage();
  const phone = env.phone ?? (typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.zerofee);
  return sim || (demo && !phone);
}

export type SimSiteKind = "pump" | "gmgn" | "web";
/** Which page a listed site opens: pump.fun's board, GMGN's trenches; every other address a plain page. */
export const simSiteKind = (site: string | undefined): SimSiteKind => (site === "pump" ? "pump" : site === "gmgn" ? "gmgn" : "web");

export type PumpBoard = "now" | "new" | "grad";
export type Trench = "new" | "completing" | "completed";
export interface SimSiteCoin {
  /** The bridge's sample-coin id (MockBridge sim.site.trade accepts sim-[a-z0-9]{2,12}). */
  token: string;
  symbol: string;
  name: string;
  /** One line under the name, on its page. */
  line: string;
  priceUsd: number;
  capUsd: number;
  changePct: number;
  /** How far along its bonding curve, 0–100 (100 = graduated). */
  curvePct: number;
  ageMin: number;
  replies: number;
  holders: number;
  volUsd: number;
  /** Its colour, for the drawn badge (a hue, 0–360). */
  hue: number;
  board: PumpBoard;
  trench: Trench;
}

/** Twelve made-up coins (sample dollars). */
export const SIM_SITE_COINS: readonly SimSiteCoin[] = [
  { token: "sim-pebble", symbol: "PEBL", name: "Pebble", line: "A small round stone with big plans.", priceUsd: 0.000412, capUsd: 41_200, changePct: 18.4, curvePct: 62, ageMin: 14, replies: 86, holders: 412, volUsd: 18_400, hue: 28, board: "now", trench: "completing" },
  { token: "sim-comet", symbol: "CMET", name: "Comet Cat", line: "A cat that only comes round once a year.", priceUsd: 0.00187, capUsd: 187_000, changePct: -6.2, curvePct: 100, ageMin: 190, replies: 340, holders: 2_140, volUsd: 96_000, hue: 260, board: "now", trench: "completed" },
  { token: "sim-lantern", symbol: "LANT", name: "Lantern", line: "Lights the way, mostly sideways.", priceUsd: 0.0000953, capUsd: 9_530, changePct: 42.1, curvePct: 21, ageMin: 3, replies: 12, holders: 58, volUsd: 3_100, hue: 45, board: "new", trench: "new" },
  { token: "sim-sprout", symbol: "SPRT", name: "Sprout", line: "Water daily. Do not overthink.", priceUsd: 0.000694, capUsd: 69_400, changePct: 9.8, curvePct: 88, ageMin: 41, replies: 154, holders: 806, volUsd: 31_000, hue: 130, board: "grad", trench: "completing" },
  { token: "sim-tidepool", symbol: "TIDE", name: "Tidepool", line: "Small crabs, smaller fees.", priceUsd: 0.0000412, capUsd: 4_120, changePct: 3.1, curvePct: 8, ageMin: 1, replies: 4, holders: 19, volUsd: 900, hue: 195, board: "new", trench: "new" },
  { token: "sim-snail", symbol: "ZOOM", name: "Rocket Snail", line: "Slow until it isn't.", priceUsd: 0.000781, capUsd: 78_100, changePct: 27.5, curvePct: 94, ageMin: 66, replies: 212, holders: 1_034, volUsd: 44_800, hue: 330, board: "grad", trench: "completing" },
  { token: "sim-crane", symbol: "FOLD", name: "Paper Crane", line: "Folded a thousand times, for luck.", priceUsd: 0.000158, capUsd: 15_800, changePct: -2.4, curvePct: 33, ageMin: 9, replies: 27, holders: 131, volUsd: 5_600, hue: 0, board: "new", trench: "new" },
  { token: "sim-toad", symbol: "NTOAD", name: "Neon Toad", line: "Glows in the dark. Croaks in the day.", priceUsd: 0.00312, capUsd: 312_000, changePct: 64.0, curvePct: 100, ageMin: 420, replies: 610, holders: 3_870, volUsd: 188_000, hue: 150, board: "now", trench: "completed" },
  { token: "sim-biscuit", symbol: "BSCT", name: "Biscuit", line: "Goes with everything. Especially tea.", priceUsd: 0.000534, capUsd: 53_400, changePct: -11.3, curvePct: 79, ageMin: 28, replies: 98, holders: 522, volUsd: 22_000, hue: 35, board: "grad", trench: "completing" },
  { token: "sim-glowworm", symbol: "GLOW", name: "Glow Worm", line: "Tiny, bright, and up past bedtime.", priceUsd: 0.0000267, capUsd: 2_670, changePct: 12.0, curvePct: 5, ageMin: 2, replies: 2, holders: 11, volUsd: 400, hue: 75, board: "new", trench: "new" },
  { token: "sim-cloudpug", symbol: "PUFF", name: "Cloud Pug", line: "Fluffy. Weightless. Snores.", priceUsd: 0.00121, capUsd: 121_000, changePct: 5.6, curvePct: 100, ageMin: 260, replies: 287, holders: 1_690, volUsd: 72_500, hue: 210, board: "now", trench: "completed" },
  { token: "sim-marble", symbol: "MRBL", name: "Marble", line: "Rolls under the sofa, comes back richer.", priceUsd: 0.000226, capUsd: 22_600, changePct: 7.7, curvePct: 47, ageMin: 19, replies: 41, holders: 203, volUsd: 8_200, hue: 280, board: "now", trench: "new" },
];

/** The board tabs, in pump.fun's place. */
export const PUMP_BOARDS: readonly { id: PumpBoard; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "new", label: "New coins" },
  { id: "grad", label: "About to graduate" },
];
/** The trenches, in GMGN's place. */
export const GMGN_TRENCHES: readonly { id: Trench; label: string }[] = [
  { id: "new", label: "New" },
  { id: "completing", label: "Completing" },
  { id: "completed", label: "Completed" },
];

export const coinsOnBoard = (b: PumpBoard) => SIM_SITE_COINS.filter((c) => c.board === b || (b === "now" && c.changePct > 20));
export const coinsInTrench = (t: Trench) => SIM_SITE_COINS.filter((c) => c.trench === t);

/** One-tap Buy amounts (the site wallet's sample money; under the $100 cap, so no sheet). */
export const SIM_SITE_BUYS = [5, 10, 20] as const;

/** The hosts each listed site's title bar shows. */
export const SIM_SITE_HOST: Record<"pump" | "gmgn", string> = { pump: "pump.fun", gmgn: "gmgn.ai" };

// Words (short, plain).
export const SIM_SITE_WORDS = {
  sim: "Simulation · sample coins, pretend money",
  board: "Coins people made today",
  trenches: "Fresh coins, live",
  bought: (amount: string, symbol: string, usd: number) => `Bought ${amount} ${symbol} for $${usd.toFixed(2)}`,
  sold: (usd: number) => `Sold for $${usd.toFixed(2)}`,
  /** Its coin left to spend (the strip counts the coins bought too). */
  short: (have: number) => `$${have.toFixed(2)} left to spend in this wallet. Add money to buy more.`,
  none: "You don't hold this coin yet.",
  failed: "That didn't go. Nothing moved. Try again.",
  webTitle: "This is a simulation",
  webBody: (host: string) => `In the full app ${host} opens right here, with your wallet ready.`,
  webMore: "Pages open inside ZeroFee, never in a new tab. Your money stays in your wallets.",
  search: (q: string) => `Results for "${q}"`,
} as const;

/** Sample web results for a typed search or site (made-up pages). */
export const simWebLinks = (host: string) => [
  { title: `${host} · Home`, line: "The front page." },
  { title: `${host} · About`, line: "Who runs it and what it does." },
  { title: `${host} · Help`, line: "Answers to common questions." },
];

/** History's sample rows in the Sim when nothing was opened yet (minutes ago). */
export const SIM_HISTORY: readonly { host: string; agoMin: number }[] = [
  { host: "pump.fun", agoMin: 4 },
  { host: "gmgn.ai", agoMin: 22 },
  { host: "solscan.io", agoMin: 75 },
  { host: "dexscreener.com", agoMin: 190 },
  { host: "jup.ag", agoMin: 1_500 },
];

// Formatting.
export const fmtCap = (usd: number) => (usd >= 1e6 ? `$${(usd / 1e6).toFixed(1)}M` : usd >= 1e3 ? `$${(usd / 1e3).toFixed(1)}K` : `$${Math.round(usd)}`);
export const fmtPrice = (usd: number) => (usd >= 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toPrecision(3)}`);
export const fmtAge = (min: number) => (min < 60 ? `${min}m` : min < 1440 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 1440)}d`);
export const fmtPct = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
export const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
/** A coin amount from the bridge's whole units: 12,136 or 0.4321. */
export function fmtUnits(units: string, decimals: number): string {
  const n = Number(units) / 10 ** decimals;
  return n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** A coin's made-up price walk (deterministic from its id), ending at its change: n points, 0..1. */
export function sparkOf(c: Pick<SimSiteCoin, "token" | "changePct">, n = 24): number[] {
  let seed = [...c.token].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const pts: number[] = [];
  let v = 1;
  const drift = c.changePct / 100 / n;
  for (let i = 0; i < n; i++) {
    pts.push(v);
    v = Math.max(0.05, v * (1 + drift + (rnd() - 0.5) * 0.12));
  }
  const lo = Math.min(...pts), hi = Math.max(...pts);
  return pts.map((p) => (hi === lo ? 0.5 : (p - lo) / (hi - lo)));
}
/** An SVG path through the walk, in a w×h box. */
export function sparkPath(pts: readonly number[], w: number, h: number, pad = 2): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)} ${(pad + (1 - p) * (h - 2 * pad)).toFixed(1)}`).join(" ");
}

/** History's sample visits (SIM_HISTORY), as the Browser's own Visit rows. */
export const simHistory = (now = Date.now()) => SIM_HISTORY.map((h) => ({ host: h.host, url: `https://${h.host}/`, atIso: new Date(now - h.agoMin * 60e3).toISOString() }));
/** Privacy's sample in the Sim: the phone's own view, trackers blocked; its switches move only here. Private browsing is
 *  what the phone build has (privacy.ts TOR_IN_PHONE_BUILD, audit 15 FB3): not ready until Tor is linked. */
export const SIM_PRIVACY = { kind: "phone", private: true, normalSites: ["gmgn.ai"], built: TOR_IN_PHONE_BUILD, blockTrackers: true } as const;

/**
 * b18: AgentZero's browser in the Sim: the phone's own loop and guards (phone.ts) over the Sim's made-up sites, thought
 * by the Sim's thinker (agent-thinker.ts: no model, no network, no money). Loaded only where the Sim is on (never on the
 * phone, never in the extension, whose stand-in for this file returns null). Null anywhere else.
 */
export async function simAgent(env: { sim?: boolean; demo?: boolean; phone?: boolean } = {}): Promise<import("../agent/live.ts").CloudBrowser | null> {
  const phone = env.phone ?? (typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.zerofee);
  if (phone || !simSitesOn(env)) return null;
  return (await import("./agent-sim.ts")).simCloud();
}

/** b18: the Sim's made-up sites AgentZero's browser can open (agent-fixtures.ts FIXTURE_SITES; a test holds them equal). */
export const SIM_AGENT_SITES: readonly string[] = ["mugs.example.com", "news.example.com", "events.example.com", "docs.example.com"];
