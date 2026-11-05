// A site's own app (product decision, 3 Nov: pump.fun and GMGN left the Browser for apps of their own in the tray): its wallet page,
// pure, so node tests it (site-wallet.test.ts). What the page shows: the wallet's dollars, its coins, its address, its
// last moves, and any slow or refused line at the bottom; then one big "Open <site>". Words a 5-year-old can read.
// Also the Activity centre's bookkeeping both the page and the Browser share (D144): each site's Add task while it is on
// its way, and a Take out followed home from the core's own record.
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingActivity } from "@zerofee/core/spending";
import { proofUrlOk, type MoveProof } from "@zerofee/core/tx-proof";
import { siteWalletFunded } from "@zerofee/core/site-funded";
import { outsideShort } from "@zerofee/core/format";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { usd } from "@zerofee/trade/app/format.ts";
import { backSteps, type MoveBack } from "../site-tasks.ts";
import { CHAIN_NAME, SITE_CHAINS, notCarried, solOf, type HubRow, type SiteChain } from "./hub-state.ts";
import { stays, takeOutAlso, tooSmall } from "./take-out.ts";

/** Each network's own coin, as the wallet holds it. */
const COIN: Readonly<Record<string, string>> = { sol: "SOL", bsc: "BNB", base: "ETH", eth: "ETH" };
/** How many moves the page lists (the rest are in Activity). */
export const MOVES_SHOWN = 4;
/** An Add on its way longer than this is slow: said at the bottom, plainly. */
export const SLOW_MS = 6 * 60_000; // a normal Add takes NEAR 3–4 min (5 Nov): "slow" only past that

/** A Take out as the core keeps it (subwallet.site.moveBacks): the move out of the site's wallet, then on home. */
export interface SiteBack { back: { id: string; status: string; usd?: number; site?: string; startedAtIso?: string; updatedAtIso?: string; proof?: MoveProof }; home?: { status: string } }

/** `native`: the network's own coin by the core's token mark ("native"), never by a symbol a token chose for itself (an
 *  airdropped "SOL" mint is not Solana); only it wears the network's name and logo. */
export interface WalletCoin { network: string; name: string; symbol: string; dollars: string; native?: true }
/** One coin the core lists for a site wallet (subwallet.coins): `amount` in smallest units; `usd` null = no price. */
export interface SiteCoin { token: string; symbol: string; name?: string; decimals: number; amount: string; usd: number | null }

/** An Add on its way, on its row (product decision, 5 Nov: the protocol at work takes the time; real runs 3–4 min). */
export const ADD_GOING = "On its way. NEAR takes 3–4 minutes.";
/** Why this wallet exists and where it works, under its title (real-money lap, 5 Nov: "$0.00" with nothing said). */
export const madeFor = (name: string): string => `ZeroFee made this wallet for ${name}. It works only on ${name}.`;

/** The network's own coin (SOL on Solana): it wears the network's logo; any other coin, its own mark. */
export const coinIsNative = (c: Pick<WalletCoin, "network" | "symbol">): boolean => !!COIN[c.network] && c.symbol === COIN[c.network];

