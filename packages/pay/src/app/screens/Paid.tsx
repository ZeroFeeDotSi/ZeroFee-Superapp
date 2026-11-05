// Paid: the tick, the exact amount, who got it, and how long it took from the scan (the stopwatch, never a guess).
// Its word is Activity's for the same movement (wallet format.ts describe): "Sent" for Wallet's Send, "Paid" for Pay's.
import { Mark } from "@zerofee/design/Mark.tsx";
import { Tick, Outward } from "../icons.tsx";
import type { Held } from "../../pay.ts";
import type { Confirm } from "../../pay.ts";
import type { Movement } from "@zerofee/wallet/types.ts";
import { paymentDollars, seconds, shownFor, youPay } from "../format.ts";
import { Address } from "./Address.tsx";

export function Paid({ c, movement, ms, fromScan, onDone, onOpen }: { c: Confirm; movement: Movement; ms?: number; fromScan: boolean; onDone: () => void; onOpen: (url: string) => void }) {
  const word = movement.kind === "pay" && movement.caller !== "wallet" ? "Paid" : "Sent";
  const amount = `${shownFor(c.target.amount, c.target.token)} ${c.target.token.symbol}`;
  // "Paid with" only when it adds something: never the amount said again (0.01 NEAR sent with 0.01 NEAR).
  const paidWith = c.maxIn === c.expectedIn && youPay(c).value !== amount ? youPay(c).value : null;
  // In dollars too, as the sheet said it (grade 02g, G11/E17).
  const usd = paymentDollars(c);
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center zf-enter" style={{ display: "grid", justifyItems: "center" }}>
        <Tick />
        <div className="zf-label" style={{ marginTop: 26 }}>{word}</div>
        <div className="py-big" style={{ marginTop: 10 }}>{shownFor(c.target.amount, c.target.token)} <small>{c.target.token.symbol}</small></div>
        {usd && <p className="zf-body" style={{ marginTop: 4 }}>{usd}</p>}
        <p className="zf-body" style={{ marginTop: 6 }}>to {c.payeePlain}{c.target.to.kind === "chain" ? `, on ${c.network}` : ""}</p>
        <CodeSays c={c} />
        {ms !== undefined && <p className="zf-small" style={{ marginTop: 6 }}>{seconds(ms)} {fromScan ? "from scan to paid" : "from tap to arrival"}</p>}
      </div>
      <div className="zf-fill" />
      {paidWith && <div className="py-rows zf-enter-2"><div className="py-split"><span>{word} with</span><span>{paidWith}</span></div></div>}
      {/* One action (grade 02g, E17): Done. The record on the chain is a quiet link, not a second button. */}
      <div className="py-floor">
        <button className="zf-btn" onClick={onDone}>Done</button>
        {movement.explorerUrls[0] && (
          <button className="zf-link" onClick={() => onOpen(movement.explorerUrls[0])}>See the record on {c.network} <Outward /></button>
        )}
      </div>
    </div>
  );
}

/** The name a code gave itself, only ever as the code's words, under who was really paid. */
function CodeSays({ c }: { c: Confirm }) {
  return c.labelFromCode ? <p className="zf-small" style={{ marginTop: 4 }}>The code says it's {c.payee}</p> : null;
}

/** On hold: the account's protection is holding this payment. Nothing has moved, and the payee isn't paid yet. `ended`:
 *  how the hold ended while this screen was up (cancelled: nothing was sent; ran: it went). */
