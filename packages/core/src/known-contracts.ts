// Contracts the decoder can describe in plain words. Anything not listed here is shown as an unknown contract, with a
// warning. S1.5 adds intents.near and the Earn contracts as they land.
import { base58Decode, base58Encode, mlDsaKeyHandle } from "./key-handle.ts";
import { base64ToBytes } from "@fastnear/utils";
import { formatShort, shortKey } from "./format.ts";
import type { Details, Network } from "./signer.ts";

/**
 * LEGACY, UNSAFE: the old recovery-only contract (contracts/recovery-policy/release/). ZeroFee never installs it any more
 * (audit, core integrity 4): its phone key is a full-access key, and its recovery leaves the old phone's key on the
 * account. Kept only to read accounts that already run it, and named as old wherever such an account is described.
 * New accounts get the account contract (ACCOUNT_POLICY).
 */
export const RECOVERY_POLICY = {
  /** sha256 of the wasm, hex. Set-up refuses it (demo-core create); only recognised on accounts that have it. */
  sha256Hex: "e48f761f450d37f07dc7c6145d93d21e7cf395cb4d25d217c7bee1d17c0d796c",
  /** The same hash in NEAR's base58 form, as `view_account` reports `code_hash` once it is installed. */
  codeHashBase58: "GPCqKXEWLFFfr9dyQyaPHnWDnKnHhLQHh81vMsyxMggB",
  /** Earlier builds of the same code, still recognised on accounts that have them (testnet, milestone M3). */
  olderCodeHashes: ["66DRkUvjTZ9vkitUvyVmYp6TgaQmjC8mRAVf5rdrceKA"],
  /** The only methods the recovery key may call (NEAR enforces this on the key itself). */
  recoveryKeyMethods: ["start_recovery", "finish_recovery"],
};

