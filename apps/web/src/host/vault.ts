// The core's vault on the iPhone: the same `Vault` interface as BrowserVault (@zerofee/core/vault), kept by Swift in
// the Keychain, this device only (kSecAttrAccessibleWhenUnlockedThisDeviceOnly): never backed up, never on another
// phone, readable only while the phone is unlocked.
//
// What lives here is whatever the core keeps in its vault: its state (not the account's device key: that one is made
// and kept in the chip, see HostKey below), Agent's standing-order key (so `keyOnThisPhone` stays true and the same signing
// path runs on the phone), and each separate wallet's seed, including the extension's imported laptop trading key
// (`subwallet.import` → `vault.put("subwallet-seed:<id>")`).
//
// Honest label: a seed kept here (Agent's, an imported laptop key) is a SOFTWARE key. It is read back into JavaScript to sign, like in the web demo.
// The Keychain keeps it off backups and other phones; it does not keep it out of this page's memory.
import { mlDsaKeyHandle, mlDsaPublicKeyBytes } from "@zerofee/core/key-handle";
import { setSignatures, signatureIsValid, type AccountKey, type DeviceKeys, type SheetRequest, type SheetSetRequest } from "@zerofee/core/device-key";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { serialize } from "@zerofee/core/tx-build";
import { sheetSummary } from "@zerofee/core/sheet-summary";
import { phoneProblem } from "@zerofee/core/security-problems";
import type { Vault } from "@zerofee/core/vault";
import type { IosHost } from "./ios.ts";

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class HostVault implements Vault {
  private readonly host: IosHost;
  private readonly prefix: string;

  /** `namespace`: a vault of its own inside the Keychain (every name is kept as "<namespace>:<name>"); none = the core's. */
  constructor(host: IosHost, namespace?: string) {
    this.host = host;
    this.prefix = namespace ? `${namespace}:` : "";
  }

  /** The phone's Keychain, this namespace of it: every copy of the core on it shares RM-4's key lock (move-key.ts). */
  get lockScope(): string { return `keychain:${this.prefix}`; }

  private async ask<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const r = await this.host.call<T>(method, params);
    // A vault that can't answer must stop the core (it shows its own key-missing / not-ready screens), never read as empty.
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    return r.ok;
  }

  async get(name: string): Promise<Uint8Array | null> {
    const { bytes } = await this.ask<{ bytes: string | null }>("vault.get", { name: this.prefix + name });
    return bytes === null ? null : fromB64(bytes);
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    await this.ask("vault.put", { name: this.prefix + name, bytes: toB64(bytes) });
  }

  async delete(name: string): Promise<void> {
    await this.ask("vault.delete", { name: this.prefix + name });
  }
}

/**
 * The account key in the iPhone's Secure Enclave (apps/ios ChipKey.swift: CryptoKit SecureEnclave.MLDSA65, Face ID on
 * every signature). JavaScript holds only the public key ("ml-dsa-65:…").
 *
 * S1.6 phase 1: the chip signs only through Swift's own sheet (NativeSheet.swift). `signOnSheet` hands Swift the exact
 * unsigned transaction bytes and the words the person saw; Swift checks the bytes are a NEAR transaction for THIS key,
 * hashes them itself, shows the words natively, and signs only that hash after that sheet's Face ID. There is no
 * bare-hash signing on the phone, so nothing in the page can get a chip signature without that sheet. The signature is
 * checked here against the public key before anything uses it.
 *
 * This is the key DemoCore signs with on the phone (core.ts passes `hostDeviceKeys(host)` as its `deviceKeys`).
 */
export class HostKey implements AccountKey {
  readonly kind = "secure-chip" as const;

  private readonly host: IosHost;
  readonly publicKey: string;

  private constructor(host: IosHost, publicKey: string) {
    this.host = host;
    this.publicKey = publicKey;
  }

  /** This phone's chip key, made on first use when `create` is true; null when there is none (or no chip). */
  static async open(host: IosHost, { create }: { create: boolean }): Promise<HostKey | null> {
    const r = create ? await host.call<{ publicKey: string }>("key.create", {}) : await host.call<{ publicKey: string | null }>("key.info", {});
    if ("problem" in r) {
      const blocked = phoneProblem(r.problem.code);
      if (create && blocked) throw new ProblemError(blocked);
      if (create) throw new Error(r.problem.whatHappened);
      return null;
    }
    const pk = r.ok.publicKey;
    if (!pk) return null;
    mlDsaPublicKeyBytes(pk); // throws unless it's a well-formed NEAR ml-dsa-65 public key
    return new HostKey(host, pk);
  }

  get publicKeyHandle(): string {
    return mlDsaKeyHandle(this.publicKey);
  }

  /** Never on the phone: the chip signs a transaction only on its own sheet (signOnSheet). */
  async signHash(): Promise<Uint8Array> {
    throw new Error("On this phone the secure chip signs only on its own approval sheet.");
  }

