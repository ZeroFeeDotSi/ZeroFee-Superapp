// Home's Swap (the Home plan §1.4; D128): You pay [coin ▾] → You get [coin ▾], an amount slider with Max, one line
// ("At least 0.0158 ETH arrives. About 2 min."), and Hold to swap. The coins are each wallet's own coin, the NEAR
// wallet's cash, and the Safe's USDC and NEAR; "You get" lists only coins a route the real core finishes reaches from the
// coin paid (swap-corridor.ts), so nothing is picked and then refused. Every route is the one private engine: wallet →
// wallet is one saved job (spending.move, E5), the Safe → a wallet is its Approve with that coin named (spending.topUp),
// a wallet → the Safe is one take-out (spending.putAway), the Safe's NEAR → its USDC is E7 (spending.topUp, home).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { safeSends, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { useFaceIdBand } from "./face-band.ts";
import { tapBurst } from "@zerofee/design/tap.ts";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { MoneyAmount, MoneySheet, QUOTE_WAIT_MS, SheetLine, quoteWaitLine, useElapsed } from "@zerofee/design/MoneySheet.tsx";
import { serviceOf } from "@zerofee/core/services";
import type { BridgeResult } from "@zerofee/core/bridge";
import { keepPrice, keptPrice } from "./price-kept.ts";
import { keepFresh, priceFresh } from "./swap-fresh.ts";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { padBase } from "@zerofee/design/keypad.ts";
import { sayWent, type HomeWallet } from "@zerofee/shell-api/money.ts";
import { HOME_PROOF } from "@zerofee/core/home-proof";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { receiptPaidLine, swapPayer } from "./paid-from.ts";
import { mark } from "@zerofee/design/tap.ts";
import { LANDED_READ_FOR_MS, LANDED_READ_MS, followSwap, landedFigure } from "./swap-follow.ts";
import { nameSwap } from "@zerofee/shell-api/job-carry.ts";
import { JobReceipt } from "./JobMade.tsx";
import { swappedLine, swappingLine } from "./receipt-said.ts";
import { ActSwap } from "../icons.tsx";
import type { Balance, Token } from "../../types.ts";
import { typedUsd } from "../hub.ts";
import { useWallet } from "../runtime.tsx";
import { useMoveProblem } from "../screens/Spending.tsx";
import { dollars, privateFigure } from "../format.ts";
import { SHEET_NEEDS, useServices } from "../services.ts";
import { SWAP_COIN, coinFigure, routeSec, feeHigh, floorOf, SWAP_MIN_USD, SWAP_WORDS, arrivesWith, backLine, coinName, feesLine, paidLine, type SwapPrice, privateLine, getsFor, mostOn, payFor, paysHere, routeOf, saidOnSheet, swapBlock, swapFloor, swapKey, swapSub, type PayHere, type SwapPlace, type SwapRoute, swapStays, swapMoney, SWAP_PLACES } from "./swap-corridor.ts";
import { MOVE_WORDS, safeSigns } from "../screens/move-split.ts";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { CoinPicker } from "./CoinPicker.tsx";
import { endHere, sendEndsHere, stoppedLine } from "./swap-refused.ts";
import { coverLine, swapCover, swapRefusal } from "./swap-cover.ts";
import { TOP_UP_PRIVATE } from "./send-cap.ts";
import type { SafeCoin } from "@zerofee/core/spending";
import { CoinSwap } from "./CoinSwap.tsx";
import { InplaceSwap } from "./InplaceSwap.tsx";
import { nearCash, nearHeldRows, type InplaceHeld } from "./swap-inplace.ts";
import { LiveTracker } from "./LiveTrack.tsx";
import type { LiveTrack } from "./live-steps.ts";
import { PLACE_CHAIN, siteRows, type ListedWallet, type PickCoin } from "./coin-pick.ts";
import { SiteBackSheet } from "./SiteMoney.tsx";
import { NEAR_IN_WALLET, coinRoute, placeCoin } from "./swap-coins.ts";
import "./move-swap.css";

type Held = NonNullable<SpendingActivity["held"]>;
export type SwapCoin = "NEAR" | "USDT";

/** The Safe's rows a swap of `coin` may be paid from (spending.ts isSwapCoin, the same rule). */
export const swapRows = (balances: readonly Balance[] | null, coin: SwapCoin): Balance[] =>
  (balances ?? []).filter((b) => b.listed !== false && b.held !== "private" && (coin === "NEAR" ? b.tokenId === "near" || b.tokenId === "nep141:wrap.near" : b.tokenId === "nep141:usdt.tether-token.near"));

/** The line while the swap service works: its own estimate when it gave one, never a spinner. */
export const workingLine = (etaSeconds?: number) => (etaSeconds ? `The swap service is working on it · about ${etaSeconds} s` : "The swap service is working on it");

/** `$8.22` → "Swap $8.22 of NEAR for USDC". */
/** the copy review (6 Nov): money always to two decimals, "Swap $150.00 of USDC for SOL", on the Getting-ready sheet and the job alike. */
export const swapWords = (usd: string, from: string, to = "USDC") => `Swap $${Number(usd).toFixed(2)} of ${from} for ${to}`;

