// The account's keys, behind one small interface.
//
// On a phone, the main key is an ML-DSA-65 key created inside the secure chip (iOS 26: SecureEnclave.MLDSA65). It
// can't be exported and signs only after Face ID; the iOS app implements this interface in Swift. Everything else in
// the core only ever sees `publicKey` and `signHash`, so no code path outside the chip can read a private key.
//
// SoftwareKey below is a stand-in for development and for the recovery key rebuilt from words. It keeps key material
// in memory, so it must never be used as an account's everyday key on a real device.
import { generateSigner, signerFromSeed, verifyHash, type MlDsa65PublicKey, type MlDsa65Signer } from "@fastnear/ml-dsa-65";
import type { PlainWords } from "./signer.ts";
import type { SheetSummary } from "./sheet-summary.ts";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * What a key with its own sheet is handed for one signature: the exact unsigned transaction bytes (it hashes them
 * itself) and the words the person saw for them. `id` names the approval those words were shown on.
 */
export interface SheetRequest {
  id: string;
  words: PlainWords;
  bytes: Uint8Array;
  /** The receiver and steps the bytes must say (sheet-summary.ts): the native sheet decodes the bytes and refuses otherwise. */
  summary: SheetSummary;
  /** The Send's leg 2 held for this one sheet (send-words HeldPair: sha256 of its payload, hex), shown with it. Not the
   *  binding: the core releases leg 2 by leg 1's own paid address (the bytes it signed) and its OWN pair.hash, never by
   *  what comes back (dev-signer releasePair). The phone's echo is only an extra check that a mismatch refuses. */
  pairHash?: string;
}

/**
 * Several transactions of ONE action (TxRequest.apart: steps an account can't chain), for ONE sheet and ONE Face ID: each
 * tx's exact bytes and the receiver and steps they must say. The native sheet decodes and checks each, shows every one,
 * and signs them back to back under that one unlock (key.signSet, ChipKey.signMany); more than four are refused.
 */
export interface SheetSetRequest {
  id: string;
  words: PlainWords;
  txs: { bytes: Uint8Array; summary: SheetSummary }[];
  pairHash?: string;
}

export interface AccountKey {
  /** NEAR text form, e.g. "ml-dsa-65:<base58>" (all 1,952 public-key bytes). */
  readonly publicKey: string;
  /** NEAR's compact on-chain identifier for the key, as shown in access-key lists. */
  readonly publicKeyHandle: string;
  /** Where the private key lives, shown to the user. */
  readonly kind: "secure-chip" | "recovery-words" | "development";
  /** Sign one 32-byte NEAR transaction hash (pure ML-DSA-65). Async: on a phone it waits for Face ID and the chip. */
  signHash(hash: Uint8Array): Promise<Uint8Array>;
  /**
   * A key that shows its own sheet (the iPhone's chip key, S1.6): it shows `words` natively, asks Face ID there, and signs
   * only sha256(`bytes`). Null = the person said Not now. When present, the core signs through this and never signHash.
   */
  signOnSheet?(request: SheetRequest): Promise<Uint8Array | null>;
  /** Every tx of one action on ONE sheet under ONE Face ID (SheetSetRequest): a signature per tx, in order. Null = Not now.
   *  A sheet key without it can't sign several steps at once: the core refuses them, never splits them into sheets. */
  signSetOnSheet?(request: SheetSetRequest): Promise<Uint8Array[] | null>;
  /**
   * A key that signs only on its own sheet (the phone's chip) signs the relay's email-alerts proof this way only: the
   * native side builds the four-line message and the NEP-413 bytes itself, its recipient its own relay's host, shows
   * "Turn on email alerts to <email>" and signs behind Face ID (apps/quotes/README.md "Proof of the account"). Null:
   * Not now.
   */
  signAlertsProof?(request: { accountId: string; email: string; deadline: string; nonce: Uint8Array }): Promise<Uint8Array | null>;
  /**
   * The chip's Chat name note (J3 part 2, chat-near.ts): the native side builds the four lines and the NEP-413 bytes
   * itself from these parts (recipient chat.zerofee.si, a Swift constant), shows "Use your NEAR name in Chat" and signs
   * behind Face ID (NearTx.swift ChatName). Null: Not now.
   */
  signChatName?(request: { accountId: string; chatKey: string; until: string; nonce: Uint8Array }): Promise<Uint8Array | null>;
  /**
   * The chip's own word on the key (the "Your key" proof card, L6): the public key the chip gives NOW from the handle it
   * holds (`held`: it loaded and gave the same key as was kept), and when the key was made. Only the phone's chip key.
   */
  proof?(): Promise<{ publicKey: string; held: boolean; madeAtIso?: string }>;
}

export class SoftwareKey implements AccountKey {
  readonly kind: "recovery-words" | "development";
  private readonly signer: MlDsa65Signer;

  private constructor(signer: MlDsa65Signer, kind: "recovery-words" | "development") {
    this.signer = signer;
    this.kind = kind;
  }

