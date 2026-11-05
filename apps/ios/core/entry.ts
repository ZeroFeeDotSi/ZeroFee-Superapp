// The trusted core as its own script (S1.6 phase 2). Swift runs it in a JavaScriptCore context of its own
// (CoreContext.swift), apart from the page: no DOM, no page scripts, no message handler the apps could reach. The same
// DemoCore as the web app's, on the same two-node chain reader; only the world around it is Swift's (shims.ts):
// - its vault is the Keychain (the same items the page's core used, so an account carries over);
// - its account key is the chip's: it hands Swift { id, words, bytes } and Swift's native sheet signs only those bytes;
// - every other approval is Swift's native sheet too (`sheet`), so no page script can answer one;
// - the backup words are shown and checked on Swift's own screen (`showWords`), so the page never sees them;
// - its events go to the page through Swift (`__native.emit`).
//
// Swift talks to it through `ZeroFeeCore`:
//   start(config JSON { network, relay? })  → "ok", once
//   call(method, params JSON, done)         → done(JSON BridgeResult)
//   check(done)                             → done(JSON { height, hash }): two nodes agree on a recent block
//   checkShims(done)                        → done(JSON { name: true | why not }): shims.ts, checked in this context
import { nativeScrypt } from "./shims.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { RpcChain } from "@zerofee/core/chain";
import { setNearProxy } from "@zerofee/core/near-proxy";
import { setSolProxy } from "@zerofee/core/sol-proxy";
import { setHoodProxy } from "@zerofee/core/hood-proxy";
import { DemoCore } from "@zerofee/core/demo-core";
import { MAIL_SERVICE } from "@zerofee/core/mail-service";
import { relayBase } from "@zerofee/core/relay";
import { signatureIsValid, type AccountKey, type DeviceKeys, type SheetRequest } from "@zerofee/core/device-key";
import { ProblemError } from "@zerofee/core/problem";
import { phoneProblem } from "@zerofee/core/security-problems";
import type { Network, PlainWords } from "@zerofee/core/signer";
import type { Vault } from "@zerofee/core/vault";
import { mlDsaKeyHandle } from "@zerofee/core/key-handle";
import { wordlist } from "@scure/bip39/wordlists/english.js";

interface NativeHost {
  /** done gets JSON { bytes: base64 | null } | { error }. `bytes` is "" except for put. */
  vault(op: "get" | "put" | "delete", name: string, bytes: string, done: (result: string) => void): void;
  /** The native approval sheet for these words (JSON PlainWords), with Face ID: done(true) only if approved. */
  approve(words: string, done: (approved: boolean) => void): void;
  /** The chip key: "info" | "create" | "sign" ({ id, words, bytes }); done gets the JSON { ok } | { problem } Swift answers. */
  key(op: "info" | "create" | "sign" | "signAlertsProof" | "signChatName" | "approval-state" | "approval-reset" | "approval-confirm" | "proof", params: string, done: (result: string) => void): void;
  /** One of the app's own files for the core (the account contract's code), base64; "" if there is none. */
  resource(name: string): string;
  /** An event for the page (JSON payload). */
  emit(event: string, payload: string): void;
  /** The backup words on the native screen (JSON { words, kid }): done(JSON { positions, words } | null). */
  words(spec: string, done: (result: string) => void): void;
  /** An exported separate wallet's key on the native screen (JSON { label, secretKey }): done(true) once shown. */
  secret(spec: string, done: (shown: boolean) => void): void;
  /** The person types their 24 words on the native screen (JSON { purpose, wordlist }): done(JSON string[24] | null). */
  typeWords(spec: string, done: (result: string) => void): void;
}

const native = (globalThis as unknown as { __native: NativeHost }).__native;

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

/** The core's vault, kept by Swift. A vault that can't answer stops the core, never reads as empty. */
const swiftVault: Vault = {
  get: (name) => ask("get", name).then((b) => (b === null ? null : Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))),
  put: (name, bytes) => ask("put", name, toB64(bytes)).then(() => undefined),
  delete: (name) => ask("delete", name).then(() => undefined),
};

