// The second device (S1.8): the laptop (or a spare phone) that must also say yes to the person's biggest requests.
//
// It has its own key, made here and never on the phone. The phone adds that key to the account through the account
// contract, which lets it call only `approve` and `decline`, and (release 7) `approve_recovery` and `refuse_recovery`:
// it can't send anything, change a rule, or act alone. Release 7: a move to a new device needs this device's yes to
// finish (or waits the words-only fallback), and this device can refuse it at any time.
// Before it says yes, it reads the held request from the account contract itself on two nodes and shows it in the
// same plain words the phone's sheet used. It never trusts the phone's screen, and the phone never trusts its screen:
// that's what makes it a second check.
//
// Pairing: this device shows its public key as a QR (`laptopCode`). The phone scans it and approves adding it on its own
// sheet, which shows the key's short fingerprint, and so does this screen.
// In the web demo the key is a software key kept in a BrowserVault; on a Mac it belongs in the Secure Enclave.
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { bytesToBase64, toBase58 } from "@fastnear/utils";
import type { Bridge, BridgeResult } from "./bridge.ts";
import type { Chain } from "./chain.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner, handleOf } from "./dev-signer.ts";
import type { Approve } from "./dev-signer.ts";
import { shortKey } from "./format.ts";
import { PAIRING_B32, PAIRING_PREFIX, pairingCodeBytes } from "./pairing-code.ts";
import { heldRequests } from "./held.ts";
import type { HeldRequest } from "./held.ts";
import { ACCOUNT_POLICY, isSecondDeviceMethods, knownReleaseBySha, policyVersion } from "./known-contracts.ts";
import { codeOf } from "./chain.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords, TxOutcome } from "./signer.ts";
import type { Vault } from "./vault.ts";

const SEED = "second-device-seed";
/** A date and time as the person's own clock shows it, never UTC. */
const localClock = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** What a second device answers: what needs its yes, and the phone's stop of a recovery (it may refuse a thief's). And
 *  what it already said yes to, until it goes (H43): its page says "You said yes. It goes in …", with nothing to answer. */
const forThisDevice = (r: HeldRequest) => r.needsSecondDevice || r.kind === "CancelRecovery" || r.secondDeviceSaidYes === true;
/** The stop's advice, for the device that answers it (the phone's own Waiting list has no yes or no for it). */
const STOP_ADVICE = "Say yes if the owner asked. Say no if a thief may have it.";
const withAdvice = (r: HeldRequest): HeldRequest => (r.kind === "CancelRecovery" ? { ...r, lines: [...r.lines, STOP_ADVICE] } : r);
/** Release 7 audit, R7-1: the phone's request to remove THIS device. Listed as a warning, with no yes or no (the device
 *  can't refuse its own removal, audit F2/F3): the owner who didn't ask it starts a recovery from the words instead. */
export const REMOVAL_WARNING = "Not you? Use your 24 words to move your account to a new device.";
/**
 * QA's MUST (5 Nov, the Safe's update path): this device's yes to an Upgrade or an AllowRelease counts only for
 * a release its OWN bundle lists (known-contracts: ZeroFee's current one or an offered one, by sha256). Anything else is
 * unknown code: shown red, "Unknown code. Say no", never "update", and a yes is refused before anything is signed, so
 * one compromised channel (the phone, the relay, a node) can't get a co-signed fast update.
 */
export const UNKNOWN_CODE_TITLE = "Unknown code. Say no";
export const UNKNOWN_CODE_WARNING = "This isn't a ZeroFee version. Whoever asked for this may be trying to take your account.";
export const unknownUpdate = (r: Pick<HeldRequest, "kind" | "releaseSha256Hex">): boolean =>
  (r.kind === "Upgrade" || r.kind === "AllowRelease") && (!r.releaseSha256Hex || knownReleaseBySha(r.releaseSha256Hex) === null);
