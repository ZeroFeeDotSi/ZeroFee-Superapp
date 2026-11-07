// Home's Send (the Home plan §1.3, bug 9, D124, D128): one sheet, From · To · how much · Hold to send. Every Send
// goes privately through NEAR, with no Plain choice: from a wallet (your SOL wallet, your ETH (RH) wallet) it is the
// wallet's coin into NEAR's private balance and on to any address on any chain Send reaches, changed to that chain's
// coin on the way (ledger.hiddenFromRow); from the Safe it is the pocket's share straight on and the rest through the
// Safe (ledger.sendFromSafe), shown only once its route is open (D125). D143: the hold is the act. From a wallet nothing
// else asks (a hot key never does); from the Safe the Safe's own Approve sheet (Face ID) follows, and this sheet steps
// aside only then. Sent: the amount flies into a check mark, the sheet closes, and one line on the screen underneath
// follows it. The guard (packages/agent's judge, the look-alike stop)
// runs before any sheet. A payment the account holds goes to the shell's Waiting screen (D17).
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { SEND_PICK_COIN, SEND_UP_TO } from "@zerofee/core/security-problems";
import type { SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import { MoneySheet, SheetLine, type Pot } from "@zerofee/design/MoneySheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { sheetsHeard } from "@zerofee/shell-api/approval-answered.ts";
import { sendSec } from "@zerofee/shell-api/job-steps.ts";
import { mark } from "@zerofee/design/tap.ts";
import { JobReceipt } from "./JobMade.tsx";
import { sendWords } from "./receipt-said.ts";
import { ActSend } from "../icons.tsx";
import type { AppId } from "@zerofee/shell-api/app-module.ts";
import { sayWent } from "@zerofee/shell-api/money.ts";
import { payProblems } from "@zerofee/pay/pay-problems";
import { shortAddress } from "@zerofee/pay/chains";
import { PayProvider, usePay } from "@zerofee/pay/app/runtime.tsx";
import type { Prefill } from "@zerofee/pay/app/links.ts";
import { LANDS_AS, NEAR_PAYOUT_CLOSED, nearLandsAs } from "../../send-to.ts";
import { declinedLine, nearPayoutLine } from "./send-said.ts";
import { saidOnSheet, sendEndsHere } from "./swap-refused.ts";
import type { Balance, Movement } from "../../types.ts";
import { PAID_KINDS, PAID_READ, type Paid as WasPaid } from "../../send-reach.ts";
import { SendForm, type SendAsk } from "./SendForm.tsx";
import { shortLine, shortUsdOf } from "./send-said.ts";
import { SAFE_SEND_OPEN, payeeOf, safeAmount, sendSources, siteSources, startSource } from "./send-sources.ts";
import { privateFigure } from "../format.ts";
import { DIDNT_LOAD, codeGate } from "./code-gate.ts";
import { rowCoins } from "./send-rows.ts";
import type { HeldCoin } from "../trading.ts";
import { buzz } from "./hold.ts";
import { SEND_PROOF_OFF, homeProof } from "./home-proof.ts";
import { SHEET_NEEDS, sheetLineOf, useServices } from "../services.ts";
import { useWallet } from "../runtime.tsx";
import { sendCash, sendHeadline } from "./send-cap.ts";
import "@zerofee/pay/app/pay.css";
// The guard (packages/agent's judge, unitGuard, obfuscated) loads as the sheet opens, never in Home's first load; Hold
// stays off until it is here, so no send can go before the guard (QA 3 Nov).
const guardCode = codeGate(() => import("./send-guard.ts"));
/** How long the guard's facts asked for when the address was read still count at the hold. */
export const FACTS_FRESH_MS = 60_000;
/** Under Hold while the guard loads, and after it failed (its own line and Try again are above): every off Hold says why. */
export const GETTING_READY = "Send is getting ready.";
export const GUARD_FAILED_WHY = "Tap Try again above.";
// H-5: the camera and the code reader load on the first tap of the scan glyph, never in Home's first load.
const ScanSheet = lazy(() => import("./ScanSheet.tsx").then((m) => ({ default: m.ScanSheet })));
// A link's reader (Chat's send, a pasted request, H-4) loads with the first link, never in Home's first load (speed budget)
const loadLinks = () => import("@zerofee/pay/app/links.ts");
const loadAsk = () => import("./request-money.ts");

/** How long the amount takes to fly into the check mark before the sheet closes (send.css). */
export const SENT_MS = 1_100;

/**
 * `onClose`: the sheet is over (went, or closed). `onAddMoney`: nothing to send yet; add some (the Add money sheet).
 * `proof`: D125, the test build (VITE_HOME_PROOF=1). Off (a release build, until the $1 proof passes): one line
 * and Close, with the money line; nothing asked of the core, no other way to send.
 */
export function SendSheet({ link, pots, onClose, onAddMoney, onMove, wallet, coin, to, chain, usd, note, agentFilled, proof = homeProof() }: { link?: string; wallet?: string; /** MoneyAsk's agentFilled: `to` is AgentZero's (send-ask.ts) */ agentFilled?: true; /** MoneyAsk prefill: the coin From opens on (a coin's own page) */ coin?: string; /** MoneyAsk prefill: who, its network, the dollars, the note (SendForm `typed`) */ to?: string; chain?: string; usd?: string; note?: string; pots: Pot[]; onClose: (went: boolean, movementId?: string) => void; onAddMoney: (chain: string) => void; /** the Safe holds money: Move it to a wallet */ onMove?: () => void; proof?: boolean }) {
  const { bridge } = useShell();
  if (!proof) return <MoneySheet title="Send" pots={pots} onClose={() => onClose(false)}><p className="zf-body wl-sheet-lead" role="status" data-testid="send-off">{SEND_PROOF_OFF}</p></MoneySheet>; // the corner's Close is the way out (product decision, 3 Nov: no second Close)
  return <PayProvider bridge={bridge}><SendBody link={link} wallet={wallet} {...(coin ? { coin } : {})} typed={to || usd || note ? { ...(to ? { to } : {}), ...(chain ? { chain } : {}), ...(usd ? { usd } : {}), ...(note ? { note } : {}), ...(agentFilled && to ? { agentFilled } : {}) } : undefined} onClose={onClose} onAddMoney={onAddMoney} {...(onMove ? { onMove } : {})} /></PayProvider>;
}

function SendBody({ link, wallet, coin, typed, onClose, onAddMoney, onMove }: { link?: string; wallet?: string; coin?: string; typed?: { to?: string; chain?: string; usd?: string; note?: string; agentFilled?: true } | undefined; onClose: (went: boolean, movementId?: string) => void; onAddMoney: (chain: string) => void; onMove?: () => void }) {
  const shell = useShell();
  const { flow, contacts, refresh, self, ready, balances: payBalances, balancesRead } = usePay();
  // what Home's runtime already read (speed, D145): the form's From is there in the first frame, never "Nothing to send
  // yet" while Send's own reads run again; each read replaces it as it answers
  const home = useWallet();
  const balances = balancesRead ? payBalances : home.balances ?? [];
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [scanning, setScanning] = useState(false);
  /** Each scan gets a fresh form (a new key): a refused one leaves it empty; a second one never mixes with the first. */
  const [formKey, setFormKey] = useState(0);
  /** sendCoinUnknown's "Pick a coin" (the audit's ruling, 5 Nov): bumped to open the form's coin picker. */
  const [pickCoin, setPickCoin] = useState(0);
  // "Send $Y" on the over-limit refusal (the copy review's words): the same Send, refilled at what is left today
  const [refill, setRefill] = useState<{ to: string; chain: string; usd: string } | null>(null);
  const [reqLine, setReqLine] = useState<string | null>(null);
  // a request's one line (H-4), however it came (a link, a paste, a scan)
  useEffect(() => { setReqLine(null); if (prefill?.request) void loadLinks().then((m) => setReqLine(m.requestLine(prefill))); }, [prefill]);
  /** The app that handed this send over (Chat): told "sent" when it went, or "back" when it didn't. */
  const back = useRef<AppId | null>(null);
  const read = useRef(false);
  /** The guard's one warn line (a first payment: firstPayLine, who, from which wallet, the next step): said, never a
   *  block. `kept`: a wallet's first payment, said on the receipt too (its send is made at the tap); else until it is. */
  const [warn, setWarn] = useState<{ text: string; kept: boolean } | null>(null);
  const checking = useRef(false);
  /** The guard's facts (has this device paid them before, the NEAR account), asked for the moment the form knows who it
   *  is (speed, D145): Hold then goes straight to the core's call, never waits on Activity's read after the hold. */
  const early = useRef<{ to: string; at: number; facts: ReturnType<NonNullable<ReturnType<typeof guardCode.here>>["guardFactsSoon"]> } | null>(null);
  /** The guard's block, known before any hold (row 1; QA's test: "isn't open yet" came only after
   *  the hold): said right above Hold, and Hold stays off until To changes. */
  const [stop, setStop] = useState<string | null>(null);
  const knowWho = (r: SendAsk["recipient"] | null) => {
    const g = guardCode.here();
    // a new To clears the last one's line (a NEAR refusal stayed on after a Robinhood address was pasted)
    setStop(null);
    setLine(null);
    const e = r && g ? { to: g.guardTarget(r), at: Date.now(), facts: g.guardFactsSoon(shell.bridge, r) } : null;
    early.current = e;
    // a NEAR account's facts are judged the moment they are here: a block is said before Hold, never after it
    if (e && g && r && r.kind !== "address") void e.facts.then((facts) => {
      if (early.current !== e) return;
      const check = g.judge(e.to, facts, "near", { opens: r.kind === "near-wallet" });
      if (check.verdict === "block") setStop(check.line);
    });
  };
  // the guard's code: here, on its way (Hold stays off), or failed (one line and Try again; nothing can be sent)
  const [guard, setGuard] = useState(() => guardCode.here());
  const [guardFailed, setGuardFailed] = useState(false);
  const loadTheGuard = () => {
    setGuardFailed(false);
    guardCode.load().then((g) => setGuard(() => g), () => setGuardFailed(true));
  };
  useEffect(() => { if (!guard) loadTheGuard(); }, []);
  useEffect(() => {
    if (!link || read.current || !ready || !flow.tokens) return;
    read.current = true;
    const tokens = flow.tokens;
    // a link's amount meets the same unit guard a scanned code's does (auditor, 4 Nov): Chat's or another app's link
    void Promise.all([loadLinks(), guardCode.load()]).then(([{ prefillFromLink, readSendLink }, g]) => {
      const asked = readSendLink(link);
      back.current = asked && "ok" in asked && asked.ok.back === "chat" ? "chat" : null;
      const r = prefillFromLink(link, tokens, self);
      if ("problem" in r) return void problem(r.problem);
      const off = g.linkUnitOff(r.ok, tokens);
      if (off) return void setLine(off);
      setPrefill(r.ok);
    }, () => void problem(payProblems.quoteFailed()));
  }, [link, ready, flow, self]);
  /** Closed without a send: the app that asked hears "back" (it returns to where the person was). */
  const close = () => {
    sayWent("");
    const b = back.current;
    back.current = null;
    onClose(false);
    if (b) shell.openApp(b, "back");
  };
  /** The contact the send is for: marked paid only once it went (security review of Job 1). */
  const paying = useRef<string | null>(null);
  /** It went: the line says so; the app that asked hears "sent" with the movement and its dollars (J6: Chat's Sent). */
  const went = (line: string, movementId?: string, usd?: string, sent?: string, landed = true) => {
    // "on its way" is not "done": the busy dot, never the tick (security review of Job 1, L7)
    sayWent(line, landed ? "went" : "quiet");
    if (paying.current) void contacts?.markPaid(paying.current);
    paying.current = null;
    const b = back.current;
    back.current = null;
    onClose(true, movementId);
    if (b) shell.openApp(b, "sent", movementId ? `movement=${encodeURIComponent(movementId)}${usd && sent ? `&usd=${encodeURIComponent(usd)}&sent=${encodeURIComponent(sent)}` : ""}` : undefined);
  };
  const [busy, setBusy] = useState(false);
  /** The Safe's own Approve may be up (a Send from the Safe): only then this sheet steps aside (D143). */
  const [asking, setAsking] = useState(false);
  /** The success moment: the amount flying into the check mark, then the sheet closes (SENT_MS). */
  const [flying, setFlying] = useState<string | null>(null);
  /** The job its receipt follows (runJob's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [flyingJob, setFlyingJob] = useState<string | null>(null);
  /** The receipt's line, from the job's own title (copy review, 7 Nov): "Sending $25.00 to bob.near.", "Sent …" once landed. */
  const [sentSaid, setSentSaid] = useState<{ going: string; landed: string } | null>(null);
  /** The job's time left under "Job created." (sendSec: the route's measured legs). */
  const [etaSec, setEtaSec] = useState<number | undefined>(undefined);

  // the wallets (Spending's own read), the pocket's coins (counted under the Safe, D128), and the Safe's own
  const [rows, setRows] = useState<Balance[]>(() => rowCoins(home.spending));
  /** The wallets have answered (Home's read this session, or Send's own): until then an empty From is "reading", never
   *  "Nothing to send yet" (real money, 4 Nov: said over a $45 Safe). */
  const [rowsRead, setRowsRead] = useState<boolean | "failed">(() => home.spending !== null);
  const [pocket, setPocket] = useState<Balance[]>(() => (home.pocket?.ready && Array.isArray(home.pocket.rows) ? home.pocket.rows : []));
  // every other coin the wallets hold (the Send review, 5 Nov): Trade's own list (trade.positions)
  const [held, setHeld] = useState<HeldCoin[] | null>(null);
  const [sites, setSites] = useState<SpendingWallet[] | null>(null);
  useEffect(() => {
    void shell.bridge.call<SpendingStatus>("spending.status").then((r) => { if ("ok" in r) { setRows(rowCoins(r.ok)); setRowsRead(true); } else setRowsRead((was) => was || "failed"); }, () => setRowsRead((was) => was || "failed"));
    void shell.bridge.call<HeldCoin[]>("trade.positions").then((r) => "ok" in r && Array.isArray(r.ok) && setHeld(r.ok), () => undefined);
    void shell.bridge.call<{ ready?: boolean; rows?: Balance[] }>("ledger.private").then((r) => "ok" in r && r.ok.ready && Array.isArray(r.ok.rows) && setPocket(r.ok.rows), () => undefined);
  }, [shell.bridge]);
  const sources = useMemo(() => [...sendSources(rows, balances.filter((b) => b.held !== "private"), pocket, undefined, held, home.earning), ...siteSources(sites)], [rows, balances, pocket, held, sites, home.earning]);
  // One wallet per chain (D55): a send to the person's own wallet is Move's, never Send's (it would link the two).
  const [ownChain, setOwnChain] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void shell.bridge.call<SpendingWallet[]>("spending.wallets").then((r) => {
      if ("ok" in r) setOwnChain(new Map(r.ok.filter((w) => w.role !== "hub").map((w) => [w.address.toLowerCase(), w.label])));
      if ("ok" in r && Array.isArray(r.ok)) setSites(r.ok);   // the site wallets, listed in From (siteSources)
    }, () => undefined);
  }, [shell.bridge]);
  // who this person has paid or saved: "New address", and the look-alike stop (address poisoning)
  const [paid, setPaid] = useState<WasPaid[]>([]);
  useEffect(() => {
    void shell.bridge.call<Movement[]>("ledger.activity", { limit: PAID_READ }).then((r) => "ok" in r && Array.isArray(r.ok) && setPaid(r.ok.flatMap((m) => (PAID_KINDS.includes(m.kind) && typeof m.to === "string" ? [{ to: m.to, ...(m.toChain ? { chain: m.toChain } : {}) }] : []))), () => undefined);
  }, [shell.bridge]);
  const history = useMemo<WasPaid[]>(() => [...paid, ...(contacts?.list() ?? []).map((c) => (c.to.kind === "address" ? { to: c.to.address, ...(c.to.chain ? { chain: c.to.chain } : {}) } : { to: c.to.accountId, chain: "near" }))], [paid, contacts]);

  // B28 + bug 8: a service that failed is one line on this sheet, never the shell's Problem screen; Hold waits (and the
  // line says "waits") only when it is down on two sources or the phone is offline: the line and the button agree
  const [line, setLine] = useState<string | null>(null);
  /** The line is a refusal that can be tried again (saidOnSheet: never a maybe-sent one): its words for the one button. Any other line ends it. */
  const [stopped, setStopped] = useState<{ line: string; label: string } | null>(null);
  const again = stopped && line === stopped.line ? stopped.label : null;
  const edited = () => { setLine(null); setStopped(null); };
  const services = useServices(shell.bridge, SHEET_NEEDS.send, "Send");
  const problem = async (p: Problem) => {
    const said = sheetLineOf(p);
    if (said) return void setLine(said);
    const next = await shell.showProblem(p);
    if (next.kind === "open" && next.screen === "receive") onAddMoney("sol");
  };

  /** The over-limit refusal (core securityProblems.sendOverLimit): shown with its two buttons; the dollars "Send $Y"
   *  refills at, "" for none tapped; undefined when it isn't that refusal. */
  const overLimitAgain = async (p: Problem): Promise<string | undefined> => {
    if (p.code !== "security.send.over-limit" || p.next2?.screen !== "security/protection") return undefined;
    const next = await shell.showProblem(p);
    return next.kind === "open" && next.screen.startsWith(SEND_UP_TO) ? next.screen.slice(SEND_UP_TO.length) : "";
  };

  const send = async (a: SendAsk) => {
    // THE GUARD (FLOW-V5 §5 item 5): AgentZero's own checks on the person's own Send, called from packages/agent.
    const g = guardCode.here();
    if (!g || checking.current) return;
    const { GUARD_HIDES, firstPayLine, guardFactsSoon, guardTarget, judge, obfuscated } = g;
    const to = guardTarget(a.recipient);
    if (obfuscated(to) || obfuscated(a.amountIn)) return void setLine(GUARD_HIDES);
    checking.current = true;
    setWarn(null);
    setLine(null);
    setBusy(true);
    let facts: Awaited<ReturnType<typeof guardFactsSoon>>;
    try {
      const e = early.current;
      facts = await (e && e.to === to && Date.now() - e.at < FACTS_FRESH_MS ? e.facts : guardFactsSoon(shell.bridge, a.recipient));
    } finally {
      checking.current = false;
    }
    // a NEAR account paid on NEAR through 1Click lands as native NEAR, which opens a new 64-hex account (counterparty.ts)
    const check = judge(to, facts, a.recipient.kind === "address" ? a.network : "near", { opens: a.recipient.kind === "near-wallet" });
    if (check.verdict === "block") {
      setBusy(false);
      return void setLine(`${check.line} Nothing was sent. Your money is still in ${a.source.place}. Paste another address.`);
    }
    if (check.verdict === "warn") {
      const first = firstPayLine(check.line, { place: a.source.place, safe: !a.source.row });
      setWarn({ text: first ?? check.line, kept: !!first && !!a.source.row });
    }
    // the unit guard before Approve: the dollars the form showed (the wallet's own price) against the coin amount at
    // 1Click's price for that coin, two reads apart; ten times off stops it (a decimal slip), before any sheet
    const known = flow.tokens?.byAsset(a.source.row ? a.source.coin ?? LANDS_AS[a.source.row].tokenId : a.source.tokenId);
    const off = !a.exactOut && known ? g.unitCheck({ target: { amount: a.amountIn, token: { decimals: known.decimals, symbol: known.symbol, ...(known.priceUsd ? { priceUsd: known.priceUsd } : {}) } } }, a.usd) : null;
    if (off) {
      setBusy(false);
      return void setLine(off);
    }
    const own = a.recipient.kind === "address" ? ownChain.get(a.recipient.address.trim().toLowerCase()) : undefined;
    if (own) {
      setBusy(false);
      return void setLine("That's one of your own wallets. Use Move for that. Nothing was sent.");
    }
    // H-4: a request still in date, and a one-time address never paid more than it was made for
    const ask = prefill?.request ? await loadAsk() : null;
    const req = ask && prefill ? ask.askOf(prefill, a.recipient) : null;
    if (req && ask!.ranOut(req)) {
      setBusy(false);
      return void setLine(ask!.REQUEST_RAN_OUT);
    }
    const over = req && !a.exactOut ? ask!.overHidden(req, a.usd) : null;
    if (over) {
      setBusy(false);
      return void setLine(over);
    }
    const payee = payeeOf(a);
    // a NEAR account gets the Safe's own NEAR coin as itself (USDC stays USDC, product decision, 5 Nov), anything else as NEAR
    const toTokenId = a.exactOut?.tokenId ?? (payee.kind === "ledger" || a.network === "near" ? nearLandsAs(a.source).tokenId : LANDS_AS[a.network].tokenId);
    const amount = a.exactOut && a.source.row ? { amountOut: a.exactOut.amount } : a.source.row ? { amountIn: a.amountIn } : { amount: safeAmount(a) };
    // upTo (audit H1, fix #3): the most this source can send, so leg 1 can bring its amount rounded up to the inflow grid
    const upTo = Number(a.source.max) > 0 ? { upTo: a.source.max } : {};
    if ("amount" in amount && !(Number(amount.amount) > 0)) {
      setBusy(false);
      return void setLine("This coin has no price right now. Pick another to send from.");
    }
    // M1 (the audit's audit): the form's own figure, never re-rounded here (it said $9.99 while this said $10.00)
    const figure = a.figure !== undefined ? Number(a.figure).toFixed(2) : a.usd !== null ? a.usd.toFixed(2) : null;
    // QA 16's Send Max shots (7 Nov): with its commas on every later line ("$1165.04" on the receipt and the Jobs rows)
    const cash = figure !== null ? sendCash(figure) : null;
    const toWho = payee.kind === "ledger" ? payee.accountId : shortAddress(payee.address);
    const said = `${a.exactOut ? `${a.exactOut.amount} ${a.exactOut.symbol}` : cash !== null ? cash : `${a.amountIn} ${a.source.symbol}`} to ${toWho}`;
    paying.current = a.contactId ?? null;
    // the job (bug report, 5 Nov; QA's crawl: Send had no receipt): from a wallet it is made at the tap (a
    // sheet past its cap steps the receipt aside until answered); from the Safe once the core answers, after every
    // sheet (its pocket's share can ask Face ID before the Safe's own: "Job created." never over an unanswered Face ID)
    const fromSafe = !a.source.row;
    setAsking(fromSafe);
    if (fromSafe) sayWent("Getting it ready…", "busy");
    mark("tap");
    const shown = cash !== null ? cash : a.exactOut ? `${a.exactOut.amount} ${a.exactOut.symbol}` : `${a.amountIn} ${a.source.symbol}`;
    // its own key (the audit's MUST, 7 Nov): the Safe's sheet for it says approval.asked and job.signed with this key, never another's
    const key = `home-send-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const eta = sendSec({ row: a.source.row, toNear: payee.kind === "ledger" || a.network === "near" });
    setEtaSec(eta);
    const end = await runJob<Movement | Movement[]>({
      key, tasks: shell.tasks, title: `Send ${said}`, ...(cash !== null ? { usd: cash } : {}), safe: fromSafe, onAnswer: true, etaSec: eta,
      // the Getting-ready sheet says the typed figure alone; the bound one only adds "from your Safe" (copy review, 6 Nov)
      ...(fromSafe ? { headline: sendHeadline(shown) } : {}),
      // QA's MUST (Sim test): a wallet's Send to someone else asks every time (QA's ruling), on
      // the shell's own sheet: asked first, "Job created." on its yes; from the Safe, runJob's default (its sheet, if ours)
      ...(a.source.row ? { asks: sheetsHeard("hot") } : {}),
      money: a.source.row ? [`row:${a.source.row}`] : ["safe", "private"],
      call: () => (a.source.row
        ? shell.bridge.call<Movement>("ledger.hiddenFromRow", { chain: a.source.row, ...(a.source.coin ? { coin: a.source.coin } : {}), to: payee, toTokenId, ...amount, ...upTo, ...(a.note ? { label: a.note } : {}) })
        : shell.bridge.call<Movement[]>("ledger.sendFromSafe", { tokenId: a.source.tokenId, to: payee, toTokenId, ...amount, ...upTo, ...(a.source.privateOnly ? {} : { fill: true }), ...(a.note ? { label: a.note } : {}), job: key })).catch(() => ({ problem: payProblems.quoteFailed() })),
      declined: (r) => "problem" in r && /declined$/.test(r.problem.code),
      made: (j) => { sayWent(""); setAsking(false); setBusy(false); buzz(shell.bridge, "success"); setSentSaid(sendWords(toWho)); setFlying(shown); setFlyingJob(j.id); },
      asking: setAsking,
    });
    setBusy(false);
    sayWent("");
    // a No on the Send's own ask (QA's lap, 5 Nov): the job made at the tap is gone
    // (runJob), "Job created." comes down, and the form says the person said no, nothing was sent, where the money is.
    // Done tapped first (the sheet is closed): Home's line says it
    if ("declined" in end) {
      paying.current = null;
      setAsking(false);
      setFlying(null);
      const no = declinedLine(shown, a.source.place);
      if (sent.current === "closed") { sent.current = null; return sayWent(no, "quiet"); }
      sent.current = null;
      return setLine(no);
    }
    if ("refused" in end) {
      paying.current = null;
      mark("refused");
      // money may already have left (a part went, or it can't be read): never this form's lit Send, whose tap would pay again (the audit's MUST, 6 Nov)
      if (sendEndsHere(end.refused)) {
        setStopped(null);
        setLine(null);
        setFlying(null);
        const next = await shell.showProblem(end.refused);
        onClose(false);
        if (next.kind === "open") shell.openApp("wallet", next.screen);
        return;
      }
      // a refusal that can be tried again is said in its own words (saidOnSheet: no service, so no sheetLineOf below); `again` holds only while that line stands
      setStopped(saidOnSheet(end.refused) ? { line: end.refused.whatHappened, label: end.refused.next.label } : null);
      // a payout to a NEAR account NEAR Intents didn't take: by name, with the wallet the money is still in (rule 8)
      if (end.refused.code === NEAR_PAYOUT_CLOSED) return setLine(nearPayoutLine(shown, a.source.place));
      // S1 (rule 8): short of money says how much, in dollars, where (the From row's own name) and what to tap
      if (end.refused.code === "ledger.balance.low") return setLine(shortLine(shortUsdOf(end.refused, a.source), a.source.place));
      // over the Safe's day limit (audit: refused before Face ID, a quote can't wait): the copy review's words on the Problem screen,
      // "Send $Y" refills this Send at what is left today, "Protection" (quiet) opens the limits
      const upTo = await overLimitAgain(end.refused);
      if (upTo !== undefined) {
        if (upTo) { setRefill({ to: a.recipient.kind === "address" ? a.recipient.address : a.recipient.accountId, chain: a.recipient.kind === "address" ? a.network : "near", usd: upTo }); setFormKey((k) => k + 1); }
        return;
      }
      // a fill whose payout coin the core can't name (the audit's ruling, 5 Nov): refused before any sheet; "Try again" sends
      // it again, "Pick a coin" opens From's coin picker
      if (end.refused.code === "security.send.coin-unknown") {
        const next = await shell.showProblem(end.refused);
        if (next.kind === "retry") return void send(a);
        if (next.kind === "open" && next.screen === SEND_PICK_COIN) setPickCoin((n) => n + 1);
        return;
      }
      return setLine(sheetLineOf(end.refused) ?? end.refused.whatHappened);
    }
    // refused after the job existed: its row says why (the receipt stays: the person closes it)
    if ("problem" in end) { paying.current = null; sent.current = { failed: true }; return void mark("refused"); }
    const moved = Array.isArray(end.ok) ? end.ok : [end.ok];
    end.job.made(moved.filter((m) => m.status !== "waiting").map((m) => `send:${m.id}`));
    refresh();
    const held = moved.find((m) => m.status === "waiting" && m.held);
    if (held?.held) {
      // the shell's Waiting screen is the one result (On hold until…, Cancel it, Done)
      onClose(true);
      return shell.showWaiting(held.held);
    }
    const done = () => went(`${said}: on its way. Activity shows it.`, moved[0]?.id, figure ?? undefined, moved[0]?.amount, false);
    // Done already tapped (a wallet's job, made at the tap): the sheet is gone, the contact is marked paid now
    if (sent.current === "closed") {
      sent.current = null;
      if (paying.current) void contacts?.markPaid(paying.current);
      paying.current = null;
      return;
    }
    sent.current = { done };
  };
  /** The job's end for Done: its movement (the core answered), refused after it was made, or Done came first. */
  const sent = useRef<{ done: () => void } | { failed: true } | "closed" | null>(null);
  const madeDone = () => {
    const s = sent.current;
    if (s && s !== "closed" && "done" in s) { sent.current = null; return s.done(); }
    sent.current = s === null ? "closed" : null;
    if (s !== null) paying.current = null;
    sayWent("");
    const b = back.current;
    back.current = null;
    onClose(s === null);
    if (b) shell.openApp(b, s === null ? "sent" : "back");
  };

  /** A link pasted into To: read like a scan's, with the same unit check, before the form fills (auditor, 4 Nov). */
  const onLink = (text: string) => {
    const tokens = flow.tokens;
    if (!tokens) return;
    void Promise.all([loadLinks(), guardCode.load()]).then(([{ prefillFromLink }, g]) => {
      const r = prefillFromLink(text, tokens, self);
      if ("problem" in r) { setPrefill(null); return setLine(r.problem.whatHappened); }
      const off = g.linkUnitOff(r.ok, tokens);
      if (off) { setPrefill(null); return setLine(off); }
      setLine(null);
      setPrefill(r.ok);
    }, () => undefined);
  };
  const waits = services.down ? services.line : null;
  return (
    <>
      {/* R3 (the design review §4.5): no "Safe $… · Wallets $…" line over the form; From says what it holds, once */}
      <MoneySheet title="Send" away={asking && (busy || !!flying)} onClose={flying ? madeDone : close}>
        {/* the sheet's line sits right above its button, the one place every money sheet uses (a Send test, 4 Nov
            00:57: at the top it read as about the address); with no form on screen (the sent screen), here */}
        {flying && <SheetLine text={line ?? services.line} />}
        {guardFailed && (
          <div role="alert" data-testid="send-didnt-load" style={{ display: "grid", gap: 12, margin: "4px 0 24px" }}>
            <p className="zf-body">{DIDNT_LOAD}</p>
            <button className="zf-btn" onClick={loadTheGuard}>Try again</button>
          </div>
        )}
        {warn && !line && (!flying || warn.kept) && <p className="zf-small" role="status" data-testid="send-guard-warn">{warn.text}</p>}
        {flying ? (
          // the job is made: the receipt, away ("Job created." and who got it), until the person closes it
          <JobReceipt amount={flying} icon={<ActSend />} testid="send-sent" etaSec={etaSec} said={sentSaid?.going} landedSaid={sentSaid?.landed} job={flyingJob} onDone={madeDone} />
        ) : (
          <div className="wl-send">
            {reqLine && <p className="zf-small">{reqLine}</p>}
            <SendForm key={formKey} prefill={prefill} sources={sources} reading={rowsRead === "failed" ? "failed" : !rowsRead || (!balancesRead && home.balances === null)}
              start={startSource(wallet, sources, coin)} history={history} {...(refill ? { typed: refill } : typed && formKey === 0 ? { typed } : {})} busy={busy} waits={waits} blocked={stop} notYet={guard ? null : guardFailed ? GUARD_FAILED_WHY : GETTING_READY} said={line ?? services.line} again={again} onEdit={edited}
              onSend={(x) => void send(x)} onSwap={(s) => { onClose(false); if (s.swap) shell.openMoney({ kind: "swap", wallet: s.swap }); }} onBack={(s) => { onClose(false); if (s.back) shell.openMoney({ kind: "siteback", wallet: s.back.wallet, name: s.back.name }); }} feeOf={(a) => (a.source.row ? shell.bridge.call<{ inUsd: string; outUsd: string } | null>("ledger.sendFee", { chain: a.source.row, ...(a.source.coin ? { coin: a.source.coin } : {}), to: payeeOf(a), toTokenId: LANDS_AS[a.network].tokenId, amountIn: a.amountIn }).then((r) => ("ok" in r ? r.ok : null), () => null) : Promise.resolve(null))} onWho={knowWho} onScan={() => setScanning(true)} onAddMoney={() => onAddMoney("sol")} {...(onMove ? { onMove } : {})}
              onLink={onLink} ownWallets={ownChain} pickCoin={pickCoin}
              {...(SAFE_SEND_OPEN ? {} : { fillShut: { usd: privateFigure({ available: home.pocket?.available ?? true, ready: home.pocket?.ready ?? pocket.length > 0, rows: pocket }), onTopUp: () => { onClose(false); shell.openApp("wallet", "private/add"); } } })}
            />
          </div>
        )}
      </MoneySheet>
      {/* H-5: a scan only ever fills the form in (or says one line); the person's own hold runs the guard, then sends. */}
      {scanning && <Suspense fallback={null}><ScanSheet tokens={flow.tokens} self={self} onClose={() => setScanning(false)} onResult={(r) => { setScanning(false); back.current = null; setWarn(null); setFormKey((k) => k + 1); if ("prefill" in r) return setPrefill(r.prefill); setPrefill(null); if ("line" in r) setLine(r.line); }} /></Suspense>}
    </>
  );
}
