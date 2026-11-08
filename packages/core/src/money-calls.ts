// What a plain throw can say (audit, 6 Nov): "Nothing moved" is true only of a call that can't move money. The one list of
// those calls is here, pure; every other method, a new one included, gets "Check Activity": a throw in a money call says
// nothing about whether its money left. The reasons per entry: sim-crawls/2026-11-06-unknown-errors/CRAWL.md.
import type { Problem } from "./problem.ts";
import { READS } from "./read-deadline.ts";
import { securityProblems } from "./security-problems.ts";

const NOTHING_MOVES: ReadonlySet<string> = new Set([
  ...READS, // read-deadline.ts: methods that only read
  // the core's other reads
  "account.fund.coins", "account.fund.status", "account.safeUpdate", "alerts.poll", "account.alertsEmail.available", "card.check", "secondDevice.alerts", "subwallet.read", "subwallet.sendPrivate.status", "subwallet.near.balance", "subwallet.near.wallet", "subwallet.private.moves", "subwallet.private.addsOnWay", "subwallet.add.onWay", "subwallet.add.watch", "subwallet.site.addCost", "subwallet.site.signIns", "subwallet.site.moveBacks", "subwallet.cap.check", "subwallet.preflight", "tx.describe",
  // a quote or an address: nothing is signed or sent
  "account.fund.start", "subwallet.add.quote", "subwallet.private.quoteIn", "subwallet.float.quoteAdd", "subwallet.float.swapQuote", "subwallet.safeSwapQuote",
  // signs and hands the bytes back, and the app sends them: a throw hands nothing back (Trade's refusal stays a plain one)
  "subwallet.signTx", "subwallet.signMessage", "subwallet.signTypedData", "subwallet.near.trade", "subwallet.session.start",
  // touches no money: a word, a note, a setting, a key shown, a session ended, a first-run step whose way on is Try again
  "account.create", "account.fund.note", "account.alertsEmail", "account.alertsEmailStop", "subwallet.add.seen", "subwallet.create", "subwallet.export", "subwallet.linkStart", "subwallet.site.forHost", "subwallet.site.forAgent", "subwallet.session.end", "subwallet.session.endAll", "recovery.check", "recovery.words", "recovery.confirm", "recovery.backup", "card.balance",
  // the ledger's reads and quotes
  "ledger.depositAddress", "ledger.receiveChain", "ledger.accountKey", "ledger.daoPolicy", "ledger.nearProfile", "ledger.daosOf", "ledger.quotePay", "ledger.quoteConvert", "ledger.swapQuote", "ledger.startNetworks", "ledger.startQuote", "ledger.quoteToPrivate", "ledger.sendFee", "ledger.privateMoveStatus", "ledger.services", "ledger.status",
  // the ledger's settings
  "ledger.relabel", "ledger.privateSetup", "ledger.privateDefault",
  // Settings → Status's read-only checks (status-probe.ts): no key, no account, no money
  "status.probe",
  // its own servers (phase 2): the hosts, a Test against a typed address, keeping or clearing one; no money
  "status.own.get", "status.own.test", "status.own.set", "subwallet.own.set", "subwallet.own.state",
  // Spending's other calls that touch no money
  "spending.setCap", "spending.exportKey", "spending.swap.find", "spending.swap.held", "spending.swap.quote",
]);
/** Whole doors with no money in them: Chat's keys, a site's codes, the sign-in mailbox. */
const NOTHING_MOVES_DOORS = ["nostr.", "site2fa.", "sitemail."];

/** Whether "nothing moved" is true of a plain throw in this call. Anything not listed: false (a new method is a money call). */
export const movesNothing = (method: string | undefined): boolean => method !== undefined && (NOTHING_MOVES.has(method) || NOTHING_MOVES_DOORS.some((d) => method.startsWith(d)));

/** The core's Problem for a plain throw in `method`. */
export const unexpectedFor = (method: string | undefined, e: unknown): Problem => (movesNothing(method) ? securityProblems.unexpected(method, e) : securityProblems.unexpectedMoney(method, e));

/** A read's plain throw inside a money call: its "Nothing was sent" is only that read's, so the money call says it can't know. */
export const readsOnly = (p: Problem): boolean => p.code === "security.unexpected" || p.code === "ledger.unexpected";

/** Whether a refusal leaves its money unknown, or some of it gone (audit, 6 Nov): its one step is Activity, its money is
 *  unsure, on its way or coming back, or NEAR hasn't confirmed its send. A Move whose part ends so starts no part after
 *  it (private-move.ts, move-run.ts): no new payment while one is unknown. Pure: a table test. */
export const moneyMayHaveMoved = (p: Problem): boolean =>
  (p.next.kind === "open" && p.next.screen === "activity") || p.money.state === "unsure" || p.money.state === "on-the-way" || p.money.state === "coming-back" || p.code === "ledger.send.unread";