  /** Swift's sheet, Face ID, then the chip signs sha256(bytes). Null = Not now. Throws (nothing signed) on any other failure. */
  async signOnSheet({ id, words, bytes, summary }: SheetRequest): Promise<Uint8Array | null> {
    const r = await this.host.call<{ signature?: string; declined?: true }>("key.sign", { id, words, bytes: toB64(bytes), summary });
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    if (r.ok.declined || !r.ok.signature) return null;
    const signature = fromB64(r.ok.signature);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    if (!signatureIsValid(hash, signature, this.publicKey)) throw new Error("The secure chip's approval didn't check out, so ZeroFee didn't use it. Your money hasn't moved.");
    return signature;
  }

  /** Separate steps of one action (TxRequest.apart): every tx to key.signSet, ONE sheet, ONE Face ID (Swift decodes each,
   *  refuses more than 4). A signature per tx, each checked against its own hash, or none is used. Null = Not now. */
  async signSetOnSheet({ id, words, txs, pairHash }: SheetSetRequest): Promise<Uint8Array[] | null> {
    const r = await this.host.call<{ signatures?: unknown; pairHash?: unknown; declined?: true }>("key.signSet", { id, words, txs: txs.map((t) => ({ bytes: toB64(t.bytes), summary: t.summary })), ...(pairHash ? { pairHash } : {}) });
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    return setSignatures(txs, r.ok, this.publicKey, pairHash);
  }

  /** The relay's email-alerts proof: Swift builds and shows it (AlertsProof), the chip signs. Checked by the core. */
  async signAlertsProof({ accountId, email, deadline, nonce }: { accountId: string; email: string; deadline: string; nonce: Uint8Array }): Promise<Uint8Array | null> {
    const r = await this.host.call<{ signature?: string; declined?: true }>("key.signAlertsProof", { accountId, email, deadline, nonce: toB64(nonce) });
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    if (r.ok.declined || !r.ok.signature) return null;
    return fromB64(r.ok.signature);
  }

  /** The "Your key" card: the public key the chip gives now from its handle, and when it was made (ChipKey.proof). */
  async proof(): Promise<{ publicKey: string; held: boolean; madeAtIso?: string }> {
    const r = await this.host.call<{ publicKey: string; held: boolean; madeAtIso?: string }>("key.proof", {});
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    return { publicKey: String(r.ok.publicKey), held: r.ok.held === true, ...(typeof r.ok.madeAtIso === "string" ? { madeAtIso: r.ok.madeAtIso } : {}) };
  }
}

const keyProblem = (what: string): Problem => ({
  code: "security.key.refused",
  whatHappened: what,
  money: { state: "not-involved" },
  next: { kind: "retry", label: "Try again" },
});

/**
 * The seam DemoCore takes (`deviceKeys`) on the phone: the account's key is the chip key. `make` never resolves null:
 * a phone that can't make the key (no chip, Face ID refused) throws a ProblemError the shell shows, before anything
 * exists on-chain. `forget` does nothing: a chip key stays on the phone and is reused by the next account.
 */
export function hostDeviceKeys(host: IosHost): DeviceKeys {
  return {
    async make() {
      let key: HostKey | null;
      try {
        key = await HostKey.open(host, { create: true });
      } catch (e) {
        if (e instanceof ProblemError) throw e;
        throw new ProblemError(keyProblem((e as Error).message || "This phone couldn't make your key."));
      }
      if (!key) throw new ProblemError(keyProblem("This phone couldn't make your key in its secure chip."));
      return key;
    },
    get: () => HostKey.open(host, { create: false }),
    forget: async () => {},
  };
}

/**
 * The device check run on a test iPhone (zerofee://host/keycheck, debug builds): make or open the chip key,
 * sign a test transaction on the native sheet with Face ID, and verify it here with the same library the core uses.
 * The test can't move money: it names no real account, its nonce is 0 and its block hash is all zeros, so no network
 * would ever take it.
 */
export async function chipKeyCheck(host: IosHost): Promise<string> {
  try {
    const key = await HostKey.open(host, { create: true });
    if (!key) return "No chip key.";
    const tx = { signerId: "keycheck.zerofee", publicKey: key.publicKey, nonce: 0n, receiverId: "keycheck.zerofee", blockHash: "11111111111111111111111111111111", actions: [{ kind: "transfer" as const, yocto: 0n }] };
    const bytes = serialize(tx);
    const words = { title: "Chip key check", lines: ["A test approval. It names no real account, so it can't move money."], warnings: [], effect: [] };
    const t0 = performance.now();
    const sig = await key.signOnSheet({ id: "keycheck", words, bytes, summary: sheetSummary(tx) });
    if (!sig) return "Not now. ZeroFee approved nothing.";
    const ms = Math.round(performance.now() - t0);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    const tampered = hash.slice();
    tampered[0] ^= 1;
    return [
      `Key: ${key.publicKey.slice(0, 24)}…`,
      `Approved with Face ID in ${ms} ms, counting the time to read the sheet.`,
      `The approval checks out here: ${signatureIsValid(hash, sig, key.publicKey) ? "yes" : "no"}.`,
      `A changed request fails the check: ${!signatureIsValid(tampered, sig, key.publicKey) ? "yes" : "no"}.`,
    ].join("\n");
  } catch (e) {
    return `Not done: ${(e as Error).message}`;
  }
}
