// One way to move money (Job 1, the spine; FLOW-V3 Part C): Send, Top up, Put away and Add money are one sheet,
// opened in place over the app the person is in (criterion 6: no tap jumps apps without saying so). The flow is three
// beats: the amount (dollars first, the coin under it) → Approve (Face ID, the core's own sheet) → one line on the
// screen the person came from saying it went. No review screen, no Done, no second sheet.
//
// Apps ask with useShell().openMoney(ask); the shell hosts the sheet (Wallet's MoneyHost, on Wallet's own bridge, as
// the money was always moved before). The "it went" line is said with sayWent and shown by the shell (WentLine).

/** A Home tab a money sheet opens pre-set to: the Safe or one wallet. */
export type HomeWallet = "safe" | "sol" | "hood" | "near" | "bsc";
/** A coin Swap trades, by where it sits (Wallet's swap-corridor.ts SWAP_PLACES; a test holds them equal). */
export type SwapCoin = "sol" | "hood" | "bsc" | "near" | "safe-usdc" | "safe-near";
/** A coin Add and Request take, by its chain (core add-outside.ts AddChain). */
export type AddCoin = "sol" | "hood" | "near" | "bsc";

/**
 * Prefill (product decision, 3 Nov: AgentZero does everything Home does by opening Home's own sheets, filled in): every field below
 * marked "prefill" is optional, read once when the sheet opens, and only fills in what a person could type. Nothing is
 * sent by it: the person still holds, taps and approves with Face ID on the core's own sheet. A sheet the agent app
 * opened filled in says AGENT_FILLED first, and its destination is read exactly as if typed (grouped, "New address",
 * the look-alike stop).
 */
export type MoneyAsk =
  /** `link`: another app's send, filled in (pay links.ts sendLink); its `back` app hears "sent" when it went. */
  | { kind: "send"; link?: string; /** Home's wallet preset: Send opens From that wallet ("safe", "sol", "hood", …). */ wallet?: string;
      /** prefill: who (any address or NEAR name Send reaches), its network when it names one ("hood": picked, still shown), how many dollars, and its note */ to?: string; chain?: string; usd?: string; note?: string;
      /** prefill: the coin it sends, by its symbol (a coin's own page: Send opens From that coin, never the Safe's biggest) */ coin?: string;
      /** set only by AgentZero's Send (agent chat/send-ask.ts): its `to` is AgentZero's, so Send says so under To while it
       *  stays. Never enough alone: the shell's own stamp of the opener (filledNote) must say the agent app too. */ agentFilled?: true }
  /** `usd`: what the asking app needs ready (Apps' "Make $10 ready"); `back`: the app to tell when it went. */
  | { kind: "topup"; usd?: string }
  /** Move (the Home plan §1.5): the sliders; `wallet`, Home's tab it opened from, is the slider it highlights.
   *  prefill: `from`, `to`, `usd` set the sliders to that one move. */
  | { kind: "move"; wallet?: HomeWallet; from?: HomeWallet; to?: HomeWallet; usd?: string; /** the whole of `from` ("move all"): Move opens with its slider at $0 */ all?: true; /** the asking app's figure was under Move's least and `usd` is that least: Move says why, in Home's own words */ raised?: true;
      /** Trade's own Move (product decision, 4 Nov): the sheet ends the moment the move is on its way, back to the app; its legs go on in Activity */ quick?: true;
      /** Private's own Move (the copy review's walk, 5 Nov): Move opens with Private as its source, its row the one in focus */ source?: "private" }
  | { kind: "putaway" }
  /** Home's Swap (the Home plan §1.4): `wallet`, Home's tab it opened from, is the "You pay" it opens on.
   *  prefill: `from` (You pay), `to` (You get), `usd`. */
  | { kind: "swap"; wallet?: HomeWallet; from?: SwapCoin; to?: SwapCoin; usd?: string }
  /** Add money (one-time private addresses, D127); `link`: the coin another app asked for (Wallet's receiveChainFor);
   *  `wallet`: Home's tab it was opened from, so Add opens pre-set to that wallet. prefill: `coin`, Add opens straight
   *  on that coin's one-time address (its wallet's, or the Safe's when `wallet` is "safe"). */
  | { kind: "receive"; link?: string; wallet?: "safe" | "sol" | "hood" | "near" | "bsc"; coin?: AddCoin }
  /** Request money (inside Add's sheet), prefilled: the dollars, the coin it's paid in, the note. */
  | { kind: "request"; usd?: string; coin?: AddCoin; note?: string }
  | { kind: "cap" }
  /** Social Trading: the Safe → a site's own wallet (`wallet`: its id; `name`: the site's, "pump.fun"), privately.
   *  `auto` (ST11): the person already said "Move $5" on the site window's own sheet: the move starts at once (the core's
   *  Approve and Face ID still ask), and its words go back to the window, never drawn behind it. */
  /** `network` (ST13): a site with a wallet per network names the one it goes to ("Solana": "Goes to your GMGN Solana
   *  wallet."); the wallet's id is still the hub's own, never the page's. */
  | { kind: "siteadd"; wallet: string; name: string; usd?: string; auto?: boolean; network?: string; /** the sheet offers "Open pump.fun" too */ canOpen?: true }
  /** Social Trading: a site's own wallet → the Safe, privately (the core's own sheet for it). `also` (ST13): the site's
   *  other funded wallets (ids from the hub's own read of the core's list, never a page's), swept home by the same tap. */
  | { kind: "siteback"; wallet: string; name: string; also?: string[]; /** opened from the wallet sheet: Back returns there */ back?: true;
      /** the dollars the button that opened it named ("Move $14.85 back to Safe"): the sheet opens at them (crawl F5) */ usd?: number };