/** The account contract (contracts/account-policy/release/): protection by amount, second device, recovery. */
export const ACCOUNT_POLICY = {
  /** Version 9, the release (259,249 bytes; the second blind re-score's items, 1 Nov): a recovery's finish adds the new
   *  phone's key first and a callback finishes it only once NEAR has added it, so an add NEAR refuses (a balance at the
   *  storage edge) leaves the old phone and the waiting recovery as they were (R8-RS1); an upgrade goes only to a release
   *  on the account's own list (allowed_releases), which grows only by an AllowRelease a second device of age co-signs or
   *  after the words-only fallback; a second device of age may refill the words' fee allowance (refill_recovery_key, its
   *  fifth method); a call's gas counts as NEAR at 1e9 yocto a gas (ten times NEAR's lowest price). The phone's and the
   *  words' methods are unchanged.
   *  Version 8 (250,137 bytes, 37vXrcd…; the blind re-score's items, 30 Oct): a single execute carries at most 250 Tgas
   *  in all (RS-1); every call's gas counts as NEAR against the bands (RS-2); a key removal never deletes the current
   *  backup key, re-checked when it runs; a second device's key is recorded only while NEAR has it (an add that failed
   *  is forgotten by its callback, a refill whose key is missing adds it alone: FB-3). Nothing else changed: the same
   *  methods for every key, the same state (upgrade_check from 7 writes nothing).
   *  Version 7 (243,074 bytes, 5s2Poz7…, the product's recovery redesign, 29 Oct): a recovery needs the second device of
   *  age's yes (approve_recovery, bound to it) or the words-only fallback (14 days by default, at least 7 x the 48-hour
   *  delay); that device can refuse it (refuse_recovery); the contract checks every key's role itself; a step carries at
   *  most 300 Tgas. Version 6 (232,058 bytes, 3JG7XVm…, audited, never published): the re-audits' fixes (CONTRACT-AUDIT.md: the phone's stop of a recovery
   *  waits 24 hours and the second device may refuse it, a second device co-signs only once of age and its clock stops in
   *  a dispute, the words beat the phone (re-audit 2, N1 (A)), upgrade_check reads all), only what the app shows: no
   *  Agent, Legacy or Kids (product decision, 28 Oct), and contract audit A's and B's fixes (28 Oct): a waiting recovery freezes
   *  spending on every account and only what the second device co-signed (or the phone's stop) runs, any stop drops what
   *  the phone asked alone, a young second device leaves at finish, the 24-hour list is bounded, a recovery's new key
   *  can't become anything else, an approval by a removed device doesn't count; and audit A's re-check (28 Oct): `approve`
   *  keeps the same rule as `run` while a recovery waits, a stop the second device didn't say yes to freezes too, new
   *  words ending a recovery drop what the phone asked alone, a yes given while young never co-signs; and the contract
   *  review (28 Oct): a call any contract may answer counts its gas as NEAR, a young yes never replaces an aged co-sign, a
   *  band may wait 31 days. */
  sha256Hex: "75af028ee153d7c341bc4f96b9ba10a4b2fada5b2170e5e07d3d13b7be735e70",
  codeHashBase58: "8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu",
  /** Earlier releases, still recognised: v9's short-waits build (FDfoE6v…, sandbox and testnet only), v8 (37vXrcd…) and its
   *  short-waits build (DodJX5m…), v7 (5s2Poz7…) and its
   *  short-waits build (vXFzGxp…), v6 (3JG7XVm…), v6 before the contract review, v6 before audit A's re-check and its cut build before audit A (built, never
   *  published), v6's first build (with Agent, Legacy and Kids; built, never published), v5 (the
   *  first audit's fixes; built, never published), v4 (Kids), v4's first build (no kids_why view), v3 (Legacy, Agent),
   *  v3's first build, v2 (execute_many, upgrade) and v1 (testnet only). */
  olderCodeHashes: ["FDfoE6vBv1bGjfxWgkXDh8FnEfLjKYFiUvDxUkQnPNL", "37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg", "DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6", "5s2Poz7TSPZnwRtEQqF2xML93w8utbk6KtqfqCaXx1V", "vXFzGxpf6mC3e515soJu476Mxbu7uvo8pfAMgRqsqVL", "3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz", "3jT9F4RL115cMxuY7Dwc5RnaSSfqAUQ9F4Rhv4GHc8h4", "7QRGbHWttcP2ahWAbc5dTThTNHbjjA2d7MAKNd3C7FdX", "5vNK7eJcv5Tf2TYHwZTNhezwXRejWa4GneaeqAATfYzB", "396ARafA8YLDcorCdHyHgykmeLDAQNrrSNwAG6EUjqMP", "GuvwX4cqM6bt53AArbHhxkJwPBYWbj4SZJ9p6ApjMp17", "3NFQ7DrAoPLJ8iwfMvwz2koeFLkNJ65nHS4DxA61y5Kv", "HvALAxK1N5XPaAmvKjvToheN9A7YqpeUAGA5ioHHpzMu", "3bP1uKfKsUMZY6Xofxv6wZtjKrin2uvoPbeb9SZaKgsE", "99APpnLna3ZBB88KVaVQXAakPyBpaLiYujxanJ2FtE1e", "FeW2wSqQNdC9LXNaGyZdY81b6hYZAkAzaaqd7M2B7WRY", "BELFgu4XArJjV2BJBtcfG2L16vKnF2a222kPt28pTcoB"],
  /** Release number by code hash: what each account's contract can do. */
  versions: { "8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu": 9, "FDfoE6vBv1bGjfxWgkXDh8FnEfLjKYFiUvDxUkQnPNL": 9, "37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg": 8, "DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6": 8, "5s2Poz7TSPZnwRtEQqF2xML93w8utbk6KtqfqCaXx1V": 7, "vXFzGxpf6mC3e515soJu476Mxbu7uvo8pfAMgRqsqVL": 7, "3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz": 6, "3jT9F4RL115cMxuY7Dwc5RnaSSfqAUQ9F4Rhv4GHc8h4": 6, "7QRGbHWttcP2ahWAbc5dTThTNHbjjA2d7MAKNd3C7FdX": 6, "5vNK7eJcv5Tf2TYHwZTNhezwXRejWa4GneaeqAATfYzB": 6, "396ARafA8YLDcorCdHyHgykmeLDAQNrrSNwAG6EUjqMP": 6, GuvwX4cqM6bt53AArbHhxkJwPBYWbj4SZJ9p6ApjMp17: 5, "3NFQ7DrAoPLJ8iwfMvwz2koeFLkNJ65nHS4DxA61y5Kv": 4, "HvALAxK1N5XPaAmvKjvToheN9A7YqpeUAGA5ioHHpzMu": 4, "3bP1uKfKsUMZY6Xofxv6wZtjKrin2uvoPbeb9SZaKgsE": 3, "99APpnLna3ZBB88KVaVQXAakPyBpaLiYujxanJ2FtE1e": 3, FeW2wSqQNdC9LXNaGyZdY81b6hYZAkAzaaqd7M2B7WRY: 2, BELFgu4XArJjV2BJBtcfG2L16vKnF2a222kPt28pTcoB: 1 } as Record<string, number>,
  /** Releases without Agent, Legacy and Kids (the current one: product decision, 28 Oct, only what the app shows). Their
   *  methods aren't there, so the core never calls them on such an account. */
  withoutModules: ["8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu", "FDfoE6vBv1bGjfxWgkXDh8FnEfLjKYFiUvDxUkQnPNL", "37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg", "DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6", "5s2Poz7TSPZnwRtEQqF2xML93w8utbk6KtqfqCaXx1V", "vXFzGxpf6mC3e515soJu476Mxbu7uvo8pfAMgRqsqVL", "3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz", "3jT9F4RL115cMxuY7Dwc5RnaSSfqAUQ9F4Rhv4GHc8h4", "7QRGbHWttcP2ahWAbc5dTThTNHbjjA2d7MAKNd3C7FdX", "5vNK7eJcv5Tf2TYHwZTNhezwXRejWa4GneaeqAATfYzB"] as string[],
  /** What NEAR lets each kind of key call (the contract adds keys with exactly these lists; the current release's). */
  deviceMethods: ["execute", "execute_many", "run", "cancel", "set_protection", "add_second_device", "remove_key", "set_recovery_key", "cancel_recovery", "upgrade"],
  agentMethods: ["agent_pay", "agent_convert", "run_order"],
  /** The same release built with its `short-waits` feature (a 60-second shortest delay instead of one day), for the sandbox
   *  rehearsal and testnet only: never set up on mainnet, never published. Known so the fake chain and the core tell it apart. */
  shortWaits: { sha256Hex: "03a474c3dae06f4f49d78ab50b5bf1d32bd3f39ac72c7277ad0f83b05ec19985", codeHashBase58: "FDfoE6vBv1bGjfxWgkXDh8FnEfLjKYFiUvDxUkQnPNL" },
  /** The recovery delays the app offers at set-up (D49, 1 Nov): 48 hours at least (the default), then 3, 7, 14 and 30 days;
   *  24 hours is no longer offered (an app rule: the contract still takes 24 hours to 30 days, so older accounts work).
   *  The contract takes 24 hours to 30 days; the choice never changes after set-up. */
  recoveryDelayChoices: [172_800, 259_200, 604_800, 1_209_600, 2_592_000] as number[],
  defaultRecoveryDelaySeconds: 172_800,
  /** Release 7: a second device also says yes to a waiting recovery, or refuses it. Release 9: and refills the words'
   *  fee allowance (refill_recovery_key). */
  secondDeviceMethods: ["approve", "decline", "approve_recovery", "refuse_recovery", "refill_recovery_key"],
  recoveryKeyMethods: ["start_recovery", "finish_recovery"],
};

