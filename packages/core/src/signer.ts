// The Signer: the ONLY way any part of the app gets anything signed.
//
// Owned by the security layer (S1). Every other layer (ledger, trade, privacy, extension) describes what it wants as a
// TxRequest and gets back an outcome. No layer ever sees a key, builds signed bytes, or writes the words the user
// approves. The Signer builds the transaction itself, decodes the exact bytes back into plain words with its own decoder,
// simulates them on two independent nodes, shows them, asks for Face ID, signs inside the secure chip, sends, and
// confirms. The requesting layer's `why` is only a hint; the approval screen is built from the decoded bytes, so a buggy
// or compromised layer can't make the user approve something different from what will happen.
//
// Apps reach it through the bridge (`tx.describe`, `tx.request`). In the web demo and in tests, `DevSigner` (dev-signer.ts)
// implements it with a software key on testnet; on the phone, the same pipeline signs inside the secure chip.
import type { Problem } from "./problem.ts";

export type Network = "mainnet" | "testnet";

export interface AccountInfo {
  accountId: string;
  network: Network;
  keys: AccountKeyInfo[];
  /** The account contract (protection by amount, its rules) is on the account, by its code hash (isAccountPolicy). A
   *  full-access key there bypasses the contract entirely (audit, 5 Nov), so Security names it red. */
  rules?: boolean;
  /** Null until the recovery policy is set up on the account. `frozenUntilIso` (release 6 on): while a recovery waits or
   *  was just stopped by the phone, on an account with no second device of age, payments wait until then.
   *  Release 7, on `pending`: `needsSecondDevice`, a second device of age is on the account, so the finish needs its yes
   *  (`approved`) or the words-only fallback (`fallbackAtIso`); `canFinishAtIso` is the earliest finish as things stand. */
  recovery: { delaySeconds: number; pending: null | RecoveryPending; frozenUntilIso?: string | null } | null;
}

export interface RecoveryPending {
  readyAtIso: string;
  needsSecondDevice?: boolean;
  approved?: boolean;
  fallbackAtIso?: string;
  canFinishAtIso?: string;
  /** Re-audit 7: the phone's one stop of this move is waiting (its wait ends then, or the second device confirms it). */
  stopAtIso?: string;
}

export interface AccountKeyInfo {
  /** NEAR's on-chain handle, e.g. "ml-dsa-65-hash:…". */
  handle: string;
  /** "device": a phone (this one or another); "second-device": the extra signer for large amounts (laptop, later);
   *  "agent": AgentZero's key (NEAR lets it call only the account's agent methods); "session": any other function-call
   *  key (a session or trading key), which the contract's role gates refuse every method. */
  role: "device" | "recovery" | "second-device" | "agent" | "session";
  /** NEAR's own permission: "full" (can do anything with the account) or "function-call" (only the methods it names). */
  access?: "full" | "function-call";
  /** Where the private key lives. */
  kind: "secure-chip" | "recovery-words" | "development";
  /** True for the key this device signs with. */
  current?: boolean;
}

