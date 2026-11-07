// "Add money to start": the words and the small decisions the screens make from the core's answer (account.fund.*).
// No amount, address or tick is decided here: each comes from the core, which read it from 1Click and the chain.
import type { FundState, FundStep, FundView } from "@zerofee/core/fund-start";


export interface FundCoinRow {
  id: string;
  symbol: string;
  name: string;
  network: string;
  /** One of the coins most people send (the core's FUND_LIKELY): listed first. */
  likely?: true;
}

/**
 * D155 (product decision, 3 Nov): "just add money from any chain that NEAR Intents supports, all native coins, select, choose
 * wallet, that money gets sent to their NEAR account through NEAR Confidential." The page's words (a five-year-old reads
 * them; to the Copywriter: $ZEROFEE_HOME/design-review/COPY-SETUP-ANY-COIN-2026-11-03.md).
 */
export const ADD_TITLE = "Add money to start";
export const ADD_LINE = "Pick the coin you'll send. It opens your account.";
export const SEARCH_LABEL = "Find a coin";
export const LIKELY_HEAD = "Most used";
export const ALL_HEAD = "All coins";
export const NO_MATCH = "No coin by that name.";
export const SHOW_ADDRESS = "Show address";
export const COPY_ADDRESS = "Copy address";
export const PICK_OTHER = "Pick another coin";
/** Honest (audit H1): the person's account isn't named, but an amount and a time can still be matched. */
export const PRIVATE_LINE = "Your account isn't named on the chain.";
export const NEAR_LINE = "NEAR goes straight to your new account.";

/** The logo key of a coin's row (packages/design logos.ts): its chain's, else its symbol's. */
const ROW_ICON: Record<string, string> = { near: "near", sol: "sol", eth: "eth", "hood-eth": "hood", "base-eth": "base", "arb-eth": "arb" };
export const coinIcon = (c: { id: string; symbol: string }): string => ROW_ICON[c.id] ?? c.id;

/** The coins whose symbol, name or network has what was typed (any case); everything when nothing was. */
export function coinsFound<C extends FundCoinRow>(coins: readonly C[], typed: string): C[] {
  const q = typed.trim().toLowerCase();
  return q ? coins.filter((c) => [c.symbol, c.name, c.network].some((x) => x.toLowerCase().includes(q))) : [...coins];
}

/** How far along set-up's money step is, for the 2 pt line at the top (0 to 1). */
export function setupProgress(at: "coins" | "deposit" | FundState): number {
  switch (at) {
    case "coins": return 0.55;
    case "deposit": case "waiting": case "expired": return 0.65;
    case "working": case "short": return 0.8;
    case "opening": return 0.9;
    default: return 1;
  }
}

/** The one live line (D155): waiting → here → opening → done; a stop says where the money is (fundLine). */
export function liveOf(v: FundView): { cls: "is-waiting" | "is-here" | "is-opening" | "is-done" | "is-stopped"; line: string } {
  const s = asShown(v);
  switch (s.state) {
    case "waiting": return { cls: "is-waiting", line: `Waiting for your ${s.coin.symbol}` };
    case "working": return { cls: "is-here", line: "It's here" };
    case "opening": return { cls: "is-opening", line: "Opening your account" };
    case "opened": case "done": return { cls: "is-done", line: "Done" };
    default: return { cls: "is-stopped", line: fundTitle(s.state, s.stage, s.coin) };
  }
}

/** One tile (before D155's one list): a coin (one network), or USDC / USDT, which then asked which network. Kept for the
 *  gallery's older screens; the page lists each coin as its own row. */
export interface FundTile {
  key: string;
  title: string;
  /** The small line under it: the coin on that network, or how many networks. */
  line: string;
  /** The logo key (packages/design logos.ts). */
  icon: string;
  coins: FundCoinRow[];
}

const ICON: Record<string, string> = { near: "near", sol: "sol", eth: "eth", "hood-eth": "hood", "base-eth": "base", "arb-eth": "arb" };

/** The tiles, in the core's order: each coin of its own, and every network's USDC (or USDT) behind one tile. */
export function fundTiles(coins: FundCoinRow[]): FundTile[] {
  const tiles: FundTile[] = [];
  for (const c of coins) {
    const pooled = c.symbol === "USDC" || c.symbol === "USDT";
    const key = pooled ? c.symbol : c.id;
    const had = tiles.find((t) => t.key === key);
    if (had) {
      had.coins.push(c);
      had.line = `${had.coins.length} networks`;
      continue;
    }
    tiles.push({ key, title: pooled ? c.symbol : c.name, line: pooled ? c.network : c.id === "near" ? "Goes straight in" : `${c.symbol}${c.name === c.network && c.symbol === "ETH" && c.id !== "eth" ? ` on ${c.network}` : ""}`, icon: pooled ? c.symbol.toLowerCase() : ICON[c.id] ?? c.symbol.toLowerCase(), coins: [c] });
  }
  return tiles;
}

