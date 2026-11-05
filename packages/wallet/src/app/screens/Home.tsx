// Home (the Home plan §1.1, D129, D126; product decision, 3 Nov; Safe | Hot, product decision, 5 Nov, HOME-SAFE-HOT-SPEC). Top to bottom:
// 1. one number, everything you have, its digits rolling when it changes; under it the day's change of the tab shown (the
//    pulse). A tap on the number hides every amount on Home, and the phone remembers;
// 2. four round actions: Add · Send · Swap · Move;
// 3. two tabs, Safe and Hot (safe-hot.ts). Safe, the first: only the Safe, one row per coin it holds inside intents.near
//    and its own NEAR, each opening that coin's trade page; what is on its way into it, the account's next step and its
//    health check. Hot: Trade's wallets, one per chain (SOL, ETH (RH), NEAR), each with its coins and an Add (opens Move,
//    set to it), then one row per site (pump.fun, GMGN, the agent's) that opens to its wallets, each coin its own row;
// 4. a read that failed keeps its last figure and is one line under the rows, saying when it was read and who failed
//    (home-view.ts readLines), with Retry: never $0, never "Solana and NEAR" whatever failed.
// The web wallet (no Safe) is Hot alone, no tabs. Hidden is not a place on Home (D128): its coins count with the Safe's.
// Motion is CSS (wallet.css): rows rise in 30 ms apart, the bar's thumb slides, the round buttons glow when pressed, the
// loading rows shimmer; under Reduce Motion it all snaps. A tab or a button is a light tap on the phone (device.haptic).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ReadLine } from "@zerofee/design/ReadLine.tsx";
import { shortTime, weekdayName } from "@zerofee/core/clock";
import type { SpendingActivity, SpendingStatus } from "@zerofee/core/spending";
import { ADD_OPEN } from "@zerofee/core/add-outside";
import { SERVICE_NAMES, serviceOf } from "@zerofee/core/services";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { usdOf } from "../../amount.ts";
import { amountOf, balanceTotal, chainName, coins, dollars, plusUsd, safeLines, titleOf, type Line } from "../format.ts";
import { awayUsd as awayOf, sumUsd, type HeldCoin } from "../trading.ts";
import { ActAdd, ActMove, ActSend, ActSwap, TabSafe } from "../icons.tsx";
import { swapLabel } from "../money/swap-follow.ts";
import type { AddOnWay, addOnWayLine as AddOnWayLine } from "../money/adds-on-way.ts";
import type * as WebPart from "./home-web.ts";
import type * as SparkMod from "@zerofee/design/Sparkline.tsx";
import type * as JobMadeMod from "../money/JobMade.tsx";
import type * as MovingMod from "../hot-moving.ts";
import type * as PnlMod from "./pnl.tsx";
import type * as ReadLinesMod from "./read-lines.ts";
import type * as LiveModule from "../money/LiveTrack.tsx";
import { usually, useWallet } from "../runtime.tsx";
import { useCoinLogos } from "../coin-logos.ts";
import { AS_OF_AFTER_MS, HIDDEN_AMOUNT, webActs, type RowChain } from "./home-view.ts";
import { HOME_TAB_IS, HOME_TAB_NAME, HOME_TABS, PRIVATE_DOOR_WORDS, privateDoor, siteGroups, siteLineUsd, siteSections, siteTap, tabPulse, type HomeTab, type SiteCoin, type SiteGroup } from "./safe-hot.ts";
// a site's own logo on its Hot row (S14): by address only, never its bytes in Home's first load
import pumpLogo from "@zerofee/browser/app/logos/pump.png?no-inline";
import gmgnLogo from "@zerofee/browser/app/logos/gmgn.png?no-inline";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { WEB_LINE, WEB_WORDS, hideWebLine, webLineHidden } from "@zerofee/shell-api/web-wallet-words.ts";

export type { RowChain } from "./home-view.ts";
export type { HomeTab } from "./safe-hot.ts";

/** How long a total still missing a part waits before it is shown as it stands (marked "Updating…"). */
export const TOTAL_GRACE_MS = 4000;

/** Where Move starts from, until Move's sliders replace it. */
export type Pot = "safe" | "spending";
/** The wallet a tab stands for: what Add, Send, Swap and Move open pre-set to (none on All). */
export type Wallet = "safe" | RowChain;

export interface HomeActions {
  onAdd: (wallet?: Wallet) => void;
  onSend: (wallet?: Wallet) => void;
  onSwap: (wallet?: Wallet) => void;
  /** Move between the Safe and the wallets. */
  onMove: (from: Pot, wallet?: Wallet) => void;
  /** A coin of the Safe: its trade page (WalletApp: Trade's "coin:intents:…" behind NATIVE_COINS, else Wallet's own). */
  onCoin: (line: Line) => void;
  /** The Safe's Buy: the list of every coin NEAR Intents swaps (Trade's Native coins). Absent: no Buy (end to end or hidden). */
  onBuy?: () => void;
  /** Private's door (safe-hot.ts privateDoor): its screen at once; WalletApp finishes a set-up not done yet (openPrivate). Absent: no door. */
  onPrivate?: () => void;
  onHeld: (held: NonNullable<SpendingActivity["held"]>) => void;
  /** A wallet's own coin: that chain's market in Trade. */
  onRow?: (chain: RowChain) => void;
  /** A coin held in a wallet: its page in Trade. */
  onRowCoin?: (chain: RowChain, address: string, symbol: string) => void;
  /** A site's own wallet ("pump.fun wallet"): its own page (the site's app). */
  onSite?: (site: string) => void;
  /** What the account holds for the person (a held payment or change), from the shell: on Home, drawn only while held. */
  waiting?: ReactNode;
  /** A wallet's address card at its tab's top (first and last letters, Copy, QR), from Add's one-time address (D127):
   *  the Add slice fills it; until it does, nothing is drawn (never the wallet's own public address). */
  addressCard?: (wallet: RowChain) => ReactNode;
  /** The account's next step (HomeSlots.thread), from the shell; on the Safe tab. */
  thread?: ReactNode;
  /** Draws a sheet of Home's own (the live tracker) over the whole app, as Wallet's other sheets are, never inside
   *  Home's scrolling page (D135: the whole screen); null takes it away. */
  overlay?: (node: ReactNode) => void;
  /** S-2: the Safe's health check (HomeSlots.health), from the shell; on the Safe tab. `close`: nothing to go back to. */
  health?: (close: () => void) => ReactNode;
  /** The Safe's coins couldn't be read just now: one line naming who failed, with Retry, under the rows (H6). */
  readFailed?: { onRetry: () => void };
  /** The wallets couldn't be read: Retry reads them again. */
  onRetrySpending?: () => void;
  /** The web wallet (product decision, 4 Nov; shell-api release.ts webWallet): the three hot wallets, no Safe. Its Home
   *  has no Safe section, tab or figure, no Move, and its one line at the top. Tests pass it; the app reads the page. */
  web?: boolean;
}

