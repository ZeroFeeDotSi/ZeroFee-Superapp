// Home's Send form (the Home plan §1.3, bug 9, D124, D128), top to bottom so the phone's keyboard never covers a
// choice: From (ONE small dropdown: each wallet's coin and, once its route is open, the Safe's coins, balance shown) →
// To (paste any address or NEAR name, or Scan; its network read from its shape; the address short in the field once read, and
// "New address" the first time) → "Which network?" only when a 0x address could be on several → the amount in dollars
// (a slider over what the coin can send, Max) → one line, how it goes and what it lands as → Hold to send. Every Send
// goes privately through NEAR: there is no Hidden / Plain choice. Every control that is off says why, in one line.
import { SEND_EMPTY } from "./dead-ends.ts";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { padBase } from "@zerofee/design/keypad.ts";
import { SheetLine } from "@zerofee/design/MoneySheet.tsx";
import { intentsKept } from "@zerofee/core/zero-fee";
import { FIRST_PAYMENT, SEND_CANT, shortId, feeLines } from "./send-words.ts";
import { TAP_ADDRESS, TAP_AGAIN, TAP_PASTE, refusedLine, sendFloor } from "./send-said.ts";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SheetNote } from "@zerofee/design/Sheet.tsx";
import { filledAddressLine, toSlotLine } from "@zerofee/shell-api/money.ts";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { round } from "@zerofee/pay/amount";
import { chainName, isNamedNearAccount } from "@zerofee/pay/chains";
import { findRecipient, type Recipient } from "@zerofee/pay/send";
import { isUsdStable } from "@zerofee/pay/tokens";
import { usePay } from "@zerofee/pay/app/runtime.tsx";
import { TrayScan } from "@zerofee/pay/app/icons.tsx";
import type { Prefill } from "@zerofee/pay/app/links.ts";
import { LANDS_AS, nearLandsAs, RELAY_LIMIT_LINE, RELAY_SEND_MAX_USD, type SendToChain } from "../../send-to.ts";
import { EXCHANGE_LINE, blockedLine, nearImplicitOf, LOOKALIKE_LINE, NO_TYPO_CHECK, noTypoCheck, cantSendTo, withNear, knownAddress, lookalikeOf, paidOn, routeLines, sendNetworks, startNetwork, type Paid } from "../../send-reach.ts";
import { REST_STAYS, coinShown, partShown, heldWords, overLine, overMax, privateCap, privateOver, readyUsd, restStays, sendFigure, underAmount, restLine, type RestParts } from "./send-cap.ts";
import { lookupDelayMs } from "./send-lookup.ts";
import { SEND_ROWS, type SendRowChain } from "./send-rows.ts";
import { maxSendLine, rentLine } from "./send-sources.ts";
import { TOP_UP_PRIVATE, fillShutLine } from "./send-cap.ts";
import "./send.css";

/** One place a Send can come from: a wallet (its own coin on its chain) or a coin in the Safe. `max`: what it can send. */
export interface SendSource {
  id: string;
  row: SendRowChain | null;
  tokenId: string;
  /** The dropdown's words: "SOL · your SOL wallet", "ETH (RH) · your ETH (RH) wallet", "USDC · your Safe". */
  label: string;
  /** Where it is, for the amount line: "your SOL wallet", "your Safe". */
  place: string;
  symbol: string;
  icon?: string;
  chain: string;
  amount: string;
  usd?: string;
  max: string;
  /** A Safe coin: what of it sits in the private balance (paid from there first). */
  pocket?: string;
  /** A wallet's token (not its own coin), by 1Click's id: it goes into NEAR Confidential as itself (core hidden-coins.ts). */
  coin?: string;
  /** Listed, but it can't go now: the one reason, said where Hold would be (D125: never a broken option). */
  cant?: string;
  /** Its way on: Swap it to this wallet's own coin first ("Swap to SOL and send"). */
  swap?: SendRowChain;
  /** A site's own wallet: its way on is Move back (the money sheet's siteback), and its row says its dollars alone. */
  back?: { wallet: string; name: string };
  line?: string;
  /** A Safe coin this Send can pay only part of: the one quiet line under Max saying why (send-words.ts SEND_PART). */
  part?: string;
  /** J2-5 (audit, 8 Nov): a Safe coin whose ready figure is under Home's, where the rest is, in dollars, by its real place
   *  (send-sources.ts restOf): said in the From list under the coin's line (send-cap.ts restLine). */
  rest?: RestParts;
  /** the copy review's ruling (5 Nov): a Safe coin this Send pays only from Private (its Safe's own route shut). Its row carries its
   *  figure (`line`: "NEAR · $8.85 in Private"), the keypad caps at it, and one line shows only when the typed amount was
   *  over it (send-cap.ts privateOver). No standing line. */
  privateOnly?: true;
}