function ask(op: "get" | "put" | "delete", name: string, bytes = ""): Promise<string | null> {
  return new Promise((resolve, reject) =>
    native.vault(op, name, bytes, (result) => {
      const r = JSON.parse(result) as { bytes?: string | null; error?: string };
      if (r.error !== undefined) reject(new Error(r.error));
      else resolve(r.bytes ?? null);
    }),
  );
}

let core: DemoCore | null = null;
/** scrypt("password", "NaCl", N=1024, r=8, p=16, dkLen=64): RFC 7914 §12's second vector. */
const RFC7914_2 = "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640";
let chain: RpcChain | null = null;

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function keyCall<T>(op: "info" | "create" | "sign" | "signAlertsProof" | "signChatName" | "approval-state" | "approval-reset" | "approval-confirm" | "proof", params: Record<string, unknown> = {}): Promise<{ ok: T } | { problem: { whatHappened: string } }> {
  return new Promise((resolve) => native.key(op, JSON.stringify(params), (r) => resolve(JSON.parse(r))));
}

/** The account key in the iPhone's chip (ChipKey.swift): only its public key is here; it signs on Swift's sheet. */
class ChipKey implements AccountKey {
  readonly kind = "secure-chip" as const;
  readonly publicKey: string;
  constructor(publicKey: string) {
    this.publicKey = publicKey;
  }
  get publicKeyHandle(): string {
    return mlDsaKeyHandle(this.publicKey);
  }
  async signHash(): Promise<Uint8Array> {
    throw new Error("On this phone the secure chip signs only on its own approval sheet.");
  }
  /** Swift's sheet, Face ID, then the chip signs sha256(bytes). Null = Not now. Checked here before anything uses it. */
  async signOnSheet({ id, words, bytes, summary }: SheetRequest): Promise<Uint8Array | null> {
    const r = await keyCall<{ signature?: string; declined?: true }>("sign", { id, words, bytes: toB64(bytes), summary });
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    if (r.ok.declined || !r.ok.signature) return null;
    const signature = fromB64(r.ok.signature);
    if (!signatureIsValid(sha256(bytes), signature, this.publicKey)) throw new Error("The chip's signature didn't check out, so it wasn't used.");
    return signature;
  }
  /** The relay's email-alerts proof: Swift builds and shows it (AlertsProof), the chip signs. Checked by the core. */
  async signAlertsProof({ accountId, email, deadline, nonce }: { accountId: string; email: string; deadline: string; nonce: Uint8Array }): Promise<Uint8Array | null> {
    const r = await keyCall<{ signature?: string; declined?: true }>("signAlertsProof", { accountId, email, deadline, nonce: toB64(nonce) });
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    if (r.ok.declined || !r.ok.signature) return null;
    return fromB64(r.ok.signature);
  }
  /** ZeroFee Chat's name note (J3 part 2): Swift builds and shows it from these parts (NearTx.swift ChatName: recipient
   *  chat.zerofee.si, its own constant), Face ID, the chip signs. The core checks the record before it is used. */
  async signChatName({ accountId, chatKey, until, nonce }: { accountId: string; chatKey: string; until: string; nonce: Uint8Array }): Promise<Uint8Array | null> {
    const r = await keyCall<{ signature?: string; declined?: true }>("signChatName", { accountId, chatKey, until, nonce: toB64(nonce) });
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    if (r.ok.declined || !r.ok.signature) return null;
    return fromB64(r.ok.signature);
  }
  /** The "Your key" card: the public key the chip gives now from its handle, and when it was made (ChipKey.proof). */
  async proof(): Promise<{ publicKey: string; held: boolean; madeAtIso?: string }> {
    const r = await keyCall<{ publicKey: string; held: boolean; madeAtIso?: string }>("proof");
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    return { publicKey: String(r.ok.publicKey), held: r.ok.held === true, ...(typeof r.ok.madeAtIso === "string" ? { madeAtIso: r.ok.madeAtIso } : {}) };
  }
}

const keyRefused = (what: string) =>
  new ProblemError({ code: "security.key.refused", whatHappened: what, money: { state: "not-involved" }, next: { kind: "retry", label: "Try again" } });

