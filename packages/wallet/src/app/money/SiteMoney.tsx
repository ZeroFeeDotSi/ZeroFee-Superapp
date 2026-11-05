// Social Trading's two money sheets (product decision, 2 Nov), the one money sheet's design over whichever app asked (the hub):
// - Add (QA, 5 Nov: one exit): "Move $10 to your pump.fun wallet" (spending.topUp with `ready`): Private pays the
//   site's wallet in ONE 1Click payment (NEAR Confidential), no Face ID; Private short, the Safe fills Private first (one
//   Face ID, a whole step, the extra stays in Private), then that same payment (site-route.ts). Never a public hop from
//   the Safe to the site's wallet.
// - Move back: a site's own wallet → the Safe, privately (subwallet.site.moveBack): its two confidential legs, the site's
//   SOL into Spending's confidential balance and on home to the Safe. D143: no Approve (a hot key never asks, and money
//   only goes home); the person's own tap here starts it, and only Wallet's call reaches it (Job 3's High).
// A refusal names who said no (the swap service, NEAR, Solana) and where the money is, on the shell's Problem screen. A
// service that failed (B28) is one line on the sheet itself, said before the tap when the relay's check already knows,
// and the site wallet's read is read again by itself while it fails: never a page.
import { TimeLeft } from "./JobMade.tsx";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { useContext, useEffect, useRef, useState } from "react";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { pickSafeCoin, type SafeCoin, type SpendingActivity, type SpendingWallet } from "@zerofee/core/spending";
import type { Bridge } from "@zerofee/core/bridge";
import { MoneySheet, QUOTE_WAIT_MS, SheetLine, quoteWaitLine, useElapsed, type Pot } from "@zerofee/design/MoneySheet.tsx";
import { Keypad } from "@zerofee/design/Keypad.tsx";
import { mark } from "@zerofee/design/tap.ts";
import "@zerofee/design/receipt.css";
import { downLine, serviceOf, type Service } from "@zerofee/core/services";
import { sayWent } from "@zerofee/shell-api/money.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { onOwnApproval } from "@zerofee/shell-api/job-run.ts";
import { JOB_WORDS, startJob, type JobHandle } from "@zerofee/shell-api/job-start.ts";
import { dollars, privateFigure } from "../format.ts";
import { ActAdd } from "../icons.tsx";
import { trimCents, typedUsd, validUsd } from "../hub.ts";
import { useMoveProblem } from "../screens/Spending.tsx";
import { SHEET_NEEDS, readAgain, sheetLineOf, useServices } from "../services.ts";
import { backAmount, backLeast, backPicked, movesBackLine, type MoveBackRead } from "./site-moves.ts";
import { keepPrice, keptPrice } from "./price-kept.ts";
import { SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { hostWallets, isHostSite } from "./site-host.ts";
import { SITE_BUSY_LINE, SITE_READS_AGAIN_MS, retryOf } from "./site-retry.ts";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { WalletRuntimeContext } from "../runtime.tsx";
import { ROUTE_WORDS, privateFrom, privateUsdcOf, siteRoute, type SiteRoute } from "./site-route.ts";
import { BACK_ID, BACK_WORDS, TAKE_OUT_ETA_SEC, takeOutJob } from "./site-back.ts";
export { moveBackLine, movesBackLine } from "./site-moves.ts";

type Held = NonNullable<SpendingActivity["held"]>;
/** What Add starts at: $10, or what the Safe has when that's less. */
export const SITE_ADD_USD = 10;
/** Under this a move would mostly go on fees (the core's floor, float.ts FLOAT_MIN_USD). */
export const SITE_MIN_USD = 2;
/** The site Take out's title (one word for the move: Take out; crawl F14). */
export const TAKE_OUT_TITLE = "Take out to your Safe";
/** A call that threw after the job existed (move-run.ts MOVE_LOST's words): its row ends, never "1 going" forever. */
const TAKE_OUT_LOST = "No answer came back. Home shows where your money is.";
/** Finding 61: the least an Add puts in a site's wallet: a Safe -> wallet leg's least (the core refuses less before any
 *  sheet), so its last step never stops in the NEAR wallet under the core's $2 floor. */
export const SITE_ADD_LEAST_USD = SAFE_LEG_MIN_USD;
/** Said under the amount while it is under SITE_ADD_LEAST_USD (Move's own words, swap-corridor.ts leastFromSafe). */
export const SITE_ADD_LEAST_LINE = `Add at least $${SAFE_LEG_MIN_USD.toFixed(2)} to cover the network fee.`;
/** Under the least, the lit button moves the least (QA, 5 Nov: GMGN's "Move $2" was a dead grey button). */
export const SITE_ADD_LEAST_GO = `Add $${SAFE_LEG_MIN_USD.toFixed(2)}`;
/** Who moves it and how long they take (product decision, 5 Nov: the protocol at work, never "about a minute"; real runs 3–4 min). */
export const SITE_ADD_HOW = "It goes through your NEAR wallet. It takes 3–4 minutes.";
/** The site Add's one title (one word for the move: Add; crawl F14), GMGN's with its network. */
export const siteAddTitle = (name: string, network?: string): string => `Add to your ${name}${network ? ` ${network}` : ""} wallet`;

/** The site's wallets as Spending lists them (their dollars), read when the sheet opens, and again by themselves (with
 *  backoff) while a service they need fails (B28 R4); an unread wallet in the answer is read again the same way. */
function useSiteWallets(ids: readonly string[]): (SpendingWallet | null)[] | undefined {
  const { bridge } = useShell();
  const [w, setW] = useState<(SpendingWallet | null)[] | undefined>(undefined);
  const key = ids.join(",");
  useEffect(
    () =>
      readAgain(
        async () => {
          const r = await bridge.call<SpendingWallet[]>("spending.wallets");
          const mine = "ok" in r ? ids.map((id) => r.ok.find((x) => x.id === id)) : [];
          // a wallet Solana didn't answer for reads as unread: asked again, as a failed read is
          return mine.some((x) => x?.unread) ? { problem: { code: "spending.wallet.unread", whatHappened: "Solana didn't answer.", money: { state: "safe" as const, where: "in your wallet" }, next: { kind: "retry" as const, label: "Try again" }, service: "solana" as const } } : r;
        },
        (r) => setW("ok" in r ? ids.map((id) => r.ok.find((x) => x.id === id) ?? null) : (prev) => prev ?? ids.map(() => null)),
      ),
    [bridge, key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return w;
}
/** ST3: the fee line is said only when an Add's cost is over this share of it. */
export const FEE_LINE_SHARE = 0.02;
/** Said until 1Click's two dry quotes are back (QA's rule: a fee figure only from a real quote, never a fixed one). */
export const FEE_WAIT_LINE = "Fees show once there's a price.";
/** Said only when the relay itself says 1Click didn't answer, or after QUOTE_WAIT_MS (20 s, as long as the relay waits)
 *  with no answer (phone test, 3 Nov: it said so at 5 s while a real quote was still coming), with Try again. */
/** Rule 9a (the proof run's Sim walk, 5 Nov: "1Click didn't answer." alone): what is down, what ZeroFee does instead,
 *  whether the Add can still go (`down`: the relay's check and this phone agree, so its button waits). */
export const feeLateLine = (s: Service = "oneclick", down = false): string => downLine(s, "down", { action: "Add", moves: !down });
export const FEE_LATE_LINE = feeLateLine();
/** The fee's price as the sheet has it: a cost; null, nothing to price; undefined, asked and on its way; "late", 1Click
 *  didn't answer in QUOTE_WAIT_MS; `late` with a service, the relay said that service didn't answer, twice (once more
 *  after the silent retry, rule 9a); `said`, the core or 1Click said no at once, in its words (never "didn't answer": an
 *  answer that came back at once is a refusal, review 3 Nov). */
export type FeeCost = number | null | undefined | "late" | { late: Service } | { said: string };
/** The sheet's fee line: the cost against the dollars moved. `waitedMs`: how long the price has been on its way. */
export function feeLine(cost: FeeCost, usd: number, waitedMs?: number, down = false): string | null {
  if (cost === null) return null;
  if (cost === undefined) return waitedMs === undefined ? FEE_WAIT_LINE : quoteWaitLine(waitedMs);
  if (cost === "late") return feeLateLine("oneclick", down);
  if (typeof cost === "object") return "late" in cost ? feeLateLine(cost.late, down) : cost.said;
  return cost > usd * FEE_LINE_SHARE ? `About $${cost.toFixed(2)} in fees.` : null;
}
/** A refusal's own words for the fee line: its detail where the core gave one (subwalletRefused keeps it in `more`). */
const saidOf = (p: Problem): string => (p.more && p.more.length <= 140 ? p.more : p.whatHappened);
/**
 * ST3: what this Add costs, from the core's two dry 1Click quotes of its own legs (subwallet.site.addCost: nothing moves),
 * asked as soon as the sheet has the Safe's coins and again 0.3 s after the typing stops; asked again by itself while
 * 1Click doesn't answer. The same price asked again within PRICE_KEPT_MS is the one kept (price-kept.ts).
 * `tokenId`: the Safe's coin the Top up pays with (spending.ts pickSafeCoin, the same pick); null: none can, so nothing to
 * price; undefined: the Safe isn't read yet (waiting).
 */
export function useAddCost(bridge: Bridge, wallet: string, usd: number, tokenId: string | null | undefined, again = 0): FeeCost {
  const [cost, setCost] = useState<FeeCost>(undefined);
  const asked = useRef(false);
  useEffect(() => {
    if (!(usd >= SITE_ADD_LEAST_USD) || tokenId === null) return void setCost(null);
    setCost(undefined);
    if (tokenId === undefined) return;
    const key = JSON.stringify(["site-add", wallet, usd.toFixed(2), tokenId]);
    const had = keptPrice<number>(bridge, key);
    if (had !== undefined) return void setCost(had);
    let stop: (() => void) | undefined;
    // no answer in QUOTE_WAIT_MS (as long as the relay waits for 1Click): said by name, with Try again; a price that comes
    // later still lands
    const late = setTimeout(() => setCost((c) => (c === undefined ? "late" : c)), QUOTE_WAIT_MS);
    let failed = 0;
    const ask = () =>
      void (stop = readAgain(
        () => bridge.call<{ feeUsd: number }>("subwallet.site.addCost", { id: wallet, usd: usd.toFixed(2), tokenId }),
        (r) => {
          // a service failing the first time is retried silently: the 20 s limit still holds over the retry
          if (!("problem" in r && serviceOf(r.problem) && failed === 0)) clearTimeout(late);
          if ("ok" in r && Number.isFinite(r.ok.feeUsd)) {
            keepPrice(bridge, key, r.ok.feeUsd);
            return setCost(r.ok.feeUsd);
          }
          // the relay said 1Click (or itself) didn't answer: asked again by itself (readAgain), silently the first time
          // (the waiting line stays), said only once the retry failed too (rule 9a); anything else came back at once: a
          // refusal, in its own words
          if ("problem" in r) {
            const s = serviceOf(r.problem);
            if (s && ++failed < 2) return;
            setCost(s ? { late: s } : { said: saidOf(r.problem) });
          }
        },
      ));
    // the first price with the sheet, at once; a new amount once the typing stops
    const t = asked.current ? setTimeout(ask, 300) : (ask(), undefined);
    asked.current = true;
    return () => (clearTimeout(t), clearTimeout(late), stop?.());
  }, [bridge, wallet, usd, tokenId, again]);
  return cost;
}
/** "From your Safe · $30.00 available": where the money comes from and how much is there (Trade's Buy line). */
export const fromLine = (where: string, usd: string | null): string => `From ${where} · ${usd === null ? "…" : `${dollars(usd)} available`}`;
/** Said when the amount is over what the place it comes from has; nothing is priced or asked. */
export const OVER_LINE = "That's more than your Safe has.";
const usdText = (raw: string) => `$${trimCents(Number(typedUsd(raw)).toFixed(2))}`;
/** A move's own id for the core (asking again with it is the same move): 24 letters and digits. */
const moveKey = () => `sb${Array.from(crypto.getRandomValues(new Uint8Array(22)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("")}`;

/**
 * D160: a host's own wallet by its site id ("host:<host>", the Browser's bar): its wallet ids from Spending's list, then
 * the sheet as for any site. While it is read, the sheet says so; a host with no wallet yet says where to make it.
 */
function useHostWallet(wallet: string): { ids: { id: string; also: string[] } | null; missing: boolean } {
  const { bridge } = useShell();
  const host = isHostSite(wallet);
  const [ids, setIds] = useState<{ id: string; also: string[] } | null>(host ? null : { id: wallet, also: [] });
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!host) return;
    let live = true;
    void bridge.call<SpendingWallet[]>("spending.wallets").then((r) => {
      if (!live || !("ok" in r)) return;
      const found = hostWallets(r.ok, wallet);
      if (found) setIds(found);
      else setMissing(true);
    }, () => undefined);
    return () => { live = false; };
  }, [wallet]);
  return { ids, missing };
}
/** The one line a host's sheet says while its wallet is read, or when it has none yet (D160). */
function HostWaits({ title, name, missing, onClose }: { title: string; name: string; missing: boolean; onClose: () => void }) {
  return (
    <MoneySheet title={title} onClose={onClose}>
      <p className="zf-small wl-sheet-lead" role="status">{missing ? `Open ${name} and connect your wallet there first.` : `Reading your ${name} wallet…`}</p>
    </MoneySheet>
  );
}