/** One NEAR transaction from the user's account to one receiver. Never raw bytes: S1 builds the bytes itself. */
export interface TxRequest {
  receiverId: string;
  actions: TxAction[];
  /** The asking layer's own one-line summary. Shown only as a hint under the decoded words, never instead of them. */
  why: string;
  /** Which app asked, for the activity log and for tests. */
  from: Requester;
  /**
   * More receivers in the SAME approval, in order, each run only if the one before it succeeded (e.g. move coins into
   * NEAR Intents, then pay). Needs the account contract (version 2); at most three more.
   */
  then?: { receiverId: string; actions: TxAction[] }[];
  /**
   * Where the money goes on after this signature, in the asking app's words (Home's Move: "it goes on to your SOL wallet,
   * privately."). Shown last and smaller, as that app's words ("Wallet says: …"), on every sheet; never instead of the
   * decoded words, and never part of what is signed.
   */
  onward?: string;
  /**
   * Whom the person entered to pay, when a step pays a 1Click deposit address for someone else (audit, core integrity 1).
   * The core signs such a payment only when the quote 1Click signed pays exactly this payee, this kind of payout (an EVM
   * address in any letter case; every other kind exactly). A quote that pays this account or one of its own wallets
   * needs none. Never shown as the payee: the sheet names the quote's own recipient.
   */
  payee?: { recipient: string; recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS" };
  /**
   * A Move's fill (the Safe → Private move in that pays one wallet with Private's share; QA, 5 Nov): a marker
   * only. Its sheet lists the legs from the core's own figures: the Safe's from the signed bytes, Private's from the
   * core's own record of the pocket's share it signed for this Move (none: left out), and their sum. Never a figure of
   * the app's, never part of what is signed.
   */
  moveFill?: true;
  /**
   * A Move's fill, the whole Move (the copy review's (a), 7 Nov): each part's units in the fill's coin, 2 to 4 of them, as
   * the wallet's plan has them (private-move.ts). Words only, never signed: the sheet says the whole Move in one line
   * only once the core finds the very leg it built among them (intents.ts legsBlock); else no line.
   */
  movePlan?: string[];
  /**
   * A Move's fill that is a Swap (Home's Swap paid through Private; the copy review's (c), 7 Nov): a marker. The sheet is titled as a
   * Swap only when the core's own record of the payment pays out another coin than the Safe's; else as a Move.
   */
  moveSwap?: true;
  /**
   * A Send's fill (the Safe → Private move in whose payout goes to someone else; product decision, 5 Nov): a marker only. Its
   * sheet says the payout as the core read it from 1Click's signed quote when the pocket's payment was joined to this
   * move in (subwallets sendPayout): the payee in full (D37), what they get, and the Safe's figure from the bytes. No
   * such record, or one that doesn't fit this move in: refused before Face ID.
   */
  sendFill?: true;
  /**
   * More of this action's signatures come after this one (the ledger's signAll, a plan of steps the account can't chain):
   * a marker only. The core says job.signed only for an action's last signature (bug report, 6 Nov).
   */
  more?: true;
  /**
   * The job this request is for (the wallet's own key of the Move or Swap, 16 to 64 letters, digits, - or _): a label
   * only, never signed and never on the sheet. Just before its sheet shows, the core says approval.asked with it, so that
   * job's row waits on the Face ID (the audit's MUST, 7 Nov: the phone's chip sheet is never heard by the page).
   */
  job?: string;
  /**
   * The steps (this request, then `then`) are separate transactions, for an account that can't chain them (the ledger's
   * approvals): ONE sheet names every step, ONE Face ID signs them all (key.signSet, at most four), each with its own
   * nonce in order, and they are sent in that order, each only once the one before it is done. Only ZeroFee's own Safe
   * screens may ask it (from "wallet" or "trade", stamped by forApps); any other app is refused by name.
   */
  apart?: true;
}

/**
 * What the core's own door asked a payment to be (QA, 5 Nov): a Swap in the Safe, or a Move into one of the
 * person's own wallets, bound to the deposit address the core itself was quoted. Never a field of TxRequest: an app, a
 * page or the relay can't set it or take it off. The core sets it (DemoCore, from its own quote doors' record; or a
 * core caller, as the second argument of Signer.request). Under it the payment must describe as exactly that swap or
 * move, or the core refuses before any sheet (security.intent.changed).
 */
export interface BoundIntent {
  kind: "swap" | "move";
  /** The one deposit address the core asked for; absent: any its own record names for this kind. */
  depositAddress?: string;
}

/** Every app inside ZeroFee, plus the security layer itself. */
export type Requester = "wallet" | "pay" | "trade" | "extension" | "browser" | "social" | "agent" | "earn" | "chat" | "security";

export type TxAction =
  | { kind: "transfer"; yocto: string }
  | { kind: "call"; method: string; args: Record<string, unknown>; depositYocto: string; gas: string };

/** What the approval screen shows, produced by S1's decoder from the exact bytes that will be signed. */
export interface PlainWords {
  /** e.g. "Send 2,000 USDC to 0xAB12…9F on Base" */
  title: string;
  lines: string[];
  warnings: Warning[];
  /**
   * Expected effect, from balances read on two independent nodes. `after` is the worst case, after the largest fee.
   * Both are rounded down for reading (4 decimals). Amounts that move, in the title and lines, are always exact.
   */
  effect: { token: string; before: string; after: string }[];
  // an empty `before` is a row that says only where it ends ("Your Safe after", "$1,090.50 in USDC": separate steps, 53):
  // the sheet draws `after` alone, no arrow
  /** The asking app's own words ("Wallet says: …"). Shown smaller, under everything above, never instead of it. */
  hint?: string;
  /** D146: the app that asked, as forApps stamped it ("wallet", "browser"…); absent: ZeroFee's own screens. A sheet shows
   *  only while that app is on screen (approval-policy.ts mayShowSheet). Never shown as words. */
  asker?: string;
  /** D143 (review, 3 Nov): a hot key's sheet (a trading, site or row wallet; never the Safe's money): Approve is
   *  one tap, no Face ID. Set only by the core's own hot-key sheets (subwallets.ts, hot-sheets.ts), never by an app. Absent:
   *  Face ID, as every sheet before it. */
  tap?: true;
  /** What the account's protection does with it, from the account contract (two nodes): runs now, waits, or needs the
   *  second device. Absent for accounts without the account contract. */
  protection?: { level: "faceid" | "wait" | "device" | "both"; waitSeconds: number; text: string };
  /** The most the network fee can be, exactly as the sheet's "Fee: at most …" line says it ("0.011 NEAR"), so a screen
   *  before the sheet can show the same figure (grade 02f, F1). */
  fee?: string;
  /** What the request pays or sends, in dollars with the coin amount after them ("about $0.04 (0.01 NEAR)", "$5.00
   *  (5 USDC)"), from the decoded bytes and the sheet's price (grade 02g, G11). Absent when nothing leaves or no price is
   *  known: never a made-up dollar figure. Shown under the title, on the web sheet and the phone's own sheet. */
  amount?: string;
  /** The lines already say what leaves (a Move's split block): the sheet draws no "Amount:" line (one amount, said once).
   *  Set only by the core's own words (and the Sim's copy of them), never by an app. */
  amountSaid?: true;
  /** Off mainnet: the sheet says "Test network" once, as a small mark (grade 02h, H10), never "on NEAR testnet" on a
   *  line. From the core's own chain, never from an app. */
  testNetwork?: true;
  /**
   * Long parts of what is approved, each under a label that says what it holds ("See which coins count": a rule's every
   * coin and its limit, by human name). The sheet shows the label under the lines and opens it with one tap: the summary
   * leads, nothing is left off the sheet (UI-SIMPLICITY-RULES rules 2 and 6; phone test, 2 Nov).
   */
  details?: Details[];
}

/** A disclosure under a summary: its label says what it holds; its lines are the full words. */
export interface Details {
  label: string;
  lines: string[];
  /** Shown open, never folded (the audit and the copy review, 5 Nov: a Send's fill sheet shows the payee's full address with no tap),
   *  directly under the line it names (`after`); its one line is an address: the money face, in groups of 4, tap to copy. */
  open?: { after: string };
}

/**
 * Characters that change how the text around them reads (audit CORE-02): control characters and line breaks, direction
 * marks, overrides and isolates, invisible joiners, Unicode tag characters (U+E0000–E007F) and stray variation
 * selectors. Text from the bytes (a memo the other side chose) or from an app
 * never carries them onto a sheet.
 */
const UNREADABLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff\u{e0000}-\u{e007f}]/gu;
/** Variation selectors (security review 2 Nov, Low): invisible, so they can hide in a name or an address. Only an
 *  emoji's own presentation selector (U+FE0E or U+FE0F right after a pictograph, as in \u2764\ufe0f) stays; every other one blanks. */