/** The chip key as the core's device key: made once in the chip; `forget` keeps it for the next account. */
const chipKeys: DeviceKeys = {
  async make() {
    const r = await keyCall<{ publicKey: string }>("create");
    if ("problem" in r) {
      // The phone check stopped it (no chip, Face ID not set up, off for ZeroFee, locked): that blocker's own screen.
      const blocked = phoneProblem((r.problem as { code?: unknown }).code);
      if (blocked) throw new ProblemError(blocked);
      throw keyRefused(r.problem.whatHappened || "This phone couldn't make your key.");
    }
    return new ChipKey(r.ok.publicKey);
  },
  async get() {
    const r = await keyCall<{ publicKey: string | null }>("info");
    return "problem" in r || !r.ok.publicKey ? null : new ChipKey(r.ok.publicKey);
  },
  forget: async () => {},
};

/** Every event the core sends, passed to the page through Swift (approval.needed never: the sheet is Swift's own).
 *  recovery.renewed too: Browser's engine drops the old words' wallets on it, and the shell says the new words are in
 *  (security review 2 Nov: without it the phone's Browser kept signing from the replaced words' wallet). */
const EVENTS = ["recovery.started", "recovery.status", "recovery.renewed", "account.waiting.ended", "subwallet.session.ended", "account.create.step"];