/** The words Home shows (grade 5). */
/** A site with wallets on more than one network names the network in each card head (GMGN: Solana, Base). */
const NET_WORD: Record<string, string> = { sol: "SOL", base: "Base", hood: "ETH (RH)", near: "NEAR", bsc: "BNB" };
/** A site's logo on its Hot row, by its site id (core site-wallets.ts). */
const SITE_LOGO: Readonly<Record<string, string>> = { pump: pumpLogo, gmgn: gmgnLogo };
export const HOME_WORDS = {
  /** A Safe swap in flight (sandbox hunt B5): its money still counts, on this row, until it lands. */
  swapping: "Swapping",
  swappingWhere: "in your Safe",
  safeLine: "Your NEAR account keeps these rules.",
  reading: "Reading your money from NEAR…",
  /** The web wallet's: its money is in its three wallets, read from each chain. */
  readingWeb: "Reading your wallets…",
  emptySafe: "Add money from any wallet or exchange. It goes into your Safe.",
  hide: "Hide amounts",
  show: "Show amounts",
  unpriced: "We leave out coins we can't price.",
  /** The section header of a wallet with nothing in it (All). */
  empty: "Empty",
  /** finding 43: "NEAR" is a wallet and a coin; its own tab says which is which (Copywriter) */
  nearWhat: "This wallet holds cash for Send and Swap. The NEAR coin in your Safe is apart.",
  /** Hot's first card: the wallets Trade buys with, and what they are (HOME-SAFE-HOT-LOOK §4). */
  trade: "Trade wallets",
  /** Hot's heading over the social trading sites' rows (S17; the copy review's words): never "Sites" or "Apps". */
  social: "Social trading",
  site: "site wallet",
  /** AgentZero's row on Hot (copy review, S14): "Its wallet · $12.00", or "Its wallet · empty" at $0; never a count. */
  agent: "Its wallet",
  agentEmpty: "empty",
  /** The Safe's head: what keeps it (Copywriter, 5 Nov). */
  safeWhat: "Safe",
  /** The number's label on Hot (the voice guard: never "hot wallet"). */
  hotLabel: "Hot",
  emptyRow: "Empty",
  /** The NEAR wallet holding cash only (look §4). */
  nearLine: "Cash",
  /** The Safe's way to every coin NEAR Intents can buy. */
  buy: "Buy",
} as const;
/** A site's row on Hot (the copy review's S14 ruling): how many wallets it has; its total follows ("2 wallets · $27.47"). */
export const walletCount = (n: number) => `${n} ${n === 1 ? "wallet" : "wallets"}`;
/** An empty wallet's one line (its Add is beside its name). */
export const emptyLine = (name: string) => `Your ${name} wallet is empty.`;

/** What a wallet's own tab says it is, where its name alone doesn't (findings 43, 51; Copywriter): "RH" and "NEAR". */
export const WALLET_WHAT: Partial<Record<RowChain, string>> = {
  hood: "ETH (RH) is ETH on Robinhood Chain.",
  near: HOME_WORDS.nearWhat,
};

/** A Trade wallet's name on Hot (HOME-SAFE-HOT-LOOK §4). */
export const HOT_NAME: Record<RowChain, string> = { sol: "SOL wallet", hood: "ETH (RH) wallet", near: "NEAR wallet", bsc: "BNB wallet" };
/** How many of the Safe's coins show before "Show all". */
export const SAFE_FIRST = 4;
/** A wallet's name (D124: "ETH (RH)") and its own coin. */
export const ROW_NAME: Record<RowChain, string> = { sol: "SOL", hood: "ETH (RH)", near: "NEAR", bsc: "BNB" };
const NATIVE: Record<RowChain, string> = { sol: "SOL", hood: "ETH", near: "NEAR", bsc: "BNB" };
const ORDER: readonly RowChain[] = ["sol", "hood", "near", "bsc"];
/** Where the device keeps "amounts hidden". */
export const HIDE_KEY = "hide-amounts";

export interface SubRow { key: string; symbol: string; amount: string; usd: string | null; address?: string; icon?: string }
export interface HomeRow {
  chain: RowChain;
  name: string;
  /** The native coin as the chain has it, with its symbol ("1.42 SOL"); null for NEAR (dollars only) or when unread. */
  amount: string | null;
  /** null: its chain wasn't in the answer: "updating…", never $0 and never left off (D111: never a NEAR-only Home). */
  usd: string | null;
  coins: SubRow[];
  /** Its coin read, its dollar price not (the price read failed): `amount` is said where dollars would be, never "Empty"
   *  or "$0.00" (QA, 4 Nov: 0.05 SOL showed "Empty $0.00" for 19 min while a relay 429 kept the price out). */
  unpriced?: true;
}

/**
 * The wallets (FLOW-V4 §1.3): SOL, ETH (RH) and NEAR always (a $0.00 wallet says where nothing is yet); BNB only while
 * it holds money (open or not, so no money is ever off Home). A wallet's first row is its native coin; each coin held there
 * is its own row with its own dollars, never counted in the row above it as well (Phantom's shape). NEAR is Spending's own
 * balance on NEAR Intents (USDC) plus the NEAR coins held there (D96): dollars first, its rows what it really holds.
 */
/** The chains' own coins the NEAR wallet can hold (an Add's forward that stopped, a refund), as Home names them. */
const NEAR_CHAIN_COINS: Record<string, { symbol: string; decimals: number; icon: string }> = { "nep141:sol.omft.near": { symbol: "SOL", decimals: 9, icon: "sol" }, "nep141:hood.omft.near": { symbol: "ETH", decimals: 18, icon: "eth" } };
/** The SOL and ETH the NEAR wallet holds (subwallet.float.balance), each priced from 1Click's list: so nothing there is
 *  invisible on Home. Dust under a cent is left out. */
export function nearChainCoins(coins: readonly { tokenId: string; amount: string }[] | null, price: (tokenId: string) => number | null): SubRow[] {
  return (coins ?? []).flatMap((t) => {
    const c = NEAR_CHAIN_COINS[t.tokenId];
    if (!c || !/^\d{1,40}$/.test(t.amount) || BigInt(t.amount) === 0n) return [];
    const n = Number(t.amount) / 10 ** c.decimals, p = price(t.tokenId), usd = p ? (n * p).toFixed(2) : null;
    return usd !== null && Number(usd) < 0.01 ? [] : [{ key: `near:${t.tokenId}`, symbol: c.symbol, amount: String(n), usd, icon: c.icon }];
  });
}

