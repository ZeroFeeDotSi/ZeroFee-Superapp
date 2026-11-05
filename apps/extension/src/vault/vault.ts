// The trading wallet's vault: the only place its seed is ever opened. It runs in the extension's background worker and
// answers the panel only (background.ts checks who is asking). At rest the seed is sealed under the passcode (seal.ts) in
// the extension's own IndexedDB (own-store.ts; content scripts can't open it, audit L26). Unlocked, it sits in chrome.storage.session: memory only, gone when Chrome closes, and out of
// reach of content scripts. It locks itself after an hour without a trade.
//
// Before every signature: the wallet must be unlocked and not idle too long; the transaction must pass policy.ts; and its
// simulated spend (two nodes, the larger answer) must be within the one-tap limit, unless the person types the passcode
// for that one trade. Wrong passcodes slow down: after five in a row, each try waits twice as long as the last.
// Raising the one-tap limit, and a transfer out (a withdraw, to any address), always need the passcode (audit L25).
import type { Problem } from "@zerofee/core/problem";
import { base64, fromBase64 } from "@zerofee/trade/sol/bytes.ts";
import { extProblems } from "../problems.ts";
import { newSeed, signSolTx, solanaKey } from "./keys.ts";
import { readCode, sealForLink } from "./link.ts";
import { checkSolTx, type Purpose } from "./policy.ts";
import { StaleBlockhash } from "./spend.ts";
import { KDF, MIN_PASSCODE, PRF_BYTES, seal, sealTouch, unseal, unsealTouch, type KdfParams, type Sealed, type TouchSealed } from "./seal.ts";

export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
export type Result<T> = { ok: T } | { problem: Problem };

export const IDLE_MS = 60 * 60_000;
export const PER_TRADE_USD = 50;
const FREE_TRIES = 5, FIRST_WAIT_MS = 30_000, MAX_WAIT_MS = 60 * 60_000;

/** `touch`: the second seal, Touch ID's, beside the passcode's (either opens the wallet; the passcode's always stays). */
interface Saved { v: 1; sealed: Sealed; sol: string; perTradeUsd: number; touch?: TouchSealed }
interface Opened { seed: string; lastUsedAt: number }
interface Tries { n: number; until: number }

/** `touch`: what the panel needs to ask the authenticator (the credential's id and the salt), never a key. */
export type Touch = { credId: string; salt: string };
export type VaultStatus =
  | { stage: "none" }
  | { stage: "locked"; sol: string; perTradeUsd: number; touch?: Touch }
  | { stage: "unlocked"; sol: string; perTradeUsd: number; locksAt: number; touch?: Touch };

export interface VaultDeps {
  local: Store;
  session: Store;
  /** Lamports this transaction would take out of `owner`, simulated on two nodes (the larger answer). Throws StaleBlockhash
   *  when its blockhash is no longer recent, and anything else when it can't tell. */
  spend(txB64: string, owner: string): Promise<bigint>;
  solUsd(): Promise<number>;
  now?(): number;
  kdf?: KdfParams;
}

const K = { saved: "vault", tries: "vault.tries", opened: "vault.open" };
/** What the vault keeps at rest (`local`), the sealed wallet first: what own-store.ts moves out of chrome.storage.local. */
export const AT_REST: readonly string[] = [K.saved, K.tries];