const answer = (done: (json: string) => void, value: unknown) => done(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

Object.defineProperty(globalThis, "ZeroFeeCore", {
  value: Object.freeze({
    start(config: string): string {
      if (core) throw new Error("the core is already started");
      const { network, relay } = JSON.parse(config) as { network: Network; relay?: string };
      if (network !== "testnet" && network !== "mainnet") throw new Error("network is testnet or mainnet");
      // The quote relay for private payments (build-web.sh's VITE_ZEROFEE_RELAY, read by Swift, which allows its host).
      const privateQuotes = relayBase(relay);
      // D139: the Safe's own NEAR reads may go through the relay's FastNEAR proxy (the key on the relay only); no one else's
      if (network === "mainnet" && privateQuotes) setNearProxy(`${privateQuotes}/v0/near`);
      // finding 3: Solana's display reads through the relay's Helius first (sol-proxy.ts)
      if (network === "mainnet" && privateQuotes) setSolProxy(`${privateQuotes}/v0/sol/read`);
      // Robinhood Chain's reads and sends through the relay's Alchemy first, its free nodes after (hood-proxy.ts)
      if (network === "mainnet" && privateQuotes) setHoodProxy(`${privateQuotes}/v0/rh/rpc`);
      chain = new RpcChain(network);
      core = new DemoCore({
        chain,
        vault: swiftVault,
        // audit pass 2, item 2: a call that names no app is refused; the page's shell stamps SHELL_APP (asShell), Swift's
        // own calls say "shell" too (BackgroundAlerts, Host)
        unstampedIsShell: false,
        // ZeroFee's mail host (mail-service.ts; CoreContext.swift lets the core reach it)
        mail: MAIL_SERVICE,
        // Fees and protection limits in dollars on the sheet (D8): words only.
        sheetPrices: true,
        deviceKeys: chipKeys,
        sheet: (words: PlainWords) => new Promise<boolean>((resolve) => native.approve(JSON.stringify(words), (yes) => resolve(yes === true))),
        // An exported key shows on Swift's own screen too: the page hears only { shown }.
        showSecret: ({ label, secretKey }: { label: string; secretKey: string }) => new Promise<boolean>((resolve) => native.secret(JSON.stringify({ label, secretKey }), (shown) => resolve(shown === true))),
        // Linking the laptop's extension: Swift's scrypt, off this queue (21 s in plain JS here), where Swift has it.
        ...(nativeScrypt ? { scrypt: nativeScrypt } : {}),
        // The backup words go to Swift's own screen and nowhere else: the page never gets them.
        // `renew`: new words that replace the old ones (recovery.renew): its own copy. No "Check later" anywhere (J2).
        showWords: (words: string[], kid: boolean, renew = false) =>
          new Promise((resolve) => native.words(JSON.stringify({ words, kid, renew }), (r) => resolve(JSON.parse(r) as { positions: number[]; words: string[] } | null))),
        // A restore or "Check my words": typed on Swift's own screen, straight to the core; the page never has them.
        typeWords: (purpose: "restore" | "check" | "rearm" | "codes") =>
          new Promise((resolve) => native.typeWords(JSON.stringify({ purpose, wordlist }), (r) => resolve(JSON.parse(r) as string[] | null))),
        // The approval key (ChipKey.swift ApprovalPass, audit IOS-1b): has Face ID changed since it was made; make it again.
        approvalKey: {
          changed: async () => {
            const r = await keyCall<{ changed: boolean }>("approval-state");
            return "ok" in r && r.ok.changed === true;
          },
          reset: async () => {
            const r = await keyCall<{ reset: true }>("approval-reset");
            if (!("ok" in r)) throw keyRefused(r.problem.whatHappened);
          },
        },
        ...(privateQuotes ? { privateQuotes } : {}),
        // Sites' two-factor secrets: sealed under Face ID by Swift (SiteCodes.swift), backed up with the words here.
        siteCodes: true,
        // Before the words' copy of a code is opened (2FA review MUST 1): Face ID with the account's approval key, now.
        codesStepUp: async () => {
          const r = await keyCall<{ approved: boolean }>("approval-confirm");
          return "ok" in r && r.ok.approved === true;
        },
        policyWasm: async () => {
          const b64 = native.resource("account_policy.wasm");
          if (!b64) throw new Error("the account contract's code isn't in this build");
          return fromB64(b64);
        },
      });
      for (const event of EVENTS) core.on(event, (payload) => native.emit(event, JSON.stringify(payload ?? {})));
      return "ok";
    },
    call(method: string, params: string, done: (json: string) => void): void {
      if (!core) return answer(done, { problem: { code: "security.core.not-ready", whatHappened: "The core hasn't started.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } });
      let p: Record<string, unknown>;
      try {
        p = params ? JSON.parse(params) : {};
      } catch {
        p = {};
      }
      core.call(String(method), p).then((r) => answer(done, r));
    },
    checkShims(done: (json: string) => void): void {
      const out: Record<string, true | string> = {};
      const t = (name: string, f: () => boolean) => {
        try {
          out[name] = f() || "wrong";
        } catch (e) {
          out[name] = String((e as Error)?.message ?? e);
        }
      };
      const text = "héllo € 𝄞 ok";
      t("utf8RoundTrip", () => new TextDecoder().decode(new TextEncoder().encode(text)) === text);
      t("utf8Bytes", () => new TextEncoder().encode("€").join() === "226,130,172");
      t("fatalRefusesBadUtf8", () => {
        for (const bad of [[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
          try {
            new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bad));
            return false;
          } catch {
            // refused, as it must be
          }
        }
        return true;
      });
      t("base64RoundTrip", () => {
        const bin = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i));
        return atob(btoa(bin)) === bin && btoa("ab") === "YWI=" && btoa("a") === "YQ==";
      });
      t("randomBytes", () => {
        const a = crypto.getRandomValues(new Uint8Array(32));
        const b = crypto.getRandomValues(new Uint8Array(32));
        return a.some((x) => x !== 0) && a.join() !== b.join();
      });
      // Swift's scrypt, through the shim, on RFC 7914's second vector: the bytes cross JSON and base64 both ways intact.
      const scryptChecked = !nativeScrypt
        ? Promise.resolve((out.nativeScrypt = "Swift gave no scrypt"))
        : nativeScrypt(new TextEncoder().encode("password"), new TextEncoder().encode("NaCl"), { N: 1024, r: 8, p: 16, dkLen: 64 }).then(
            (k) => (out.nativeScrypt = Array.from(k, (b) => b.toString(16).padStart(2, "0")).join("") === RFC7914_2 || "wrong bytes"),
            (e) => (out.nativeScrypt = String((e as Error)?.message ?? e)),
          );
      const started = Date.now();
      setTimeout(() => {
        out.timerFires = Date.now() - started >= 40 || `fired after ${Date.now() - started} ms`;
        const signal = AbortSignal.timeout(10);
        signal.addEventListener("abort", () => {
          out.abortTimeout = (signal.reason as Error)?.name === "TimeoutError" || "wrong reason";
          void scryptChecked.then(() => answer(done, out));
        });
      }, 50);
    },
    check(done: (json: string) => void): void {
      if (!chain) return answer(done, { error: "not started" });
      chain.commonBlock().then(
        (b) => answer(done, { height: b.height, hash: b.hash }),
        (e) => answer(done, { error: String((e as Error)?.message ?? e) }),
      );
    },
  }),
  writable: false,
  configurable: false,
});