/** An address to compare by eye: groups of four (UI-SIMPLICITY-RULES 3); Copy always copies it whole. */
export const addressGroups = (a: string): string => (/^[0-9a-zA-Z]{12,}$/.test(a) ? a.match(/.{1,4}/g)!.join(" ") : a);

/** "$1.90" from the core's "1.90"; nothing when the core had no price. */
export const dollars = (usd?: string): string | null => (usd && /^\d+(\.\d+)?$/.test(usd) ? `$${Number(usd).toFixed(2)}` : null);

/**
 * Set-up's honest numbers and times (J2, O4, O5, O8): how long it takes, said on Welcome; what opening costs and what
 * it is for, said with the coins; the hour an address lasts, said before anything is sent; one figure per address.
 */
export const SETUP_TIME = "Set-up takes about 5 minutes. First you write down 24 words. Then you add a little money.";
export const SETUP_TIME_NO_MONEY = "Set-up takes about a minute. You write down 24 words, then you are in.";
export const openCostLine = (cost: string | null): string =>
  cost ? `Opening your account takes about ${cost} of it. The rest stays yours.` : "Opening your account takes a little of it. The rest stays yours.";
/**
 * D125: set-up's swap route (SOL and ETH (RH): a one-time address into the person's own NEAR wallet, then NEAR on to the
 * account being opened) is unproven with real money, so it is on only in the test build (VITE_HOME_PROOF=1, the
 * same flag as Add's). Off: NEAR alone (it needs no swap), with this line; never the old public route.
 */
export const SWAP_OFF_LINE = "More coins open after their first real test.";
export const fundCoinsShown = <C extends { id: string }>(coins: readonly C[], proof: boolean): C[] => coins.filter((c) => proof || c.id === "near");
/** The address screen's lines (design review 2 Nov, section 11): the network and that more is fine, then the hour's end. */
export const depositWhere = (network: string, near: boolean): string => (near ? "Send it on NEAR. More is fine: it all stays in your account." : `Send it on ${network}. More is fine: the rest goes in your Safe.`);
/** O-2c (QA, 3 Nov): NEAR that came before the words were checked waits at the setup address; nothing opens yet. */
export const WAITS_TITLE = "Your NEAR is here";
export const WAITS_LINE = "Write down your 24 words, then your account opens.";
/** O-2b (QA, 3 Nov): the address screen's optional line, where Hidden is open on this build: the first win needs the
 *  Safe to hold $2 after the opening ("Send at least" itself stays the opening's figure). */
export const SEND_MORE_LINE = "Send $2 more to try Private right away.";
/** The address's real end (1Click's own deadline), said calmly with its day when it isn't today. */
export const depositUntil = (untilIso: string, nowMs = Date.now()): string => {
  const end = new Date(untilIso);
  const today = end.toDateString() === new Date(nowMs).toDateString();
  return `This address works until ${today ? "" : `${end.toLocaleDateString([], { weekday: "long" })} `}${clock(untilIso)}.`;
};
/** The one figure (O5; design review 11): dollars when 1Click priced it, else the coin. */
export const depositTitle = (d: { amount: string; usd?: string }, symbol: string): string => (dollars(d.usd) ? `Send at least ${dollars(d.usd)} of ${symbol}` : `Send ${d.amount} ${symbol}`);

/** "4:15 PM", in the person's own clock. */
export const clock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The checklist's line for each step, by where it stands: a done step says what happened; one running or still to come
 * says what is being waited on or done. Never a done line for a step that hasn't happened (product decision, 2 Nov: "Money seen on
 * Solana" with nothing sent).
 */
export function stepText(step: FundStep, v: Pick<FundView, "coin"> & Partial<Pick<FundView, "waitsForWords">>): string {
  const done = step.state === "done";
  const todo = step.state === "todo";
  switch (step.key) {
    case "seen":
      if (done) return `Money seen on ${v.coin.network}`;
      if (step.state === "failed") return `Some ${v.coin.symbol} arrived, not all`;
      return `Waiting for your ${v.coin.symbol}`;
    case "near":
      if (done) return "Changed to NEAR";
      if (step.state === "failed") return "The change to NEAR stopped";
      return todo ? "Change it to NEAR" : "Changing it to NEAR";
    case "open":
      // O-2c review L: while the NEAR waits for the words, nothing is opening yet
      if (!done && v.waitsForWords) return "Opens once your words are checked";
      return done ? "Account opened" : todo ? "Open your account" : "Opening your account";
    case "rest":
      // Job 1: never offered (the rest stays in the Safe, B10/B11); kept for a record from before.
      return "The rest is in your Safe";
  }
}