/** "1234500000" with 9 decimals → "1.2345"; at most 6 decimals, trailing zeros dropped. */
export function coinAmount(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return "?";
  const s = amount.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = decimals ? s.slice(s.length - decimals).slice(0, 6).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

/** The core's coins for each of the site's wallets, as rows: the network's coin first, then by dollars (the core's own
 *  order kept); a coin with no price shows its amount, never $0.00. */
export function coinsFromCore(byNetwork: readonly { network: string; coins: readonly SiteCoin[] }[]): WalletCoin[] {
  const out: WalletCoin[] = [];
  for (const { network, coins } of byNetwork) {
    for (const c of coins) {
      if (!/[1-9]/.test(c.amount)) continue;
      const sym = (c.symbol || "").slice(0, 12);
      // the network's own coin (the core's token "native", never its symbol: the audit, a spam "SOL" mint) by its
      // network's name ("Solana", never "SOL" over "SOL"; UI audit 5 Nov)
      const native = c.token === "native";
      const own = native ? CHAIN_NAME[network as SiteChain] : undefined;
      out.push({ network, name: (own ?? (c.name || sym)).slice(0, 40), symbol: sym, dollars: c.usd !== null && Number.isFinite(c.usd) ? usd(c.usd) : `${coinAmount(c.amount, c.decimals)} ${sym}`.trim(), ...(native ? { native: true as const } : {}) });
    }
  }
  return out;
}
/** `url`: its transaction on the chain's explorer (core tx-proof.ts), the proof; none when the chain has none yet. */
export interface WalletMove { id: string; title: string; detail: string; state: "done" | "moving" | "failed"; at: string; url?: string }

/** The transaction that touched the site's wallet: an Add's landing (its end), a Take out's start; else the other. */
const proofOf = (p: MoveProof | undefined, first: "start" | "end"): { url?: string } => {
  const url = (first === "end" ? [p?.end?.url, p?.start?.url] : [p?.start?.url, p?.end?.url]).find((u) => proofUrlOk(u));
  return url ? { url } : {};
};
export interface WalletView {
  /** The wallet's dollars: "$12.40"; "…" before the first read; never $0.00 for a wallet that can't be read. */
  dollars: string;
  /** Under the total when some coins have no price: "Plus coins with no price." */
  totalNote?: string;
  coins: WalletCoin[];
  /** Its Solana address (the one Add fills); none until the wallet is made. */
  address?: string;
  canAdd: boolean;
  canTakeOut: boolean;
  moves: WalletMove[];
  /** Slow or refused, at the bottom of the page. */
  lines: string[];
  /** The one big button. */
  open: string;
}

const money = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) ? usd(n) : "");

/** An Add's row, from Spending's own record of it. */
/** A shell job as the site wallet reads it (shell-api tasks.ts Task). */
export interface JobRowIn { id: string; title: string; state: string; startedAt: number; usd?: string }
/** This site's Add jobs still going (SiteMoney.tsx startJob: "Add $10.00 to your pump.fun wallet") with no Add row of
 *  Spending's on its way yet: each its "On its way" row, so the list shows it on the frame "Job created." does. One row
 *  per move: once Spending's row for it is read (on its way), the job's row gives way to it. */
export function jobMoves(name: string, jobs: readonly JobRowIn[], adds: readonly WalletMove[]): WalletMove[] {
  if (adds.some((a) => a.state === "moving")) return [];
  const mine = `to your ${name} wallet`;
  return jobs.filter((j) => j.state === "pending" && j.title.startsWith("Add ") && j.title.endsWith(mine)).map((j) => {
    const $ = /^Add (\$[\d,.]+) /.exec(j.title)?.[1] ?? j.usd;
    return { id: `job:${j.id}`, title: $ ? `Add ${$}` : "Add money", detail: ADD_GOING, state: "moving" as const, at: new Date(j.startedAt).toISOString() };
  });
}

function addMove(name: string, a: SpendingActivity): WalletMove {
  return { ...addWords(name, a), ...proofOf(a.proof, "end") };
}
function addWords(name: string, a: SpendingActivity): WalletMove {
  const $ = money(Number(a.usd));
  const title = $ ? `Add ${$}` : "Add money"; // one word for the move (crawl F14)
  // finding 61: the Add reached the NEAR wallet but its move on to the site's didn't go: never "It's in your … wallet"
  if (a.stoppedShort) return { id: a.id, title, detail: a.note ?? "It didn't reach the wallet. Your money is safe.", state: "failed", at: a.atIso };
  if (a.status === "done") return { id: a.id, title, detail: "It's in this wallet.", state: "done", at: a.atIso };
  if (a.status === "failed" || a.status === "refused") return { id: a.id, title, detail: a.note ?? "It didn't go. Your money is safe.", state: "failed", at: a.atIso };
  if (a.status === "refunded") return { id: a.id, title, detail: a.note ?? "It came back. Your money is safe.", state: "done", at: a.atIso };
  if (a.status === "waiting-for-you") return { id: a.id, title, detail: "Waiting for you.", state: "moving", at: a.atIso };
  return { id: a.id, title, detail: ADD_GOING, state: "moving", at: a.atIso };
}