/** Unknown code's own warning always, first (the audit's SHOULD: an older warning never hides it); any other follows it. */
export const markUnknown = (r: HeldRequest): HeldRequest => (unknownUpdate(r) ? { ...r, title: UNKNOWN_CODE_TITLE, warning: r.warning && r.warning !== UNKNOWN_CODE_WARNING ? `${UNKNOWN_CODE_WARNING} ${r.warning}` : UNKNOWN_CODE_WARNING } : r);
const removesThis = (r: HeldRequest, mine: string) => r.kind === "RemoveKey" && r.removesKey === mine;
const asWarning = (r: HeldRequest): HeldRequest => ({ ...r, title: "Your main device asked to remove this device", lines: [REMOVAL_WARNING], warning: REMOVAL_WARNING, needsSecondDevice: false, ready: false, kind: "RemoveThisDevice" });
/** Release 7: the waiting recovery itself, as a request this device answers (its id in the list). */
export const RECOVERY_REQUEST_ID = "recovery";
const RECOVERY_ADVICE = "Say yes if you are moving to a new device. If not, say no: the move ends.";
/** The contract's own work on a yes to a recovery (it records one row) and on a refusal (it ends the move and drops what
 *  the phone asked alone): well inside this. */
const RECOVERY_ANSWER_GAS = 30_000_000_000_000n;
/** A key as the contract holds it: base64 of its borsh form (tag 2 + 1,952 bytes). */
const borshOf = (publicKey: string) => bytesToBase64(new Uint8Array([2, ...decodePublicKey(publicKey)]));
/** Release 10 (round 2, the laptop veto: lib.rs `decline`): a second device of age's no to anything the phone asked alone
 *  ends every request the phone asked alone and opens a dispute for a change's wait (`floor_ns`: the recovery delay plus
 *  as much again, up to a day more; 72 hours on the app's 48-hour account). Until it ends, or the backup words end it
 *  (`end_dispute`), the phone's Face ID payments stop and the phone alone asks nothing that waits. */
export interface Veto {
  /** This device has been on the account for a change's wait (`second_device_ages` reads 0 for it). */
  aged: boolean;
  /** The dispute's length: the account's change wait, from its own `delay_seconds`. */
  floorSeconds: number;
  /** Every second device's key as the contract holds it (base64 of its borsh form): no device turns down their removal. */
  secondDevices: readonly string[];
}
const DAY_S = 86_400;
/** The contract's `floor_ns`, in seconds: the recovery delay plus as much again, up to a day more. */
export const floorSeconds = (delaySeconds: number) => delaySeconds + Math.min(delaySeconds, DAY_S);
/**
 * How long this device's no to `r` pauses the account (seconds), or undefined when the no ends only `r`: an older
 * contract (`veto` null), a device not yet of age, the phone's stop of a recovery or the move itself (their own rules),
 * a second device's removal (the contract refuses its no), or what a second device already said yes to (co-signed: the
 * contract refuses its no; this device's page shows it as said, with nothing to answer). lib.rs `decline`, `phone_alone`.
 * `veto` "unknown" (the nodes didn't answer its views, the audit's SHOULD): it fails toward asking, "unknown" for anything that
 * may pause (a removal too: which keys are second devices is unread).
 */
export function pauseOnNo(r: Pick<HeldRequest, "kind" | "removesKey" | "secondDeviceSaidYes">, veto: Veto | "unknown" | null): number | "unknown" | undefined {
  if (veto === null) return undefined;
  if (r.kind === "CancelRecovery" || r.kind === "Recovery" || r.kind === "RemoveThisDevice") return undefined;
  if (r.secondDeviceSaidYes) return undefined;
  if (veto === "unknown") return "unknown";
  if (!veto.aged) return undefined;
  if (r.kind === "RemoveKey" && r.removesKey !== undefined && veto.secondDevices.includes(r.removesKey)) return undefined;
  return veto.floorSeconds;
}
/** What this device's page lists: a held request, and how long its no would pause the account (`pauseOnNo`), or
 *  `pauseUnknown` when the account couldn't be read just then (its no may pause it: the page asks first all the same). */