const SELECTOR = /(\p{Extended_Pictographic})?([\ufe00-\ufe0f\u{e0100}-\u{e01ef}])/gu;
export const readable = (text: string): string =>
  text.replace(UNREADABLE, " ").replace(SELECTOR, (all, base: string | undefined, vs: string) => (base && (vs === "\ufe0f" || vs === "\ufe0e") ? all : `${base ?? ""} `));

/** The same words with every field readable as it stands. */
export function readableWords(w: PlainWords): PlainWords {
  return {
    ...w,
    title: readable(w.title),
    lines: w.lines.map(readable),
    warnings: w.warnings.map((x) => ({ ...x, text: readable(x.text) })),
    effect: w.effect.map((e) => ({ token: readable(e.token), before: readable(e.before), after: readable(e.after) })),
    ...(w.hint !== undefined ? { hint: readable(w.hint) } : {}),
    ...(w.protection ? { protection: { ...w.protection, text: readable(w.protection.text) } } : {}),
    ...(w.fee !== undefined ? { fee: readable(w.fee) } : {}),
    ...(w.amount !== undefined ? { amount: readable(w.amount) } : {}),
    ...(w.details ? { details: w.details.map((d) => ({ label: readable(d.label), lines: d.lines.map(readable), ...(d.open ? { open: { after: readable(d.open.after) } } : {}) })) } : {}),
  };
}

export interface Warning {
  kind: "first-time-recipient" | "large-amount" | "unknown-contract" | "key-change" | "simulation-disagrees" | "effect-unknown";
  text: string;
}

export type TxOutcome =
  /** `explorerUrls`: every transaction sent, in order, for a request of separate steps (TxRequest.apart). */
  | { status: "done"; txHash: string; explorerUrl: string; explorerUrls?: string[] }
  /** Accepted by the account's rules, but held: it waits until `readyAtIso` (the phone can cancel), and/or needs the
   *  second device's OK. Nothing has moved yet. `id` names it in `account.waiting`. */
  | { status: "waiting"; txHash: string; explorerUrl: string; id: string; readyAtIso: string; needsSecondDevice: boolean; explorerUrls?: string[]; unsent?: number }
  | { status: "declined" } // the user said no, or closed the approval screen: not an error
  | { status: "problem"; problem: Problem };

export interface Signer {
  account(): Promise<AccountInfo>;
  /** Decode only: what the approval screen WOULD say. Lets layers preview and test without asking for Face ID. */
  describe(request: TxRequest, intent?: BoundIntent): Promise<PlainWords>;
  /** Build → decode → read balances on 2 nodes → show → Face ID → sign in the chip → send → confirm on 2 nodes. */
  request(request: TxRequest, intent?: BoundIntent): Promise<TxOutcome>;
}