/** A Take out's row, from the core's own record of it (the same steps its Activity task follows). */
function backMove(name: string, m: SiteBack): WalletMove {
  return { ...backWords(name, m), ...proofOf(m.back.proof, "start") };
}
function backWords(name: string, m: SiteBack): WalletMove {
  const $ = money(m.back.usd);
  const s = backSteps(name, m);
  const at = m.back.updatedAtIso ?? m.back.startedAtIso ?? "";
  const title = $ ? `Take out ${$}` : "Take out money"; // one word for the move (crawl F14)
  if (!s.end) return { id: m.back.id, title, detail: "On its way to your Safe.", state: "moving", at };
  return { id: m.back.id, title, detail: s.end.detail, state: s.end.state === "failed" ? "failed" : "done", at };
}

/**
 * The wallet page. `row`: the site's wallets as the hub reads them (hubRows); `read`: how the last read went;
 * `moving`: an Add on its way (its dollars and since when); `adds`: Spending's moves; `backs`: the core's Take outs.
 */
export function walletView(i: {
  site: string;
  name: string;
  row?: HubRow;
  read: "first" | "ok" | "failed";
  moving?: { usd: number; sinceMs: number };
  adds?: readonly SpendingActivity[];
  backs?: readonly SiteBack[];
  line?: string;
  now: number;
  /** The core's coins per wallet (subwallet.coins); absent or empty: the wallets' own coin as before. */
  coins?: readonly { network: string; coins: readonly SiteCoin[] }[];
  /** The shell's jobs (the task store): an Add's job made at "Job created." is its row here on that same frame, before
   *  Spending's own row for it is read (5 Nov: "Nothing yet" for about 1 s). */
  jobs?: readonly JobRowIn[];
}): WalletView {
  const { site, name, row, read } = i;
  const dollars = row?.usd !== null && row?.usd !== undefined ? usd(row.usd) : read === "failed" ? "Can't see it now" : "…";
  // the total is the wallet's one figure (spending.wallets: its coin and every priced coin bought on the site, the same
  // figure Home and the landing line say; QA 5 Nov: three figures for one wallet); a coin with no price is left
  // out of it and said so (independent UI grade, 3 Nov: "$0.00" above a $2.47 coin)
  let totalNote: string | undefined;
  const held = (i.coins ?? []).flatMap((w) => w.coins).filter((c) => /[1-9]/.test(c.amount));
  if (held.length) {
    const priced = held.filter((c) => c.usd !== null && Number.isFinite(c.usd));
    if (priced.length < held.length) totalNote = priced.length ? "Plus coins with no price." : "Your coins have no price yet.";
  }
  // its coins: each network's wallet with money in it, in the site's order; none yet: its Solana wallet at $0.00
  const order = (n: string) => { const k = (SITE_CHAINS[site] ?? ["sol"]).indexOf(n as SiteChain); return k < 0 ? 99 : k; };
  const funded = (row?.wallets ?? []).filter((w) => siteWalletFunded(w.usd, w.holds)).sort((a, b) => order(a.network) - order(b.network));
  const coins: WalletCoin[] = funded.map((w) => ({ network: w.network, name: CHAIN_NAME[w.network as SiteChain] ?? w.network, symbol: COIN[w.network] ?? "", dollars: w.usd !== null ? usd(w.usd) : w.holds!, native: true as const }));
  if (!coins.length && row && row.usd !== null) coins.push({ network: "sol", name: "Solana", symbol: "SOL", dollars: usd(0), native: true });
  // every coin the wallet holds (bought on the site too), when the core has listed them
  const listed = i.coins?.length ? coinsFromCore(i.coins) : [];
  if (listed.length) coins.splice(0, coins.length, ...listed);
  const moving = i.moving;
  const canAdd = Boolean(row?.wallet) && !moving;
  const canTakeOut = Boolean(row?.wallet) && ((solOf(row) ?? 0) >= 2 || takeOutAlso(row!).length > 0);
  const addRows = (i.adds ?? []).filter((a) => a.site === site && !a.of).map((a) => addMove(name, a));
  const moves = [
    ...addRows,
    ...jobMoves(name, i.jobs ?? [], addRows),
    ...(i.backs ?? []).filter((m) => m.back.site === site).map((m) => backMove(name, m)),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MOVES_SHOWN);
  const lines: string[] = [];
  if (i.line) lines.push(i.line);
  // an Add on its way is its row in Moves (one row, QA 5 Nov); a line only when it is slow, or has no row. Never
  // "About a minute": a real Add took 3 to 4 minutes (5 Nov)
  const hasRow = moves.some((m) => m.state === "moving");
  if (moving && i.now - moving.sinceMs > SLOW_MS) lines.push(`NEAR is slow right now. ${usd(moving.usd)} is still on its way.`);
  else if (moving && !hasRow) lines.push(`${usd(moving.usd)} is on its way. NEAR takes 3–4 minutes.`);
  if (read === "failed") lines.push("Solana didn't answer. This is from the last look.");
  const why = takeOutWhy({ name, canTakeOut, wallet: Boolean(row?.wallet), moving: Boolean(moving), sol: row ? solOf(row) : null, coins: listed });
  if (why) lines.push(why);
  if (row) {
    for (const c of stays(row)) lines.push(`${notCarried(c)} Take out leaves your ${CHAIN_NAME[c]} money here.`);
    for (const c of tooSmall(row)) lines.push(`Your ${CHAIN_NAME[c]} money is under $2, so Take out leaves it.`);
  }
  return { dollars, ...(totalNote ? { totalNote } : {}), coins, ...(row?.address ? { address: row.address } : {}), canAdd, canTakeOut, moves, lines, open: `Open ${name}` };
}