/** Put money in: a listed site's wallet by its id, or (D160) any host's own wallet by its site id ("host:<host>"). */
export function SiteAddSheet(p: Parameters<typeof SiteAddSheetFor>[0]) {
  const { ids, missing } = useHostWallet(p.wallet);
  if (!ids) return p.auto ? null : <HostWaits title={siteAddTitle(p.name, p.network)} name={p.name} missing={missing} onClose={p.onClose} />;
  return <SiteAddSheetFor {...p} wallet={ids.id} />;
}

function SiteAddSheetFor({ wallet, name, network, safeUsd, coins, askedUsd, auto, onAutoLine, onClose, onDone, onHeld, onOpen, onAdd, onOpenSite }: { wallet: string; name: string; network?: string; safeUsd: string | null; /** a test finding: opening the site is never gated on money: "Open pump.fun" beside Move */ onOpenSite?: () => void; /** the Safe's coins (ledger.balances; null or none: not read yet), for the fee's quote */ coins?: readonly SafeCoin[] | null; askedUsd?: string; auto?: boolean; onAutoLine?: (line: string) => void; onClose: () => void; onDone: (line: string) => void; onHeld: (h: Held) => void; onOpen: (n: NextStep) => void; onAdd: () => void }) {
  const { bridge, tasks } = useShell();
  /** The job is made (bug report, 5 Nov: no waiting screen): its dollars, and the sheet says "Job created." */
  const [made, setMade] = useState<string | null>(null);
  const start = String(Math.min(Number(askedUsd ?? SITE_ADD_USD) || SITE_ADD_USD, safeUsd !== null && Number(safeUsd) >= SITE_ADD_LEAST_USD ? Math.floor(Number(safeUsd) * 100) / 100 : SITE_ADD_USD));
  const [usd, setUsd] = useState(start);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  // the audit's rule c: a signed Add NEAR let go with nothing sent: the line and its Try again (a new Approve, a new Face ID)
  const [busyAgain, setBusyAgain] = useState<string | null>(null);
  // F2: the line names what waits in this sheet's own word ("Move waits until it's back"), never "Add"
  const services = useServices(bridge, SHEET_NEEDS.siteadd, "Add");
  const problem = useMoveProblem(onOpen, setLine);
  const emptySafe = safeUsd !== null && !(Number(safeUsd) >= SITE_ADD_LEAST_USD);
  // F4: this Add's own key: a second tap or a retry while it runs is the same move in the core; a new one after it ends
  const addKey = useRef(moveKey());
  const typed = validUsd(usd) ? Number(typedUsd(usd)) : 0;
  // the Safe's coin that pays (null: none can, so no price; undefined: the Safe not read yet, so the waiting line)
  // only a site's wallet on Solana is priced (review Low: BNB or Base would wait for ever)
  // an amount over what the Safe has is refused here, before anything is priced or asked (product decision, 3 Nov)
  const over = safeUsd !== null && typed > Number(safeUsd);
  const under = typed > 0 && typed < SITE_ADD_LEAST_USD;
  const pays = over || typed < SITE_ADD_LEAST_USD || (network !== undefined && network !== "Solana") ? null : !coins ? undefined : pickSafeCoin([...coins], typed)?.coin.tokenId ?? null;
  const [priceAgain, setPriceAgain] = useState(0);
  const cost = useAddCost(bridge, wallet, auto ? 0 : typed, pays, priceAgain);
  // D137: while the price is on its way, the seconds it has taken ("Getting a price… 0:07")
  const waited = useElapsed(!auto && cost === undefined && typeof pays === "string");
  const fee = feeLine(cost, typed, typeof pays === "string" ? waited : undefined, services.down);
  // the keypad's first key starts a new amount (Trade's Buy); Max is all the Safe has, to the cent, and the next key types
  // over it too (Finding 37: Max then 1 was the Max with a 1 on the end)
  const [fresh, setFresh] = useState(true);
  const maxUsd = safeUsd !== null && Number(safeUsd) >= SITE_ADD_LEAST_USD ? String(Math.floor(Number(safeUsd) * 100) / 100) : null;
  // how it goes (QA): Private alone in one exit, or the Safe's fill then that exit (site-route.ts); Private unread
  // (no wallet runtime above the sheet) is null, never a $0 that refuses
  const pocket = useContext(WalletRuntimeContext)?.pocket ?? null;
  const privUsd = privateUsdcOf(pocket);
  const route = siteRoute(typed, privUsd, SAFE_FILL_OPEN);
  const go = async (v: string = usd, readsAgain = false): Promise<void> => {
    // one spelling for a moving amount, cents always (audit 2 Nov: "$3 is on its way" over a row saying "$3.00")
    const amount = `$${Number(typedUsd(v)).toFixed(2)}`;
    mark("tap"); // a crawl's clock (performance.mark): tap, approved, away, landed (the wallet page's line)
    // never more than the Safe has (the button is off then too)
    if (safeUsd !== null && Number(typedUsd(v)) > Number(safeUsd)) return void setLine(OVER_LINE);
    const way = siteRoute(Number(typedUsd(v)), privUsd, SAFE_FILL_OPEN);
    // Private short and the fill not open yet: said, nothing asked (the button is off then too)
    if (way.kind === "closed") { const l = ROUTE_WORDS.closed(dollars(String(way.haveUsd))); return void (auto ? onAutoLine?.(l) : setLine(l)); }
    setBusy(true);
    setLine(null);
    setBusyAgain(null);
    // the job (bug report, 5 Nov): made the moment the Safe's Approve says yes (Face ID on every Safe
    // signature): its row on Home and in Activity, the bell's pulse, "Job created." here (the site's window hears it went);
    // the core's answer then ends the job's row, never this sheet
    let job: JobHandle | null = null;
    const make = () => {
      if (job) return;
      // its time left from the route's measured time: Private pays the site's wallet straight (job-steps.ts LEG_SEC)
      job = startJob(tasks, { title: `Add ${amount} to your ${name} wallet`, usd: amount, etaSec: LEG_SEC.privateOut });
      mark("away");
      if (auto) onDone(`${amount} is on its way to ${name}.`); else { setMade(amount); setBusy(false); }
    };
    // Private pays it alone: no Face ID, so the job is made at the tap; with the fill, on the Safe's yes (its Face ID)
    if (way.kind === "private") make();
    const stop = onOwnApproval((yes) => { if (yes) { mark("approved"); sayWent(""); make(); } });
    const r = await bridge.call<SpendingActivity | { declined: true }>("spending.topUp", { usd: typedUsd(v), ready: wallet, key: addKey.current }).finally(stop);
    // the audit's rule d: only a move that went gets a new key; a refusal or a no keeps it, so Try again is never a second move
    if ("ok" in r && !("declined" in r.ok)) addKey.current = moveKey();
    const j = job as JobHandle | null;
    const again = "problem" in r ? retryOf(r.problem, { signed: j !== null, readsAgain }) : null;
    // rule b: no yes was heard, so nothing was signed: the reads once more, by themselves (still busy), no second sheet
    if (again === "reads") return void setTimeout(() => void go(v, true), SITE_READS_AGAIN_MS);
    setBusy(false);
    sayWent("");
    if ("problem" in r) {
      // rule c: the sheet asks; its Try again opens the Safe's Approve again (Face ID), never a silent signature
      if (again === "ask" && j && !auto) { setMade(null); setBusyAgain(v); return j.failed(r.problem.whatHappened); }
      if (j) return j.failed(r.problem.whatHappened);
      // ST11: the site window says what failed (the shell's Problem screen would be behind it)
      if (auto) return void onAutoLine?.(r.problem.whatHappened);
      return void problem(r.problem, setUsd);
    }
    if ("declined" in r.ok) {
      j?.gone();
      // ST11: the person said no on the core's Approve: the window hears it (nothing moved), the move ends
      if (auto) onAutoLine?.("Not moved. Your money is still in your Safe.");
      return;
    }
    if (r.ok.held) {
      j?.made([`move:${r.ok.id}`]);
      // auto, already told it went: the hold is its row's (Home's Waiting shows it); nothing ends twice
      if (auto && j) return;
      onHeld(r.ok.held);
      // auto (ST11): the hold's own line went to the window with onHeld; nothing else ends it
      return auto ? undefined : onDone("");
    }
    if (!j) make();
    (job as JobHandle | null)?.made([`move:${r.ok.id}`]);
  };
  // ST11: the person said "Move" on the site window's own sheet: start once, as soon as the Safe's dollars are read
  const started = useRef(false);
  useEffect(() => {
    if (!auto || started.current) return;
    // the Safe's dollars not read in 15 s (an outage): say so, never sit invisible (review M2)
    const t = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      onAutoLine?.("Your Safe didn't answer. Your money hasn't moved.");
    }, 15000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auto || started.current || safeUsd === null) return;
    started.current = true;
    // the window said "Move $5": exactly that, or a line, never a smaller move (review L1)
    if (askedUsd && Number(safeUsd) < Number(askedUsd)) return void onAutoLine?.(`Your Safe has less than $${askedUsd}. Add money to it first.`);
    if (emptySafe) return void onAdd();
    if (services.down) return void onAutoLine?.(services.line ?? feeLateLine("oneclick", true));
    void go();
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (auto) return null;
  // the job is made: the design's receipt, away ("Job created."), and Done; its row follows it from here
  if (made !== null) {
    return (
      <MoneySheet title={ROUTE_WORDS.title(made, name)} onClose={() => onDone("")}>
        <div className="zf-receipt zf-receipt--job" data-state="away" role="status" aria-live="polite" data-testid="site-add-made">
          <div className="zf-receipt__obj">
            <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
            <div className="zf-receipt__coin"><span className="zf-receipt__disc"><ActAdd /></span></div>
          </div>
          <p className="zf-receipt__amount">{made}</p>
          <p className="zf-receipt__head">{JOB_WORDS.created}</p>
          <TimeLeft etaSec={LEG_SEC.privateOut} />
        </div>
        <button className="zf-btn wl-sheet-go" onClick={() => onDone("")} data-testid="site-add-done">Done</button>
      </MoneySheet>
    );
  }
  // ST1 (product decision, 2 Nov): "Put money in pump.fun" · $ · "It goes through NEAR." (audit H1: never "privately") · "Move $10"; the tile shows what it has
  // the design review's Move (§7): the title, the number, one line, the button; nothing above the sheet. a test finding: putting
  // money in is a choice, not a gate: "Open pump.fun" under it opens the site as it is
  const routeLine = network ? `Goes to your ${name} ${network} wallet.` : wayLine(route, privUsd);
  // Private's one figure (format.ts privateFigure, test MUST 3: "$25.00 available" under Move's $33.86); its USDC, the
  // part that pays a site, is said in its own line when it is less (site-route.ts privateFrom)
  const fromPriv = route.kind === "private" ? privateFrom(privateFigure(pocket), privUsd) : null;
  const from = fromPriv ? fromLine(ROUTE_WORDS.fromPrivate, fromPriv.usd) : fromLine("your Safe", safeUsd);
  const openSite = onOpenSite && !busy ? <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onOpenSite}>{`Open ${name}`}</button> : null;
  return (
    <MoneySheet title={ROUTE_WORDS.title(validUsd(usd) ? usdText(usd) : "$0", name)} away={busy} onClose={onClose}>
      {emptySafe ? (
        <>
          <p className="zf-body wl-sheet-lead">Your Safe has less than ${SITE_ADD_LEAST_USD.toFixed(2)}. Add money to it first.</p>
          <button className="zf-btn wl-sheet-go" onClick={onAdd}>Add money</button>
          {openSite}
        </>
      ) : (
        <>
          {/* Trade's Buy (product decision, 3 Nov): one number, where it comes from and how much is there, a keypad, one button */}
          <p className="zf-money__amount" aria-label={`Dollars to move to ${name}`} data-testid="site-add-amount" style={{ font: "200 56px/1.1 var(--font)", letterSpacing: "-.03em", color: "var(--ink)" }}>{`$${usd || "0"}`}</p>
          <div className="wl-swap-slide">
            <p className="zf-small wl-sheet-meta" data-testid="site-add-from">{from}</p>
            {maxUsd && <button className="wl-swap-all" disabled={busy} onClick={() => { setFresh(true); setUsd(trimCents(maxUsd)); }} aria-label={`Max, ${dollars(maxUsd)}`}>Max</button>}
          </div>
          {fromPriv?.part && <p className="zf-small wl-sheet-meta" data-testid="site-add-part">{fromPriv.part}</p>}
          {over && <p className="zf-small wl-sheet-meta" role="status" data-testid="site-add-over">{OVER_LINE}</p>}
          {(under || fresh) && !over && <p className="zf-small wl-sheet-meta" role="status" data-testid="site-add-least">{SITE_ADD_LEAST_LINE}</p>}
          {/* ST13: a site with a wallet per network says which one it goes to; a one-network site, where it comes from */}
          <p className="zf-small wl-sheet-meta" data-testid="site-add-route">{routeLine}</p>
          {fee && <p className="zf-small wl-sheet-meta" data-testid="site-add-fee">{fee}</p>}
          {(cost === "late" || (typeof cost === "object" && cost !== null)) && <button className="zf-btn zf-btn--quiet" onClick={() => setPriceAgain((n) => n + 1)}>Try again</button>}
          <SheetLine text={line ?? services.line} />
          {busyAgain !== null && !busy && <p className="zf-small wl-sheet-meta" role="status" data-testid="site-add-busy">{SITE_BUSY_LINE}</p>}
          {busyAgain !== null && !busy && <button className="zf-btn zf-btn--quiet" data-testid="site-add-busy-again" onClick={() => void go(busyAgain)}>Try again</button>}
          {!busy && <Keypad value={fresh ? "" : usd} decimals={2} onChange={(v) => { setFresh(false); setUsd(v); }} />}
          {/* under the least, the lit choice is the least itself (QA, 5 Nov: "Move $2" was a dead grey button) */}
          {under ? (
            <button className="zf-btn wl-sheet-go" data-testid="site-add-least-go" disabled={busy || services.down} onClick={() => { const least = SITE_ADD_LEAST_USD.toFixed(2); setFresh(true); setUsd(least); void go(least); }}>
              {SITE_ADD_LEAST_GO}
            </button>
          ) : (
            <button className="zf-btn wl-sheet-go" disabled={busy || services.down || over || route.kind === "closed" || !validUsd(usd) || Number(typedUsd(usd)) < SITE_ADD_LEAST_USD} onClick={() => void go()}>
              {busy ? "Getting it ready…" : validUsd(usd) ? `Add ${usdText(usd)}` : "Add"}
            </button>
          )}
          {openSite}
        </>
      )}
    </MoneySheet>
  );
}