/** `inNear`: the SOL or ETH the NEAR wallet holds (nearChainCoins), each its own line. */
export function homeRows(s: SpendingStatus, held: HeldCoin[] = [], inNear: SubRow[] = []): HomeRow[] {
  const coinsOn = (c: RowChain): SubRow[] => held.filter((h) => h.chain === c).map((h) => ({ key: `${c}:${h.address}`, symbol: h.symbol, amount: h.amount, usd: h.usd ?? null, address: h.address }));
  const rows: HomeRow[] = [];
  for (const c of ORDER) {
    if (c === "near") {
      const reserve = s.reserveUsd ?? "0.00";
      // its cash is its USDC, one line, "Cash" (review L7); any SOL or ETH it holds is its own line by name, never hidden
      // in Cash (they are in the reserve's dollars, so Cash is what's left); then each NEAR coin. With nothing but cash the
      // row's own dollars are the cash, so no sub-row says them twice (e2e walk 3 Nov: "Cash $0.11")
      // each coin's dollars at the list's price, never more than the reserve has left (two prices a cent apart never show a
      // line over the NEAR wallet's own figure)
      let left = Number(reserve);
      inNear = inNear.map((x) => {
        if (x.usd === null) return x;
        const usd = Math.min(Number(x.usd), Math.max(0, left));
        left -= usd;
        return { ...x, usd: usd.toFixed(2) };
      });
      const cash = Math.max(0, left).toFixed(2);
      const subs = coinsOn("near").length || inNear.length ? [...(Number(cash) >= 0.01 ? [{ key: "near:cash", symbol: "Cash", amount: "", usd: cash }] : []), ...inNear, ...coinsOn("near")] : [];
      rows.push({ chain: "near", name: ROW_NAME.near, amount: null, usd: sumUsd([reserve, ...coinsOn("near").map((x) => x.usd)]), coins: subs });
      continue;
    }
    const n = s.networks.find((x) => x.network === c);
    const bare = s.unpriced?.find((x) => x.network === c && Number(x.nativeAmount) > 0);
    if (!n && bare) { rows.push({ chain: c, name: ROW_NAME[c], amount: `${coins(bare.nativeAmount, 4)} ${NATIVE[c]}`, usd: null, coins: coinsOn(c), unpriced: true }); continue; }
    if (!n) { if (c !== "bsc") rows.push({ chain: c, name: ROW_NAME[c], amount: null, usd: null, coins: coinsOn(c) }); continue; }
    // BNB (or any chain the core closes) only while it holds money: its money is never left off Home (review L6)
    if ((c === "bsc" || n.closed) && !(Number(n.cashUsd) + Number(n.coinsUsd) >= 0.01)) continue;
    rows.push({ chain: c, name: ROW_NAME[c], amount: n.nativeAmount !== undefined ? `${coins(n.nativeAmount, 4)} ${NATIVE[c]}` : null, usd: n.cashUsd, coins: coinsOn(c) });
  }
  return rows;
}

/** A wallet's dollars: its own coin and every coin in it (NEAR's figure already holds its coins). null: not read. */
export const walletUsd = (r: HomeRow): string | null => (r.usd === null ? null : r.chain === "near" ? r.usd : sumUsd([r.usd, ...r.coins.map((c) => c.usd)]));

/** The number, its digits rolling (wallet.css .wl-roll): each digit is a column of 0–9 moved by transform alone. The
 *  text itself is there once, for reading; the columns are drawn by CSS (no text of their own). */
function Roll({ text }: { text: string }) {
  const chars = [...text];
  return (
    <>
      <span className="wl-sr">{text}</span>
      <span className="wl-roll" aria-hidden="true">
        {chars.map((c, i) => <span key={chars.length - i} className={/\d/.test(c) ? "wl-roll__d" : "wl-roll__s"} data-c={c} style={{ "--d": /\d/.test(c) ? Number(c) : 0 } as CSSProperties} />)}
      </span>
    </>
  );
}

/** The four round actions: a glyph and a word each, 56 pt, one row, pre-set to the tab shown (All: none). */
function Actions({ a, wallet, buzz, name }: { a: HomeActions; wallet?: Wallet; buzz: () => void; name?: string }) {
  const web = a.web ?? webWallet();
  const every = [
    // finding 43: Add only where Add takes that wallet's coin (ADD_OPEN: not NEAR yet); its Move is in the tab. The
    // web wallet's Add is each wallet's own address, so it opens on every wallet there
    ...(web || !wallet || wallet === "safe" || ADD_OPEN[wallet] ? [{ word: "Add", icon: <ActAdd />, on: () => a.onAdd(wallet) }] : []),
    { word: "Send", icon: <ActSend />, on: () => a.onSend(wallet) },
    { word: "Swap", icon: <ActSwap />, on: () => a.onSwap(wallet) },
    { word: "Move", icon: <ActMove />, on: () => a.onMove("safe", wallet) },
  ];
  // the web wallet has no Safe: no Move and no Swap, Add and Send only (home-view.ts webActs)
  const acts = web ? every.filter((x) => (webActs() as string[]).includes(x.word)) : every;
  return (
    <div className="wl-acts" role="group" aria-label={name ? `What you can do with ${name}` : "What you can do"}>
      {acts.map((x) => (
        <button key={x.word} className="wl-act" onClick={() => { buzz(); x.on(); }} aria-label={name ? `${x.word}, ${name}` : x.word}>
          <span className="wl-act__dot">{x.icon}</span>
          <span className="wl-act__word">{x.word}</span>
        </button>
      ))}
    </div>
  );
}

/** One coin row: its logo (a held coin carries its chain's small badge), name, amount and dollars. */
function CoinRow({ i, icon, src, symbol, chain, title, detail, usd, on, expanded, kind }: { i: number; icon?: string; src?: string; symbol: string; chain?: RowChain; title: string; detail?: string; usd: string; on?: () => void; expanded?: boolean; kind?: string }) {
  const Tag = on ? "button" : "div";
  return (
    <Tag className={`wl-row wl-coin wl-rise${on ? " wl-pick" : ""}${kind ? ` ${kind}` : ""}`} style={{ "--i": i } as CSSProperties} {...(on ? { onClick: on } : {})} {...(expanded !== undefined ? { "aria-expanded": expanded } : {})}>
      <span className="wl-badged">
        <CoinIcon symbol={symbol} icon={icon} {...(src ? { src } : {})} size={40} />
        {chain && <span className="wl-badge"><CoinIcon symbol={NATIVE[chain]} icon={chain} size={16} /></span>}
      </span>
      <div><div className="t">{title}</div>{detail && <div className="d">{detail}</div>}</div>
      <div className="r"><div className="v">{usd}</div></div>
      {/* a site's row (the copy review's S14 ruling): a quiet chevron, turned by wallet.css while it is open */}
      {expanded !== undefined && <span className="wl-site__chev" aria-hidden="true">›</span>}
    </Tag>
  );
}

/** A section's header (HOME-VISUAL §3.3): its name in sentence case (the Safe with its shield, a wallet with its chain's
 *  logo), its total on the right, then what it holds an action for (a Trade wallet's Add). Not a button. */
function Head({ name, usd, shield, logo, children }: { name: string; usd: string; shield?: boolean; logo?: ReactNode; children?: ReactNode }) {
  return (
    <div className="wl-sec wl-sec--still">
      {shield && <span className="wl-sec__shield" aria-hidden="true"><TabSafe /></span>}
      {logo}
      <span className="wl-sec__name">{name}</span>
      <span className="wl-sec__usd">{usd}</span>
      {children}
    </div>
  );
}

/** Rows not read yet: their shape, shimmering (never $0). */
const Skeleton = ({ n = 3 }: { n?: number }) => <>{Array.from({ length: n }, (_, i) => <div key={i} className="wl-row wl-row-skel wl-shimmer" aria-hidden="true"><span /><i /><b /></div>)}</>;