/**
 * Finding 46: why Take out is off, said on the page (a wallet showed $2.47 in Bonk under a greyed Take out). Take out
 * moves the wallet's SOL home; a coin bought on the site must be sold for SOL there first; under $2 of SOL stays.
 */
export function takeOutWhy(i: { name: string; canTakeOut: boolean; wallet: boolean; moving: boolean; sol: number | null; coins: readonly WalletCoin[] }): string | null {
  if (i.canTakeOut || !i.wallet || i.moving) return null;
  const others = [...new Set(i.coins.filter((c) => c.network === "sol" && c.symbol && c.symbol !== "SOL").map((c) => c.symbol))];
  if (others.length) return `Take out moves only SOL. Sell your ${others.slice(0, 2).join(" and ")} for SOL on ${i.name} first.`;
  if ((i.sol ?? 0) > 0) return `Take out needs $2 of SOL. This wallet has ${usd(i.sol as number)}.`;
  return null;
}

/** "So1a nA11 …": the whole address in groups of four, as the QR sheet shows it. */
export { groupAddress } from "@zerofee/core/address-group";
/** "So1ana…111111": the address short, for its row, six and six (core format.ts outsideShort; Sim test: the
 *  pump.fun page cut it four and four). */
export const shortAddress = (a: string): string => outsideShort(a);
/** The wallet's every move, on Solana's own explorer (the proof, outside ZeroFee). */
export const proofUrl = (address: string): string => `https://solscan.io/account/${encodeURIComponent(address)}`;

/** D144: each site's Add task while it's on its way (kept on this phone, so a relaunch still ends it). */
const ADD_TASKS_KEY = "zf.hub.addtasks.v1";
export const readAddTasks = (store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Record<string, string> => {
  try { const v = JSON.parse(store?.getItem(ADD_TASKS_KEY) ?? "{}") as unknown; return v && typeof v === "object" ? (v as Record<string, string>) : {}; } catch { return {}; }
};
export const saveAddTasks = (v: Record<string, string>, store: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void => { try { store?.setItem(ADD_TASKS_KEY, JSON.stringify(v)); } catch { /* memory only */ } };

/** D144: a Take out followed home in the Activity centre, from the core's own record of it (every 5 s, up to 30 min). */
const FOLLOW_MS = 5000, FOLLOW_FOR_MS = 30 * 60_000;
export function followBack(bridge: Bridge, tasks: Tasks, taskId: string, moveId: string, name: string, until = Date.now() + FOLLOW_FOR_MS): void {
  const look = async () => {
    const r = await bridge.call<MoveBack[]>("subwallet.site.moveBacks").catch(() => null);
    const m = r && "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => x?.back?.id === moveId) : undefined;
    const s = backSteps(name, m);
    tasks.update(taskId, { steps: s.steps });
    if (s.end) return void tasks.end(taskId, s.end.state, s.end.detail);
    if (Date.now() < until) setTimeout(() => void look(), FOLLOW_MS);
    else tasks.end(taskId, "stopped", "NEAR doesn't show it in your Safe yet. Look again in a minute.");
  };
  setTimeout(() => void look(), FOLLOW_MS);
}