/** The sheet's one line for the way it goes (site-route.ts): Private's one exit, the fill then it, or the fill not open. */
function wayLine(r: SiteRoute, privUsd: number | null): string {
  if (r.kind === "private") return ROUTE_WORDS.private;
  if (r.kind === "fill") return ROUTE_WORDS.fill(privUsd && privUsd >= 0.01 ? dollars(String(privUsd)) : null, `$${r.fillUsd}`);
  if (r.kind === "closed") return ROUTE_WORDS.closed(dollars(String(r.haveUsd)));
  return SITE_ADD_HOW;
}

/** The networks a site's wallet is named by on the Take out sheet ("your GMGN BNB wallet"; never "chain", ST13). */
const NETWORK_WORD: Readonly<Record<string, string>> = { sol: "Solana", bsc: "BNB", base: "Base", eth: "Ethereum" };
/** Where each leg of a Take out stands on the sheet, after the tap. */
type LegState = { went: true; id: string; usd: number } | { went: false; line: string };

/**
 * Take out: a site's wallets → the Safe, privately. `also` (ST13): the site's other funded wallets (GMGN's BNB beside its
 * Solana), so one tap sweeps them all home; each is its own leg on the core's own sheet (nothing leaves a site's wallet
 * without it), one after the other. The sheet lists the legs with their dollars before the tap; a leg that didn't go
 * names why and that its money is still in that wallet; one line follows the ones that went until they are in the Safe.
 */