export function Home(a: HomeActions) {
  const web = a.web ?? webWallet();
  // the web line's × (bug report, 4 Nov): closed once, closed for good in this browser (web-wallet-words.ts)
  const [lineHidden, setLineHidden] = useState(() => webLineHidden());
  // D134: every figure from `shown`, the copy kept on this phone until each part is read again (display only)
  const { bridge, balanceProblem, activity, shown: view, refresh, kid: childPhone } = useWallet();
  const { tokens, balances, balancesAt, chains, earning, pocket, spending, spendingStale, spendingAt, held, nearCoins, heldFailed, wallets, trading, tradingPartial, settled, complete, lastTotal } = view;
  // Safe | Hot (product decision, 5 Nov): the Safe first. The web wallet has no Safe: Hot alone (its tab is never drawn)
  const [picked, setTab] = useState<HomeTab>("safe");
  const tab: HomeTab = web ? "hot" : picked;
  const [allSafe, setAllSafe] = useState(false);
  // a site wallet's coins (Hot), each at its own price: the core's subwallet.coins (kept 15 s there), read while Hot shows
  const [siteCoins, setSiteCoins] = useState<ReadonlyMap<string, readonly SiteCoin[]>>(new Map());
  const siteIds = (wallets ?? []).filter((w) => w.role === "site" && !w.unread).map((w) => w.id).join(",");
  // each site wallet's figure as Spending last read it: a Take out or Add that landed changes it, and its coins are read
  // again at once, fresh (test, MUST 9: "SOL $35.00" stayed ~8 s after Take out), never on the next 15 s look
  const siteFigures = (wallets ?? []).filter((w) => w.role === "site" && !w.unread).map((w) => `${w.id}:${w.cashUsd}:${w.coinsUsd}`).join(",");
  useEffect(() => {
    if (tab !== "hot" || !siteIds) return;
    let live = true;
    void Promise.all(siteIds.split(",").map((id) => bridge.call<SiteCoin[]>("subwallet.coins", { id, fresh: true }).then((r) => ("ok" in r && Array.isArray(r.ok) ? ([id, r.ok] as const) : null), () => null)))
      .then((got) => live && setSiteCoins(new Map(got.filter((x): x is readonly [string, SiteCoin[]] => x !== null))));
    return () => { live = false; };
  }, [bridge, tab, siteIds, siteFigures]);
  const sites = siteSections(wallets, (id) => siteCoins.get(id), sumUsd);
  // one row per site (S14): GMGN once, its SOL and Base wallets inside it once opened; closed on each visit
  const groups = siteGroups(sites, sumUsd);
  const social = groups.filter((g) => !g.agent);
  const [openSites, setOpenSites] = useState<ReadonlySet<string>>(new Set());
  // every held coin's own picture (product decision, 3 Nov): by chain and address, through the relay, kept on the phone; a
  // site wallet's coins too
  const pictured = [...(held ?? []), ...sites.flatMap((x) => x.coins.filter((c) => c.token !== "native").map((c) => ({ chain: x.network, address: c.token })))];
  const logo = useCoinLogos(bridge, held === null && !pictured.length ? null : pictured);
  // the phone going offline or back re-reads its line at once ("You're offline"), never at the next read
  const [, onlineChanged] = useState(0);
  useEffect(() => { const f = () => onlineChanged((n) => n + 1); const w = globalThis as unknown as Partial<Window>; w.addEventListener?.("online", f); w.addEventListener?.("offline", f); return () => { w.removeEventListener?.("online", f); w.removeEventListener?.("offline", f); }; }, []);
  const buzz = () => { try { void bridge.call("device.haptic", { kind: "tap" }).catch(() => undefined); } catch { /* nothing to feel */ } };
  // amounts hidden: a tap on the number, remembered on this phone (Wallet's own device.store)
  const [hide, setHide] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge.call<{ value: string | null }>("device.store.get", { key: HIDE_KEY }).then((r) => live && "ok" in r && setHide(r.ok?.value === "1"), () => undefined);
    return () => { live = false; };
  }, [bridge]);
  const flip = () => { const next = !hide; setHide(next); buzz(); void bridge.call("device.store.set", { key: HIDE_KEY, value: next ? "1" : null }).catch(() => undefined); };
  const $ = (usd: string | null | undefined, unread = "updating…") => (hide ? HIDDEN_AMOUNT : usd === null || usd === undefined ? unread : dollars(usd));
  // an Add from another chain on its way: one line, never a page (V4 step 6)
  const [adds, setAdds] = useState<AddOnWay[]>([]);
  // Home's Add needs only the relay (the test mainnet test, 3 Nov): an older gate on Hidden's own pocket kept
  // every Add's line, card and Activity task off for an account without one, so money that arrived showed nowhere
  const addsReady = !!pocket?.available;
  const [lineOf, setLineOf] = useState<typeof AddOnWayLine | null>(null);
  const [onWayOf, setOnWayOf] = useState<((l: readonly AddOnWay[]) => number) | null>(null);
  useEffect(() => {
    if (!addsReady) return void setAdds([]);
    let stop: (() => void) | undefined, live = true;
    // while Wallet is open: its one-time SOL addresses watched for money too (push), then the fast reads
    void import("../money/adds-on-way.ts").then((m) => { if (!live) return; setLineOf(() => m.lineFor); setOnWayOf(() => m.arrivingUsd); stop = m.watchAddsOnWay(bridge, setAdds, { push: true }); }, () => undefined);
    return () => { live = false; stop?.(); };
  }, [bridge, addsReady]);
  // an Add moved a step (in the NEAR wallet, sent on, landed): the figures it touches are read again at once, never at the
  // next poll, so the money is counted where it is now and only there (D140)
  const addSteps = adds.map((x) => `${x.key}:${x.stage ?? ""}:${x.onWayUsd ?? ""}`).join(",");
  const lastSteps = useRef<string | null>(null);
  useEffect(() => {
    const was = lastSteps.current;
    lastSteps.current = addSteps;
    if (was !== null && was !== addSteps) refresh();
  }, [addSteps]);
  // D137: every Add, Send, Swap and Move in flight is a live card at the top of each wallet it touches, its tracker the
  // whole screen (LiveTrack.tsx, all of it loaded after the first paint). `covered`: the rows a card stands for.
  const [Live, setLive] = useState<typeof LiveModule.LiveHome | null>(null);
  const [covered, setCovered] = useState<ReadonlySet<string>>(new Set());
  const feed = useRef({ adds, movements: activity ?? [] });
  feed.current = { adds, movements: activity ?? [] };
  useEffect(() => { let on = true; void import("../money/LiveTrack.tsx").then((m) => on && setLive(() => m.LiveHome), () => undefined); return () => { on = false; }; }, []);
  // H-1: the pulse, what prices did to the coins today (pulse.ts), once every part of the money is read; loaded after
  // Home's first paint, so Home's own first load stays small
  const [pulseText, setPulseText] = useState<string | null>(null);
  const [pnl, setPnl] = useState<typeof PnlMod.pnl | null>(null);
  const pulseReady = Boolean(balances && settled && complete && !tradingPartial && held !== null);
  useEffect(() => {
    if (!pulseReady) return void setPulseText(null);
    let live = true;
    setPulseText(null);
    void import("./pnl.tsx").then((m) => live && setPnl(() => m.pnl), () => undefined);
    void import("../pulse.ts").then((m) => m.readPulse(bridge, m.holdings({ balances: balances!, pocket, spending, held }), new Date(), web ? undefined : tabPulse(tab)), () => null).then((t) => live && setPulseText(t ?? null), () => undefined);
    return () => { live = false; };
  }, [pulseReady, bridge, balances, pocket, spending, held, tab]);
  // the web wallet's own parts (home-web.ts: its number and its read lines), loaded on the web only, after the first paint
  const [webPart, setWebPart] = useState<typeof WebPart | null>(null);
  useEffect(() => { if (web) void import("./home-web.ts").then((m) => setWebPart(m), () => undefined); }, [web]);
  // the read lines (read-lines.ts), loaded after the first paint: they only matter once a read failed
  const [lines, setLines] = useState<typeof ReadLinesMod | null>(null);
  useEffect(() => { void import("./read-lines.ts").then((m) => setLines(m), () => undefined); }, []);
  const [grace, setGrace] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setGrace(false), TOTAL_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  // the wallets: Hot's Trade section, one per chain
  const kid = childPhone === true;
  const rows = spending?.loaded && !spending.unread ? homeRows(spending, held ?? [], nearChainCoins(nearCoins, (id) => Number(tokens.get(id)?.priceUsd) || null)) : null;
  // a wallet's figure: its own coin and the coins in it (a site's wallet is its own section, after Trade's)
  const figure = (r: HomeRow) => {
    const usd = walletUsd(r);
    return { usd, empty: usd !== null && !(Number(usd) >= 0.01) && r.coins.every((c) => !(Number(c.amount) > 0)) };
  };
  /** The web wallet's number: its wallets' figures only (no Safe); a wallet read without its price says its amount
   *  (home-view.ts webHero), never "$0.00". */
  const webBig = web && rows && webPart ? webPart.webHero([...rows.map((r) => ({ usd: figure(r).usd, amount: r.amount, unpriced: r.unpriced })), ...sites.map((x) => ({ usd: x.usd, amount: null }))], lastTotal, sumUsd) : null;
  // the web wallet has no Safe: Home is read once the wallets are (their rows), and counts only them
  const read = web ? Boolean(spending?.loaded && !spending.unread) : Boolean(balances && settled);
  // D128: Hidden is no place on Home. Its coins count with the Safe's until the engine slice folds the pocket in.
  const safe = read && balances ? safeLines(balances, pocket, chains, earning) : null;
  // D140: an Add's money in neither the NEAR wallet's count nor the wallet yet (the core's onWayUsd) counts from "Received"
  // B5 (sandbox hunt): a Safe swap in flight left the Safe and hasn't come back yet: counted at its price until it ends
  const swapping = (activity ?? []).filter((m) => m.kind === "swap" && m.status === "moving" && m.source === "safe");
  const addsUsd = (onWayOf ? onWayOf(adds) : 0) + swapping.reduce((t, m) => t + (Number(usdOf(m.amount, tokens.get(m.from ?? "")?.priceUsd)) || 0), 0);
  const counted = web ? (webBig ? webBig.usd : read && rows?.some((r) => r.unpriced) ? null : lastTotal) : read ? balanceTotal(balances!, chains, earning, pocket, trading) : lastTotal;
  const total = counted && addsUsd > 0 ? plusUsd(counted, addsUsd.toFixed(2)) : counted;
  const shown = read && (web || complete || !grace);
  // a wallet whose coin is read but not its price (QA, 4 Nov): its amount is the number, or the line under it
  const bareHero = read ? webBig?.amount ?? null : null;
  const bareLine = read ? webBig?.line ?? null : null;
  // D134: a known figure is never blanked: while the parts are read, the kept total stays (and rolls to the new one); on
  // the web a total not read is the kept one or the skeleton, never "$0.00"
  // the phone's number is the tab's own (look, 5 Nov): the Safe's money on Safe (an Add on its way into it counted),
  // Hot's on Hot; Hot money never shows on the Safe. The web wallet (no Safe): everything, as before
  const safeUsd = read && balances ? balanceTotal(balances, chains, earning, pocket) : null;
  // the Safe's figure waits for its parts (Earn's NEAR, Hidden's) as the total did, never a short one (TOTAL_GRACE_MS)
  // Hot's number is the sum of what Hot shows (QA's MUST, Sim test: $286.62 over rows of $294.06): its
  // wallets, the money on its way (trading.ts awayUsd: one row per move of the person own, the engine own legs counted with
  // no row until they run late, hot-moving.ts) and each site section; the
  // core's figure until then
  const awayUsd = spending?.loaded && !spending.unread ? awayOf(spending) : 0;
  // (a row or a site not read makes the core's figure partial: tradingUsd)
  const hotUsd = rows && !tradingPartial ? sumUsd([...rows.map((r) => figure(r).usd), awayUsd.toFixed(2), ...sites.map((x) => x.usd)]) : trading;
  const tabUsd = tab === "safe" ? (!shown ? null : safeUsd && addsUsd > 0 ? plusUsd(safeUsd, addsUsd.toFixed(2)) : safeUsd) : hotUsd;
  // the moving rows and their time left (TimeLeft) load with the first money on its way, never in Home's first load
  const [Moving, setMoving] = useState<{ rows: typeof MovingMod; Left: typeof JobMadeMod.TimeLeft } | null>(null);
  const anyMoving = awayUsd > 0;
  useEffect(() => {
    if (!anyMoving || Moving) return;
    let live = true;
    void Promise.all([import("../hot-moving.ts"), import("../money/JobMade.tsx")]).then(([rows, j]) => live && setMoving({ rows, Left: j.TimeLeft }), () => undefined);
    return () => { live = false; };
  }, [anyMoving, Moving]);
  const moving = Moving && spending && anyMoving ? Moving.rows.movingRows(spending) : [];
  const Left = Moving?.Left, movingWords = Moving?.rows.MOVING_WORDS;
  const hero = web ? bareHero ?? (shown ? (total === null ? null : dollars(total)) : lastTotal ? dollars(lastTotal) : null) : tabUsd === null ? null : dollars(tabUsd);
  // the 7-day line under the number (concept v3.1; home-days.ts): the phone's own last days of the number shown (the
  // tab's own figure since Safe | Hot, each tab its own kept days), read once it is shown and kept on the phone; nothing
  // under two days. Loaded after Home's first paint, as the pulse is
  const [days, setDays] = useState<number[]>([]);
  const [Spark, setSpark] = useState<typeof SparkMod.Sparkline | null>(null);
  const daysFor = !web && shown && tabUsd !== null && tabUsd !== undefined ? tabUsd : null;
  useEffect(() => {
    setDays([]);
    if (daysFor === null) return;
    let live = true;
    void import("@zerofee/design/Sparkline.tsx").then((m) => live && setSpark(() => m.Sparkline), () => undefined);
    void import("../home-days.ts").then((m) => m.readDays(bridge, Number(daysFor), new Date(), m.daysKey(tab)), () => []).then((d) => live && setDays(d), () => undefined);
    return () => { live = false; };
  }, [daysFor, bridge, tab]);

  // what is on its way: Adds from other chains, the wallets' own moves, deposits into the Safe
  const onWay = (): ReactNode[] => [
    ...(lineOf ? adds : []).filter((x) => !covered.has(`add:${x.key}`)).map((x) => {
      const w = lineOf!(x, tokens.get(x.tokenId)?.symbol);
      return <div className="wl-row wl-rise" key={`add-${x.key}`} role="status"><span className="zf-tick off" aria-hidden="true" /><div><div className="t">{w.title}</div>{w.detail && <div className="d">{w.detail}</div>}</div><div className="r" /></div>;
    }),
    ...(spending?.onItsWay ?? []).filter((m) => m.held || !(covered.has(`move:${m.id}`) || (m.of && covered.has(`move:${m.of}`)))).map((m) => {
      const inside = (
        <>
          <span className="zf-tick off" aria-hidden="true" />
          <div><div className="t">{m.held ? "Waiting" : "On its way"}</div><div className="d">{swapLabel(m.id) ?? m.words}{m.held ? ` · until ${until(m.held.readyAtIso)}` : ""}</div></div>
          <div className="r"><div className="v">{$(m.askedUsd ?? m.usd)}</div></div>
        </>
      );
      return m.held ? <button className="wl-row wl-pick wl-rise" key={m.id} onClick={() => a.onHeld(m.held!)}>{inside}</button> : <div className="wl-row wl-rise" key={m.id}>{inside}</div>;
    }),
    ...swapping.map((m) => {
      const token = tokens.get(m.from ?? "");
      const usd = token ? usdOf(m.amount, token.priceUsd) : undefined;
      return (
        <div className="wl-row wl-rise" key={m.id} role="status">
          <span className="zf-tick off" aria-hidden="true" />
          <div><div className="t">{HOME_WORDS.swapping}</div><div className="d">{hide ? HIDDEN_AMOUNT : amountOf(m.amount, token?.symbol ?? "", token?.decimals, 0)} {token?.symbol ?? ""} · {HOME_WORDS.swappingWhere}</div></div>
          <div className="r">{usd && <div className="v">{$(usd)}</div>}</div>
        </div>
      );
    }),
    ...(activity ?? []).filter((m) => m.kind === "deposit" && m.status === "moving").map((m) => {
      const token = tokens.get(m.to ?? "");
      const usd = token ? usdOf(m.amount, token.priceUsd) : undefined;
      return (
        <div className="wl-row wl-rise" key={m.id}>
          <span className="zf-tick off" aria-hidden="true" />
          <div><div className="t">On its way</div><div className="d">{hide ? HIDDEN_AMOUNT : amountOf(m.amount, token?.symbol ?? "", token?.decimals, 0)} {token?.symbol ?? ""} from {chainName(chains, m.from ?? "")} · {usually(m.from ?? "").toLowerCase()}</div></div>
          <div className="r">{usd && <div className="v">{$(usd)}</div>}</div>
        </div>
      );
    }),
  ];

  // the Safe's coins, holdings first by dollars (format.ts lines), each opening its trade page
  const safeCoins = () =>
    !safe ? <Skeleton n={2} />
      : safe.lines.length === 0 ? <p className="zf-small wl-list-empty">{HOME_WORDS.emptySafe}</p>
        : <>
          {(allSafe ? safe.lines : safe.lines.slice(0, SAFE_FIRST)).map((l, i) => <CoinRow key={l.key} i={i} symbol={l.symbol} icon={l.listed ? l.icon : undefined}
            title={titleOf(l)} detail={hide ? HIDDEN_AMOUNT : l.listed ? `${amountOf(l.amount, l.symbol)} ${l.symbol}` : coins(l.amount)} usd={l.usd !== undefined ? $(l.usd) : ""} on={() => a.onCoin(l)} />)}
          {!allSafe && safe.lines.length > SAFE_FIRST && <button type="button" className="wl-row wl-pick wl-more" onClick={() => { buzz(); setAllSafe(true); }}>Show all</button>}
          {safe.uncounted && complete && <p className="zf-small wl-list-empty">{HOME_WORDS.unpriced}</p>}
        </>;

  /** A Trade wallet's Add (product decision, 5 Nov): its chain's logo and "Add", beside its name; it opens Move, set to it. */
  // the web wallet has no Safe and no Move: its Add is the wallet's own address (Add money), as before
  const addTo = (c: RowChain) => (c === "bsc" ? null : (
    <button type="button" className="wl-hw-add" data-testid={`add-${c}`} aria-label={`Add ${NATIVE[c]}`} onClick={() => { buzz(); if (web) a.onAdd(c); else a.onMove("safe", c); }}>
      <span className="wl-hw-add__disc" aria-hidden="true">+<span className="wl-hw-add__badge"><CoinIcon symbol={NATIVE[c]} icon={c === "hood" ? "eth" : c} size={12} /></span></span>
    </button>
  ));

  /** A Trade wallet (HOME-SAFE-HOT-LOOK §4): one row (its coin names under its name, its figure, Add beside it) that
   *  opens the wallet's market; each coin bought in it is a row of its own under it that opens that coin's page. */
  const wallet = (r: HomeRow): ReactNode => {
    const { usd, empty } = figure(r);
    // its coin read, its price not: the amount where its dollars go
    const said = usd === null && r.unpriced ? r.amount : null;
    // NEAR's line says its own NEAR (one line, never a sentence), else its cash
    const nearCoin = r.chain === "near" ? r.coins.find((c) => c.symbol === "NEAR") : undefined;
    const names = r.chain === "near" ? (nearCoin ? `${coins(nearCoin.amount, 4)} NEAR` : HOME_WORDS.nearLine) : r.amount ?? "";
    // every coin in it but its cash: bought ones (an address: their page), and SOL or ETH the NEAR wallet holds (D140)
    const bought = r.coins.filter((c) => c.symbol !== "Cash");
    const icon = r.chain === "hood" ? "eth" : r.chain;
    // one unit per line (re-check, 5 Nov: "SOL wallet / 1.1859 SOL / $136.87" was the whole wallet's dollars beside SOL
    // alone): the wallet's line is its own coin, in units and in dollars, as Trade's tab says it; each coin in it is its own
    // line under it. Hot's figure stays the whole wallet (figure()). NEAR's line already says its whole wallet.
    const lineUsd = r.chain === "near" ? usd : r.usd;
    return (
      <div key={r.chain} className="wl-hw" data-chain={r.chain}>
        <CoinRow i={0} symbol={NATIVE[r.chain]} icon={icon} chain={r.chain} title={HOT_NAME[r.chain]} detail={empty ? HOME_WORDS.emptyRow : hide && r.chain !== "near" ? HIDDEN_AMOUNT : names} usd={said && !hide ? said : $(lineUsd)} on={() => a.onRow?.(r.chain)} />
        {addTo(r.chain)}
        {bought.map((c, i) => <CoinRow key={c.key} i={i + 1} symbol={c.symbol} {...(c.icon ? { icon: c.icon } : c.address && logo(r.chain, c.address) ? { src: logo(r.chain, c.address)! } : {})}
          chain={r.chain} title={c.symbol} detail={`${hide ? HIDDEN_AMOUNT : coins(c.amount, 4)} ${c.symbol}`} usd={$(c.usd)} {...(c.address ? { on: () => a.onRowCoin?.(r.chain, c.address!, c.symbol) } : {})} />)}
      </div>
    );
  };

  /** A site's own wallet inside its site's row (S14): one row, its network and its figure, that opens THAT
   *  site's wallet page (the copy review's ruling, 5 Nov: never the Trade tab's market, empty or not, with a market for its chain or
   *  none); then each coin it holds at its own price, as a Trade wallet's are. A coin of a chain Trade lists opens its page
   *  there (a priced one: safe-hot.ts tap): markets open only from the Trade tab and a coin's own row. */
  const siteWallet = (x: SiteGroup["wallets"][number], at: number): ReactNode => {
    const c = x.network as RowChain;
    const listed = x.opens;
    const symbol = NATIVE[c] ?? x.network.toUpperCase();
    const native = x.coins.find((k) => k.token === "native");
    const held = x.holds && !/^0(\.0+)?(\s|$)/.test(x.holds) ? x.holds : null;
    const empty = x.usd !== null && !(Number(x.usd) >= 0.01) && !held && !x.coins.length;
    // its coin read, its price not (a wallet outside the cap: "0.0012 ETH"): the amount where its dollars go, never $0.00
    const amountOnly = held !== null && !native && !(Number(x.usd ?? 0) >= 0.01);
    // the site's wallet page (figure, coins, Add / Take out, "Open pump.fun"; bug report, 5 Nov)
    const siteOpen = siteTap(x, a.onSite).onClick;
    const detail = empty ? HOME_WORDS.emptyRow : hide ? HIDDEN_AMOUNT : native ? `${coins(native.amount, 4)} ${native.symbol}` : amountOnly ? undefined : held ?? undefined;
    // its line's dollars are its own coin's (safe-hot.ts siteLineUsd), never the whole wallet's beside SOL's units
    const lineUsd = siteLineUsd(x);
    return (
      <div key={x.key} data-chain={x.network} data-wallet={x.key}>
        <CoinRow i={at} symbol={symbol} {...(x.mark ? { icon: x.mark } : {})} title={`${NET_WORD[x.network] ?? x.network.toUpperCase()} wallet`} kind="wl-site__wallet" {...(detail ? { detail } : {})} usd={amountOnly && !hide ? held! : lineUsd === null && native ? "" : $(lineUsd)} {...(siteOpen ? { on: siteOpen } : {})} />
        {x.coins.filter((k) => k.token !== "native").map((k, i) => {
          const src = listed ? logo(c, k.token) : undefined;
          return <CoinRow key={k.key} i={at + i + 1} symbol={k.symbol} {...(src ? { src } : {})} {...(listed ? { chain: c } : {})}
            title={k.symbol} detail={`${hide ? HIDDEN_AMOUNT : coins(k.amount, 4)} ${k.symbol}`} usd={k.usd === null ? "" : $(k.usd)} {...(k.tap ? { on: () => a.onRowCoin?.(c, k.token, k.symbol) } : {})} />;
        })}
        {x.noPage && <p className="zf-small wl-list-empty">{x.noPage}</p>}
      </div>
    );
  };

  /** A site on Hot (S14): ONE row, its logo, its name and its figure (the sum of its wallets); a tap opens it
   *  to its wallets, one row each, and closes it again. */
  const siteRow = (g: SiteGroup, inGroup = false): ReactNode => {
    const open = openSites.has(g.key);
    const src = g.site ? SITE_LOGO[g.site] : undefined;
    const toggle = () => { buzz(); setOpenSites((o) => { const n = new Set(o); if (!n.delete(g.key)) n.add(g.key); return n; }); };
    // inside Social trading's card (S17), a site is a part of it, not a card of its own
    const Tag = inGroup ? "div" : "section";
    return (
      <Tag key={g.key} {...(inGroup ? { role: "group" } : { className: "zf-group wl-hot" })} data-site={g.key} aria-label={g.name}>
        <CoinRow i={0} symbol={g.name} {...(src ? { src } : g.agent ? {} : g.wallets[0]?.mark ? { icon: g.wallets[0].mark } : {})} title={g.name}
          kind="wl-site"
          detail={g.agent ? `${HOME_WORDS.agent} · ${g.usd !== null && !(Number(g.usd) >= 0.01) ? HOME_WORDS.agentEmpty : $(g.usd)}` : `${walletCount(g.wallets.length)} · ${$(g.usd)}`} usd={$(g.usd)} on={toggle} expanded={open} />
        {open && g.wallets.map((w, i) => siteWallet(w, i + 1))}
      </Tag>
    );
  };

  // the collapsed hero (HOME-SAFE-HOT-LOOK §2): once the big number has scrolled away, one line under the header says the part in view
  const heroEl = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = heroEl.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAway(!!e && !e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [web, kid]);

  // Private's door (the gates re-crawl, 5 Nov): one row under the Safe's coins; not set up, one tap sets it up and opens it
  const door = web || kid || !a.onPrivate ? null : privateDoor(pocket, true);
  // instant (rule 2): the tap opens Private at once; a set-up not done yet (WalletApp runs it behind) finishes there
  const privateRow = (): ReactNode => door && (
    <button type="button" className="wl-row wl-pick wl-row--text" data-testid="safe-private" onClick={() => { buzz(); a.onPrivate!(); }}>
      <div><div className="t">{PRIVATE_DOOR_WORDS.name}</div><div className="d">{PRIVATE_DOOR_WORDS[door.kind]}</div></div>
    </button>
  );


  const tabs: readonly HomeTab[] = kid || web ? [] : HOME_TABS;
  const pick = (t: HomeTab) => { if (t !== tab) { buzz(); setTab(t); } };
  const at = Math.max(0, tabs.indexOf(tab));

  // the honest line: who failed and since when (home-view.ts), never a $0
  const missing = rows && !(Array.isArray(spendingStale) && spendingStale.length) ? (["sol", "hood"] as const).filter((c) => !spending!.networks.some((n) => n.network === c) && !rows.some((r) => r.chain === c && r.unpriced)) : [];
  // D134: a kept figure under 2 minutes old is as good as fresh, so its failed read says nothing (an older one: "as of")
  const old = (at: number | null) => !at || Date.now() - at > AS_OF_AFTER_MS;
  const reads = !lines ? [] : lines.readLines({
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
    ...(!web && a.readFailed && (!balances || old(balancesAt)) ? { safe: { by: SERVICE_NAMES[serviceOf(balanceProblem) ?? "near"], at: balancesAt, shown: !!balances } } : {}),
    ...(spending?.unread ? { oneClick: { at: null } } : spendingStale === "all" && old(spendingAt) ? { oneClick: { at: spendingAt } } : {}),
    ...(Array.isArray(spendingStale) && spendingStale.length ? (old(spendingAt) ? { chains: { ids: spendingStale, at: spendingAt } } : {}) : missing.length ? { chains: { ids: [...missing], at: null } } : {}),
    trade: heldFailed && held === null,
    ...(webPart ? { web: webPart.WEB_READ_WORDS } : {}),
  });

  const readLine = reads.length > 0 && (!web || webPart) && <ReadLine text={reads.join(" ")} {...(webPart ? { retry: webPart.WEB_READ_WORDS.retry } : {})} {...(a.readFailed ?? (a.onRetrySpending ? { onRetry: a.onRetrySpending } : {}))} />;
  let body: ReactNode;
  if (tab === "safe") {
    // the Safe and its coins, nothing else's (product decision, 5 Nov); its Buy reaches every coin NEAR Intents swaps
    body = (
      <>
        {a.thread}
        {onWay()}
        <section className="wl-safe" aria-label="Safe">
          <Head name={HOME_WORDS.safeWhat} shield usd={safe ? `${safe.lines.length} ${safe.lines.length === 1 ? "coin" : "coins"}` : ""}>
            {a.onBuy && <button type="button" className="wl-buy" data-testid="safe-buy" onClick={() => { buzz(); a.onBuy!(); }}><span>{HOME_WORDS.buy}</span></button>}
          </Head>
          {safeCoins()}
        </section>
        {privateRow()}
        {a.health?.(() => undefined)}
      </>
    );
  } else {
    // Hot: Trade's wallets, one per chain, then each site's own wallet (pump.fun, GMGN, the agent's); never the Safe
    body = (
      <>
        {web && onWay()}
        <section className="zf-group wl-hot" aria-label={HOME_WORDS.trade}>
          <div className="wl-gsub"><b>{HOME_WORDS.trade}</b></div>
          {/* money on its way inside Hot (copy review, 5 Nov): one row per move at the top, folded into its wallet's row once it lands */}
          {moving.map((m) => (
            // a16 (Sim hot-run7): shaped as the wallet rows under it: the dot and the destination as the title ("Your SOL
            // wallet", never cut), "On its way · " and TimeLeft's text as the sub-line, the figure its own right column
            <div key={m.id} className="wl-hw wl-hw--moving" data-testid="hot-moving">
              <p className="wl-hw__moving">{movingWords?.title(m.engine ? "your wallets" : m.to)}</p>
              <b className="wl-hw__usd">{$(m.usd)}</b>
              {/* the time left only when the engine gave one (phone test, 5 Nov: a row with none read "This job has no time
                  estimate." in the figure column; the receipt says that sentence, a row says "On its way" alone) */}
              {Left && (m.etaSec || m.endsAt) ? <Left etaSec={m.etaSec} endsAt={m.endsAt} follow={false} line={movingWords?.sub} /> : <p className="zf-receipt__line">{movingWords?.sub()}</p>}
            </div>
          ))}
          {spending === null || !spending.loaded ? <Skeleton /> : (rows ?? []).map((r) => wallet(r))}
        </section>
        {/* the social trading sites under ONE heading (S17: pump.fun, GMGN, more later); AgentZero's row stays its own */}
        {social.length > 0 && (
          <section className="zf-group wl-hot" data-testid="hot-social" aria-label={HOME_WORDS.social}>
            <div className="wl-gsub"><b>{HOME_WORDS.social}</b></div>
            {social.map((g) => siteRow(g, true))}
          </section>
        )}
        {groups.filter((g) => g.agent).map((g) => siteRow(g))}
      </>
    );
  }

  // The big number is ALWAYS everything, on both tabs (product decision, 3 Nov). Under it ONE line: while reading, what it's doing;
  // then the day's change of the tab shown. The four buttons below are pre-set to the Safe on its tab.
  const statusWords = !read ? (lastTotal ? "Updating…" : web ? HOME_WORDS.readingWeb : HOME_WORDS.reading) : !web && !complete ? (grace ? HOME_WORDS.reading : "Updating…") : null;
  const change = !hide && pulseText ? /^(Up|Down) (\$[\d,]+\.\d\d) today$/.exec(pulseText) : null;
  const slotStatus = !!statusWords;
  const slot: ReactNode = statusWords ? statusWords
    : bareLine && !hide ? bareLine
      : change && pnl ? pnl(change[1] === "Up", change[2]!, web ? total : tabUsd) : null;
  return (
    <div className="wl wl-home zf-enter" data-hide={hide || undefined} data-day={!hide && change ? (change[1] === "Up" ? "up" : "down") : undefined} {...(web ? { "data-web": "" } : {})}>
      {/* the web wallet's one line (product decision, 4 Nov): what this version is, and where the Safe lives */}
      {web && !lineHidden && (
        <div className="wl-webline">
          <p className="zf-small" data-testid="web-line">{WEB_LINE}</p>
          <button type="button" className="wl-webline__x" aria-label={WEB_WORDS.close} onClick={() => (hideWebLine(), setLineHidden(true))}>×</button>
        </div>
      )}
      {!web && !kid && (
        <div className="wl-collapsed" data-on={away || undefined} aria-hidden="true">
          <p>{hero ? (hide ? HIDDEN_AMOUNT : hero) : ""}<span> · {HOME_TAB_NAME[tab]}{change ? ` · ${change[1]} ${change[2]} today` : ""}</span></p>
        </div>
      )}
      <div className="wl-hero" ref={heroEl}>
        {!web && !kid && <p className="wl-hero__label">{tab === "safe" ? "Your Safe" : HOME_WORDS.hotLabel}</p>}
        <button type="button" className="wl-display wl-hero__n" onClick={flip} disabled={!hero} aria-label={hero ? `${web ? "Your money" : tab === "safe" ? "Your Safe" : HOME_WORDS.hotLabel}: ${hide ? "hidden" : hero}. ${hide ? HOME_WORDS.show : HOME_WORDS.hide}` : "Reading your money"}>
          {!hero ? <span className="wl-total-skel" /> : hide ? HIDDEN_AMOUNT : bareHero ? hero : <Roll text={hero} />}
        </button>
        {/* ONE line under the number, its height kept from the first paint so the four buttons never move (HOME-VISUAL
            §3.4): a tab's own figure ("SOL wallet $144.37"); on All, while reading, what it's doing, then the day's change
            ("Up $122.25 today"), the amount in ink. Hidden amounts hide the change */}
        <p className="wl-slot" {...(slotStatus ? { role: "status" } : {})} aria-hidden={!slot || undefined}>{slot}</p>
        {/* the last days, as a line (28 tall, always kept on the phone so the four buttons never move; air under two days) */}
        {!web && <div className="wl-spark" aria-hidden="true">{Spark && !hide && days.length >= 2 && <Spark points={days} />}</div>}
      </div>
      <Actions a={a} buzz={buzz} {...(tab === "safe" && !kid ? { wallet: "safe" as const, name: "your Safe" } : {})} />
      {/* what the account holds for the person (a held payment or change): on Home while something is held, nothing
          when nothing is (review High: a hold in the cancel window is never behind a tap) */}
      {a.waiting}
      {tabs.length > 0 && (
        <div className="wl-bar" role="tablist" aria-label="Your money" style={{ "--n": tabs.length, "--at": at } as CSSProperties}>
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={t === tab} className="wl-bar__t" onClick={() => pick(t)}>
              <span className="wl-half"><b>{HOME_TAB_NAME[t]}</b><small>{t === "safe" ? (safe ? $(safe.totalUsd) : "") : $(hotUsd)}</small></span>
            </button>
          ))}
          <span className="wl-bar__line" aria-hidden="true" />
        </div>
      )}
      {Live && <Live bridge={bridge} feed={feed} only={web ? "all" : tab} overlay={a.overlay} onCovered={setCovered} buzz={buzz} />}
      {web && readLine}
      <div className="wl-rows wl-list" key={tab} role="tabpanel">
        {/* what the tab on is, one quiet line under the switch, in the list and never in its stuck band (first-time hunt,
            5 Nov: "Home never says what Safe or Hot is"); it takes the place of Hot's old note under the Trade card */}
        {tabs.length > 1 && <p className="zf-small wl-what">{HOME_TAB_IS[tab]}</p>}
        {body}
      </div>
      {/* H6: a read that failed is one line under the rows, with Retry at its end; the figures stay as last read. On the
          web it is over the rows, so it is never under the app bar (the review's 390 px shot, 4 Nov) */}
      {!web && readLine}
    </div>
  );
}

/** "Tue 14:00": when a held move can go, in the phone's own time. */
export function until(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "later" : `${weekdayName(d)} ${shortTime(d)}`;
}