/** A refusal while pricing, in the sheet's words (review M3): never the core's inner words or a service's raw text. */
export function plainLine(p: { code: string; whatHappened: string }): string {
  if (/unreachable|unavailable|down/.test(p.code)) return "NEAR Intents didn't answer. Nothing moved. Try again.";
  if (/Spending|Trading|Private|said no|:/.test(p.whatHappened)) return "The swap service can't price this swap right now. Nothing moved.";
  return p.whatHappened;
}

/** Each chain's own coin on NEAR Intents (its price in the coin list). */
const COIN_ID: Partial<Record<SwapPlace, string>> = { sol: "nep141:sol.omft.near", hood: "nep141:hood.omft.near", bsc: "nep245:v2_1.omni.hot.tg:56_11111111111111111111" };
/** A coin got, in dollars: the wallet's own figure when it holds some, else the coin list's price; USDC is a dollar. */
export function priceOf(place: SwapPlace, status: SpendingStatus, tokens: Map<string, Token>): number {
  if (SWAP_COIN[place].symbol === "USDC") return 1;
  const n = status.networks.find((x) => x.network === place);
  const amount = Number(n?.nativeAmount), cash = Number(n?.cashUsd);
  if (amount > 0 && cash > 0) return cash / amount;
  const id = COIN_ID[place];
  return Number(id ? tokens.get(id)?.priceUsd : NaN) || 0;
}

/** The asks each route makes (one call): the Safe's are its Approve (Face ID), the wallets' need none. */
/** `all`: Max on a wallet's own coin (review L3): sent as "all", so the core keeps the network's fee back. */
export function askOf(r: SwapRoute, usd: number, key: string, all = false): { method: string; params: Record<string, unknown> } {
  switch (r.kind) {
    case "move": return { method: "spending.move", params: { from: r.from, to: r.to, usd: all && r.from !== "near" ? "all" : usd, key } };
    case "topup": return { method: "spending.topUp", params: { usd, swap: r.coin, legs: [{ network: r.to, usd }], key } };
    case "home": return { method: "spending.putAway", params: { legs: [{ network: r.from, usd: all ? "all" : usd }] } };
    case "safe": return { method: "spending.topUp", params: { usd, swap: "NEAR", home: true, key } };
  }
}