export function OnHold({ c, held, onDone, ended }: { c: Confirm; held?: Held; onDone: () => void; ended?: "ran" | "cancelled" }) {
  const when = held ? new Date(held.readyAtIso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center zf-enter" style={{ display: "grid", justifyItems: "center" }}>
        <Mark size={96} mode="still" />
        <div className="zf-label" style={{ marginTop: 26 }}>{ended === "cancelled" ? "Cancelled" : ended === "ran" ? "On its way" : "On hold"}</div>
        <div className="py-big" style={{ marginTop: 10 }}>{shownFor(c.target.amount, c.target.token)} <small>{c.target.token.symbol}</small></div>
        <p className="zf-body" style={{ marginTop: 6 }}>to {c.payeePlain}</p>
        <CodeSays c={c} />
        {ended === "cancelled" ? (
          <p className="zf-small" style={{ marginTop: 14, maxWidth: 300 }}>Cancelled. Nothing was sent. Your money stays in your Safe.</p>
        ) : ended === "ran" ? (
          <p className="zf-small" style={{ marginTop: 14, maxWidth: 300 }}>It went. It shows in Activity.</p>
        ) : (
          <p className="zf-small" style={{ marginTop: 14, maxWidth: 300 }}>
            Nothing has moved yet. Your protection holds payments this big{held?.needsSecondDevice ? " until your laptop agrees" : when ? ` until ${when}` : ""}. You can cancel it until then. Nothing is paid before that.
          </p>
        )}
      </div>
      <div className="zf-fill" />
      <div className="py-floor"><button className="zf-btn" onClick={onDone}>Done</button></div>
    </div>
  );
}

/**
 * After the small first top-up to a new card (or a test send to a new exchange address): the chain can't prove the
 * address is THIS person's (a look-alike costs cents). So the person checks its own app; only "Yes" unlocks more.
 * `amount` as said ("5 USDC"); `after` the line under the question.
 */
export function Arrived({ amount, card, after, onAnswer }: { amount: string; card: string; after?: string; onAnswer: (a: "yes" | "no" | "not-yet") => void }) {
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center zf-enter" style={{ display: "grid", justifyItems: "center" }}>
        <Tick />
        <div className="zf-label" style={{ marginTop: 26 }}>Sent</div>
        <h1 className="zf-title" style={{ marginTop: 12 }}>Did {amount} arrive in your {card} app?</h1>
        <p className="zf-small" style={{ marginTop: 10, maxWidth: 300 }}>{after ?? `Open ${card} and look. Pay sends bigger top-ups to this card only after you say yes.`}</p>
      </div>
      <div className="zf-fill" />
      <div className="py-floor">
        <button className="zf-btn" onClick={() => onAnswer("yes")}>Yes, it arrived</button>
        <button className="zf-link" onClick={() => onAnswer("not-yet")}>Not yet</button>
        <button className="zf-link" onClick={() => onAnswer("no")}>No, it didn't</button>
        <p className="zf-small">Not yet? Pay asks again next time you open it.</p>
      </div>
    </div>
  );
}

/**
 * "No, it didn't" (the robot's walk): one plain screen, nothing from the card's screen under it. What happened, where
 * the money is, one next step. Pay has already forgotten that address (it may be a look-alike), so the money words say
 * both cases (Security's MUST on 1ea4d90), and the address is shown to compare, never put back on the clipboard, where
 * the next paste would reuse it (Security, UI's final round).
 */
export function NotArrived({ card, address, onOpen, onAgain }: { card: string; address: string; onOpen?: () => void; onAgain: () => void }) {
  return (
    <div className="py py-col">
      <div className="zf-fill" />
      <div className="py-center zf-enter">
        <h1 className="zf-title">Your money didn't show in {card}.</h1>
        <p className="zf-body" style={{ marginTop: 10 }}>It went to the address you pasted. If that was your {card} address, the money may still show there. If not, ZeroFee can't get it back.</p>
      </div>
      {address && <div style={{ marginTop: 18 }}><Address value={address} /><p className="zf-small" style={{ marginTop: 6 }}>Compare it with the address in {card}.</p></div>}
      <div className="zf-fill" />
      <div className="py-floor">
        {onOpen ? <button className="zf-btn" onClick={onOpen}>Open {card}</button> : <button className="zf-btn" onClick={onAgain}>Try another address</button>}
        {onOpen && <button className="zf-link" onClick={onAgain}>Try another address</button>}
      </div>
    </div>
  );
}