/** What the person asked, as the sheet sends it. `exactOut`: a request or a link that names its coin and amount (H-4). */
export interface SendAsk {
  source: SendSource;
  recipient: Recipient;
  network: SendToChain;
  contactId?: string;
  amountIn: string;
  usd: number | null;
  exactOut?: { tokenId: string; amount: string; symbol: string };
  note?: string;
  ref?: string;
}

/** A paste's checks (the amount read, never guessed; the person's own addresses), loaded when Send opens, never in Home's
 *  first load; a paste before they are here waits for them. */
type Checks = typeof import("@zerofee/design/read-amount.ts") & typeof import("./send-own.ts");
let checks: Checks | undefined;
const loadChecks = (): Promise<Checks> => Promise.all([import("@zerofee/design/read-amount.ts"), import("./send-own.ts")]).then(([a, o]) => (checks = { ...a, ...o }));
const withChecks = (f: (c: Checks) => void) => (checks ? f(checks) : void loadChecks().then(f, () => undefined));

/** The slider's steps: fine enough for cents on most balances, never more than the coin can send. */
const STEPS = 1000;
const dollarsOf = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A balance in the dropdown: "1.42 SOL · $201.00"; a Safe coin "$8.85 ready to send" (S3, send-cap.ts heldWords); a
 *  site's wallet its own line (siteSources). */
const held = (s: SendSource) => s.line ?? heldWords(s);