/**
 * Release 10 (2 Nov): Agent's own key with a daily limit, and the R9-AL1 fix (contracts/account-policy/release/
 * account_policy-10.wasm, docs/audit/RELEASE-10.md). OFFERED ONLY (D57): a new account still gets release 9
 * (ACCOUNT_POLICY); a release-9 account is offered this as an optional update, and only once two nodes show it published
 * under this hash with this sha256. Never forced, never assumed: a feature that needs it (Agent) asks `hasAgent` first.
 * The phone's key gets Agent's four methods at the update (its upgrade_check); Agent's own key calls only agent_pay.
 * This is the build with the 4 Nov security audit's fixes (docs/audit/RELEASE-10.md: a new Agent key and a looser budget
 * at the strictest band, a key renewal only within Face ID and never while frozen, a waiting removal never takes Agent's
 * key). The first build (`beforeAudit`) was never published: it is unknown code everywhere (no version, not an account
 * contract, no Agent, never offered, the sheet's "Unknown code"). Its hashes are kept only so tests can say so.
 */
export const RELEASE_10 = {
  version: 10,
  sha256Hex: "44e440247bd8316de013bb604403d9ae751a422748b005f92cd2c3c289d0b244",
  codeHashBase58: "5dvbBjU2boghQtkkoCUJeBofaheUwLjLUwnvMydC6Tf9",
  bytes: 361_940,
  /** Its short-waits build (a minute's least delay): sandbox and testnet only, never set up on mainnet, never published. */
  shortWaits: { sha256Hex: "4fe834e2a99a1ac33b8d8994e771afd2d12795144daa3cb907b50ee44dc2a400", codeHashBase58: "6NvaDuhkYJVK6WMdywp4gqno9j6LpABeizNkiu429PYs" },
  /** Earlier builds, never published, so unknown code everywhere: the first build and its short-waits build
   *  (release/previous/account_policy-10-before-audit*.wasm), then the 4 Nov audit's fixed build and its short-waits
   *  build (release/previous/account_policy-10-before-r1*.wasm, before the internal proofing's round 1), then round 1's
   *  build and its short-waits build (release/previous/account_policy-10-before-r2*.wasm, before round 2 and the laptop
   *  veto), then round 2's build and its short-waits build (release/previous/account_policy-10-before-r4*.wasm, before
   *  round 4's B4: a sale priced by 1Click's signed quote). Listed only for the tests that check nothing counts them as ZeroFee's. */
  beforeAudit: ["CzhCDZAN4GhtxTtoHpKUXvNDmKus5r1aLtAK85KW37sE", "64YHsAK7LbvdWHufcKphQMLVeMAoun5AK9mJhY5pd5te", "6b8A5yiiiXJeAYPXiw1ZsgceYKcrzJeW3zqEJLne67v7", "d1vgvH6ax491XWsKrrk2J7AaF8fA5avrGoXMJdPC8Lb", "7SdCPVynVHqeqo9AnLxqZ8Wfu4SYi63e4cJ7kkgGihYD", "BPuYmPa8nQDT2sNMuYmCGBHDiBSdLfvNe2seCctDofkm", "HBacNykNbFZ1PtZawdtV8b5xA9iyWSWDp8eHrm2mwdim", "6wU9YptPjjA1ZYN6FXHiM8egjjxC5tzRvnVyDk4ZVJwD"],
  deviceMethods: [...ACCOUNT_POLICY.deviceMethods, "agent_set", "agent_set_budget", "agent_revoke", "agent_renew_key"],
  agentMethods: ["agent_pay"],
  /** Round 2 (the laptop veto): the words' key also ends a laptop's dispute. The contract adds it with these three
   *  methods, and its upgrade_check renews an earlier build's words key to them. */
  recoveryKeyMethods: ["start_recovery", "finish_recovery", "end_dispute"],
} as const;
for (const h of [RELEASE_10.codeHashBase58, RELEASE_10.shortWaits.codeHashBase58]) {
  ACCOUNT_POLICY.versions[h] = RELEASE_10.version;
  // No Legacy or Kids in it: the v3/v4 module paths (hasModules) never treat it as theirs.
  ACCOUNT_POLICY.withoutModules.push(h);
}
/** The releases ZeroFee offers as an optional update (D57), newest last. */
export const OFFERED_RELEASES = [RELEASE_10] as const;
/** Does this account's contract have release 10's Agent (its own key, a daily limit)? */
export const hasAgent = (codeHash: string | undefined, network?: Network) => policyVersion(codeHash, network) >= 10;