export function SwapSheet({ status, slowLine, balances, wallet, prefill, onClose, onDone, onHeld, onOpen }: { status: SpendingStatus; /** the read still on its way, named (MoneyHost: the sheet opened on what was known) */ slowLine?: string | null; safeUsd: string | null; balances: readonly Balance[] | null; wallet?: HomeWallet; /** filled in by the app that opened it, read once: You pay, You get, the dollars */ prefill?: { from?: SwapPlace; to?: SwapPlace; usd?: string }; onClose: () => void; onDone: (line: string, follow?: { id: string; words: string; etaSeconds?: number }) => void; onHeld: (h: Held) => void; onOpen: (next: NextStep) => void }) {
  const shell = useShell();
  const { bridge, tasks } = shell;
  const { tokens, pocket, earning } = useWallet();
  // audit H1: what the Safe's USDC really sends, by the core's own rule (safeSends); the band not read yet: nothing promised
  const band = useFaceIdBand(bridge);
  const sends = band === undefined ? undefined : (u: number) => safeSends(balances ?? [], u, { swap: "USDC", roomUsd: Number(status.roomUsd) || 0, bandUsd: band, onward: true });
  // BNB while its gate is open; the two-leg pairs only in the test proof build (review L9)
  const open = (c: "bsc" | "pair") => (c === "pair" ? HOME_PROOF : status.networks.some((n) => n.network === c && !n.closed));
  const pays = useMemo(() => paysHere({ networks: status.networks, reserveUsd: status.reserveUsd, roomUsd: status.roomUsd, safe: balances, pocket: pocket?.available ? pocket.rows : null, earning }).filter((p) => getsFor(p.place, open).length > 0), [status, balances, pocket, earning]);
  const [payPlace, setPayPlace] = useState<SwapPlace | null>(prefill?.from ?? null);
  // opened from a Home tab: "You pay" starts on that wallet (when it holds anything to swap), until another is picked
  const pay: PayHere | null = pays.find((p) => p.place === (payPlace ?? payFor(wallet, pays))) ?? pays[0] ?? null;
  const gets = pay ? getsFor(pay.place, open) : [];
  const [getPlace, setGetPlace] = useState<SwapPlace | null>(prefill?.to ?? null);
  const get: SwapPlace | null = getPlace && gets.includes(getPlace) ? getPlace : gets[0] ?? null;
  const route = pay && get ? routeOf(pay.place, get, open) : null;
  const most = pay ? mostOn(pay, route) : 0;
  const [picking, setPicking] = useState<"pay" | "get" | null>(null);
  // any coin (bug report, 5 Nov): a coin picked that isn't one of Home's places; its route is swap-coins.ts coinRoute
  const [coinPay, setCoinPay] = useState<PickCoin | null>(null);
  const [coinGet, setCoinGet] = useState<PickCoin | null>(null);
  // a coin swap's tap: this sheet is its tracker from then on (Close leaves it running; Home's Jobs row follows it)
  const [track, setTrack] = useState<LiveTrack | null>(null);
  /** "Who can see this?" (R3): the honest privacy line one tap away, its own full-screen sheet (D135), so the floor never grows */
  const [who, setWho] = useState(false);
  const [usd, setUsd] = useState(prefill?.usd ?? "");
  // Finding 37: an amount the person didn't type key by key (a chip, Max, the one it opened with) is typed over by the first key
  const [preset, setPreset] = useState(!!prefill?.usd);
  const amount = Number(typedUsd(usd) ?? 0);
  const block = swapBlock({ route, usd: amount, most });
  // T-F (6 Nov): whether the Safe covers what Private is short of, by the core's own rule (swap-cover.ts); Private short
  // with no cover is said before the tap in the sub-line slot, the button off, never refused after it
  const cover = route?.kind === "topup" && !block ? swapCover({ coin: route.coin, usd: amount, safe: balances as readonly SafeCoin[] | null, pocket: pocket ? (pocket.available ? pocket.rows as readonly SafeCoin[] : []) : null, fillOpen: SAFE_FILL_OPEN }) : null;
  const short = coverLine(cover);
  // J3-3: who pays, by the fill rule the money path itself runs (move-split safeSigns): the same `signs` the tap's job
  // (fromPrivate), its Safe sheet and the receipt's W1 read, so the "You pay" card never names a place the money won't
  // leave. Coins not read, or a fill: the Safe's Approve comes, as before
  const signs = route?.kind === "topup" ? safeSigns([{ from: "safe", to: route.to, usd: amount }], balances && pocket ? [...balances, ...(pocket.available && pocket.ready ? pocket.rows : [])] : null, SAFE_FILL_OPEN, route.coin) : undefined;
  // the route's least, said once while the amount is picked; nothing under it is offered (QA, 5 Nov)
  const floor = floorOf(route);
  // a press with no amount yet says "Pick an amount." (until the dollars change)
  const [tried, setTried] = useState(false);
  const toWallet = route?.kind === "topup" ? status.networks.find((n) => n.network === route.to) : undefined;
  const back = block ? null : backLine(route, amount, (Number(toWallet?.cashUsd) || 0) + (Number(toWallet?.coinsUsd) || 0));
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // one key per swap as asked (review M2): a retry of the same pair and amount is the same move, never a second one
  const keys = useRef(new Map<string, string>());
  const keyFor = (what: string) => { let k = keys.current.get(what); if (!k) keys.current.set(what, (k = swapKey())); return k; };
  const services = useServices(bridge, SHEET_NEEDS.swap, "Swap");
  const problem = useMoveProblem(onOpen, setLine);
  // a Problem whose one step is Try again is said ON the sheet, with its Try again (QA, 4 Nov: "Solana's price
  // isn't read yet" went to the shell's screen behind this sheet for 4 minutes; each hold lined up another, so after Close
  // Back and Try again showed the next copy). Its Try again asks again (the price too); Close leaves
  const [stopped, setStopped] = useState<Problem | null>(null);
  // QA's condition (6 Nov): any edit, the amount or a coin, ends a refusal: its line goes, the button reads Swap again
  const edited = () => { setLine(null); setStopped(null); setTried(false); };
  const onUsd = (v: string) => { edited(); setUsd(v); };
  // what it really brings and what it costs, from 1Click's dry quotes (UI's mainnet rehearsal, 3 Nov: "at least 1.4")
  const price = useSwapPrice(bridge, pay?.place ?? null, get, amount, !route || !!block);
  const name = coinName;
  // a site's own wallet picked on "You pay": its Move to your Safe (Back comes here)
  const [sitePay, setSitePay] = useState<{ id: string; name: string } | null>(null);
  const [sites, setSites] = useState<PickCoin[]>([]);
  useEffect(() => { let on = true; void bridge.call<ListedWallet[]>("spending.wallets").then((r) => { if (on && "ok" in r) setSites(siteRows(r.ok)); }).catch(() => undefined); return () => { on = false; }; }, [bridge]);
  // the NEAR wallet's own coins (Swap in place, owner): what it can sell inside NEAR Intents
  const [nearRaw, setNearRaw] = useState<{ tokenId: string; amount: string }[] | null>(null);
  useEffect(() => { let on = true; void bridge.call<{ tokens?: { tokenId: string; amount: string }[] }>("subwallet.float.balance").then((r) => { if (on && "ok" in r && Array.isArray(r.ok?.tokens)) setNearRaw(r.ok.tokens); }).catch(() => undefined); return () => { on = false; }; }, [bridge]);
  const nearHeld = useMemo(() => nearHeldRows(nearRaw, (id) => tokens.get(id)), [nearRaw, tokens]);
  // the NEAR wallet's cash, its one figure (bug hunt item 4: it showed $48.54 of $50.00, the move-out fee room)
  const cash = useMemo(() => nearCash(nearRaw), [nearRaw]);

  // the job (bug report, 5 Nov: every waiting money flow is instant): from a wallet it is made at the tap; from the Safe
  // on this swap's own Face ID yes (job-run.ts). "Job created." here (the receipt), its row on Home and in Activity, the
  // bell's pulse; the core's answer ends the row, never this sheet. A No makes nothing: the sheet as it was.
  const jobTasks = useShell().tasks;
  const [made, setMade] = useState<string | null>(null);
  // J3 (copy review, 7 Nov): Private paying the Safe's Swap whole (no Face ID by design, D143) says so on the receipt (W1)
  const [paidLine, setPaidLine] = useState<string | null>(null);
  /** The job its receipt follows (runJob's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [madeJob, setMadeJob] = useState<string | null>(null);
  /** The receipt's first line (copy review, 7 Nov): "$25.00 swapped: about 0.2419 SOL is in your SOL wallet.", the tap's own figures. */
  const [madeSaid, setMadeSaid] = useState<{ going: string; landed: string } | null>(null);
  // the audit's Send audit M5 (7 Nov): once its movement is done, the receipt's landed line says what the movement itself landed
  // (1Click's settled amountOut, the core's record), never the tap's estimate; read while the receipt shows
  const [landing, setLanding] = useState<{ id: string; where: string } | null>(null);
  useEffect(() => {
    if (!landing) return;
    let live = true;
    const read = async () => {
      const r = await bridge.call<SpendingActivity[]>("spending.activity", {}).catch(() => null);
      if (!live || !r || !("ok" in r) || !Array.isArray(r.ok)) return;
      const fig = landedFigure(r.ok, landing.id, (n) => coinFigure(n, "down"));
      if (fig) { live = false; setMadeSaid((m) => (m ? { ...m, landed: swappedLine(fig, landing.where) } : m)); }
    };
    void read();
    const t = setInterval(() => void read(), LANDED_READ_MS);
    const end = setTimeout(() => { live = false; }, LANDED_READ_FOR_MS);
    return () => { live = false; clearInterval(t); clearTimeout(end); };
  }, [landing]);
  const go = async () => {
    if (!pay || !get || !route || busy || block || short) return;           // one hold, one swap
    // M5 (the audit's audit): a price this old is asked again first, so the tap's figure (the receipt's) is never a stale one
    if (price.cost && !priceFresh(price.at, Date.now())) return price.again();
    mark("tap");
    setBusy(true); setLine(null); setStopped(null);
    const words = swapWords(String(amount), SWAP_COIN[pay.place].label, SWAP_COIN[get].label);
    // a Swap from the Safe to a wallet that Private pays whole (the ledger's fill rule, move-split safeSigns): no Safe sheet
    // comes, so the job is made at the tap like a wallet's (rule 2; QA's Sim lap: 1.8 s to "Job created." while
    // it waited for a sheet that never came). Coins not read, or a fill: the Safe's Approve first, as before
    // `signs`: the render's own (J3-3), the value the "You pay" card said
    const safe = (route.kind === "topup" && signs !== false) || route.kind === "safe";
    const said = `$${amount.toFixed(2)}`;
    // what comes in, as the sheet priced it at the tap ("0.0644 SOL"): the job's end says it (copywriter, 5 Nov)
    const px = priceOf(get, status, tokens);
    const got = price.cost && px > 0 ? coinFigure(price.cost.arrivesUsd / px, "down") : "0";
    const lands = got !== "0" ? `${got} ${SWAP_COIN[get].symbol}` : undefined;
    // D143: only the Safe's routes ask (its Approve, Face ID); a wallet's swap is made at once
    if (safe) sayWent("Getting it ready…", "busy");
    const a = askOf(route, amount, keyFor(`${pay.place} ${get} ${amount}`), amount >= most - 0.004 && !pay.place.startsWith("safe"));
    // the receipt says W1 only once the job's own record shows Private paid it (the copy review's J2-4: never on the fill rule's guess)
    setPaidLine(null);
    const end = await runJob<SpendingActivity | { declined: true }>({
      tasks: jobTasks, title: words, usd: said, etaSec: routeSec(route), safe, ...(signs === false ? { fromPrivate: true } : {}), money: swapMoney(safe, signs, pay.place),
      call: () => bridge.call<SpendingActivity | { declined: true }>(a.method, a.params),
      declined: (r) => "ok" in r && "declined" in r.ok,
      made: (j) => { sayWent(""); setMadeJob(j.id); setMadeSaid({ going: swappingLine(SWAP_COIN[pay.place].label, SWAP_COIN[get].label), landed: swappedLine(lands, SWAP_COIN[get].where) }); setMade(said); setBusy(false); },
      // the audit's (B): the Safe asked after all, so the receipt never says "From Private, so no Face ID."
      safeAsked: () => setPaidLine(null),
      // its key (the call's), which the core names with approval.asked when the Safe's sheet comes for it (the audit's MUST)
      ...(typeof a.params.key === "string" ? { key: a.params.key } : {}),
    });
    sayWent("");
    setBusy(false);
    if ("declined" in end) return setMade(null);
    // the build's trace of S2 (5 Nov): refused after "Job created." showed, the receipt stayed over the refusal. Now the
    // receipt goes (the refusal says what failed, where the money is, the next tap). Train 10's runJob decides the row:
    // a refusal before the Safe's yes takes the tap's job away (nothing was asked of it); after, the row ends stopped
    // Private short after the tap (refused before anything is signed): the reviewer's "Not enough in Private." screen (swapRefusal)
    if ("refused" in end) { mark("refused"); setMade(null); return void (sendEndsHere(end.refused) ? endHere(shell, end.refused, onClose) : saidOnSheet(end.refused) ? setStopped(end.refused) : problem(swapRefusal(end.refused), onUsd)); }
    // refused after the job existed: its row ends stopped with why (runJob); the sheet says it too, never "Job created."
    if ("problem" in end) { mark("refused"); setMade(null); return void (sendEndsHere(end.problem) ? endHere(shell, end.problem, onClose) : saidOnSheet(end.problem) ? setStopped(end.problem) : problem(swapRefusal(end.problem), onUsd)); }
    const ok = end.ok as SpendingActivity;
    setPaidLine(receiptPaidLine(route.kind === "topup", signs, ok));
    // the row is this Swap's from its first read (QA's Sim crawl, 5 Nov: it read "Move" until Done)
    nameSwap(ok.id, words, lands);
    setLanding({ id: ok.id, where: SWAP_COIN[get].where });
    end.job.made([`move:${ok.id}`]);
    if (ok.held) { onHeld(ok.held); return onDone(""); }
    // the wallets are read again until the swap shows (swap-follow.ts): the host does it with Done (the app that asked
    // hears its id), or here when Done came first
    if (closed.current) followSwap(bridge, { id: ok.id, words });
    else follow.current = { id: ok.id, words };
  };
  const follow = useRef<{ id: string; words: string } | null>(null);
  const closed = useRef(false);
  const finish = () => { closed.current = true; const f = follow.current; follow.current = null; if (f) onDone("", f); else onDone(""); };

  // the picker's rows for Home's places: what can pay (with what each holds), or every place a coin can land in
  // (NEAR itself as the NEAR wallet's coin whenever its cash pays, bug hunt item 6)
  const placeRows = (which: "pay" | "get"): PickCoin[] => (which === "pay" ? pays.map((p) => placeCoin(p.place, SWAP_COIN[p.place], p.usd))
    : [...SWAP_PLACES.map((p) => placeCoin(p, SWAP_COIN[p])), ...(payPick?.place === "near" ? [NEAR_IN_WALLET] : [])]).filter((c): c is PickCoin => c !== null);
  // nothing else to pay with but a coin the NEAR wallet holds (its cash all spent by a Max): the sheet opens on that coin,
  // so what was bought can always be sold
  const paying = coinPay ?? (pay ? null : nearHeld[0] ?? null);
  const payPick: PickCoin | null = paying ?? (pay ? placeCoin(pay.place, SWAP_COIN[pay.place], pay.usd) : null);
  // a coin paid gets its wallet's own coin by default: SOL, ETH (RH), or the NEAR wallet's cash (Swap in place)
  const getPick: PickCoin | null = coinGet ?? (paying && (paying.chain === "sol" || paying.chain === "hood" || paying.chain === "near") ? placeCoin(paying.chain, SWAP_COIN[paying.chain]) : get ? placeCoin(get, SWAP_COIN[get]) : null);
  const coinWhy = (which: "pay" | "get") => (c: PickCoin): string | null => {
    if (which === "pay") return null;
    if (!payPick) return null;
    const r = coinRoute(payPick, c, open);
    return "why" in r ? r.why : null;
  };
  const picked = (which: "pay" | "get", c: PickCoin) => {
    setPicking(null); edited();
    if (which === "pay") {
      if (c.site) return setSitePay(c.site);
      setUsd("");
      if (c.place) { setCoinPay(null); setPayPlace(c.place); } else setCoinPay(c);
      // a coin got that the new coin paid can't reach goes back to the default
      if (coinGet && "why" in coinRoute(c, coinGet, open)) setCoinGet(null);
      return;
    }
    if (c.place) { setCoinGet(null); setGetPlace(c.place); } else setCoinGet(c);
  };
  const coinTrade = (paying || coinGet) && payPick && getPick ? coinRoute(payPick, getPick, open) : null;
  // what the floor and the sub-line slot say, and what the one button does (swapFloor, swapSub): pure, so each state is a test
  const said = line ?? services.line ?? slowLine ?? null;
  const refused = stopped && !busy && !block ? stoppedLine(stopped) : null;
  const on = swapFloor({ again: refused ? stopped!.next.label : null, block, tried, said: !!said, priceDown: price.late || !!price.said });
  // J3-3: Private paying it whole, the card names Private, so no "leaves Private" line under it
  const payer = pay ? swapPayer({ safeRoute: route?.kind === "topup", signs, where: SWAP_COIN[pay.place].where, usd: pay.usd, privateUsd: privateFigure(pocket) }) : null;
  const stays = !block && !payer?.private ? swapStays(route, amount, sends, undefined, cover) : null;
  const nothing = !!route && most < 0.01;
  // M5 (the audit's audit): a price past its life with nothing newer is greyed, its arrives line and its fee
  const feeCls = `zf-small${price.stale ? " wl-swap2--stale" : ""}`;
  const sub = swapSub({ short, back, arrives: route && !block ? arrivesWith(route, get!, amount, priceOf(get!, status, tokens), price.cost) : null, part: nothing ? SWAP_WORDS.none : pay?.part ?? null });
  const list = (which: "pay" | "get") => (
    <CoinPicker bridge={bridge} title={which === "pay" ? SWAP_WORDS.pay : SWAP_WORDS.get} start={(which === "pay" ? payPick : getPick ?? payPick)?.chain ?? (PLACE_CHAIN[pay?.place ?? "near"] ?? "near")}
      places={which === "pay" ? [...placeRows("pay"), ...sites] : placeRows("get")} {...(which === "pay" ? { nearHeld } : {})} search={which === "get"} why={coinWhy(which)} onPick={(c) => picked(which, c)} onClose={() => setPicking(null)} />
  );

  // Swap again (a refund's next tap): this sheet, with the coins it had
  if (track) return <LiveTracker track={track} onClose={() => onDone("")} onNext={() => setTrack(null)} />;
  if (sitePay) return <SiteBackSheet wallet={sitePay.id} name={sitePay.name} safeUsd={null} onBack={() => setSitePay(null)} onClose={onClose} onDone={(l) => onDone(l)} />;
  // the picker is its own full-screen sheet over Swap's (D135, sheet-stack.ts): its Close comes back here
  return (<>
    <MoneySheet title={SWAP_WORDS.title} away={made === null && busy && (route?.kind === "topup" || route?.kind === "safe")} onClose={made !== null ? finish : onClose}>
      {/* the job is made: the same sheet becomes the receipt, away ("Job created."), until the person closes it (test, 5 Nov:
          a sheet of its own slid in again from the bottom) */}
      {made !== null ? <JobReceipt amount={made} icon={<ActSwap />} testid="swap-made" etaSec={route ? routeSec(route) : undefined} said={madeSaid?.going} landedSaid={madeSaid?.landed} paidLine={paidLine} job={madeJob} onDone={finish} /> : coinTrade && payPick && getPick ? ("kind" in coinTrade && coinTrade.kind === "trade" ? (
        <CoinSwap bridge={bridge} tasks={tasks} pay={payPick} get={getPick} chain={coinTrade.chain} payAddress={coinTrade.pay} getAddress={coinTrade.get}
          most={coinPay ? coinPay.heldUsd ?? 0 : pay?.most ?? 0} onPickPay={() => setPicking("pay")} onPickGet={() => setPicking("get")} onTrack={setTrack} />
      ) : "kind" in coinTrade && coinTrade.kind === "inplace" ? (
        <InplaceSwap bridge={bridge} tasks={tasks} pay={payPick} get={getPick} route={coinTrade} {...(coinTrade.side === "sell" && paying && "held" in paying ? { held: (paying as PickCoin & { held: InplaceHeld }).held } : {})}
          {...(coinTrade.side === "buy" && cash ? { cashRaw: cash.raw } : {})}
          most={coinTrade.side === "sell" ? paying?.heldUsd ?? 0 : cash ? cash.usd : pays.find((p) => p.place === "near")?.usd ?? 0} onPickPay={() => setPicking("pay")} onPickGet={() => setPicking("get")} onTrack={setTrack} />
      ) : (
        <>
          <button className="wl-swap-pick" onClick={() => setPicking("pay")} aria-label={`${SWAP_WORDS.pay}: ${payPick.symbol}`}><span className="zf-small">{SWAP_WORDS.pay}</span><span className="zf-body wl-sw-name">{payPick.symbol}</span></button>
          <button className="wl-swap-pick" onClick={() => setPicking("get")} aria-label={`${SWAP_WORDS.get}: ${getPick.symbol}`}><span className="zf-small">{SWAP_WORDS.get}</span><span className="zf-body wl-sw-name">{getPick.symbol}</span></button>
          <p className="zf-small wl-mv-why" role="status" data-testid="swap-why">{"why" in coinTrade ? coinTrade.why : ""}</p>
        </>
      )) : !pay ? (
        <>
          <SheetLine text={line ?? services.line ?? slowLine ?? null} />
          <p className="zf-body wl-sheet-lead" role="status">{balances === null ? "Reading your money…" : SWAP_WORDS.nothing}</p>
          <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          {/* the UI reviewer's ruling (6 Nov), Send's shape (a16): the first frame shows everything, no scroll. The card, the
              dollars, the chips, ONE sub-line slot and the keypad share a box whose keypad gives (56 pt rows down to 30); the
              floor under it is its own box, so it can never cover a key, and nothing sits under the button */}
          <div className="wl-swap2">
            <div className="wl-swap2__scroll">
              <div className="wl-swap2__card">
                <button className="wl-swap-pick" onClick={() => setPicking("pay")} aria-label={`${SWAP_WORDS.pay}: ${SWAP_COIN[pay.place].label} · ${payer?.where ?? SWAP_COIN[pay.place].where}`} data-testid="swap-payer">
                  <span className="zf-small">{SWAP_WORDS.pay}</span><CoinIcon symbol={SWAP_COIN[pay.place].symbol} icon={SWAP_COIN[pay.place].icon} size={28} />
                  {/* R3 (the design review §4.4): the coin over where it sits, two lines, never wrapped mid-phrase */}
                  <span className="zf-body wl-sw-name">{SWAP_COIN[pay.place].label}<span className="zf-small wl-sw-where">{payer?.where ?? SWAP_COIN[pay.place].where}</span></span>
                  {payer?.usd !== null && <span className="zf-small">{dollars((payer?.usd ?? pay.usd).toFixed(2))}</span>}<svg className="wl-sw-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
                </button>
                <button className="wl-swap-pick" onClick={() => setPicking("get")} aria-label={`${SWAP_WORDS.get}: ${get ? name(get) : SWAP_WORDS.pick}`}>
                  <span className="zf-small">{SWAP_WORDS.get}</span>
                  {get ? <><CoinIcon symbol={SWAP_COIN[get].symbol} icon={SWAP_COIN[get].icon} size={28} /><span className="zf-body wl-sw-name">{SWAP_COIN[get].label}<span className="zf-small wl-sw-where">{SWAP_COIN[get].where}</span></span></> : <span className="zf-body">{SWAP_WORDS.pick}</span>}
                  <svg className="wl-sw-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
                </button>
              </div>
              <div className="wl-swap-amount" style={{ ["--w" as string]: `${Math.max(1, (usd || "0").length) + 0.3}ch` }}>
                <MoneyAmount usd={usd} onUsd={onUsd} label={`Dollars of ${SWAP_COIN[pay.place].label} to swap`} />
              </div>
              {/* the design review §4.4, the Buy pattern: chips then the keypad, no range slider; Max is the most it can swap */}
              <div className="wl-swap-chips" role="group" aria-label={`Amount, up to $${most.toFixed(2)}`}>
                {["10", "25", "50"].map((d) => <button key={d} type="button" className="zf-chip" onClick={() => { setPreset(true); onUsd(d); }} disabled={Number(d) > most || Number(d) < floor.usd}>{`$${d}`}</button>)}
                <button type="button" className="zf-chip wl-swap-all" onClick={() => { setPreset(true); onUsd(most.toFixed(2)); }} disabled={most < floor.usd} aria-label={`Max, $${most.toFixed(2)}`}>{SWAP_WORDS.max}</button>
              </div>
              {/* the one sub-line slot: its height is kept, so a line coming or going moves nothing */}
              <div className="wl-swap2__sub" data-testid="swap-sub">{sub && <p className={`zf-small${price.stale && sub.id === "swap-arrives" ? " wl-swap2--stale" : ""}`} data-testid={sub.id}>{sub.text}{sub.id === "swap-short" && <> <button type="button" className="zf-link" onClick={() => { onClose(); shell.openApp("wallet", "private/add"); }} data-testid="swap-top-up">{TOP_UP_PRIVATE}</button></>}</p>}</div>
              <Keypad value={padBase(usd || "0", preset)} decimals={2} onChange={(v) => { setPreset(false); onUsd(v === "0" ? "" : v); }} />
            </div>
            <div className="wl-swap2__floor">
              {/* line 1, one slot: a refusal in its place while it stands, else the privacy line with its link at the end */}
              <div className="wl-swap2__line" data-testid="swap-line">
                {on.line === "stopped" && <p className="zf-small" role="alert" data-testid="swap-stopped">{refused}</p>}
                {on.line === "why" && <p className="zf-small" role="status" data-testid="swap-why">{block}</p>}
                {on.line === "said" && <SheetLine text={said} />}
                {on.line === "price" && <p className="zf-small" role="status" data-testid="swap-price-late">{price.late ? SWAP_PRICE_LATE : price.said}</p>}
                {on.line === "stays" && <p className="zf-small">{stays && <span data-testid="swap-stays">{stays} </span>}{privateLine(route) && <button type="button" className="zf-link wl-swap2__who" onClick={() => setWho(true)} data-testid="swap-who">{MOVE_WORDS.who}</button>}</p>}
              </div>
              {/* line 2, the fee block, right above the button (the copy review, 6 Nov); a refusal never takes its place */}
              {route && (
                <div className="zf-fee">
                  {price.waiting ? <p className="zf-small" role="status" data-testid="swap-price-wait">{quoteWaitLine(price.waitedMs)}</p> : price.figure && <p className={feeCls} data-testid="swap-fee">{price.figure}</p>}
                  <p className="zf-small" data-testid="swap-paid">{price.paid}</p>
                </div>
              )}
              {/* the tap IS the swap (product decision, 5 Nov: no hold, no confirm); the Safe's routes still ask Face ID on its own
                  sheet. One button: after a refusal it reads Try again and asks again; never a second grey one */}
              <button type="button" className={`zf-btn wl-sheet-go${on.tap === "swap" && block === SWAP_WORDS.amount ? " is-idle" : ""}`} data-testid="swap-go" disabled={busy || (on.tap === "swap" && (nothing || !!short || services.down || (!!block && block !== SWAP_WORDS.amount)))}
                onClick={(e) => { if (on.tap === "price") return price.again(); if (on.tap === "swap" && block === SWAP_WORDS.amount) return setTried(true); tapBurst(e.currentTarget, () => void bridge.call("device.haptic", { kind: "tap" }).catch(() => undefined)); void go(); }}>{on.label}</button>
            </div>
          </div>
        </>
      )}
    </MoneySheet>
    {picking && list(picking)}
    {who && <MoneySheet title={MOVE_WORDS.who} onClose={() => setWho(false)}><p className="zf-body wl-sheet-lead" data-testid="swap-private">{privateLine(route)}</p></MoneySheet>}
  </>);
}