  /** A fresh development key. On a phone, the chip makes the key instead. */
  static generate(): SoftwareKey {
    return new SoftwareKey(generateSigner(), "development");
  }

  /** Rebuild a key from its 32-byte seed (the recovery words, or a stored development seed). */
  static fromSeed(seed: Uint8Array, kind: "recovery-words" | "development"): SoftwareKey {
    return new SoftwareKey(signerFromSeed(seed), kind);
  }

  get publicKey(): string {
    return this.signer.publicKey;
  }

  get publicKeyHandle(): string {
    return this.signer.publicKeyHandle;
  }

  async signHash(hash: Uint8Array): Promise<Uint8Array> {
    if (hash.length !== 32) throw new Error("a NEAR transaction hash is 32 bytes");
    return this.signer.signHash(hash);
  }

  /** The seed, for writing the recovery words or a development key file. Never log it. */
  exportSeed(): Uint8Array {
    const seed = this.signer.exportSeed();
    if (!seed) throw new Error("this key was imported without its seed");
    return seed;
  }

  /** Zero the key material held in memory. The key can't sign afterwards. */
  destroy(): void {
    this.signer.destroy();
  }
}

/** Check a signature offline, e.g. that a chip signature verifies before it is sent anywhere. */
export function signatureIsValid(hash: Uint8Array, signature: Uint8Array, publicKey: string): boolean {
  if (!publicKey.startsWith("ml-dsa-65:")) return false;
  return verifyHash({ hash, signature, publicKey: publicKey as MlDsa65PublicKey });
}

/** The phone's answer to key.signSet for separate steps (SheetSetRequest), checked before anything uses it: Not now is
 *  null; otherwise exactly one base64 signature per tx, each valid over sha256 of its own tx's bytes, and the pair's hash
 *  echoed exactly. Anything else throws and none is used. Shared by the isolated core (apps/ios/core/entry.ts) and the
 *  page's host key (apps/web/src/host/vault.ts). */
export function setSignatures(txs: readonly { bytes: Uint8Array }[], answer: { signatures?: unknown; pairHash?: unknown; declined?: unknown }, publicKey: string, pairHash?: string): Uint8Array[] | null {
  if (answer.declined === true) return null;
  const sigs = answer.signatures;
  const unmatched = "What the phone signed didn't match what you approved, so ZeroFee didn't use it. Your money hasn't moved.";
  if (!Array.isArray(sigs) || sigs.length !== txs.length || sigs.some((s) => typeof s !== "string")) throw new Error(unmatched);
  if (pairHash !== undefined && answer.pairHash !== pairHash) throw new Error(unmatched);
  const out = (sigs as string[]).map((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  if (out.some((sig, i) => !signatureIsValid(sha256(txs[i]!.bytes), sig, publicKey))) throw new Error("The chip's signature didn't check out, so it wasn't used.");
  return out;
}

/**
 * Where an account's device key lives, for the core. The web demo keeps a software key in its vault; the iPhone host
 * passes its chip key (the Secure Enclave's ML-DSA-65, Face ID on every signature), so the core never sees a seed.
 */
export interface DeviceKeys {
  /** The device key for a new account or a recovery: made now (a chip key is made once per phone and reused). */
  make(): Promise<AccountKey>;
  /** The device key made here, or null when there is none. */
  get(): Promise<AccountKey | null>;
  /** Forget it, when no account uses it (an account that was never made). A chip key may simply stay. */
  forget(): Promise<void>;
}

/** The default: a software key kept in a vault (the web demo, tests). */
export function vaultDeviceKeys(vault: { get(name: string): Promise<Uint8Array | null>; put(name: string, bytes: Uint8Array): Promise<void>; delete(name: string): Promise<void> }, name = "device-seed"): DeviceKeys {
  // The key built from the seed, kept while the vault gives the same seed (grade 1 Nov b, N1): rebuilding it is an
  // ML-DSA keygen plus base58 of 1,952 bytes, and every account read asked for it, so the page froze. A locked vault
  // (no seed, or a throw) or a different seed drops it; it is built again once after the next unlock.
  let kept: { seed: Uint8Array; key: SoftwareKey } | null = null;
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
  const drop = () => {
    kept?.seed.fill(0);
    kept = null;
  };
  return {
    async make() {
      const key = SoftwareKey.generate();
      // Saved before anything exists on-chain, so a crash can never strand an account without its key.
      const seed = key.exportSeed();
      await vault.put(name, seed);
      drop();
      kept = { seed: seed.slice(), key };
      return key;
    },
    async get() {
      let seed: Uint8Array | null;
      try {
        seed = await vault.get(name);
      } catch (e) {
        drop();
        throw e;
      }
      if (!seed) {
        drop();
        return null;
      }
      if (kept && same(kept.seed, seed)) return kept.key;
      drop();
      const key = SoftwareKey.fromSeed(seed, "development");
      kept = { seed: seed.slice(), key };
      return key;
    },
    async forget() {
      drop();
      await vault.delete(name);
    },
  };
}