export function createVault(d: VaultDeps) {
  const now = d.now ?? Date.now;
  const saved = () => d.local.get<Saved>(K.saved);

  async function opened(s: Saved): Promise<Opened | undefined> {
    const o = await d.session.get<Opened>(K.opened);
    if (!o) return undefined;
    const seed = fromBase64(o.seed), same = solanaKey(seed).address === s.sol;
    seed.fill(0);
    if (now() - o.lastUsedAt > IDLE_MS || !same) { await d.session.remove(K.opened); return undefined; }
    return o;
  }

  /** The passcode check, with the slowdown. The seed, or a Problem. */
  async function tryPasscode(s: Saved, passcode: string): Promise<Result<Uint8Array>> {
    const t = (await d.local.get<Tries>(K.tries)) ?? { n: 0, until: 0 };
    if (t.until > now()) return { problem: extProblems.passcodeWait(new Date(t.until).toISOString()) };
    const seed = await unseal(s.sealed, passcode);
    if (seed) { if (t.n) await d.local.remove(K.tries); return { ok: seed }; }
    const n = t.n + 1;
    const wait = n < FREE_TRIES ? 0 : Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (n - FREE_TRIES));
    await d.local.set(K.tries, { n, until: now() + wait });
    return { problem: wait ? extProblems.passcodeWait(new Date(now() + wait).toISOString()) : extProblems.passcodeWrong() };
  }

  const open = (seed: Uint8Array) => d.session.set(K.opened, { seed: base64(seed), lastUsedAt: now() } satisfies Opened);

  return {
    async status(): Promise<VaultStatus> {
      const s = await saved();
      if (!s) return { stage: "none" };
      const o = await opened(s);
      const touch = s.touch ? { touch: { credId: s.touch.credId, salt: s.touch.salt } } : {};
      return o ? { stage: "unlocked", sol: s.sol, perTradeUsd: s.perTradeUsd, locksAt: o.lastUsedAt + IDLE_MS, ...touch } : { stage: "locked", sol: s.sol, perTradeUsd: s.perTradeUsd, ...touch };
    },

    /** Makes the wallet: a new seed, sealed under the passcode, and opens it. Never replaces a wallet that exists. */
    async create(passcode: string): Promise<Result<{ sol: string }>> {
      if (await saved()) throw new Error("a trading wallet already exists in this browser");
      if ([...passcode.normalize("NFKC")].length < MIN_PASSCODE) return { problem: extProblems.passcodeShort(MIN_PASSCODE) };
      const seed = newSeed();
      try {
        const s: Saved = { v: 1, sealed: await seal(seed, passcode, d.kdf ?? KDF), sol: solanaKey(seed).address, perTradeUsd: PER_TRADE_USD };
        await d.local.set(K.saved, s);
        if ((await saved())?.sealed.ct !== s.sealed.ct) return { problem: extProblems.storage() };
        await open(seed);
        return { ok: { sol: s.sol } };
      } catch {
        return { problem: extProblems.storage() };
      } finally {
        seed.fill(0);
      }
    },

    async unlock(passcode: string): Promise<Result<{ sol: string }>> {
      const s = await saved();
      if (!s) throw new Error("no trading wallet in this browser");
      const r = await tryPasscode(s, passcode);
      if ("problem" in r) return r;
      await open(r.ok);
      r.ok.fill(0);
      return { ok: { sol: s.sol } };
    },

    /**
     * Touch ID, opening the same wallet as the passcode. A PRF output that doesn't open it means the authenticator is gone
     * (a new laptop, the passkey deleted, Touch ID reset): that seal is dropped, and the passcode opens the wallet as before.
     */
    async unlockTouch(prf: Uint8Array): Promise<Result<{ sol: string }>> {
      const s = await saved();
      if (!s) throw new Error("no trading wallet in this browser");
      if (!s.touch) return { problem: extProblems.touchGone() };
      const seed = await unsealTouch(s.touch, prf);
      if (!seed) {
        const { touch: _gone, ...rest } = s;
        await d.local.set(K.saved, rest);
        return { problem: extProblems.touchGone() };
      }
      await open(seed);
      seed.fill(0);
      return { ok: { sol: s.sol } };
    },

    /** Turns Touch ID on (or moves it to a new credential): only with the wallet opened by the passcode first. */
    async touchOn(passcode: string, t: { credId: string; salt: Uint8Array; prf: Uint8Array }): Promise<Result<Touch>> {
      const s = await saved();
      if (!s) throw new Error("no trading wallet in this browser");
      if (t.prf.length !== PRF_BYTES || t.salt.length !== PRF_BYTES || !t.credId) throw new Error("a Touch ID seal needs a credential, a 32-byte salt and a 32-byte PRF output");
      const r = await tryPasscode(s, passcode);
      if ("problem" in r) return r;
      try {
        const touch = await sealTouch(r.ok, t.prf, t.salt, t.credId);
        await d.local.set(K.saved, { ...s, touch });
        return { ok: { credId: touch.credId, salt: touch.salt } };
      } catch {
        return { problem: extProblems.storage() };
      } finally {
        r.ok.fill(0);
      }
    },

    /** Turns Touch ID off: the passcode first, as for turning it on. */
    async touchOff(passcode: string): Promise<Result<true>> {
      const s = await saved();
      if (!s) throw new Error("no trading wallet in this browser");
      const r = await tryPasscode(s, passcode);
      if ("problem" in r) return r;
      r.ok.fill(0);
      const { touch: _off, ...rest } = s;
      await d.local.set(K.saved, rest);
      return { ok: true };
    },

    async lock(): Promise<void> {
      await d.session.remove(K.opened);
    },

    /** Lowering the one-tap limit is free; raising it needs the passcode (audit L25), with the same slowdown. */
    async setPerTradeUsd(usd: number, passcode?: string): Promise<Result<true>> {
      const s = await saved();
      if (!s || !(usd > 0) || usd > 100_000) throw new Error("the one-tap limit is a positive number of dollars");
      if (usd > s.perTradeUsd) {
        if (passcode === undefined) return { problem: extProblems.passcodeNeeded() };
        const r = await tryPasscode(s, passcode);
        if ("problem" in r) return r;
        r.ok.fill(0);
      }
      await d.local.set(K.saved, { ...s, perTradeUsd: usd });
      return { ok: true };
    },

    /**
     * Signs one Solana transaction for this wallet, or says why not. `passcode` is given only when the person typed it for
     * this one trade, to go above the one-tap limit.
     */
    async signSol(txB64: string, purpose: Purpose, opts: { passcode?: string } = {}): Promise<Result<{ signedTx: string }>> {
      const s = await saved();
      if (!s) throw new Error("no trading wallet in this browser");
      const verdict = checkSolTx(txB64, s.sol, purpose);
      if (!verdict.ok) return { problem: extProblems.refused(verdict.why) };
      // money out of the wallet, to any address, is never one tap (audit L25)
      if (purpose.kind === "withdraw" && opts.passcode === undefined) return { problem: extProblems.passcodeNeeded() };
      let seed: Uint8Array;
      if (opts.passcode !== undefined) {
        const r = await tryPasscode(s, opts.passcode);
        if ("problem" in r) return r;
        seed = r.ok;
      } else {
        const o = await opened(s);
        if (!o) return { problem: extProblems.locked() };
        seed = fromBase64(o.seed);
      }
      // simulated before every signature, with or without the passcode: recent, and within the limit when one tap
      let usd: number;
      try {
        usd = (Number(await d.spend(txB64, s.sol)) / 1e9) * (await d.solUsd());
      } catch (e) {
        seed.fill(0);
        return { problem: e instanceof StaleBlockhash ? extProblems.stale() : extProblems.checkFailed() };
      }
      if (opts.passcode === undefined && (!Number.isFinite(usd) || usd > s.perTradeUsd)) { seed.fill(0); return { problem: extProblems.overCap(s.perTradeUsd) }; }
      try {
        const signedTx = signSolTx(txB64, seed);
        await open(seed);                                                     // a trade keeps it unlocked for another hour
        return { ok: { signedTx } };
      } finally {
        seed.fill(0);
      }
    },

    /** The link QR, with the passcode typed again: the seed sealed under the code the phone showed (link.ts). The seed
     *  itself never leaves the vault. */
    async linkCode(passcode: string, code: string): Promise<Result<{ qr: string; sol: string }>> {
      const s = await saved();
      if (!s) throw new Error("no trading wallet in this browser");
      if (!readCode(code)) return { problem: extProblems.linkCodeTyped() };
      const r = await tryPasscode(s, passcode);
      if ("problem" in r) return r;
      try { return { ok: { qr: (await sealForLink(r.ok, code, d.kdf ?? KDF))!, sol: s.sol } }; } finally { r.ok.fill(0); }
    },
  };
}

export type Vault = ReturnType<typeof createVault>;