export function SendForm({ prefill, typed: filled, sources, reading = false, history, busy, waits, notYet = null, blocked = null, said = null, again = null, onEdit, onSend, onWho, onScan, onLink, onAddMoney, onMove, fillShut, onSwap, onBack, feeOf, start = null, ownWallets, pickCoin = 0 }: {
  prefill: Prefill | null;
  sources: SendSource[];
  /** The wallets or the Safe haven't answered yet: no source is "reading", never "Nothing to send yet"; "failed": the
   *  wallets' read didn't answer, said so (never a "reading" that can't end). */
  reading?: boolean | "failed";
  /** Addresses and names this person has paid or saved (Activity, contacts): "New address", and the look-alike stop. */
  history: readonly Paid[];
  busy: boolean;
  /** The sheet's own reason the Send can't go now (a service down on two sources, offline): the sheet says it in its line, over this form, and Hold is off. */
  waits: string | null;
  /** Why Hold isn't on yet while the sheet itself gets ready (its safety check still loading, or failed): said under Hold. */
  notYet?: string | null;
  /** The guard's block for who To reads as, known before any tap (judge, when To is read): said in the line above Send
   *  in rule 8's three parts, and Send stays off until To changes (row 1; the audit's MUST on 214497408). */
  blocked?: string | null;
  /** The sheet's own line (a refusal, a problem, a service down): right above Hold, the one place every sheet uses
   *  (a Send test, 4 Nov: it sat at the top, away from the button). */
  said?: string | null;
  /** `said` is a refusal that can be tried again: the button's words while it stands (sendFloor). */
  again?: string | null;
  /** The amount, the coin or the network changed: the sheet's refusal ends (the To's change ends it through onWho). */
  onEdit?: () => void;
  onSend: (a: SendAsk) => void;
  /** Who To now reads as (null: nobody yet), as soon as it is read: the sheet asks the guard's facts then. */
  onWho?: (r: Recipient | null) => void;
  onScan?: () => void;
  onLink?: (text: string) => void;
  onAddMoney: () => void;
  /** The Safe holds money but no wallet does (sending straight from the Safe isn't open yet): Move it to a wallet. */
  onMove?: () => void;
  /** the fill shut (copy review, 5 Nov): Private's one figure for the From card's sub-line, and its "Top up Private" (opens the fill) */
  fillShut?: { usd: string | null; onTopUp: () => void };
  /** A coin Hidden can't take: Swap it to its wallet's own coin, then send. */
  onSwap?: (s: SendSource) => void;
  onBack?: (s: SendSource) => void;
  /** The fee before the tap (a wallet's Send): 1Click's two dry quotes, asked as the address and amount settle. */
  feeOf?: (a: SendAsk) => Promise<{ inUsd: string; outUsd: string } | null>;
  /** Bumped by the sheet to open the coin picker (sendCoinUnknown's "Pick a coin", the audit's ruling, 5 Nov); 0: never. */
  pickCoin?: number;
  /** The source the dropdown opens on (Home's wallet preset: Send from a wallet's own page); the first when absent. */
  start?: string | null;
  /** Filled in by the app that opened Send (MoneyAsk prefill), read once: the address or name exactly as if typed (its
   *  lookup, grouped address, "New address" and look-alike stop all run), the dollars once the coin's price is known, the
   *  note. It only fills in: Hold and the core's Face ID still ask. */
  typed?: { to?: string; chain?: string; usd?: string; note?: string; /** `to` is AgentZero's (MoneyAsk agentFilled) */ agentFilled?: true };
  /** The person's own wallets (address lowercased → "SOL wallet"): pasted, To says so at once (Move's job, not Send's). */
  ownWallets?: ReadonlyMap<string, string>;
}) {
  const { bridge, contacts, self, flow } = usePay();
  const tokens = flow.tokens;
  const [sourceId, setSourceId] = useState<string | null>(null);
  const source = sources.find((s) => s.id === sourceId) ?? sources.find((s) => s.id === start) ?? sources[0];
  const [open, setOpen] = useState(false);
  useEffect(() => { if (pickCoin > 0) setOpen(true); }, [pickCoin]);
  const [text, setText] = useState(filled?.to ?? "");
  // W7: the shell's own note (the agent app opened this Send), only while the address is still the one it filled in
  const agentLine = filledAddressLine(useContext(SheetNote), filled?.to, text, filled?.agentFilled === true);
  // a16 (Sim re-walk, 5 Nov): once To is read, the field itself shows the address short (six and six, shortId), never its
  // scrolled tail; a tap in the field shows the whole of it, to read or change
  const [editing, setEditing] = useState(false);
  const [who, setWho] = useState<{ recipient: Recipient; contactId?: string } | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [picked, setPicked] = useState<SendToChain | null>(null);
  const [amount, setAmount] = useState("0");
  const [typed, setTyped] = useState<string | null>(null);
  // Finding 37: an amount the person didn't type key by key (a chip, Max, one it was opened with) is typed over by the
  // first key ($25 then 1 is $1, not $251)
  const [preset, setPreset] = useState(false);
  const [exact, setExact] = useState<SendAsk["exactOut"] | null>(null);
  // a pasted or typed amount that is never guessed ("1e5", "1,500", 50 digits): said under it, Hold off, the last good one kept
  const [amountNo, setAmountNo] = useState<string | null>(null);
  // the copy review's ruling: Send from Private, the typed amount was over what Private holds and the keypad capped it there
  const [capped, setCapped] = useState(false);
  useEffect(() => { void loadChecks().catch(() => undefined); }, []);

  const stable = !!source && isUsdStable(source.symbol);
  const places = stable ? 2 : 9;
  const perCoin = !source ? null : stable ? 1 : Number(source.usd) > 0 && Number(source.amount) > 0 ? Number(source.usd) / Number(source.amount) : null;
  const max = source?.max ?? "0";
  // Max keeps the grid's gap (privacy audit, 4 Nov): the sheet says exactly what goes to them, and where the rest stays
  const rent = source ? rentLine(source, sources) : null;
  const maxLine = source ? maxSendLine(source, amount, source.row && !source.coin ? SEND_ROWS[source.row].decimals : tokens?.byAsset(source.tokenId === "near" ? "nep141:wrap.near" : source.tokenId)?.decimals) : null;

  // the network: the only one, the one the coin comes from, or the person's pick (never a guess between 0x networks)
  // row 1: a lower-case 0x address that is also an open NEAR account (NEP-518, "ETH-style implicit") can be paid on
  // NEAR too: NEAR is one more network to pick, only once NEAR says the account exists (never a guess)
  const [onNear, setOnNear] = useState<string | null>(null);
  const networks = useMemo(() => (who ? withNear(sendNetworks(who.recipient), who.recipient, onNear) : []), [who, onNear]);
  // M1: the only network, or the one this address was paid on before; a NEW 0x address starts on none (the person picks)
  const network: SendToChain | null = picked && networks.includes(picked) ? picked : startNetwork(networks, who ? paidOn(who.recipient.kind === "address" ? who.recipient.address : who.recipient.accountId, history) : null);
  // the copy review's J2-3 (8 Nov): the chosen network chip is shown whole, never under the row's right-edge fade ("Base" was)
  const netsRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => { netsRow.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ inline: "nearest", block: "nearest" }); }, [network, networks.length]);

  // The source changed under the amount (a wallet's row read after the Safe's coins, or its price came): dollars that were
  // typed stay those dollars in this coin (UI's mainnet rehearsal, 3 Nov: $0.50 filled in while the Safe's USDC was the
  // first source became 0.5 SOL once the SOL wallet's row came, capped to its whole balance, "Hold to send $4.52"). An
  // amount not typed in dollars (Max, the slider) comes down to what this source can send.
  useEffect(() => {
    if (!source) return;
    if (typed !== null && perCoin !== null) return type(typed);
    if (typed === null && Number(amount) > Number(max)) {
      setAmount(max);
      setTyped(null);
    }
  }, [source?.id, max, perCoin]);

  const setCoins = (coins: string) => {
    setExact(null);
    setCapped(false);
    setAmount(Number(coins) > Number(max) ? max : coins);
  };
  /** The number typed, in dollars when the coin has a price, kept as typed (finding 64: more than the coin can send is
   *  said by the line under it and Hold stays off; it never turns into the whole balance). */
  const type = (v: string) => {
    setAmountNo(null);
    const clean = v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setTyped(clean);
    setCapped(false);
    if (!source) return;
    const coins = perCoin && !stable ? (Number(clean || "0") / perCoin).toFixed(places) : clean || "0";
    setExact(null);
    // Send from Private (the copy review's ruling): the keypad caps at what Private holds of the coin; the line says so, once
    const cap = source.privateOnly ? privateCap(round(coins, places, "down"), source.max, perCoin, stable) : null;
    if (cap) { setTyped(cap.typed); setAmount(cap.amount); setCapped(true); return; }
    setAmount(round(coins, places, "down"));
  };
  // a paste (or a key on a computer) is read as the keypad would have it, never guessed (readAmount)
  const paste = (v: string) => withChecks(({ readAmount, refusedLine }) => { const r = readAmount(v, 9, perCoin !== null && !stable ? 2 : places); if ("no" in r) setAmountNo(refusedLine(r.no, v)); else type(r.ok); });
  const slide = (v: number) => {
    setTyped(null);
    setCoins(v >= STEPS ? max : round(((Number(max) * v) / STEPS).toFixed(places), places, "down"));
  };
  // the dollars it was opened with, typed once the coin's price is here (never read as coins before it)
  const usdFilled = useRef(false);
  useEffect(() => {
    if (!filled?.usd || usdFilled.current || !source || perCoin === null) return;
    usdFilled.current = true;
    setPreset(true);
    type(filled.usd);
  }, [perCoin, source?.id]);
  // the network it was opened with (chain: "hood"), picked once the address is read, and only where that address can go;
  // the choice stays on screen, and the address's own checks (New address, the look-alike stop) run as for any other
  const chainFilled = useRef(false);
  useEffect(() => {
    if (!filled?.chain || chainFilled.current || !who) return;
    chainFilled.current = true;
    if ((networks as string[]).includes(filled.chain)) setPicked(filled.chain as SendToChain);
  }, [who]);
  const at = Number(max) > 0 ? Math.min(STEPS, Math.round((Number(amount) / Number(max)) * STEPS)) : 0;
  const usd = exact ? (() => { const t = tokens?.byAsset(exact.tokenId); return t?.priceUsd ? Number(exact.amount) * Number(t.priceUsd) : null; })() : perCoin !== null ? Number(amount) * perCoin : null;

  // the address, read as it is typed: its network from its own shape (D111: any chain, never only a NEAR name)
  const seq = useRef(0);
  const lastText = useRef("");
  useEffect(() => {
    const t = text.trim();
    // a paste is read at once; typing waits for a pause (send-lookup.ts)
    const wait = lookupDelayMs(lastText.current, text);
    lastText.current = text;
    // first, before any return: a lookup still on its way can never set who for text that changed (review M)
    const n = ++seq.current;
    if (prefill && who && (who.recipient.kind === "address" ? who.recipient.address : who.recipient.accountId) === t) return;
    setWho(null);
    setLine(null);
    setPicked(null);
    if (t.length < 3) return;
    // H-4: a ZeroFee link (a request, a send) pasted here fills Send in (shown, editable), the same as opening it
    if (onLink && /^zerofee:/i.test(t)) return onLink(t);
    const look = () => {
      // the person's own wallet, Safe or Add address: said as theirs, before its shape is checked (a Sim sample fails it)
      const mine = checks?.ownLine(t, { wallets: ownWallets ?? new Map(), addEnds: checks.keptAddEnds(checks.addCardStore()), self: self ?? undefined });
      if (mine) return setLine(mine);
      void findRecipient(bridge, t, { contacts: contacts ?? undefined, self: self ?? undefined }).then((r) => {
        if (n !== seq.current) return;
        if ("problem" in r) return setLine(refusedLine(r.problem.whatHappened, source?.place ?? "the wallet you send from", TAP_PASTE));
        const no = cantSendTo(r.ok.recipient, chainName);
        if (no) return setLine(refusedLine(no, source?.place ?? "the wallet you send from", TAP_ADDRESS));
        setWho({ recipient: r.ok.recipient, ...(r.ok.contactId ? { contactId: r.ok.contactId } : {}) });
        // a NEAR name is checked on NEAR; anything else is read here, so only a name's lookup is NEAR's (bug 8, SendForm:100)
      }, () => n === seq.current && setLine(isNamedNearAccount(t.toLowerCase()) ? refusedLine("NEAR didn't answer", source?.place ?? "the wallet you send from", TAP_AGAIN) : refusedLine("That address can't be read", source?.place ?? "the wallet you send from", TAP_PASTE)));
    };
    if (wait === 0) return look();
    const timer = setTimeout(look, wait);
    return () => clearTimeout(timer);
  }, [text, bridge]);

  useEffect(() => { onWho?.(who?.recipient ?? null); }, [who]);
  useEffect(() => {
    // the audit's SHOULD: a mixed-case 0x is checked against its EIP-55 checksum BEFORE it is lowercased for NEP-518
    const a = who?.recipient.kind === "address" ? nearImplicitOf(who.recipient.address) : null;
    if (!a) return;
    let live = true;
    void bridge.call<{ exists: boolean }>("ledger.recipientInfo", { accountId: a }).then((r) => live && "ok" in r && r.ok.exists && setOnNear(a), () => undefined);
    return () => { live = false; };
  }, [who, bridge]);

  // A link (Chat's pay) or a scanned code (each scan on a fresh form): the address, its network and, when it names one,
  // the coin and amount it asks for, exactly (H-4). Declared AFTER the address effect: on a fresh form both run at mount,
  // and the code's recipient must be the last word, never a fresh lookup of the bare address (walk, 3 Nov).
  useEffect(() => {
    if (!prefill) return;
    const r = prefill.recipient;
    setText(r.kind === "address" ? r.address : r.accountId);
    const no = cantSendTo(r, chainName);
    if (no) return setLine(refusedLine(no, source?.place ?? "the wallet you send from", TAP_ADDRESS));
    setWho({ recipient: r });
    const ask = prefill.request;
    const tokenId = ask?.tokenId ?? prefill.tokenId;
    const coin = tokenId ? tokens?.byAsset(tokenId) : undefined;
    const wanted = ask?.amount ?? prefill.amount;
    const nets = sendNetworks(r);
    // the exact coin and amount only where it can land as asked: that coin, on a network this Send reaches
    if (coin && wanted && Number(wanted) > 0 && (nets as string[]).includes(coin.chain)) {
      setPicked(coin.chain as SendToChain);
      setExact({ tokenId: coin.assetId, amount: wanted, symbol: coin.symbol });
    } else if (ask?.usd && perCoin) { setPreset(true); type(ask.usd); }
  }, [prefill, sources.length > 0]);

  const target = who ? (who.recipient.kind === "address" ? who.recipient.address : who.recipient.accountId) : "";
  const lookalike = who ? lookalikeOf(target, history) : null;
  const isNew = !!who && !knownAddress(target, history);
  const coinAmount = exact ? null : Number(amount);
  const over = !exact && overMax(amount, max);
  // S3: the same figure the From row says ("$8.85 ready to send"), one function for both
  const readyNow = readyUsd(max, perCoin);
  const most = readyNow !== null ? dollarsOf(readyNow) :`${coinShown(max, "down")} ${source?.symbol ?? ""}`;
  // S1: over what can go, the slot under the amount says nothing worked from it (send-cap.ts underAmount)
  const under = underAmount({ over, exact: exact ?? null, amount, symbol: source?.symbol ?? "", place: source?.place ?? "", maxLine });
  // why Hold is off, the first that applies (every disabled control says why)
  const why = !source ? null
    : source.cant ? source.cant
    : notYet ? notYet
    // the guard's block, known when To is read (row 1): before any tap, Send off until To changes
    : blocked ? blockedLine(blocked, source.place)
    : waits ? waits
    : amountNo ? amountNo
    : over ? overLine(source.place, most, Number(max) > 0)
    : !who ? (line ? null : "Paste an address or a name.")
    : lookalike ? LOOKALIKE_LINE
    : !network ? "Pick the network first."
    : exact ? (usd !== null && usd > RELAY_SEND_MAX_USD ? RELAY_LIMIT_LINE : null)
    : !(coinAmount! > 0) ? "Pick how much."
    : usd !== null && usd > RELAY_SEND_MAX_USD ? RELAY_LIMIT_LINE
    : null;
  const ready = !!source && !!who && !!network && !why && !waits && !busy && (!!exact || Number(amount) > 0);
  // one figure for the flow (test, MUST 1: "$6.85" over "Send $6.86"): the keypad's dollars and the button's are the
  // same cent figure (core cents.ts), the typed one when there is one, else the worked one rounded once
  const figure = sendFigure({ typed, exact: !!exact, usd });
  const shown = typed ?? (exact ? (figure ?? exact.amount) : perCoin !== null && !stable ? (Number(amount) > 0 ? figure ?? "" : "") : amount === "0" ? "" : amount);
  // product decision (5 Nov): no hold, no confirm: the tap IS the action; to an outside address the core's own
  // sheet asks Face ID (the web: the password) with the address and the fee, to the person's own wallet it just goes
  const label = exact ? `Send ${exact.amount} ${exact.symbol}` : `Send${Number(amount) > 0 ? ` ${figure !== null ? dollarsOf(Number(figure)) : `${amount} ${source?.symbol ?? ""}`}` : ""}`;
  const floor = sendFloor({ label, again, said, why: why ?? null, ready });
  // any edit ends the sheet's refusal, before it paints; never a read that settles (the sources loading must not end a link's line) (Swap's `edited`): keypad, chips, Max, a paste, a coin, a network
  const editKey = JSON.stringify([sourceId, picked, amount, typed, exact]);
  const lastEdit = useRef(editKey);
  useLayoutEffect(() => { if (lastEdit.current !== editKey) { lastEdit.current = editKey; onEdit?.(); } }, [editKey]);
  // the fee before the tap (QA, 5 Nov: "the real figure, up front"): asked 400 ms after the address and the
  // amount settle, shown once it lands; never blocks the tap (not back yet: the core's own sheet says it)
  const feeKey = source?.row && !source.cant && who && network && !exact && Number(amount) > 0 ? `${source.id}|${network}|${who.recipient.kind === "address" ? who.recipient.address : who.recipient.accountId}|${amount}` : null;
  const [fee, setFee] = useState<{ key: string; f: { inUsd: string; outUsd: string } | null } | null>(null);
  useEffect(() => {
    if (!feeKey || !feeOf || !source || !who || !network) return;
    let live = true;
    const t = setTimeout(() => {
      void feeOf({ source, recipient: who.recipient, network, amountIn: amount.replace(/\.$/, ""), usd }).then((f) => live && setFee({ key: feeKey, f }), () => undefined);
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [feeKey]);
  const feeNow = fee && fee.key === feeKey ? feeLines(fee.f) : null;
  const go = () => {
    if (!ready || !source || !who || !network) return;
    onSend({
      source, recipient: who.recipient, network, ...(who.contactId ? { contactId: who.contactId } : {}), amountIn: amount.replace(/\.$/, ""), usd,
      ...(exact ? { exactOut: exact } : {}), ...(prefill?.note ?? filled?.note ? { note: prefill?.note ?? filled?.note } : {}), ...(prefill?.ref ? { ref: prefill.ref } : {}),
    });
  };

  // the To field's short form: the address as read, long, and the field not being edited (a16); once an address is read
  // the field lets go of the focus (the keypad is the next step), so the short form shows at once after a paste
  const shortTo = who && !editing && target.length > 24 && text.trim() === target ? shortId(target) : null;
  const toField = useRef<HTMLInputElement>(null);
  useEffect(() => { if (who && target.length > 24 && typeof document !== "undefined" && document.activeElement === toField.current) toField.current?.blur(); }, [who]);
  if (!source) {
    // the grade (3 Nov, r-m02): "Nothing to send yet" under a $28.10 Safe. Money in the Safe: say where it is, offer Move
    return (
      <div className="wl-send2" data-testid="send-empty">
        {/* the sheet's line (a service down) first: this state's one button follows it */}
        {said && <SheetLine text={said} />}
        {reading
          ? <p className="zf-body" role={reading === "failed" ? "alert" : "status"} data-testid="send-reading">{reading === "failed" ? SEND_EMPTY.didntAnswer : SEND_EMPTY.reading}</p>
          : onMove
          ? <div className="wl-empty-wallet"><p className="wl-empty-wallet__line">{SEND_EMPTY.inSafe}</p><button className="zf-btn zf-btn--quiet wl-add-btn" onClick={onMove} data-testid="send-move">{SEND_EMPTY.move}</button></div>
          : <><p className="zf-body">{SEND_EMPTY.none}</p><button className="zf-btn" onClick={onAddMoney}>Add money</button></>}
      </div>
    );
  }
  return (
    <div className="wl-send2">
      {/* a16 (Sim re-walk, 5 Nov): the sheet is a column: the card, the amount, the chips, the one sub-line and the keypad
          scroll in their own box (the keypad's rows compress first, send.css); the floor under it (the line, the lit
          button, the fee line) is its own box, so the keypad can never run under the button */}
      <div className="wl-send2__scroll">
      {/* R3 (the design review §4.5, G1): From and To are two rows of ONE inset card, a hairline between them */}
      <div className="wl-send2__card">
      <div className="wl-send2__from">
        <span className="wl-send2__label">From</span>
        <button type="button" className="wl-pick zf-press" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="send-from" disabled={busy}>
          <CoinIcon symbol={source.symbol} icon={source.icon} size={22} />
          {/* "From your SOL wallet": the row reads as one phrase, its coin in the line under it; the list keeps the full
              words ("SOL · your SOL wallet"). Never cut: "ETH (RH) · your ETH (RH) …" was. */}
          <b>{source.place}</b>
          <span className="zf-small">{held(source)}</span>
          <svg className="wl-pick__chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
        </button>
        {/* the held figure is more than can go now (the audit's filing, 5 Nov): said directly under From, before any amount */}
        {partShown(source.part, held(source)) && <p className="zf-small wl-send2__part" data-testid="send-part">{source.part}</p>}
        {/* the fill shut (the copy review's ruling, 5 Nov): a Private-only row says public sends go through Private and what it holds,
            with the quiet link that opens the fill */}
        {fillShut && source.privateOnly && (
          <div className="wl-send2__part" data-testid="send-fill-shut">
            <p className="zf-small">{fillShutLine(fillShut.usd)}</p>
            <button type="button" className="zf-link" onClick={fillShut.onTopUp} data-testid="send-top-up">{TOP_UP_PRIVATE}</button>
          </div>
        )}
        {open && (
          <ul role="listbox" aria-label="Send from" className="wl-pick__list" data-testid="send-from-list">
            {sources.map((s) => (
              <li key={s.id} role="option" aria-selected={s.id === source.id}>
                <button type="button" className="wl-pick__opt" onClick={() => { setSourceId(s.id); setOpen(false); setTyped(null); setExact(null); setAmount("0"); setCapped(false); }}>
                  <CoinIcon symbol={s.symbol} icon={s.icon} size={22} />
                  <b>{s.label}</b>
                  <span className="zf-small">{held(s)}</span>
                  {/* J2-5: where the rest of Home's figure is, by place (a mute line, never on the From row) */}
                  {s.rest && restLine(s) && <span className="zf-small wl-pick__why" data-testid="send-rest">{restLine(s)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="py-field wl-send2__to">
        <span className="wl-send2__label">To</span>
        {/* the field's value is always the whole address (audit: nothing read or sent ever sees "…"); while it is not being
            edited a span over it shows the six-and-six form, and a tap on that puts the focus back in the field */}
        <input ref={toField} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} placeholder="Name or address" aria-label="Who to send to" className={shortTo ? "wl-send2__to-in--under" : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false} data-testid="send-to" />
        {shortTo && <span className="wl-send2__short" aria-hidden="true" title={text.trim()} onClick={() => toField.current?.focus()} data-testid="send-to-short">{shortTo}</span>}
        {onScan && <button type="button" className="zf-icon-btn" onClick={onScan} disabled={busy} aria-label="Scan a code"><TrayScan /></button>}
      </label>
      {/* the address as read, under the To row inside the same card (an address AgentZero filled in says so in the network
          line's slot, in the card under To: toSlotLine) */}
      {who && (isNew || network) && (
        <p className="wl-send2__addr" data-testid="send-where">
          {isNew && <span className="zf-small" data-testid="send-first">{FIRST_PAYMENT}</span>}
          {isNew && who.recipient.kind === "address" && noTypoCheck(who.recipient.address, network) && <span className="zf-small" data-testid="send-no-check">{NO_TYPO_CHECK}</span>}
          {/* the network line's slot (a16, in the card): AgentZero's line in its place while To is still the address it filled in (the approval sheet still says "Public on <network>."); the network line once the person edits To */}
          {network && routeLines(network, nearLandsAs(source).coin, who.recipient.kind === "ledger").map((l, i) => (i === 0 && agentLine ? <span key="agent" className="wl-send2__route" data-testid="send-agent-filled">{toSlotLine(agentLine, l)}</span> : <span key={l} className="wl-send2__route" data-testid={i ? "send-lands" : "send-route"}>{l}</span>))}
        </p>
      )}
      </div>
      {/* S3 (the copy review's words): a Safe coin that can send less than it holds says why its figure is smaller, once, under From */}
      {restStays(source) && !source.privateOnly && <p className="zf-small wl-send2__coins" data-testid="send-rest">{REST_STAYS}</p>}
      {line && <p className="zf-small" role="status" data-testid="send-line">{line}</p>}
      {who && networks.length > 1 && (
        <div className="wl-send2__nets" role="radiogroup" aria-label="Which network?" data-testid="send-networks">
          <span className="wl-send2__label">Which network?</span>
          <div className="wl-chips" ref={netsRow}>
            {networks.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={n === network} className={`wl-chip zf-press${n === network ? " on" : ""}`} onClick={() => setPicked(n)} disabled={busy}>
                {n === "hood" ? "ETH (RH)" : LANDS_AS[n].network}
              </button>
            ))}
          </div>
          {isNew && <p className="zf-small" data-testid="send-exchange">{EXCHANGE_LINE}</p>}
        </div>
      )}

      <div className="wl-send2__amount">
        <label className="wl-send2__money">
          {(perCoin !== null || exact) && <span aria-hidden="true">$</span>}
          <input inputMode="none" autoComplete="off" placeholder="0" value={shown} onChange={(e) => paste(e.target.value)} aria-label={perCoin !== null ? "Amount in dollars" : `Amount in ${source.symbol}`} data-testid="send-amount" disabled={busy} />
        </label>
        {/* the grade's Send (the design review §4.5, the Buy pattern): chips, then the keypad; no range slider. Max is
            what the coin can send, never more (slide(STEPS), as the slider's top was) */}
        <div className="wl-send2__chips" role="group" aria-label="How much of it">
          {perCoin !== null && !exact && ["5", "25", "50"].map((d) => { const off = readyNow !== null && Number(d) > readyNow; return <button key={d} type="button" className={`zf-chip${off ? " is-off" : ""}`} aria-disabled={off || undefined} onClick={() => { setPreset(true); type(d); }} disabled={busy}>{`$${d}`}</button>; })}
          <button type="button" className="zf-chip" onClick={() => { setPreset(true); slide(STEPS); }} data-testid="send-max" disabled={busy || !(Number(max) > 0)}>Max</button>
        </div>
        {/* the one sub-line slot (a16, Sim re-walk): what the dollars are in the coin, once something is typed (before
            that the From row already says what it holds; say it once: the grade's Send had "1.42 SOL · $144.37" twice);
            Send from Private typed over what Private holds (the copy review's ruling): the cap line, in this same slot, in its place
            while it shows. The slot keeps its height either way: nothing below it moves, nothing scrolls. */}
        <div className="wl-send2__sub" data-testid="send-sub">
          {capped && source.privateOnly
            ? <p className="zf-small wl-send2__coins" role="status" data-testid="send-private-over">{privateOver(most, source.symbol)}</p>
            : under.max ? <p className="zf-small wl-send2__coins" data-testid="send-max-line">{under.max}</p>
            : under.coins && <p className="zf-small wl-send2__coins" data-testid="send-coin-line">{under.coins}</p>}
        </div>
      </div>
      {/* the keypad stands on its own in the column (a16): it is the one piece that gives, 56 pt rows down to 34 */}
      {!exact && <Keypad value={padBase(shown || "0", preset)} decimals={perCoin !== null && !stable ? 2 : places} onChange={(v) => { setPreset(false); type(v === "0" ? "" : v); }} />}

      </div>
      <div className="wl-send2__floor">
      {/* the fee lines (what stays, the quote) sit on the floor over the button, with its line */}
      {rent && <p className="zf-small" data-testid="send-rent">{rent}</p>}
      {feeNow?.high && <p className="zf-small" role="status" data-testid="send-fee-high">{feeNow.high}</p>}
      {floor.line === "said" ? <SheetLine text={said} /> : floor.line === "why" && <p className="zf-small wl-send2__why" role="status" data-testid="send-why">{why}</p>}
      {/* the fee block, right above the button (the copy review, 6 Nov): both of Send's routes go through NEAR Intents (SendSheet's two calls) */}
      <div className="zf-fee">
        {feeNow && <p className="zf-small" data-testid="send-fee">{feeNow.fees}</p>}
        <p className="zf-small" data-testid="send-paid">{intentsKept(!!feeNow)}</p>
      </div>
      {source.cant && source.swap && onSwap
        ? <button type="button" className="zf-btn wl-hold" onClick={() => onSwap(source)} disabled={busy} data-testid="send-swap-first">{SEND_CANT.swapButton(SEND_ROWS[source.swap].coin)}</button>
        : source.cant && source.back && onBack
        ? <button type="button" className="zf-btn wl-hold" onClick={() => onBack(source)} disabled={busy} data-testid="send-move-back">{SEND_CANT.siteButton}</button>
        : <button type="button" className="zf-btn wl-hold" disabled={!ready} onClick={go} data-testid="send-go">{floor.label}</button>}
      </div>
    </div>
  );
}