/** A release the account's `upgrade` may name (by its sha256, hex): ZeroFee's current one or an offered one, by number.
 *  Anything else: null, and the sheet calls it unknown code. Short-waits builds are never named: they're never offered. */
export function knownReleaseBySha(sha256Hex: string): number | null {
  if (sha256Hex === ACCOUNT_POLICY.sha256Hex) return ACCOUNT_POLICY.versions[ACCOUNT_POLICY.codeHashBase58] ?? null;
  return OFFERED_RELEASES.find((r) => r.sha256Hex === sha256Hex)?.version ?? null;
}

/** A release's sha256 as 64 hex characters, from any of the forms it travels in: hex, base64 (the contract's own JSON,
 *  `Base64VecU8`, as `waiting_requests` and `upgrade` carry it) or base58 (NEAR's code hash). Null: not 32 bytes. */
export function releaseShaHex(hash: unknown): string | null {
  if (typeof hash !== "string" || hash.length === 0 || hash.length > 100) return null;
  if (/^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase();
  let bytes: Uint8Array | null = null;
  try {
    // base64 of 32 bytes always ends in "="; base58 never has "=", "+" or "/".
    bytes = /[=+/]/.test(hash) ? base64ToBytes(hash) : base58Decode(hash);
  } catch {
    return null;
  }
  return bytes.length === 32 ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : null;
}

/**
 * THE check for a waiting AllowRelease or Upgrade (QA, 5 Nov, MUSTs 1 and 2): is this hash a release THIS
 * device's own bundle offers (ZeroFee's current release or an offered one)? Its release number, or null: unknown code,
 * shown in red ("Unknown code. Say no"), never "update", and never approved. Every screen that shows or approves such a
 * request asks here: the phone's Safe and Protection, the guard-dog alert, the laptop page. It reads nothing from the
 * network: the list is compiled into the app.
 */
export function knownRelease(hash: unknown): number | null {
  const hex = releaseShaHex(hash);
  return hex ? knownReleaseBySha(hex) : null;
}
export const isKnownRelease = (hash: unknown): boolean => knownRelease(hash) !== null;

/** The release an account on `release` is offered (D57): ZeroFee's current one from release 2 to 8 (the first with
 *  `upgrade`), release 10 from release 9 (it lets AgentZero hold its wallet). None from 10 on. */
export function offeredUpdate(release: number): { version: number; sha256Hex: string; codeHashBase58: string } | null {
  if (release >= 2 && release < 9) return { version: ACCOUNT_POLICY.versions[ACCOUNT_POLICY.codeHashBase58]!, sha256Hex: ACCOUNT_POLICY.sha256Hex, codeHashBase58: ACCOUNT_POLICY.codeHashBase58 };
  if (release === 9) return { version: RELEASE_10.version, sha256Hex: RELEASE_10.sha256Hex, codeHashBase58: RELEASE_10.codeHashBase58 };
  return null;
}

/**
 * The update an account is offered, by the code it runs (its hash), not by its release number alone (QA's NIT,
 * 5 Nov): releases 2 to 8 get ZeroFee's current one; release 9, or an earlier BUILD of the newest offered release (a
 * re-spun release 10 keeps the number 10), gets the newest offered build. The newest build itself (or its short-waits
 * twin) gets none. Unknown code, or code from a newer release than any offered: none.
 */
export function offeredUpdateFor(codeHash: string | undefined, network?: Network): { version: number; sha256Hex: string; codeHashBase58: string } | null {
  if (!codeHash || !isAccountPolicy(codeHash, network)) return null;
  const release = policyVersion(codeHash, network);
  if (release >= 2 && release < 9) return offeredUpdate(release);
  const newest = OFFERED_RELEASES[OFFERED_RELEASES.length - 1]!;
  if (release < 9 || release > newest.version) return null;
  if (codeHash === newest.codeHashBase58 || codeHash === newest.shortWaits.codeHashBase58) return null;
  return { version: newest.version, sha256Hex: newest.sha256Hex, codeHashBase58: newest.codeHashBase58 };
}

/** A second device's method list, exactly: this release's, release 7's and 8's (no refill_recovery_key; release 9's
 *  upgrade_check renews it to this release's), or release 6's (approve and decline only, before a recovery needed its
 *  yes). Never a superset, so no other key is ever taken for one. A release-6 one is added again (add_second_device, the
 *  core's account.secondDevice.refill) to answer a move to a new device. */
export const RELEASE6_SECOND_DEVICE_METHODS = ["approve", "decline"] as const;
export const RELEASE7_SECOND_DEVICE_METHODS = ["approve", "decline", "approve_recovery", "refuse_recovery"] as const;
export const isSecondDeviceMethods = (methods: readonly string[]) =>
  [ACCOUNT_POLICY.secondDeviceMethods, RELEASE7_SECOND_DEVICE_METHODS, RELEASE6_SECOND_DEVICE_METHODS].some((list) => methods.join() === list.join());

/**
 * The short-waits builds (a minute's least delay, v7 to release 10): sandbox and testnet only, never published. On
 * mainnet such code is never ZeroFee's (audit, core integrity 3): anyone can deploy it, and its waits are a minute, so an
 * account running it there reads as unknown code (no rules, no version, no recovery rules) to every read and to the
 * second device.
 */
const SHORT_WAITS_CODE_HASHES: readonly string[] = [ACCOUNT_POLICY.shortWaits.codeHashBase58, "DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6", "vXFzGxpf6mC3e515soJu476Mxbu7uvo8pfAMgRqsqVL", ...OFFERED_RELEASES.map((r) => r.shortWaits.codeHashBase58)];
/** Short-waits code counts only where the network is said and isn't mainnet; not said, it is mainnet's strict reading. */
const countsOn = (codeHash: string, network: Network | undefined) => network === "testnet" || !SHORT_WAITS_CODE_HASHES.includes(codeHash);

/** Is this installed code (base58 code hash) one of ZeroFee's account-contract releases, on this network? */
export const isAccountPolicy = (codeHash: string | undefined, network?: Network) => !!codeHash && countsOn(codeHash, network) && (codeHash === ACCOUNT_POLICY.codeHashBase58 || ACCOUNT_POLICY.olderCodeHashes.includes(codeHash) || OFFERED_RELEASES.some((r) => r.codeHashBase58 === codeHash || r.shortWaits.codeHashBase58 === codeHash));

/** The account contract's release number on an account (0 if it doesn't run the account contract, on this network). */
export const policyVersion = (codeHash: string | undefined, network?: Network) => (codeHash && countsOn(codeHash, network) ? (ACCOUNT_POLICY.versions[codeHash] ?? 0) : 0);

/** Has this account's contract Legacy and Agent (v3 on), or Kids too (`kids`: v4 on)? Never the current release. */
export const hasModules = (codeHash: string | undefined, kids = false, network?: Network) => policyVersion(codeHash, network) >= (kids ? 4 : 3) && !ACCOUNT_POLICY.withoutModules.includes(codeHash!);

/** Is this installed code one of the recovery-only contract's builds? */
export const isRecoveryPolicy = (codeHash: string | undefined) => !!codeHash && (codeHash === RECOVERY_POLICY.codeHashBase58 || RECOVERY_POLICY.olderCodeHashes.includes(codeHash));

/** A protection level as the contract writes it in JSON. */
export type PolicyLevel = "FaceId" | "Device" | { Wait: { seconds: string } } | { Both: { seconds: string } };

/** "Runs as soon as you approve", "Waits 1 day; you can cancel it from this device until then", … */
/**
 * What a level does, in words. `backupWordsStop`: release 5 on (audit F1), starting a recovery drops every waiting request
 * a second device hasn't approved, so the backup words can stop a wait too.
 */
export function levelWords(level: PolicyLevel, backupWordsStop = false): string {
  if (level === "FaceId") return "It runs as soon as you approve.";
  if (level === "Device") return "It also needs your second device's yes.";
  if ("Wait" in level) return backupWordsStop ? `It waits ${duration(Number(level.Wait.seconds))}. You, or your backup words, can stop it.` : `It waits ${duration(Number(level.Wait.seconds))}. You can cancel it from this device until then.`;
  return `It waits ${duration(Number(level.Both.seconds))} and also needs your second device's yes.`;
}

/**
 * The coins a protection band can list (NEAR, USDC, USDT and demo-core's BAND_COINS), by the name a person knows them by
 * and their decimals (UI-SIMPLICITY-RULES rule 3: a coin is its human name on every screen, never its contract id or raw
 * units, even behind a disclosure). The phone test, 2 Nov.
 */
const KNOWN_COINS: Record<string, [symbol: string, decimals: number, name: string]> = {
  near: ["NEAR", 24, "NEAR"],
  "nep141:wrap.near": ["NEAR", 24, "NEAR (wrapped)"],
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": ["USDC", 6, "USDC"],
  "nep141:usdt.tether-token.near": ["USDT", 6, "USDT"],
  "nep141:sol.omft.near": ["SOL", 9, "SOL"],
  "nep141:eth.omft.near": ["ETH", 18, "ETH"],
  "nep141:base.omft.near": ["ETH", 18, "ETH on Base"],
  "nep141:arb.omft.near": ["ETH", 18, "ETH on Arbitrum"],
  "nep141:hood.omft.near": ["ETH", 18, "ETH on Robinhood Chain"],
  "nep141:btc.omft.near": ["BTC", 8, "Bitcoin"],
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": ["USDC", 6, "USDC on Solana"],
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": ["USDC", 6, "USDC on Base"],
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": ["USDC", 6, "USDC on Ethereum"],
  "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near": ["USDC", 6, "USDC on Arbitrum"],
  "nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near": ["USDC", 6, "USDC on Gnosis"],
  "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": ["USDT", 6, "USDT on Ethereum"],
  "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near": ["USDT", 6, "USDT on Solana"],
  "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near": ["USDT", 6, "USDT on Tron"],
  "nep141:zec.omft.near": ["ZEC", 8, "Zcash"],
  "nep141:eth.bridge.near": ["ETH", 18, "ETH (bridged to NEAR)"],
  "nep141:nbtc.bridge.near": ["BTC", 8, "Bitcoin (bridged to NEAR)"],
  "nep141:xrp.omft.near": ["XRP", 6, "XRP"],
  "nep141:doge.omft.near": ["DOGE", 8, "Dogecoin"],
  "nep141:tron.omft.near": ["TRX", 6, "Tron"],
  "nep141:ltc.omft.near": ["LTC", 8, "Litecoin"],
  "nep141:bch.omft.near": ["BCH", 8, "Bitcoin Cash"],
  "nep141:cardano.omft.near": ["ADA", 6, "Cardano"],
  "nep141:sui.omft.near": ["SUI", 9, "Sui"],
  "nep141:eth-0x2260fac5e5542a773aa44fbcfedf7c193bc2c599.omft.near": ["WBTC", 8, "Wrapped Bitcoin on Ethereum"],
  "nep141:eth-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near": ["cbBTC", 8, "cbBTC on Ethereum"],
  "nep141:base-0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf.omft.near": ["cbBTC", 8, "cbBTC on Base"],
  "nep141:sui-c1b81ecaf27933252d31a963bc5e9458f13c18ce.omft.near": ["USDC", 6, "USDC on Sui"],
};

/** A coin's human name ("USDC on Solana"), or "another coin" for one ZeroFee doesn't name: never its id. */
export const coinName = (coin: string): string => KNOWN_COINS[coin]?.[2] ?? "another coin";

/** NEAR in yocto → "2.5 NEAR"; a known coin by its decimals ("0.2108 SOL"); any other coin as "a limit in another coin",
 *  never its raw units or its id (UI-SIMPLICITY-RULES rule 3). */
export function coinAmount(coin: string, units: string): string {
  const k = KNOWN_COINS[coin];
  if (!k || !/^\d+$/.test(units)) return "a limit in another coin";
  // A limit is context, not an amount that moves: short, rounded down (the band never reads bigger than it is).
  return `${formatShort(BigInt(units), k[1], "down")} ${k[0]}`;
}

const USD_COINS: Record<string, number> = { "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": 6, "nep141:usdt.tether-token.near": 6 };

/**
 * A NEAR limit carries the dollars it was set from (one fact, one figure: grade 02e, E3, "$490 vs $492 vs $493"): its
 * last 18 digits (under a millionth of a NEAR) are the cents, then the mark 777777. Every device then reads the dollars
 * the person chose from the account itself: the page, its sheet and the Waiting screen alike.
 */
const TAIL = 10n ** 18n, MARK = 777_777n;
export const nearLimitWithDollars = (nearYocto: bigint, cents: bigint): bigint => (nearYocto / TAIL) * TAIL + cents * 1_000_000n + MARK;

/** A dollar figure worked out from a price, said as people would: two significant figures ($501.14 → $500, $1,234 → $1,200). */
export function roundAbout(usd: number): number {
  if (!(usd >= 10)) return Math.round(usd * 100) / 100;
  const step = 10 ** (Math.floor(Math.log10(usd)) - 1);
  return Math.round(usd / step) * step;
}

/**
 * A NEAR limit in dollars: the dollars it carries (exact), unless today's price puts it more than a quarter away (a
 * request could carry any tail); else at `nearUsd`, rounded ("about"). Null when neither can be said.
 */
export function nearLimitUsd(near: string, nearUsd?: number | null): { usd: number; about: boolean } | null {
  if (!/^\d{1,40}$/.test(near)) return null;
  const n = BigInt(near);
  const priced = nearUsd && nearUsd > 0 ? (Number(n / 10n ** 16n) / 1e8) * nearUsd : null;
  const carried = n % 1_000_000n === MARK ? Number((n % TAIL) / 1_000_000n) / 100 : 0;
  if (carried > 0 && (priced === null || Math.abs(carried - priced) <= priced / 4)) return { usd: carried, about: false };
  return priced === null ? null : { usd: roundAbout(priced), about: true };
}

/**
 * A band's limit in dollars, as the person chose it (grade 1 Nov, D8: they picked $500 and the sheet said "114.1552
 * NEAR"): from its USDC or USDT limit when it has one (exact), else its NEAR limit (nearLimitUsd). Null when neither can
 * be said.
 */
export function bandUsd(upTo: [string, string][], nearUsd?: number | null): string | null {
  for (const [coin, amount] of upTo) {
    const d = USD_COINS[coin];
    if (d !== undefined && /^\d+$/.test(String(amount))) return `$${(Number(BigInt(amount) / 10n ** BigInt(d - 2)) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  const near = upTo.find(([coin]) => coin === "near")?.[1];
  const l = near === undefined ? null : nearLimitUsd(String(near), nearUsd);
  return l && `${l.about ? "about " : ""}$${l.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * A protection's bands as a summary plus its coin list (UI-SIMPLICITY-RULES rules 1, 2, 4; phone test, 2 Nov: a
 * wall of coin ids pushed Finish off the screen). Each band is one sentence, in dollars: "Payments up to $21 go as soon
 * as you approve." then "Bigger ones wait 2 minutes. You can cancel them." A band that counts more than one coin keeps
 * every coin's own limit, by its human name, behind "See which coins count": all of it is still on the sheet, one tap open.
 */
export function bandWords(bands: unknown, nearUsd?: number | null): { lines: string[]; details?: Details } {
  if (!Array.isArray(bands)) return { lines: [] };
  const coinLines: string[] = [];
  const many = bands.filter((b: any) => Array.isArray(b?.up_to) && b.up_to.length > 1).length;
  const lines = bands.map((b: any, i: number) => {
    const upTo: [string, string][] | null = Array.isArray(b?.up_to) ? b.up_to : null;
    const usd = upTo ? bandUsd(upTo, nearUsd) : null;
    const amounts = upTo ? upTo.map(([coin, amount]) => coinAmount(coin, String(amount))) : [];
    if (upTo && upTo.length > 1) {
      if (many > 1) coinLines.push(`Up to ${usd ?? "each coin's limit"}:`);
      upTo.forEach(([coin], j) => coinLines.push(`${coinName(coin)}: up to ${amounts[j]}`));
    }
    // one coin: its dollars and the coin ("$500 (114.15 NEAR)"); many: the dollars alone, the coins behind the disclosure
    const limit = upTo ? (usd ? (upTo.length === 1 ? `${usd} (${amounts[0]})` : usd) : upTo.length === 1 ? amounts[0] : "each coin's limit") : null;
    const who = limit ? `Payments up to ${limit}` : i > 0 ? "Bigger ones" : "Payments";
    return `${who} ${bandLevelWords(b?.level)}.`;
  });
  return coinLines.length ? { lines, details: { label: "See which coins count", lines: coinLines } } : { lines };
}

/** What a band does with a payment, in the payments' own words, so the sheet's rules never read like what this change
 *  does (grade 02g, E15: "runs as soon as you approve" under a Cancel, and "waits 1 hour" three times). */
function bandLevelWords(level: PolicyLevel | undefined): string {
  if (!level) return "go as the rules say";
  if (level === "FaceId") return "go as soon as you approve";
  if (level === "Device") return "also need your second device's OK";
  if ("Wait" in level) return `wait ${duration(Number(level.Wait.seconds))}. You can cancel them`;
  return `wait ${duration(Number(level.Both.seconds))} and also need your second device's OK`;
}

/** A borsh ML-DSA key (base64, tag 2 + 1,952 bytes) → its short handle, as the key list and the app show it. */
function keyText(b64: unknown): string {
  try {
    const bytes = base64ToBytes(String(b64));
    if (bytes.length !== 1953 || bytes[0] !== 2) return "(not a ZeroFee key)";
    return shortKey(mlDsaKeyHandle(`ml-dsa-65:${base58Encode(bytes.subarray(1))}`));
  } catch {
    return "(unreadable key)";
  }
}

/** Plain words for a call on the user's own account (the account's rules). Null if the method isn't one we know. */
/**
 * What a waiting recovery keeps on the account while it waits (grade 02e, E6: the start sheet said 7.2318 → 7.2248 and
 * 0.0199 NEAR left): NEAR's storage for the record's new key, 4 + 1,953 bytes, and its ready time, 8. It comes back when
 * the move finishes or stops.
 */
export const RECOVERY_HOLD_YOCTO = 1_965n * 10n ** 19n;
const HOLD = "0.0197 NEAR";
const HOLD_BACK = `The ${HOLD} held while it waited comes back.`;
/** Grade 02f, F10: what a finished move does to the device that has the account now (its key is deleted). */
const OLD_LOSES = "When it finishes, that device loses its key and stops working for your account.";

export function ownAccountCall(method: string, args: unknown, nearUsd?: number | null): { title: string; lines: string[]; warnings?: { kind: "unknown-contract"; text: string }[]; heldYocto?: bigint; details?: Details[] } | null {
  const a = (args ?? {}) as Record<string, any>;
  switch (method) {
    case "run":
      return { title: "Send this waiting payment now", lines: ["Its wait is over, so it can go."] };
    case "cancel":
      return { title: "Cancel this waiting payment", lines: ["Nothing from it goes out."] };
    case "approve":
      return { title: "Say yes to this waiting payment", lines: ["As your second device, you say yes to it."] };
    case "decline":
      return { title: "Say no to this waiting payment", lines: ["As your second device, you turn it down. Nothing goes out."] };
    case "set_protection": {
      // A summary in dollars; the coins each band counts behind "See which coins count" (phone test, 2 Nov).
      const w = bandWords(a.bands, nearUsd);
      return { title: "Change your protection", lines: w.lines, ...(w.details ? { details: [w.details] } : {}) };
    }
    case "add_second_device":
      return { title: "Add a second device", lines: ["The second device can say yes or no to your bigger payments. It can't send anything itself."], details: [{ label: "Details", lines: [`Key: ${keyText(a.public_key)}`] }] };
    case "remove_key":
      return { title: "Remove a key from your account", lines: ["That device can never act for your account again."], details: [{ label: "Details", lines: [`Key: ${keyText(a.public_key)}`] }] };
    case "upgrade": {
      // The release is named by its sha256: say whether it is one ZeroFee knows.
      let hex = "";
      try {
        hex = Array.from(base64ToBytes(String(a.code_hash)), (b) => b.toString(16).padStart(2, "0")).join("");
      } catch {
        // unreadable: said below
      }
      // Release 9: a release not on the account's own list is added to it first (an AllowRelease: its own words, held.ts);
      // asked again while that waits, the update itself is placed. The switch waits its level either way, so these words
      // never say a second device's yes makes it sooner (QA, 5 Nov: false on release 4's 2-minute update).
      const version = knownReleaseBySha(hex);
      return version === RELEASE_10.version
        ? { title: "Update your account's rules", lines: ["AgentZero can have its own wallet, which you fund.", "Your other rules stay the same."] }
        : version !== null
        ? { title: "Update your account's rules", lines: [`To ZeroFee's newest version (version ${version}). Your settings stay as they are.`] }
        : {
            title: "Unknown code. Cancel this",
            lines: ["Unknown code, not ZeroFee's.", "It would replace your account's rules with unknown code. Only go on if you know what it is."],
            warnings: [{ kind: "unknown-contract", text: "This isn't a ZeroFee version. Whoever asked for this may be trying to take your account." }],
            details: [{ label: "Details", lines: [`Fingerprint: ${hex || "(unreadable)"}`] }],
          };
    }
    case "set_recovery_key":
      // the words also make every hot wallet's key (hot-keys.ts): those open at once; only the Safe waits (audit, core integrity 6)
      return { title: "Add your backup words to your account", lines: ["Anyone with them can take your other wallets at once.", "Your Safe waits, and this device can stop it."] };
    case "new": {
      const seconds = Number(a.delay_seconds ?? a.recovery_delay_seconds);
      const recovery = `A new device must wait ${duration(seconds)} before it can use your account.`;
      // the old recovery-only contract's set-up (RECOVERY_POLICY: legacy, unsafe): ZeroFee never asks for it now
      if (!a.bands) return { title: "Turn on old recovery rules", lines: [recovery], warnings: [{ kind: "unknown-contract", text: "These rules are old and not safe. ZeroFee doesn't use them now." }] };
      const w = bandWords(a.bands, nearUsd);
      return { title: "Set up your account's rules", lines: [recovery, ...w.lines], ...(w.details ? { details: [w.details] } : {}) };
    }
    case "start_recovery":
      // Said on the device the account moves to (a phone or a browser), so it names neither (grade 1 Nov b, D17).
      // Grade 02f, F10: the finish deletes every other device key (lib.rs on_recovery_key), so both sheets say so.
      // Summary first (UI-SIMPLICITY-RULES 2, 6; product decision, 2 Nov): two short lines, the old device's loss among them; every
      // sentence it carried before is one tap down on the sheet itself, word for word, never dropped.
      return {
        title: "Start moving your account to this device",
        // Review (round 3, L3): "can take over", not "gets": a finish is still needed and the device that has it can stop it.
        lines: ["This device can take over after a wait.", "Then your old device loses its key."],
        // lib.rs start_recovery drops every waiting request a second device hasn't approved (audit F1): said here too.
        details: [{ label: "What happens while it waits", lines: ["This device has to wait before it can use your account.", "The device that has your account now can stop it until then.", OLD_LOSES, "Starting it cancels every payment or change still waiting. One stays only if a second device past its own wait said yes.", `The network holds about ${HOLD} while it waits. It comes back when you finish.`] }],
        heldYocto: RECOVERY_HOLD_YOCTO,
      };
    case "finish_recovery":
      return { title: "Finish moving your account to this device", lines: ["This device gets full use of your account.", "The device that had it loses its key and stops working for your account.", HOLD_BACK], heldYocto: -RECOVERY_HOLD_YOCTO };
    case "cancel_recovery":
      return { title: "Stop moving your account to a new device", lines: ["The new device won't get your account.", HOLD_BACK], heldYocto: -RECOVERY_HOLD_YOCTO };
    case "approve_recovery":
      return { title: "Let the move to a new device go ahead", lines: ["Your backup words started moving the account to a new device.", "With this device's yes, the new device gets the account when the wait is over."] };
    case "refill_recovery_key":
      return { title: "Refill your backup words' fees", lines: ["As the second device, you refill the fees kept for your backup words. Up to 0.25 NEAR.", "The words can still only move the account to a new device."] };
    case "refuse_recovery":
      return { title: "Stop the move to a new device", lines: ["The move ends now.", "Then payments pause for a while, so a thief with both gets nothing.", HOLD_BACK], heldYocto: -RECOVERY_HOLD_YOCTO };
    default:
      return null;
  }
}

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a while";
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