/** Nothing has happened yet: no money seen, nothing changed (the address is waiting, or ran out). */
export const nothingSeen = (v: Pick<FundView, "steps">): boolean => !v.steps.some((s) => s.state === "done" || s.state === "failed");

/** The step running now (or the last one done), for the activity bar's one line. */
export function currentStep(v: FundView): FundStep | null {
  return v.steps.find((s) => s.state === "now" || s.state === "failed") ?? v.steps.filter((s) => s.state === "done").at(-1) ?? null;
}

/**
 * The checklist's title: what is happening, in one short sentence. Open with its words done (J2, words first): the one
 * "Your account is open" of set-up. Open with its words still to write (`needs-backup`, the order before J2): "Your
 * money is in", so the words' own last screen is the one "Your account is open" (O7: never two in a row).
 */
export function fundTitle(state: FundState, stage?: FundView["stage"], coin?: Pick<FundView["coin"], "symbol">): string {
  switch (state) {
    // D155 (product decision, 3 Nov): set-up says what happens, plainly; no AgentZero line here
    case "waiting": return coin ? `Waiting for your ${coin.symbol}` : "Waiting for your money";
    case "working": return coin ? `Your ${coin.symbol} is here` : "Your money is here";
    case "opening": return "Opening your account";
    case "opened":
    case "done": return stage === "needs-backup" ? "Your money is in" : "Your account is open";
    case "short": return "Not enough came in";
    case "expired": return "This address ran out";
    case "refunded": return "Your money came back";
    case "failed": return "Your account didn't open with it";
    case "open-failed": return "Your account isn't open yet";
  }
}

/**
 * The line under the steps: where the money is, in one or two short sentences (VOICE 6: what happened, is it safe).
 * `ready`: the account is open and its backup words are done.
 */
export function fundLine(v: FundView, ready: boolean, nowMs = Date.now()): string {
  const { symbol, network } = v.coin;
  // the private route (3 Nov) refunds to the person's own confidential balance, Home's NEAR wallet; an order from before
  // named the coin's own wallet (refundTo)
  const wallet = v.refundTo ? `your own ${network} wallet in ZeroFee` : "your NEAR wallet in ZeroFee";
  switch (v.state) {
    case "waiting": return v.coin.id === "near" ? "Your account opens when it gets here." : `Send it from any ${network} wallet. Your account opens when it gets here.`;
    case "working": return v.coin.id === "near" ? "Some NEAR arrived, not all of it yet. Send the rest to the same address." : `Getting your account ready. ${etaWords(v.etaIso, nowMs)}`;
    case "opening": return "Your money is here. This takes under a minute.";
    case "opened": return ready ? (v.rest ? `${dollars(v.rest.usd) ?? `${v.rest.near} NEAR`} is left over. It's in your Safe now.` : "Your money is in your Safe.") : "Write down your backup words next. They bring your account back if you lose this phone.";
    case "done": return ready ? "Your money is in your Safe." : "Write down your backup words next. They bring your account back if you lose this phone.";
    case "short": return `${v.arrived ? `${v.arrived} ${symbol} arrived. ` : ""}Send at least ${v.deposit?.minimum ?? ""} ${symbol} in all to the same address. If no more comes, it goes back to ${wallet}.`;
    case "expired": return `Already sent to it? It goes back to ${wallet} if it can't be changed.`;
    case "refunded": return `${v.refunded ? `${v.refunded} ${symbol}` : `Your ${symbol}`} went back to ${wallet}. Your backup words open it. Find them in your account.`;
    case "failed": return `Your ${symbol} is safe. It goes back to ${wallet}.`;
    case "open-failed": return "Your money is safe at your account's address. Nothing was lost.";
  }
}

/**
 * The swap's live ETA (O9): 1Click's own estimate from when the money was seen, said as the time left; past it, said
 * plainly. No estimate: the usual time.
 */
export function etaWords(etaIso: string | undefined, nowMs = Date.now()): string {
  const end = etaIso ? Date.parse(etaIso) : NaN;
  if (!Number.isFinite(end)) return "This takes about a minute.";
  const left = Math.ceil((end - nowMs) / 1000);
  if (left <= 0) return "Slower than usual. It's with the swap service, on its way.";
  if (left < 90) return `It will be done in about ${Math.max(5, Math.round(left / 5) * 5)} seconds.`;
  return `It will be done in about ${Math.ceil(left / 60)} minutes.`;
}