/** Take out: a listed site's wallets by their ids, or (D160) any host's own wallets by its site id ("host:<host>"). */
export function SiteBackSheet(p: Parameters<typeof SiteBackSheetFor>[0]) {
  const { ids, missing } = useHostWallet(p.wallet);
  if (!ids) return <HostWaits title={TAKE_OUT_TITLE} name={p.name} missing={missing} onClose={p.onClose} />;
  return <SiteBackSheetFor {...p} wallet={ids.id} also={isHostSite(p.wallet) ? ids.also : p.also} />;
}

function SiteBackSheetFor({ wallet, also = [], name, safeUsd, askedUsd, onClose, onDone, onBack }: {
  /** `askedUsd`: the dollars the button that opened it named (crawl F5) */
  askedUsd?: number;
  wallet: string; also?: readonly string[] | undefined; name: string; safeUsd: string | null; onClose: () => void; onDone: (line: string, movementId?: string) => void; /** a test finding: back to the wallet sheet it was opened from */ onBack?: () => void }) {
  void safeUsd;
  const shell = useShell();
  const { bridge, tasks } = shell;
  const ids = [wallet, ...also.filter((x) => x !== wallet)];
  const read = useSiteWallets(ids);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [legs, setLegs] = useState<Record<string, LegState>>({});
  /** The job is made at the tap (rule 2; QA's Sim test: "Getting it ready…", no job, no time): its dollars. */
  const [made, setMade] = useState<string | null>(null);
  const doneWith = useRef<{ line: string; id: string } | null>(null);
  const services = useServices(bridge, SHEET_NEEDS.takeout, "Take out");
  const priced = (w: SpendingWallet | null | undefined): number | null => (w && w.cashUsd !== undefined && !w.unread ? Number(w.cashUsd) : null);
  const has = read === undefined ? undefined : priced(read[0]);
  // the other legs: wallets read with dollars to move (an empty one or an unread one is never a leg)
  // only a current wallet of the same site (review L2: the ids come from the hub's read, and are checked again here)
  const first = read?.[0];
  const others = (read ?? []).slice(1).flatMap((w) => (w && first && w.role === "site" && w.current && w.site === first.site && (priced(w) ?? 0) >= SITE_MIN_USD ? [w] : []));
  const sweep = has !== undefined && has !== null && has >= SITE_MIN_USD ? [read![0]!, ...others] : others;
  const total = Math.round(sweep.reduce((n, w) => n + (priced(w) ?? 0), 0) * 100) / 100;
  // a test finding: one wallet moves the amount picked (a slider and Max, the least that lands said, as Move does); a sweep of
  // several networks moves each whole, as before. Starts at $10, or the whole when that's less (a test finding's rule)
  const single = sweep.length === 1 && sweep[0]!.id === wallet;
  const [pick, setPick] = useState<number | null>(null);
  // crawl F5: opened from "Move $14.85 back to Safe", it opens at $14.85, never $10.00
  const picked = single ? backPicked(total, pick, askedUsd, SITE_ADD_USD, SITE_MIN_USD) : total;
  const amountOf = (w: SpendingWallet) => (single ? backAmount(picked, total, w.units) : "all");
  const walletName = (w: SpendingWallet) => (ids.length > 1 ? `your ${name} ${NETWORK_WORD[w.network] ?? w.network} wallet` : `your ${name} wallet`);
  const one = async (w: SpendingWallet): Promise<LegState> => {
    const r = await bridge.call<{ id: string; usd: number }>("subwallet.site.moveBack", { id: w.id, amount: amountOf(w), key: moveKey() });
    if ("problem" in r) {
      // the money is still in that wallet (review, Low: never "in your Safe" here)
      const m = r.problem.money;
      const still = m.state === "safe" && m.where === "in your Safe";
      const said = sheetLineOf(still ? { ...r.problem, money: { state: "safe", where: `in ${walletName(w)}` } } : r.problem);
      if (!said && sweep.length === 1) {
        await shell.showProblem(backProblem(r.problem, name));
        return { went: false, line: "" };
      }
      return { went: false, line: said ?? `${backProblem(r.problem, name).whatHappened} Your money is still in ${walletName(w)}.` };
    }
    return { went: true, id: r.ok.id, usd: r.ok.usd };
  };
  const go = async () => {
    setBusy(true);
    setLine(null);
    // the job at the tap (rule 2; D143: nothing asks, a hot key never does): its row on Home and in Activity, the bell's
    // pulse, "Job created." and its time left here; the core's answer hands the row to the Take out's own (back:<id>)
    const job = startJob(tasks, takeOutJob(picked, name));
    mark("away");
    setMade(`$${picked.toFixed(2)}`);
    const done: Record<string, LegState> = {};
    try {
      for (const w of sweep) {
        const r = await one(w);
        done[w.id] = r;
        // the first leg refused: nothing has moved; the job's row says why (rule 8) and the sheet comes back as it was,
        // with its line and its button (review L3)
        if (!r.went && Object.keys(done).length === 1) {
          job.failed(r.line || BACK_WORDS.stillThere(name));
          setMade(null);
          if (r.line) setLine(r.line);
          return;
        }
      }
    } catch (e) {
      job.failed(TAKE_OUT_LOST);
      setMade(null);
      throw e;
    } finally {
      setBusy(false);
    }
    const went = Object.values(done).filter((x): x is Extract<LegState, { went: true }> => x.went);
    const usdWent = went.reduce((n, x) => n + x.usd, 0);
    // the Take out's own rows (site-back.ts "back:<id>") take the job's place, with its dollars and its time left
    job.made(went.map((x) => `${BACK_ID}${x.id}`));
    if (went.length === sweep.length) {
      // the receipt stays ("Job created.", the time left) until Done or Close; they end it with this line and the row's id
      doneWith.current = { line: `$${usdWent.toFixed(2)} is on its way to your Safe.`, id: went[0]!.id };
      // its row on Home's Now at once (site-back.ts), not at the watch's next read
      void import("./live-steps.ts").then((m) => m.pokeLive(), () => undefined);
      followMoveBack((m, p) => bridge.call(m, p), went.map((x) => x.id), name, Date.now, legNetworks(went.map((x) => x.id)));
      return;
    }
    setMade(null);
    // one wallet: its line on the sheet, and the button stays to try again (as before the sweep)
    if (sweep.length === 1) {
      const l = done[sweep[0]!.id];
      if (l && !l.went && l.line) setLine(l.line);
      return;
    }
    // a leg didn't go: the sheet stays with each leg's line; the ones that went are followed home
    setLegs(done);
    const why = Object.values(done).find((x): x is Extract<LegState, { went: false }> => !x.went && Boolean(x.line));
    if (why) setLine(why.line);
    if (went.length) followMoveBack((m, p) => bridge.call(m, p), went.map((x) => x.id), name, Date.now, legNetworks(went.map((x) => x.id)));
  };
  const legNetworks = (legIds: readonly string[]) => legIds.map((id) => { const w = sweep.find((x) => x.id === id); return w ? NETWORK_WORD[w.network] ?? w.network : ""; });
  // after a partial sweep the headline is what went, never the total asked for (review M1)
  const wentUsd = Object.values(legs).reduce((n, l) => n + (l.went ? l.usd : 0), 0);
  const legLine = (w: SpendingWallet): string => {
    const l = legs[w.id];
    return !l ? dollars(String(priced(w) ?? 0)) : l.went ? "On its way" : "Not moved";
  };
  // the job is made: the design's receipt, away ("Job created.", the time left), and Done; its row follows it from here
  if (made !== null) {
    const end = () => (doneWith.current ? onDone(doneWith.current.line, doneWith.current.id) : onClose());
    return (
      <MoneySheet title={TAKE_OUT_TITLE} onClose={end}>
        <div className="zf-receipt zf-receipt--job" data-state="away" role="status" aria-live="polite" data-testid="takeout-made">
          <div className="zf-receipt__obj">
            <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
            <div className="zf-receipt__coin"><span className="zf-receipt__disc"><ActAdd /></span></div>
          </div>
          <p className="zf-receipt__amount">{made}</p>
          <p className="zf-receipt__head">{JOB_WORDS.created}</p>
          <TimeLeft etaSec={TAKE_OUT_ETA_SEC} watch />
        </div>
        <button className="zf-btn wl-sheet-go" onClick={end} data-testid="takeout-done">Done</button>
      </MoneySheet>
    );
  }
  return (
    <MoneySheet title={TAKE_OUT_TITLE} onClose={onClose}>
      {read === undefined ? (
        <p className="zf-small wl-sheet-lead">Reading your {name} wallet…</p>
      ) : has === null && !others.length ? (
        <p className="zf-body wl-sheet-lead" role="status">{`Solana didn't answer, so your ${name} wallet isn't read yet. Your money is still in it.`}</p>
      ) : !sweep.length ? (
        <>
          <p className="zf-body wl-sheet-lead">Your {name} wallet has {dollars(String(has ?? 0))}. Under ${SITE_MIN_USD}, fees would take most of it.</p>
          <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <p className="zf-money__amount" aria-label={Object.keys(legs).length ? "On its way" : single ? "To move" : "All of it"} style={{ font: "200 56px/1.1 var(--font)", letterSpacing: "-.03em", color: "var(--ink)" }}>{dollars(String(Object.keys(legs).length ? Math.round(wentUsd * 100) / 100 : picked))}</p>
          {/* where it comes from and how much is there, as Put money in says it (product decision, 3 Nov) */}
          {!Object.keys(legs).length && <p className="zf-small wl-sheet-lead" data-testid="takeout-from">{fromLine(ids.length > 1 ? `your ${name} wallets` : `your ${name} wallet`, String(total))}</p>}
          {single && !Object.keys(legs).length && total > SITE_MIN_USD && (
            <div className="wl-swap-slide">
              <input type="range" className="wl-move-range" min={SITE_MIN_USD} max={total} step={0.01} value={picked} disabled={busy} aria-label={`Amount, up to ${dollars(String(total))}`} onChange={(e) => setPick(Number(e.target.value))} />
              <button className="wl-swap-all" disabled={busy} onClick={() => setPick(total)} aria-label={`Max, ${dollars(String(total))}`}>Max</button>
            </div>
          )}
          {Object.keys(legs).length > 0 && <p className="zf-small wl-sheet-lead" role="status">{`${dollars(String(Math.round(wentUsd * 100) / 100))} is on its way to your Safe.`}</p>}
          {/* ST13: one tap sweeps every funded wallet of the site home; each leg says its dollars, then where it is */}
          {ids.length > 1 && (
            <ul className="wl-rows wl-top" aria-label="What moves" data-testid="takeout-legs" style={{ padding: 0, listStyle: "none" }}>
              {sweep.map((w) => (
                <li key={w.id} className="wl-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span className="t">{NETWORK_WORD[w.network] ?? w.network}</span>
                  <span className="t">{legLine(w)}</span>
                </li>
              ))}
            </ul>
          )}
          {ids.length > 1 && has === null && <p className="zf-small wl-sheet-lead" role="status">Solana didn't answer, so your {name} Solana wallet waits. Your money is still in it.</p>}
          {!Object.keys(legs).length && <p className="zf-small wl-sheet-lead">{single
            ? `At least ${dollars(backLeast(picked).toFixed(2))} reaches your Safe, after fees. Coins you bought stay in your ${name} wallet.`
            : `All of it. Coins you bought stay in your ${name} wallets.`}</p>}
          <SheetLine text={line ?? services.line} />
          {!Object.keys(legs).length && <button className="zf-btn wl-sheet-go" disabled={busy || services.down} onClick={() => void go()}>{busy ? "Getting it ready…" : `Take out ${dollars(String(picked))}`}</button>}
        </>
      )}
      {onBack && !busy && !Object.keys(legs).length && <button className="zf-btn zf-btn--quiet wl-sheet-go" onClick={onBack}>Back</button>}
    </MoneySheet>
  );
}

/** How often, and for how long at most, a Move back is followed to the Safe after its sheet. */
const FOLLOW_MS = 3000;
const FOLLOW_FOR_MS = 30 * 60_000;

/**
 * After the sheet: the Move back is followed through the core's own record of it (subwallet.site.moveBacks) until it
 * reaches the Safe, and then one line says so; a refund or a stop says where the money is. Only what the core read from
 * 1Click's status is said, never a guess.
 */
export function followMoveBack(call: (method: string, p?: Record<string, unknown>) => Promise<{ ok: unknown } | { problem: unknown }>, id: string | readonly string[], name: string, now: () => number = Date.now, networks: readonly string[] = []): void {
  const ids = typeof id === "string" ? [id] : [...id];
  const until = now() + FOLLOW_FOR_MS;
  const look = async () => {
    const r = await call("subwallet.site.moveBacks").catch(() => null);
    const all = r && "ok" in r && Array.isArray(r.ok) ? (r.ok as MoveBackRead[]) : [];
    const line = movesBackLine(ids.map((x) => all.find((m) => m.back.id === x)), name, networks);
    if (line) return sayWent(line.text, line.state);
    if (now() < until) setTimeout(() => void look(), FOLLOW_MS);
  };
  setTimeout(() => void look(), FOLLOW_MS);
}

/** A Move back the core or the swap service refused: who said no, and that the money is still in the site's wallet. */
export function backProblem(p: Problem, name: string): Problem {
  const swap = /swap service|1click/i.test(`${p.whatHappened} ${p.more ?? ""}`);
  if (!swap) return p;
  return { ...p, whatHappened: "NEAR Intents didn't take this move.", money: { state: "safe", where: `in your ${name} wallet` }, next: { kind: "nothing", label: "Close" } };
}
