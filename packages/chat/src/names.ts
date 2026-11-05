// Who is who in ZeroFee Chat (J3 part 2): a key's NEAR name, checked. A name record (core chat-near.ts) says "this chat
// key is alice.near", signed by one of alice.near's keys and by the chat key; Chat checks both signatures here, then
// asks NEAR whether that key is still one of the account's own device keys (ledger.accountKey). Only then is the name
// shown, with its mark. Display only: a name never moves money, and a payment always goes through Send and the core's
// sheet. Security review of the design (2 Nov): H1 (whose keys count: the ledger's rule), M1 (nicknames), M6 (cache by
// the account's key, back off on no, only the keys on screen), L3, L4.
import type { Bridge } from "@zerofee/core/bridge";
import { readNameEvent, type ChatNameRecord } from "@zerofee/core/chat-near";

/** The web demo's sample account names, for their label only (whether one is checked is the bridge's to say). */
const SAMPLE_NAME = /^zf-sample\d{6}\.testnet$/;
// SIM_ACCOUNT and accountWords live in account-words.ts (no imports), so Home's Details says the same words, light
import { SIM_ACCOUNT, accountWords } from "./account-words.ts";
export { SIM_ACCOUNT, accountWords };

/** "Here, you post as …" above "Use my NEAR account here": your account, or in the Sim, your sample account. */
export function postAsLine(account: string | null): string {
  if (!account) return "Here, you post as your NEAR account. Open your account first.";
  return account === SIM_ACCOUNT ? "Here, you post as your sample account." : `Here, you post as your NEAR account, ${accountWords(account)}.`;
}
import type { NostrEvent } from "@zerofee/core/nostr";
import { readable } from "@zerofee/core/signer";

/** A key's name, as far as this device knows. */
export type NameState =
  | { status: "none" }
  | { status: "checking"; account: string }
  | { status: "checked"; account: string }
  | { status: "not-checked"; account: string };

const OK_MS = 10 * 60_000;
const NO_MS = 2 * 60_000;
const UNREADABLE_MS = 60_000;

/** The names of the keys Chat has on screen. `onChange` runs when one is checked (or stops being). */
export class NameBook {
  private readonly records = new Map<string, { at: number; record: ChatNameRecord | null }>();
  /** NEAR's word on (account, key): by the account's key, not the chat key (M6), so one account naming a thousand chat
   *  keys asks NEAR once. */
  private readonly verdicts = new Map<string, { onAccount: boolean | null; until: number }>();
  private readonly asking = new Set<string>();
  private readonly bridge: Pick<Bridge, "call">;
  private readonly onChange: () => void;
  private readonly now: () => number;

  constructor(bridge: Pick<Bridge, "call">, onChange: () => void, now: () => number = Date.now) {
    this.bridge = bridge;
    this.onChange = onChange;
    this.now = now;
  }

  /** A name event from the servers (its id and signature already checked by the pool). The newest per key counts. */
  see(e: NostrEvent): void {
    // Not newer than the one kept: dropped before any signature is checked (diff review L5: a relay replaying old
    // records would otherwise cost an ML-DSA check each).
    const kept = this.records.get(e.pubkey);
    if (kept && kept.at >= e.created_at) return;
    const read = readNameEvent(e, this.now());
    if (!read) return;
    const had = this.records.get(read.chatKey);
    if (had && had.at >= read.at) return;
    this.records.set(read.chatKey, { at: read.at, record: read.record });
    this.onChange();
    if (read.record) void this.check(read.record);
  }

  /** What this device itself just signed (nostr.bind / bound): known at once, still checked on NEAR like any other. */
  mine(e: NostrEvent): void {
    this.see(e);
  }

  private keyOf(r: ChatNameRecord): string {
    return `${r.account}|${r.publicKey}`;
  }

  private async check(r: ChatNameRecord): Promise<void> {
    const k = this.keyOf(r);
    const v = this.verdicts.get(k);
    if ((v && v.until > this.now()) || this.asking.has(k)) return;
    this.asking.add(k);
    try {
      const res = await this.bridge.call<{ onAccount: boolean | null }>("ledger.accountKey", { accountId: r.account, publicKey: r.publicKey });
      const onAccount = "ok" in res ? res.ok.onAccount : null;
      this.verdicts.set(k, { onAccount, until: this.now() + (onAccount === true ? OK_MS : onAccount === false ? NO_MS : UNREADABLE_MS) });
    } finally {
      this.asking.delete(k);
    }
    this.onChange();
  }

  state(pubkey: string): NameState {
    const r = this.records.get(pubkey)?.record;
    if (!r) return { status: "none" };
    const v = this.verdicts.get(this.keyOf(r));
    if (!v) {
      void this.check(r);
      return { status: "checking", account: r.account };
    }
    if (v.until <= this.now()) void this.check(r);
    return v.onAccount === true && Date.parse(r.until) > this.now() ? { status: "checked", account: r.account } : { status: "not-checked", account: r.account };
  }

  /** The checked account of a key, or null. */
  account(pubkey: string): string | null {
    const s = this.state(pubkey);
    return s.status === "checked" ? s.account : null;
  }
}

/** The small word after a checked name's mark: a sample account on the demo, a test-network name, or none. */
export function markWord(account: string): string | null {
  // the Sim's own account already says "Sample account" (accountWords): never "sample" twice
  if (SAMPLE_NAME.test(account)) return "sample";
  if (account.endsWith(".testnet")) return "test network";
  return null;
}

/** Check marks and look-alike dots: never in a nickname as it is shown (M1). */
const MARKS = /[✓✔☑✅]/gu;
const DOTS = /[.․．。｡·•]/u;

/** A BitChat nickname as ZeroFee shows it: no check marks; one that could pass for a NEAR name (any dot, or a dot's
 *  look-alike) says it isn't checked, so only the mark's own badge ever says a name is someone's account. */
export function nickWords(raw: string): string {
  const nick = readable(raw).replace(MARKS, "").trim() || "anon";
  return DOTS.test(nick) ? `${nick} (not checked)` : nick;
}