/** What the sheet hands back to the app that opened it, once it is over. */
/** `line`: an `auto` Add's own words when it went, or why it didn't (ST11: the site window says them, not the shell). */
/** `open` (a site's Add, a test finding): the person chose to open the site without putting money in. `back` (a site's Take
 *  out, a test finding): the person went Back, to the wallet sheet the sheet was opened from. */
export type MoneyEnd = { went: true; movementId?: string; line?: string } | { went: false; line?: string; open?: true; back?: true };

/** Said first on a sheet the agent app opened filled in (prompt injection: what it filled is checked before Face ID). */
export const AGENT_FILLED = "AgentZero filled this in. Check it before you approve.";
/** W7 (audit, the copy review's look: a quiet 13 px --mute line): said under To, in the network line's slot, on a Send the agent app
 *  filled in (toSlotLine). */
export const AGENT_FILLED_ADDRESS = "AgentZero filled this in. Check the address.";
/**
 * Send's AgentZero line: AGENT_FILLED_ADDRESS only when the shell says the agent app opened the sheet (`note`,
 * MoneyHost's filledNote: the opener's stamp, never a field of the ask or the model's words), AND the prefill carries
 * AgentZero's flag (`flagged`: the ask's agentFilled, set only by send-ask.ts), AND the address on screen is still the
 * one filled in (`filled`). A person-typed or pasted Send, or an address the person changed: none.
 */
export const filledAddressLine = (note: string | null, filled: string | undefined, shown: string, flagged: boolean): string | null =>
  note !== null && flagged && !!filled && filled.trim() !== "" && shown.trim() === filled.trim() ? AGENT_FILLED_ADDRESS : null;
/** The slot under To (the copy review's quiet --mute line, never a box, never above the amount): AgentZero's line while the address
 *  is still the one it filled in, in place of the network line; the network line once the person edits To. The approval
 *  sheet keeps its own "Public on <network>." line whatever this says. */
export const toSlotLine = (agentLine: string | null, networkLine: string | null): string | null => agentLine ?? networkLine;

/** Whether an ask carries anything filled in for the person: any field past its kind (a Request is all filled in). */
export function prefilled(ask: MoneyAsk): boolean {
  if (ask.kind === "request") return true;
  return Object.entries(ask).some(([k, v]) => k !== "kind" && v !== undefined && v !== "");
}
/** The line a sheet says first: AGENT_FILLED when the agent app opened it filled in; none for any other app, or an
 *  agent's ask with nothing filled in. `asker` is the shell's, never the ask's. */
export const filledNote = (ask: MoneyAsk, asker: string | undefined): string | null => (asker === "agent" && prefilled(ask) ? AGENT_FILLED : null);
/**
 * The ask as the money host takes it from `asker`, the app the shell says opened it (never a field the app sets). From
 * the agent app, a site's `auto` move is never automatic: its sheet comes first (prefill never skips a step).
 */
export function askFrom(ask: MoneyAsk, asker: string | undefined): MoneyAsk {
  if (asker === "agent" && ask.kind === "siteadd" && ask.auto) {
    const { auto: _auto, ...rest } = ask;
    return rest;
  }
  return ask;
}

type Line = { text: string; state: "busy" | "went" | "quiet" };
const listeners = new Set<(l: Line | null) => void>();
let current: Line | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Says one line on the screen the person is on: "Getting it ready…" (busy), "Sent $5.00 to alex.near" (went). A went
 *  line stays a few seconds; a busy one until the next line. */
export function sayWent(text: string, state: Line["state"] = "went"): void {
  // A move still on its way never shows the done tick (security rule L7; B28: "$3.00 is on its way to pump.fun." had it).
  if (state === "went" && STILL_MOVING.test(text)) state = "quiet";
  current = text ? { text, state } : null;
  watchSight();
  arm();
  listeners.forEach((l) => l(current));
}
/**
 * A went line's seconds count only while the page is in sight (break row, 2 Nov: a NEAR buy that landed while the phone
 * was locked said "Bought 0.36 QTC for $25.00" to a hidden page, and it was gone before the person came back). Out of
 * sight the line waits; back in sight it stays its full few seconds.
 */
const outOfSight = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";
function arm(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!current || current.state === "busy" || outOfSight()) return;
  timer = setTimeout(() => sayWent(""), WENT_MS);
}
let watching = false;
function watchSight(): void {
  if (watching || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  watching = true;
  document.addEventListener("visibilitychange", arm);
}
export const WENT_MS = 5000;
/** The line on the screen now, if any (a move's "on its way" line is ended by its landing: wallet landing-notice.ts). */
export const wentNow = (): string | null => current?.text ?? null;
/** Words that say the money hasn't arrived yet: such a line is never a "went" (no tick). */
export const STILL_MOVING = /\bon its way\b|\bon the way\b|\bmoving\b|…$/i;
export function onWent(l: (line: Line | null) => void): () => void {
  listeners.add(l);
  l(current);
  return () => void listeners.delete(l);
}