/** Said only when the relay says 1Click didn't answer, or after QUOTE_WAIT_MS (20 s, as long as the relay waits for it),
 *  with Try again; the floor still shows. Until then the sheet counts the seconds ("Getting a price… 0:07"). */
export const SWAP_PRICE_LATE = "NEAR Intents didn't answer.";
/**
 * What the swap really brings and costs (core subwallet.float.swapCost: 1Click's dry quotes, nothing moves), asked 0.3 s
 * after the amount stops changing (copy review, 5 Nov: no fee-size line, so no second price at a bigger amount).
 * `waiting` (with `waitedMs`) while it is on its way; `late` when the relay said 1Click didn't
 * answer or QUOTE_WAIT_MS passed; `said` when it came back refused at once (its own words, never "didn't answer"). The
 * same price asked again within PRICE_KEPT_MS is the one kept.
 */
function useSwapPrice(bridge: Bridge, from: SwapPlace | null, to: SwapPlace | null, usd: number, off: boolean): { cost: SwapPrice | null; at: number; stale: boolean; figure: string | null; paid: string; late: boolean; said: string | null; waiting: boolean; waitedMs: number; again: () => void } {
  const [cost, setCost] = useState<SwapPrice | null>(null);
  // M5 (the audit's audit): when the price shown came, and whether it is past its life with nothing newer (greyed)
  const [at, setAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [late, setLate] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [tries, setTries] = useState(0);
  const waitedMs = useElapsed(waiting);
  useEffect(() => {
    setCost(null); setLate(false); setSaid(null); setWaiting(false); setStale(false);
    if (off || !from || !to || !(usd >= SWAP_MIN_USD)) return;
    let live = true;
    const call = (u: number): Promise<BridgeResult<SwapPrice>> => {
      const key = JSON.stringify(["swap", from, to, u.toFixed(2)]);
      const had = keptPrice<SwapPrice>(bridge, key);
      if (had) return Promise.resolve({ ok: had });
      return bridge.call<SwapPrice>("subwallet.float.swapCost", { from, to, usd: u.toFixed(2) }).then((r) => {
        if ("ok" in r && Number.isFinite(r.ok.feeUsd) && Number.isFinite(r.ok.arrivesUsd)) keepPrice(bridge, key, r.ok);
        return r;
      });
    };
    const good = (r: BridgeResult<SwapPrice> | null): SwapPrice | null => (r && "ok" in r && Number.isFinite(r.ok.feeUsd) && Number.isFinite(r.ok.arrivesUsd) ? r.ok : null);
    let slow: ReturnType<typeof setTimeout> | undefined;
    let fresh = () => {};
    // asked again while the sheet sits (never the kept copy: that one is the price going stale)
    const ask = (): Promise<SwapPrice | null> => bridge.call<SwapPrice>("subwallet.float.swapCost", { from, to, usd: usd.toFixed(2) }).then((r) => {
      const c = good(r);
      if (c) keepPrice(bridge, JSON.stringify(["swap", from, to, usd.toFixed(2)]), c);
      return c;
    });
    const t = setTimeout(() => {
      setWaiting(true);
      slow = setTimeout(() => { if (live) { setWaiting(false); setLate(true); } }, QUOTE_WAIT_MS);
      void call(usd).then((r) => r, () => null).then((r) => {
        clearTimeout(slow);
        if (!live) return;
        setWaiting(false);
        const c = good(r);
        setCost(c);
        if (c) { setAt(Date.now()); fresh = keepFresh({ ask, got: (n) => { setCost(n); setAt(Date.now()); setStale(false); }, stale: () => setStale(true) }); }
        // no price: the relay's own "didn't answer" (a service named) is late; anything else came back at once, refused
        const p = r && "problem" in r ? r.problem : null;
        setLate(!c && (!p || !!serviceOf(p)));
        setSaid(!c && p && !serviceOf(p) ? (p.more && p.more.length <= 140 ? p.more : p.whatHappened) : null);
      });
    }, 300);
    return () => { live = false; clearTimeout(t); clearTimeout(slow); fresh(); };
  }, [bridge, from, to, usd, off, tries]);
  return { cost, at, stale, figure: feesLine(cost), paid: paidLine(cost), late, said, waiting, waitedMs, again: () => setTries((n) => n + 1) };
}