/** The one button under the checklist, by state. `wait`: none: the core opens the account by itself (J2: no "Go to the app"). */
export type FundNext = "wait" | "app" | "words" | "wordsFirst" | "done" | "deposit" | "again" | "retry";
export function fundNext(v: FundView, stage: "needs-funding" | "needs-backup" | "ready"): { next: FundNext; label: string } {
  // O-2c: the NEAR waits at the setup address for the words: the one step is the words (then it opens by itself).
  if (v.waitsForWords) return { next: "wordsFirst", label: "Write down my words" };
  switch (v.state) {
    // Nothing seen yet: the address, never the apps (each would only say the account isn't open: a door to nothing).
    case "waiting":
      return { next: "deposit", label: "Show the address" };
    // On its way, or opening: nothing to tap (J2). The account opens by itself; closing ZeroFee is fine.
    case "working":
    case "opening":
      return { next: "wait", label: "" };
    case "opened":
    case "done":
      if (stage !== "ready") return { next: "words", label: "Write down your backup words" };
      // Job 1 (B10, B11): no "Move the rest to Private": what is left over stays in the Safe. J2: the one way in.
      return { next: "done", label: "Open ZeroFee" };
    case "short":
      return { next: "deposit", label: "Show the address" };
    case "expired":
      return { next: "again", label: "Get a new address" };
    case "refunded":
    case "failed":
      return { next: "again", label: "Pick a coin again" };
    case "open-failed":
      return { next: "retry", label: "Try again" };
  }
}

/** Open but its backup words not written yet: never "all set" until they are (the checklist says open, words next). */
export const asShown = (v: FundView): FundView => {
  // The rest is never a step on screen (Job 1, B10/B11): it stays in the Safe.
  const steps = v.steps.filter((s) => s.key !== "rest");
  const state = v.state === "done" && v.stage === "needs-backup" ? "opened" : v.state;
  return steps.length === v.steps.length && state === v.state ? v : { ...v, steps, state };
};

/** The checklist shows instead of the address once anything has happened. */
export const showsChecklist = (v: FundView): boolean => v.state !== "waiting" && v.state !== "expired";

/**
 * Back from a coin's page (Add SOL, Add NEAR, Add ETH: its address, or its run-out page), by its arrow, the browser's Back
 * or Escape (all three run the page's one onBack: PushedFrame's button and its useBack): one step, to the coins, at once.
 * The product decision, 6 Nov: the arrow seemed to do nothing, because Back first asked the core for the coins again, and on
 * mainnet that read asks the chain and NEAR's price before it answers. Now the list already read shows at the tap and is
 * read again behind it; no list read yet (an address kept from before), the coins' own frame at once, the list as it comes.
 */
export const fundBack = (held: boolean): { to: "coins" | "loading"; reread: true } => ({ to: held ? "coins" : "loading", reread: true });

/** What a read of the coins does when it answers. Asked by the coins' own screen (`quiet` false: the first look, another
 *  coin): show them, or its Problem. Read again behind a Back (`quiet`): on the coins or their frame it shows them; a
 *  failed read under a list already shown keeps that list; anywhere else (a coin tapped meanwhile) it only keeps the list,
 *  never pulling the person back. */
export function coinsAnswer(at: string, held: boolean, ok: boolean, quiet: boolean): "show" | "keep" | "problem" | "nothing" {
  const here = at === "coins" || at === "loading";
  if (!quiet) return ok ? "show" : "problem";
  if (!here) return ok ? "keep" : "nothing";
  if (ok) return "show";
  return held ? "nothing" : "problem";
}

/** The apps may show (with the bar over them) only once money is seen: before it, every app would be a door to nothing. */
export const mayGoToApp = (v: FundView): boolean => showsChecklist(v) && !nothingSeen(v);

/**
 * Set-up may be left (start over, or bring an account back with its words) only while no money was ever seen: no
 * address yet, or one still waiting. Once anything arrived, the account's own wallets hold it (or it lands at the
 * account), and only this set-up can reach it.
 */
export const mayLeaveSetup = (v: FundView | null): boolean => v === null || (v.state === "waiting" && nothingSeen(v));

/** What an app says while the account opens (money seen): the state's title, its line, and the one way back. */
export function openingWords(v: FundView, app: string): { title: string; line: string; note: string | null; button: string; words: boolean } {
  const shown = asShown(v);
  const next = fundNext(shown, shown.stage);
  const words = next.next === "words";
  if (shown.waitsForWords) return { title: WAITS_TITLE, line: WAITS_LINE, note: null, button: "See the steps", words: false };
  return {
    title: fundTitle(shown.state, shown.stage, shown.coin),
    line: fundLine(shown, shown.stage === "ready"),
    note: shown.state === "working" || shown.state === "opening" ? `${app} opens as soon as your account does.` : null,
    button: words ? next.label : "See the steps",
    words,
  };
}