export type SecondDeviceRequest = HeldRequest & { pauseSeconds?: number; pauseUnknown?: true };

/** A no's gas. Release 10's laptop veto (round 2): one no drops EVERY request the phone asked alone, so its cost grows with
 *  the queue. QA's G3-1 (5 Nov, pinned near-sandbox 2.13.4): with the queue full (20 waiting, about 3.2 KB
 *  each) one no burns 19.52 Tgas; at the old 10 Tgas it ran out of gas, dropped nothing, and a thief could fill the queue
 *  on purpose to defeat the veto. 40 Tgas is twice that worst case, 0.04 NEAR against this key's 1 NEAR fee allowance.
 *  A yes may finish the held request, carrying out its own steps: its gas is the request's (held.ts yesGasFor), never a
 *  flat 300 Tgas, which NEAR prices at 0.30 NEAR against the allowance before running anything and refuses once the
 *  allowance has burnt down below that. */
export const NO_GAS = 40_000_000_000_000n;
/** G3-1's measured worst no (Tgas in gas units): a full queue's drop, release 10 on the pinned sandbox. */
export const NO_GAS_MEASURED_WORST = 19_520_000_000_000n;

/** The pairing code: the public key in base32, which a QR code stores in its compact letters-and-digits mode. */
export function laptopCode(publicKey: string): string {
  const bytes = decodePublicKey(publicKey);
  let bits = 0;
  let acc = 0;
  let out = PAIRING_PREFIX;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += PAIRING_B32[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += PAIRING_B32[(acc << (5 - bits)) & 31];
  return out;
}

/** A pairing code, or a key in NEAR's text form, → the key in NEAR's text form. Throws if it isn't a whole key. */
export function keyFromLaptopCode(text: string): string {
  const t = text.trim();
  if (t.startsWith("ml-dsa-65:")) {
    decodePublicKey(t);
    return t;
  }
  const bytes = pairingCodeBytes(t);
  if (!bytes) throw new Error("not a whole ZeroFee pairing code");
  const key = `ml-dsa-65:${toBase58(bytes)}`;
  decodePublicKey(key);
  return key;
}

export interface SecondDeviceOptions {
  chain: Chain;
  vault: Vault;
  /** An approval left open this long counts as "no". */
  approvalTimeoutMs?: number;
  /** The phone's own sheet (inside the isolated core, audit IOS-4): asked instead of an `approval.needed` listener. */
  approve?: (words: PlainWords) => Promise<boolean>;
  /** D143 on the web: the sheet's yes (a yes moves or holds the guarded account's money) counts only with a fresh check
   *  that the person is there (the browser's passkey, with user verification). Never set with `approve` (the phone's sheet). */
  stepUp?: (reason: string) => Promise<boolean>;
}

/** The second device's own core: its key, the accounts it guards, and its yes or no, on its own approval sheet. */
export class SecondDeviceCore implements Bridge {
  private readonly chain: Chain;
  private readonly vault: Vault;
  private readonly approvalTimeoutMs: number;
  private readonly approve?: (words: PlainWords) => Promise<boolean>;
  private readonly stepUp?: (reason: string) => Promise<boolean>;
  private readonly listeners = new Map<string, Set<(payload: any) => void>>();
  private readonly approvals = new Map<string, (approve: boolean) => void>();

  constructor(options: SecondDeviceOptions) {
    this.chain = options.chain;
    this.vault = options.vault;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
    this.approve = options.approve;
    this.stepUp = options.stepUp;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
    try {
      switch (method) {
        case "secondDevice.state":
          return { ok: (await this.state()) as T };
        case "secondDevice.requests":
          return { ok: (await this.requests()) as T };
        case "secondDevice.alerts":
          return { ok: (await this.alerts()) as T };
        case "secondDevice.answer":
          // A no to the move: `freeze: false` (the laptop page's word for it) or `confirmStop: true` confirms the phone's
          // waiting stop instead (two of three, no freeze); anything else is a plain refusal, which always freezes.
          return { ok: (await this.answerRequest(params.accountId, params.id, params.approve, params.confirmStop === true || params.freeze === false)) as T };
        case "approval.answer": {
          const settle = typeof params.id === "string" ? this.approvals.get(params.id) : undefined;
          if (!settle) throw new ProblemError(securityProblems.notReady());
          settle(params.approve === true);
          return { ok: { ok: true } as T };
        }
        default:
          throw new ProblemError(securityProblems.methodUnknown(method));
      }
    } catch (e) {
      if (e instanceof ProblemError) return { problem: e.problem };
      return { problem: securityProblems.unexpected(method, e) };
    }
  }

  on<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (payload: any) => void);
    this.listeners.set(event, set);
    return () => set.delete(handler as (payload: any) => void);
  }

  /** This device's key, made on first use and kept in the vault. */
  private async key(): Promise<SoftwareKey> {
    const seed = await this.vault.get(SEED);
    if (seed) return SoftwareKey.fromSeed(seed, "development");
    const made = SoftwareKey.generate();
    await this.vault.put(SEED, made.exportSeed());
    return made;
  }

  /**
   * S-1 on the device that guards an account: a new key on it, or a new waiting change, each told once (its own key is
   * never news). Nothing when this device has no key yet (asking never makes one).
   */
  private async alerts(): Promise<{ kind: "key" | "held"; id: string; title: string; body: string }[]> {
    if (!(await this.vault.get(SEED))) return [];
    const key = await this.key();
    const g = await import("./guard-dog.ts");
    return g.deviceGuard({ chain: this.chain, vault: this.vault, publicKey: key.publicKey, accounts: await this.accounts(key.publicKey) });
  }

  /** Accounts that have this key as their second device: found through the key index, then checked on two nodes. */
  private async accounts(publicKey: string): Promise<string[]> {
    const handle = handleOf(publicKey);
    const found = await this.chain.accountsForKey(handle);
    const block = await this.chain.commonBlock();
    const out: string[] = [];
    for (const accountId of found) {
      const key = await this.chain.accessKey(accountId, publicKey, block);
      const p = key?.permission;
      if (p?.kind === "function-call" && p.receiverId === accountId && isSecondDeviceMethods(p.methods)) out.push(accountId);
    }
    return out;
  }

  /** What the pairing screen shows: the QR's text, the fingerprint the phone's sheet will show, and any accounts. */
  private async state(): Promise<{ code: string; fingerprint: string; borshKey: string; accounts: string[] }> {
    const key = await this.key();
    return {
      code: laptopCode(key.publicKey),
      fingerprint: shortKey(handleOf(key.publicKey)),
      borshKey: borshOf(key.publicKey),
      accounts: await this.accounts(key.publicKey),
    };
  }

  /**
   * Requests waiting for this device's yes, per account, read from each account contract: what needs it, and the phone's
   * stop of a recovery, which this device may let go now or refuse (release 6, re-audit R3: a thief's stop is refused).
   */
  private async requests(): Promise<{ accountId: string; requests: SecondDeviceRequest[] }[]> {
    const key = await this.key();
    const accounts = await this.accounts(key.publicKey);
    const mine = borshOf(key.publicKey);
    return Promise.all(accounts.map(async (accountId) => {
      const all = await heldRequests(this.chain, accountId);
      // Its own removal first, as a warning; then the move to a new device; then what waits for its yes.
      const removal = all.filter((r) => removesThis(r, mine)).map(asWarning);
      const held = all.filter((r) => forThisDevice(r) && !removesThis(r, mine)).map(withAdvice).map(markUnknown);
      const recovery = await this.recoveryRequest(accountId);
      // Release 10 (the laptop veto): what a no would pause, so the page asks first (read only when something waits).
      // A node's error on its views never takes the list (and its No) away: unknown, so Say no still asks first. A clean
      // null (an older contract) answers at once, as before.
      const veto = held.length ? await this.veto(accountId, mine).catch((): "unknown" => "unknown") : null;
      const marked = held.map((r): SecondDeviceRequest => {
        const pause = pauseOnNo(r, veto);
        return pause === undefined ? r : pause === "unknown" ? { ...r, pauseUnknown: true } : { ...r, pauseSeconds: pause };
      });
      return { accountId, requests: [...removal, ...(recovery ? [recovery] : []), ...marked] };
    }));
  }

  /** The account's veto facts, read from its contract (two nodes), or null on a contract without the veto. Its marker is
   *  `second_device_yes_from`, which came in the same round (release 10, round 2) and is a list on every account that
   *  has it (this device is on it); an older contract has no such view (null). */
  private async veto(accountId: string, mine: string): Promise<Veto | null> {
    const block = await this.chain.commonBlock();
    const [ages, yesFrom, delay] = await Promise.all([
      this.chain.view(accountId, "second_device_ages", {}, block),
      this.chain.view(accountId, "second_device_yes_from", {}, block),
      this.chain.view(accountId, "delay_seconds", {}, block),
    ]);
    const delaySeconds = Number(delay);
    if (!Array.isArray(yesFrom) || !Array.isArray(ages) || !Number.isFinite(delaySeconds) || delaySeconds <= 0) return null;
    const rows = ages as [string, string | number][];
    const me = rows.find(([k]) => k === mine);
    return { aged: me !== undefined && String(me[1]) === "0", floorSeconds: floorSeconds(delaySeconds), secondDevices: rows.map(([k]) => k) };
  }

  /** Release 7: the waiting recovery that needs this device's yes, read from the contract (two nodes), as one request. */
  private async recoveryRequest(accountId: string): Promise<HeldRequest | null> {
    const block = await this.chain.commonBlock();
    const acct = await this.chain.account(accountId, block);
    if (policyVersion(codeOf(acct), this.chain.network) < 7) return null;
    const status = (await this.chain.view(accountId, "recovery_status", {}, block)) as { ready_at_ns: string; needs_device: boolean; approved: boolean; fallback_at_ns: string } | null;
    if (!status || !status.needs_device) return null;
    const iso = (ns: string) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
    const lines = [
      "The backup words started moving this account to a new device. It needs this device's yes to finish.",
      status.approved ? "This device already said yes. A no still ends the move." : `Without a yes, the words alone can finish it after ${localClock(iso(status.fallback_at_ns))}.`,
      RECOVERY_ADVICE,
    ];
    return { id: RECOVERY_REQUEST_ID, title: "A move to a new device", lines, readyAtIso: iso(status.ready_at_ns), needsSecondDevice: !status.approved, ready: false, change: true, kind: "Recovery", yesGas: Number(RECOVERY_ANSWER_GAS) };
  }

  /** Release 7: this device's yes to the waiting recovery (bound to the one it read), or its refusal. */
  /** `confirmStop` (R7-9): with a no, the device's explicit confirmation of the phone's waiting stop (two of three, no
   *  freeze: refuse_recovery { confirm_stop: true }); a plain no always freezes. The screen offers "Refuse and freeze"
   *  (the default) and "Confirm my main device's stop (no freeze)". */
  private async answerRecovery(accountId: string, approve: boolean, confirmStop = false): Promise<TxOutcome> {
    const key = await this.key();
    const block = await this.chain.commonBlock();
    const status = (await this.chain.view(accountId, "recovery_status", {}, block)) as { new_key: string; ready_at_ns: string } | null;
    if (!status) throw new ProblemError(securityProblems.waitingGone());
    const request = (await this.recoveryRequest(accountId)) ?? { title: "A move to a new device", lines: [] as string[] };
    const outcome = approve ? "With your yes, the new device gets the account once the wait is over." : confirmStop ? "With your yes, the move ends now and nothing pauses." : "With your no, the move ends now. Then payments pause for a while.";
    const sheet: Approve = (words) => this.approveOnSheet({ ...words, title: `${approve ? "Say yes to" : "Say no to"}: ${request.title}`, lines: [...request.lines, outcome, ...words.lines] });
    const signer = new DevSigner({ accountId, chain: this.chain, key, approve: sheet });
    const args = approve ? { new_key: status.new_key, ready_at_ns: status.ready_at_ns } : confirmStop ? { confirm_stop: true } : {};
    const call = { kind: "call" as const, method: approve ? "approve_recovery" : "refuse_recovery", args: new TextEncoder().encode(JSON.stringify(args)), gas: RECOVERY_ANSWER_GAS, depositYocto: 0n };
    return signer.run(accountId, [call]);
  }

  /** Say yes or no to one held request, after this device's own sheet shows it in full. */
  private async answerRequest(accountId: unknown, id: unknown, approve: unknown, confirmStop?: unknown): Promise<TxOutcome> {
    const key = await this.key();
    if (typeof accountId !== "string" || !(await this.accounts(key.publicKey)).includes(accountId)) {
      throw new ProblemError(securityProblems.requestNotAllowed("This device isn't the second device of that account."));
    }
    if (id === RECOVERY_REQUEST_ID) return this.answerRecovery(accountId, approve === true, confirmStop === true);
    // Its own removal has no yes or no here (R7-1): it isn't found.
    const found = (await heldRequests(this.chain, accountId)).find((r) => r.id === String(id) && forThisDevice(r) && !removesThis(r, borshOf(key.publicKey)));
    if (!found) throw new ProblemError(securityProblems.waitingGone());
    const request = markUnknown(withAdvice(found));
    const yes = approve === true;
    // unknown code: no yes from this device, ever (a no still goes)
    if (yes && unknownUpdate(request)) throw new ProblemError(securityProblems.requestNotAllowed(`${UNKNOWN_CODE_TITLE}.`));
    // A stop of a recovery: a yes stops the move at once (the contract runs it on approve), a no lets the move go on.
    const stop = request.kind === "CancelRecovery";
    const outcome = yes
      ? stop
        ? "With your yes, the move stops now."
        : Date.parse(request.readyAtIso) <= Date.now()
          ? "With your yes, it goes now."
          : `With your yes, it goes after ${localClock(request.readyAtIso)}.`
      : stop
        ? "With your no, the move to a new device goes on."
        : "Nothing from it goes out.";
    // The request's long parts (a rule's every coin) come with it, one tap open on this device's sheet too.
    const sheet: Approve = (words) => {
      const details = [...(request.details ?? []), ...(words.details ?? [])];
      return this.approveOnSheet({ ...words, title: `${yes ? "Say yes to" : "Say no to"}: ${request.title}`, lines: [...request.lines, outcome, ...words.lines], ...(details.length ? { details } : {}) });
    };
    const signer = new DevSigner({ accountId, chain: this.chain, key, approve: sheet });
    const call = { kind: "call" as const, method: yes ? "approve" : "decline", args: new TextEncoder().encode(JSON.stringify({ id: request.id })), gas: yes ? BigInt(request.yesGas) : NO_GAS, depositYocto: 0n };
    return signer.run(accountId, [call]);
  }

  private async approveOnSheet(words: PlainWords): Promise<boolean> {
    if (this.approve) return this.approve(words);
    const yes = await this.showSheet(words);
    if (!yes || !this.stepUp) return yes;
    if (await this.stepUp(words.title).catch(() => false)) return true;
    throw new ProblemError(securityProblems.safeNotVerified());
  }

  private showSheet(words: PlainWords): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.listeners.get("approval.needed")?.size) return resolve(false);
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      const timer = setTimeout(() => settle(false), this.approvalTimeoutMs);
      const settle = (answer: boolean) => {
        clearTimeout(timer);
        this.approvals.delete(id);
        resolve(answer);
      };
      this.approvals.set(id, settle);
      for (const handler of this.listeners.get("approval.needed") ?? []) {
        try {
          handler({ id, words });
        } catch {
          // A broken listener must not stop the core.
        }
      }
    });
  }
}
