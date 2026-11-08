// The demo core: every security method in docs/interfaces.md, on NEAR testnet, behind the same Bridge the phone uses.
//
// Apps and the shell talk to it exactly as they will talk to the phone's isolated core. Differences from the phone:
// - the key is a software key kept in a Vault (encrypted in the browser), not in the secure chip;
// - the approval sheet is drawn by the shell (labelled demo), which answers with `approval.answer`.
// Everything else is the real pipeline: bytes decoded independently, two nodes agreeing, the recovery policy on-chain.
//
// Onboarding, in order:
//   account.create   a throwaway classical key makes the testnet account; in ONE transaction it adds the device's
//                    post-quantum key, installs the account rules (never the old recovery-only contract), and deletes itself.
//   recovery.words   24 words for a new recovery key, kept in memory only.
//   recovery.confirm three words checked; only then is the recovery key added on-chain (approval sheet). Stage: ready.
//   recovery.backup  (the phone, S1.6) the words on their own native screen, the check there, then as recovery.confirm.
// An app closed half-way through the backup leaves no key on-chain that nobody wrote down: the words just change.
import { decodePublicKey } from "@fastnear/ml-dsa-65";
import { mlDsaKeyHandle } from "./key-handle.ts";
import { httpsOrigin } from "./https-url.ts";
import { APP_STORE_NAME } from "./app-store.ts";
import { base64ToBytes, bytesToBase64, fromBase58, privateKeyFromRandom, publicKeyFromPrivate, signHash as signClassical } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { activityItem, recipientsOf } from "./activity.ts";
import type { ActivityItem } from "./activity.ts";
import { SHELL_APP, type Bridge, type BridgeResult } from "./bridge.ts";
import { NEAR_MAINNET_NODES, RpcChain, codeOf, explorerUrl, mlDsaHandle, proxyOpening, proxySafe, txHashOf } from "./chain.ts";
import { releaseTxBytes, signedReleaseTx } from "./tx-borsh.ts";
import { RpcGnosis, checkGnosisPayAccount, readCardBalance } from "./gnosis-pay.ts";
import type { GnosisReader } from "./gnosis-pay.ts";
import { KEY_CALL_GAS, allFallbackAged, heldRequests, listingRunsAtNs, ownCallGas, updateRunsAtIso } from "./held.ts";
import { keyFromLaptopCode, SecondDeviceCore } from "./second-device.ts";
import { DEFAULT_PROTECTION, bandCoins, defaultBands, type ProtectionBand } from "./protection-bands.ts";
import type { HeldRequest } from "./held.ts";
import type { Block, Chain, ChainKey, ChainPermission } from "./chain.ts";
import { availableYocto } from "./near-available.ts";
import { SoftwareKey, signatureIsValid, vaultDeviceKeys } from "./device-key.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base58, base64 } from "./sol/bytes.ts";
import type { AccountKey, DeviceKeys } from "./device-key.ts";
import { DevSigner, handleOf, recoveryState, warmRecovery } from "./dev-signer.ts";
import type { Approve } from "./dev-signer.ts";
import { ACCOUNT_POLICY, RECOVERY_POLICY, RELEASE_10, duration, hasAgent, hasModules, isAccountPolicy, isSecondDeviceMethods, nearLimitUsd, nearLimitWithDollars, offeredUpdateFor, policyVersion, type PolicyLevel } from "./known-contracts.ts";
import { ProblemError, type Problem } from "./problem.ts";
import { FORK, FORK_CROSS_CHAIN } from "./fork.ts";
import { seedToWords, wordsProblem, wordsToSeed } from "./recovery-words.ts";
import { securityProblems } from "./security-problems.ts";
import { SAFE_SWAP_PRIVATE } from "./safe-swap-private.ts";
import { faultOf, relayLimitProblem, relayOldLimit, serviceProblem } from "./services.ts";
import { RpcEvmChain } from "./evm.ts";
import { oneClickQuote, oneClickStatus } from "./intents.ts";
import { setupCoin } from "./setup-coins.ts";
import { FUND_COINS, FUND_LIKELY, FUND_PRIVATE_ROOM, fundOffered, FUND_REST_MIN_USD, FUND_REST_MIN_YOCTO, coinText, shownUntil, fundCoin, fundSteps, overBase, readSwap } from "./fund-start.ts";
import type { FundCoin, FundFacts, FundOrder, FundRecord, FundView } from "./fund-start.ts";
import type { Received } from "./add-outside.ts";
import type { OneClickLookup, OneClickQuoter } from "./intents.ts";
import type { EvmChain, EvmWalletChain } from "./evm.ts";
import { RpcSolChain } from "./solana.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets, TRADE_SESSION } from "./subwallets.ts";
import type { HostScrypt, OldWordsSweep } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import type { AgentCtx } from "./agent-door.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { WebDoor, noSafeSigner, webAllows, type WebWalletOptions } from "./web-wallet.ts";
import { chatSeed } from "./nostr.ts";
import { ChatKeys } from "./chat-keys.ts";

import { SHOW_NEW_WORDS } from "./show-new-words.ts";
import { readableWords, type AccountInfo, type Network, type PlainWords, type TxOutcome, type TxRequest } from "./signer.ts";
import { READS } from "./read-deadline.ts";
import { unexpectedFor } from "./money-calls.ts";
import type { CoreAction } from "./tx-build.ts";
import type { Vault } from "./vault.ts";
import { readJson, readText } from "./net.ts";
import { everyAligned } from "./aligned.ts";
import { BAND_COINS, BAND_MAX_COINS } from "./band-coins.ts";
export { BAND_COINS, BAND_MAX_COINS };

export type Stage = "none" | "needs-funding" | "needs-backup" | "ready" | "recovering";

/** A self-funded account waiting for its NEAR: send at least `needYocto` to `fundAddress` from any wallet. */
export interface Funding {
  stage: "needs-funding";
  accountId: string;
  fundAddress: string;
  needYocto: string;
  haveYocto: string;
  /** Of what's sent, the part that stays with the account as its storage (the rules' code, or the reference to the
   *  published copy, and their first state): the funding screen says this number, never one of its own. */
  storageYocto?: string;
  /** O-2c: the NEAR is here, and the account opens once the backup words are checked (words first). */
  wordsDue?: true;
}

/** Audit pass 2, item 2: a Node process (no page, no phone core) may let a call with no app count as the shell's. */
export const unstampedMayBeShell = (g: { process?: { versions?: { node?: unknown } }; window?: unknown }): boolean =>
  typeof g.process?.versions?.node === "string" && g.window === undefined;

export interface DemoCoreOptions {
  chain: Chain;
  vault: Vault;
  /** The account contract wasm. The core installs only ACCOUNT_POLICY.sha256Hex (or its short-waits build off mainnet); the old recovery-only contract (RECOVERY_POLICY, legacy) is refused. */
  policyWasm: () => Promise<Uint8Array>;
  /** How long a new device must wait. The release takes a day or more (the app offers 48 h by default, 3, 7, 14 or 30 days; D49); the short-waits build used off mainnet takes 60 s. */
  recoveryDelaySeconds?: number;
  /** Makes a funded testnet account owned by a classical setup key. Default: NEAR's testnet faucet. */
  createAccount?: (accountId: string, publicKey: string) => Promise<void>;
  /** The pause before testnet account creation is tried again after a hiccup (times the try). Default 2 s. */
  createRetryMs?: number;
  /** Mainnet set-up: the pause between two reads of the setup address, until its balance stops moving. Default 1.5 s. */
  settleMs?: number;
  /** An approval left open this long counts as "no". */
  approvalTimeoutMs?: number;
  /**
   * Audit pass 2, item 2: may a call that names no app count as ZeroFee's own screens? Never in a page or the phone's
   * core (the shell's own bridge stamps SHELL_APP; a call with no app, or app "", is refused). Default: only in a Node
   * process (the tests and the test tools, which hold the core themselves).
   */
  unstampedIsShell?: boolean;
  /**
   * The approval sheet, when it isn't the shell's (S1.6 phase 2: the core runs in Swift's own context on the phone and
   * every approval is Swift's native sheet). Given these words, it resolves true only if the person approved. Without
   * it, the core asks the shell's sheet through `approval.needed`.
   */
  sheet?: (words: PlainWords) => Promise<boolean>;
  /**
   * The backup words' own screen, when it isn't the page (S1.6: Swift's native screen). It shows the 24 words, runs the
   * three-word check, and resolves the three positions and words picked (null: Later). With it, `recovery.words` is
   * refused, so the words never reach the page; `recovery.backup` runs the whole step instead.
   */
  showWords?: (words: string[], kid: boolean, renew?: boolean) => Promise<{ positions: number[]; words: string[] } | null>;
  /**
   * The phone (S1.6 follow-up): the person types their 24 words on ZeroFee's own screen, for a restore or "Check my
   * words", and they come straight here; the page never has them (recovery.start and recovery.check then refuse words
   * from the page). Null: they stopped.
   */
  typeWords?: (purpose: "restore" | "check" | "rearm" | "codes") => Promise<string[] | null>;
  /**
   * The phone's approval key (ChipKey.swift ApprovalPass, audit IOS-1, IOS-1b): has Face ID changed since it was made
   * (then every approval that isn't the account key's is refused), and make it again, bound to the faces enrolled now.
   */
  approvalKey?: { changed(): Promise<boolean>; reset(): Promise<void> };
  /** How often to look for a recovery someone else started, while anyone listens for `recovery.started`. */
  watchIntervalMs?: number;
  /** How often account.fund.status may ask 1Click about one address (default FUND_STATUS_MS; tests: 0). */
  fundStatusEveryMs?: number;
  /** Finding 23: the first wait before an opening stopped by busy nodes is tried again (default FUND_BUSY_FIRST_MS). */
  fundBusyFirstMs?: number;
  /** Gap between the few retries when the key index hasn't seen a recovery key yet (it can lag by seconds). */
  indexRetryMs?: number;
  /** Protection for a new account, in the account contract's JSON. Default: DEFAULT_PROTECTION, in dollars at today's prices. */
  protection?: unknown[];
  /** Coin prices in US dollars, for turning "$1,000" into coin amounts when the person sets their protection. */
  prices?: () => Promise<Prices>;
  /** Solana, read on two nodes, for the separate wallets. Default: two public mainnet nodes. */
  sol?: SolChain;
  /** 1Click's quote for a deposit address, for checking Agent's swaps. Default: 1Click's public status. */
  oneClick?: OneClickLookup;
  /** The key a 1Click quote must be signed with. Default: 1Click's own; tests sign their quotes with a test key. */
  quoteKey?: string;
  /** NEAR Intents' salt for a confidential wallet's sign-in. Default: intents.near's current_salt on mainnet; null: none. */
  intentsSalt?: (() => Promise<string | null>) | null;
  /** The pinned quote server for the private pocket (it holds the 1Click partner key): its base URL, https. Not set:
   *  the pocket can't pay yet. */
  privateQuotes?: string;
  /** AgentZero's mailbox (D80): the inbox API's host and the mail domain, from the app's settings; none: no mailbox. */
  mail?: { host: string; domain: string };
  /** D103: a host without a native Face ID sheet (the web) proves the person is there before a sheet that hands out a key
   *  copy or loosens AgentZero: a passkey assertion with user verification. Not given on such a host: those refused. */
  userVerified?: (reason: string) => Promise<boolean>;
  /** D143 on the web (product decision, 3 Nov, P0: "I could sign a txn from the Safe… no Face ID, no iPhone key check"): every
   *  signature of the Safe's own key needs, after the sheet's Approve, a FRESH check that the person is there (the web's
   *  passkey assertion with user verification, read from its signed flags: unlock/verify.ts). Set on a host without a
   *  native Face ID sheet; the phone's sheet IS Face ID (nativeSheet, or a key with its own sheet), so it is never set
   *  there. Its answer is final: no, a cancelled prompt or a throw, and nothing is signed. Trading wallets and listed
   *  sites never reach the Safe's sheet (their own keys, the one cap: D143's speed rule), so they are never asked. */
  safeStepUp?: (reason: string) => Promise<boolean>;
  /** A tool's own quote relay on this machine's loopback (http://127.0.0.1:<port>, tools/mainnet/local-relay.sh, for the
   *  mainnet flows run only) may be `privateQuotes`. Never set by the app's build (demo-core-loopback.test.ts checks). */
  privateQuotesLoopback?: true;
  /** 1Click's quotes, for Agent's swaps. Default: 1Click's public API. */
  quoter?: OneClickQuoter;
  /** Say fees and protection limits in dollars on sheets and held requests (D8), at 1Click's public NEAR price. Words
   *  only, never what is signed. Off (tests, tools): NEAR alone. */
  sheetPrices?: boolean;
  /** A separate wallet's chain coin in dollars, for checking fast-trade caps. Default: 1Click's public prices. */
  nativeUsd?: (chain: "sol" | "bsc" | "hood" | "near") => Promise<number | null>;
  /** The phone's own host keeps sites' two-factor secrets sealed under Face ID (SiteCodes.swift) and backs them up with
   *  the words through the core (site-2fa-backup.ts): site2fa.* answers only then, and only with no app asking. The page
   *  never reaches site2fa.* on the phone (IsolatedCore.swift: not a core family the page may call). Off everywhere else. */
  siteCodes?: true;
  /** Before site2fa.restore opens the words' copy with the key at rest (review MUST 1): a fresh Face ID with the
   *  account's own approval key (ApprovalPass, biometryCurrentSet). Unset, or that key refused because the faces
   *  changed (approvalKey.changed): the 24 words typed on the phone's own screen instead. */
  codesStepUp?: () => Promise<boolean>;
  /** A screen of the device's own for an exported key (the phone): the key never comes back to the caller. */
  showSecret?: (s: { label: string; secretKey: string }) => Promise<boolean>;
  /** scrypt by the host (the phone's, natively, off the core's thread): linking the laptop's extension. Default: @noble/hashes'. */
  scrypt?: HostScrypt;
  /** BNB Chain and Robinhood Chain, read on two nodes, for the separate wallets. Default: two public nodes each. */
  evm?: EvmChain;
  /** Where the account's device key lives. Default: a software key in `vault` (the web demo). The iPhone host passes
   *  its chip key, so the account's key is made and used inside the Secure Enclave, behind Face ID. */
  deviceKeys?: DeviceKeys;
  /** Gnosis Chain, read on two nodes, for checking card addresses. Default: two public nodes. */
  gnosis?: GnosisReader;
  /**
   * A browser (audits K-2, K-4): the new account's backup words live in this page's memory only until they are shown
   * and checked (never in the vault, whatever it is), and the words' hot wallets keep no key in the vault: each is made
   * again from the hot root when it signs. Not set (the phone, whose vault is the Keychain): as before.
   */
  secretsInMemory?: boolean;
  /** AgentZero's own wallet: on by default (agent-route.ts AGENTZERO_WALLET); a test's own setting only. */
  agentWallet?: { on?: boolean; proof?: boolean };
  /**
   * The web wallet (product decision, 4 Nov, web-wallet.ts): this core runs a normal wallet with NO Safe. The 24 words and
   * their three hot wallets only; every Safe-only method is refused by name (security.web.noSafe) and the Safe's signer
   * is never made. `passwordOk` checks the person's password again (Show recovery phrase, Export private key).
   */
  webWallet?: WebWalletOptions;
}

export interface Prices {
  near: number;
  usdc?: number;
  usdt?: number;
  /** H01: the market coins of BAND_COINS in dollars, by asset id (1Click's fresh price); a coin without one isn't written. */
  coins?: Record<string, number>;
}

/** A market coin's price below this is too small to write a limit at (its amount would be huge), so it isn't written. */
const MARKET_USD_MIN = 0.01;
/** The recovery watcher marks what the open app showed (alertsPoll) on one tick in this many: every 2 minutes at 30 s. */
const ALERTS_EVERY = 4;
/** How long NEAR Intents' agreed current salt is kept (intentsSalt). */
const SALT_KEEP_MS = 10 * 60_000;

/** A held request's disclosure (a coin it can't name: its id and exact amount) on the sheet that sends, finishes or
 *  cancels it, before the call's own (security review 2 Nov, High 2: the sheet where the money leaves had lost it). */
const withItemDetails = (item: { details?: PlainWords["details"] }, w: PlainWords): { details?: PlainWords["details"] } => {
  const details = [...(item.details ?? []), ...(w.details ?? [])];
  return details.length ? { details } : {};
};

// Kept here too, for the core's own callers and tests (protection-bands.ts holds them).
export { DEFAULT_PROTECTION, bandCoins, defaultBands, type ProtectionBand };

/**
 * The contract's bands → dollar bands, so the Protection screen opens on what the account holds (never a screen's own
 * defaults). A limit in USDC is exact dollars (set-up and every save write USDC at $1 on mainnet); a NEAR-only limit
 * (testnet) is NEAR at `nearUsd`, to the cent. Null when a limit can't be said in dollars (no USDC and no price) or the
 * bands aren't the contract's shape: the screen then shows the coin rules and offers no save.
 */
export function usdBands(raw: unknown, nearUsd: number | null): ProtectionBand[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const secs = (x: unknown) => (typeof x === "string" && /^\d{1,12}$/.test(x) ? Number(x) : null);
  const out: ProtectionBand[] = [];
  for (const b of raw as { up_to?: unknown; level?: unknown }[]) {
    const lv = b?.level as { Wait?: { seconds?: unknown }; Both?: { seconds?: unknown } } | string | null | undefined;
    const wait = typeof lv === "object" && lv ? secs(lv.Wait?.seconds) : null;
    const both = typeof lv === "object" && lv ? secs(lv.Both?.seconds) : null;
    const level: Pick<ProtectionBand, "level" | "waitSeconds"> | null =
      lv === "FaceId" ? { level: "faceid" } : lv === "Device" ? { level: "device" } : wait !== null ? { level: "wait", waitSeconds: wait } : both !== null ? { level: "both", waitSeconds: both } : null;
    if (!level) return null;
    if (b.up_to === null) {
      out.push({ upToUsd: null, ...level });
      continue;
    }
    if (!Array.isArray(b.up_to)) return null;
    const limits = new Map((b.up_to as unknown[]).filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string" && /^\d{1,40}$/.test(x[1])));
    const usdc = limits.get(USDC), near = limits.get("near");
    // USDC has 6 decimals: units / 1e6 dollars, to the cent.
    // A limit held in NEAR alone (testnet) is shown as the dollars the person chose for it, which the limit itself carries
    // (grade 1 Nov b, N5: "$501.14" drifted with the price; 02e, E3: a device-kept copy left other devices on the price);
    // an older limit at today's price, as a round "about" figure.
    const inNear = usdc === undefined && near !== undefined ? nearLimitUsd(near, nearUsd) : null;
    const usd = usdc !== undefined ? Number(BigInt(usdc) / 10_000n) / 100 : inNear?.usd ?? null;
    if (usd === null || !(usd > 0)) return null;
    out.push({ upToUsd: usd, ...(inNear?.about ? { about: true } : {}), ...level });
  }
  return out;
}

/**
 * Dollar bands → the contract's bands, at these prices: each limit in NEAR, and on mainnet in USDC and USDT too, so a
 * stablecoin is measured like NEAR (a coin a band doesn't list never fits it, and goes to the strictest band).
 */
export function contractBands(bands: ProtectionBand[], prices: Prices, network: string): unknown[] {
  const cents = (usd: number) => BigInt(Math.round(usd * 100));
  const micros = (price: number) => BigInt(Math.round(price * 1e6));
  const level = (b: ProtectionBand) =>
    b.level === "faceid" ? "FaceId" : b.level === "device" ? "Device" : b.level === "wait" ? { Wait: { seconds: String(b.waitSeconds) } } : { Both: { seconds: String(b.waitSeconds) } };
  // A price far outside anything NEAR has traded at is a wrong answer, never a limit (audit NF-09).
  if (!(prices.near >= NEAR_USD_SANE[0] && prices.near <= NEAR_USD_SANE[1])) throw new ProblemError(securityProblems.priceUnsure());
  return bands.map((b) => {
    if (b.upToUsd === null) return { up_to: null, level: level(b) };
    // A NEAR-only limit (testnet) carries its dollars (E3); mainnet's USDC limit already says them exactly.
    const inNear = (cents(b.upToUsd) * 10n ** 24n * 10_000n) / micros(prices.near);
    const nearLimit = (network === "mainnet" ? inNear : nearLimitWithDollars(inNear, cents(b.upToUsd))).toString();
    const limits: [string, string][] = [["near", nearLimit]];
    // A stablecoin counts at $1, whatever a list says (audit NF-09): a de-peg makes the band smaller in dollars, never larger.
    if (network === "mainnet") limits.push([USDC, (cents(b.upToUsd) * 10n ** 4n).toString()], [USDT, (cents(b.upToUsd) * 10n ** 4n).toString()]);
    // H01: every other coin the app can price, in dollars at its price today, up to the contract's 32 (mainnet only: the
    // ids are mainnet's). The contract adds each coin's share of its own limit into one budget (audit F6).
    if (network === "mainnet") {
      for (const c of BAND_COINS) {
        if (limits.length >= BAND_MAX_COINS) break;
        const usdUnits = (cents(b.upToUsd) * 10n ** BigInt(c.decimals)) / 100n;
        if (c.kind === "near") limits.push([c.id, nearLimit]);
        else if (c.kind === "usd") limits.push([c.id, usdUnits.toString()]);
        else {
          const listed = prices.coins?.[c.id];
          if (listed === undefined || !Number.isFinite(listed) || listed < MARKET_USD_MIN || listed > 1e7 || !c.floorUsd) continue;
          const px = Math.max(listed, c.floorUsd);
          const limit = (cents(b.upToUsd) * 10n ** BigInt(c.decimals) * 10_000n) / micros(px);
          if (limit > 0n) limits.push([c.id, limit.toString()]);
        }
      }
    }
    return { up_to: limits, level: level(b) };
  });
}
/**
 * A save never re-prices a limit the person didn't touch (grade 01d, Q7: $490 went from 114.4164 to 113.4259 NEAR): a
 * band whose dollars are what the account showed (`nowUsd`, from `now` on chain) keeps its stored coin amounts, as long
 * as it lists the same coins (H01's "count every coin" save still writes the new list).
 */
export function keepUntouched(next: unknown[], bands: readonly ProtectionBand[], now: unknown, nowUsd: readonly ProtectionBand[] | null): unknown[] {
  if (!Array.isArray(now) || !nowUsd || nowUsd.length !== now.length) return next;
  const coins = (up: unknown) => (Array.isArray(up) ? (up as [string, string][]).map((x) => x[0]).sort().join() : null);
  return next.map((b, i) => {
    const was = (now[i] as { up_to?: unknown } | undefined)?.up_to;
    const up = (b as { up_to: unknown }).up_to;
    const usd = bands[i]?.upToUsd;
    return usd != null && nowUsd[i]?.upToUsd === usd && coins(was) !== null && coins(was) === coins(up) ? { ...(b as object), up_to: was } : b;
  });
}
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT = "nep141:usdt.tether-token.near";

/** The NEAR prices a band may be written at, in dollars: anything outside is a wrong answer (audit NF-09). */
const NEAR_USD_SANE: [number, number] = [0.1, 1000];
/** Ref Finance's deepest wNEAR/USDC pool (a simple pool; found 28 Oct 2026 by reading all 8,991 pools). */
const REF_EXCHANGE = "v2.ref-finance.near";
const REF_NEAR_USDC_POOL = 4512;

/** NEAR in dollars from the chain itself: that pool's reserves, read through two nodes. Null when it can't be read. */
async function refNearUsd(chain: Chain): Promise<number | null> {
  const pool = (await chain.view(REF_EXCHANGE, "get_pool", { pool_id: REF_NEAR_USDC_POOL }, await chain.commonBlock()).catch(() => null)) as { token_account_ids?: unknown; amounts?: unknown } | null;
  const ids = pool?.token_account_ids, amounts = pool?.amounts;
  if (!Array.isArray(ids) || !Array.isArray(amounts) || ids.length !== 2 || amounts.length !== 2) return null;
  const n = ids.indexOf("wrap.near"), u = ids.indexOf(USDC.slice("nep141:".length));
  if (n < 0 || u < 0 || !/^\d{1,40}$/.test(String(amounts[n])) || !/^\d{1,40}$/.test(String(amounts[u]))) return null;
  const near = Number(BigInt(amounts[n]) / 10n ** 18n) / 1e6;
  return near > 0 ? Number(amounts[u]) / 1e6 / near : null;
}

/**
 * The prices a protection's limits are written at (audit NF-09: they are signed with no sheet at an account's creation).
 * NEAR: 1Click's, only if updated in the last 15 minutes, and on mainnet only within 10 % of the chain's own (Ref
 * Finance's deepest pool, two nodes); else nothing is written and the person tries again. Stablecoins: $1 (contractBands).
 */
/**
 * The chain set-up's band prices read (Ref's NEAR pool #4512, on mainnet): the account's own. On the mainnet copy
 * (VITE_FORK=1, fork.ts) the copy's NEAR can't hold Ref's state (its node answers TOO_LARGE_CONTRACT_STATE, so set-up
 * would stop at priceUnsure): there they read real NEAR mainnet, read-only (a price; nothing is signed or sent there).
 * Off the copy, and on testnet, the account's own chain as before.
 */
export const bandPriceChain = (chain: Chain, fork: boolean = FORK): Chain => (fork && chain.network === "mainnet" ? new RpcChain("mainnet", NEAR_MAINNET_NODES) : chain);

export async function bandPrices(chain: Chain): Promise<Prices> {
  const near = await oneClickNativeUsd("near");
  if (!near) throw new ProblemError(securityProblems.priceUnsure());
  if (chain.network === "mainnet") {
    const own = await refNearUsd(chain);
    if (!own || Math.abs(near - own) / own > 0.1) throw new ProblemError(securityProblems.priceUnsure());
    const coins = await marketCoinPrices();
    if (Object.keys(coins).length) return { near, coins };
  }
  return { near };
}

/** H01: BAND_COINS' market coins in dollars from 1Click's list, each only if updated in the last 15 minutes; a coin with
 *  no fresh price is left out (it then waits, as before), and no list at all leaves them all out. */
async function marketCoinPrices(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const list: any[] = await readJson(await fetch("https://1click.chaindefuser.com/v0/tokens", { signal: AbortSignal.timeout(15000) }));
    if (!Array.isArray(list)) return out;
    for (const c of BAND_COINS) {
      if (c.kind !== "market") continue;
      const t = list.find((x) => x?.assetId === c.id);
      const price = Number(t?.price);
      // the list's own decimals must be the ones the limit is written in (a changed coin is never guessed at)
      if (t?.decimals !== c.decimals || !(Date.now() - Date.parse(t?.priceUpdatedAt) < 15 * 60_000)) continue;
      if (Number.isFinite(price) && price >= MARKET_USD_MIN) out[c.id] = price;
    }
  } catch {
    /* no list: NEAR and the stablecoins only */
  }
  return out;
}

/** A confidential quote's status through the pinned quote server (`GET <base>/v0/status?depositAddress=`). */
function privateStatusFrom(base: string, loopback = false): (depositAddress: string, statusTag?: string) => Promise<unknown | null> {
  // https only; plain http only for a tool's own relay on this machine's loopback, when the tool says so
  const local = loopback && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(base);
  if (!local && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(base)) throw new Error("the private quote server must be an https URL");
  return async (depositAddress, statusTag) => {
    let res: Response;
    try {
      const headers: Record<string, string> = statusTag ? { "x-zerofee-status-tag": statusTag } : {};
      res = await fetch(`${base.replace(/\/$/, "")}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw relayFailed(null, null, e);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw relayFailed(res, await readJson(res).catch(() => null));
    return readJson(res);
  };
}

/**
 * The relay or 1Click behind it failed (B28): named, with how. The relay passes 1Click's own failure on as
 * quotes.upstream.*; anything else is the relay's own (down, or busy with its per-minute limit).
 */
function relayFailed(res: Response | null, json: unknown, e?: unknown): ProblemError {
  const upstream = /^quotes\.upstream\./.test(String((json as { code?: unknown } | null)?.code ?? ""));
  return new ProblemError(serviceProblem("security.partner.unreachable", upstream ? "oneclick" : "relay", faultOf(res?.status ?? null, e)));
}

/**
 * The float's moves through the same pinned quote server: 1Click's quote, generate-intent and submit-intent, a deposit's
 * transaction (deposit/submit, with its quote's tag), and status.
 * No answer, or the server's own trouble: partner-unreachable. A clear "no" (4xx): an error marked `refused`, which the
 * float's moves treat as final.
 */
function floatRelayFrom(base: string, loopback = false): FloatRelay {
  const status = privateStatusFrom(base, loopback);
  const root = base.replace(/\/$/, "");
  /** One POST to the relay; `tag`: the deposit's own quote tag (deposit/submit). Only through post, or submitDeposit, below (each refused on the mainnet copy). */
  const send = async (path: string, body: unknown, tag?: string): Promise<any> => {
    let res: Response;
    let json: any = null;
    try {
      res = await fetch(`${root}/v0/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(tag ? { "x-zerofee-status-tag": tag } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      json = await readJson(res).catch(() => null);
    } catch (e) {
      throw relayFailed(null, null, e);
    }
    if (res.status >= 500 || res.status === 429) throw relayFailed(res, json);
    // D132: the server before its update refuses over $100: said by name, nothing moved
    if (relayOldLimit(json)) throw new ProblemError(relayLimitProblem());
    // the relay's own code too (its limit on one quote, quotes.request.too-big), so the core can say whose "no" it was
    if (!res.ok) throw Object.assign(new Error(String(json?.message ?? json?.whatHappened ?? `HTTP ${res.status}`)), { refused: true, ...(typeof json?.code === "string" ? { code: json.code } : {}) });
    return json;
  };
  const post = async (path: string, body: unknown): Promise<any> => {
    // the mainnet copy (VITE_FORK=1): 1Click can't be copied, so no quote, intent or submit goes out (fork.ts)
    if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
    return send(path, body);
  };
  return {
    base: root,
    quote: (body) => post("quote", body),
    generateIntent: (signerId, depositAddress) => post("generate-intent", { type: "swap_transfer", standard: "nep413", signerId, depositAddress }),
    submitIntent: (signedData) => post("submit-intent", { type: "swap_transfer", signedData }),
    // the mainnet copy: no deposit hint either (fork.ts)
    submitDeposit: async (depositAddress, txHash, tag) => {
      if (FORK) throw new ProblemError(FORK_CROSS_CHAIN);
      return send("deposit/submit", { txHash, depositAddress }, tag);
    },
    status,
  };
}

/** How long a "ready" account.state is kept for every caller (D134, item 3; DemoCore.keptState). */
export const STATE_KEPT_MS = 15_000;
/** Reads the screens make that READS doesn't list (they have no deadline of their own): they never drop the kept state. */
const QUIET_READS = new Set(["account.id", "account.nearPrice", "tx.describe", "card.check", "subwallet.list"]);

/** How long the one NEAR price snapshot is kept (H1): every figure read within it says the same dollars. */
export const NEAR_PRICE_KEPT_MS = 60_000;

/** How long 1Click's token list is kept (oneClickTokens). */
export const TOKEN_LIST_KEPT_MS = 20_000;
let tokenList: { at: number; list: Promise<any[]> } | undefined;
/**
 * 1Click's token list, kept 20 s and asked once at a time, for every dollar figure read from it: a swap's sheet and the
 * next one, and (D145, speed) a move's own price, which asked it afresh each time (a ~600 ms read of ~53 KB measured from the test network,
 * 3 Nov) on the way to a top-up's, a take-out's or Perps' put-in sheet, after the sheet's own cost read had just read it.
 * A failed read is never kept. Each figure still says whether its price is fresh (updated in the last 15 minutes).
 */
const readTokenList = (): Promise<any[]> => fetch("https://1click.chaindefuser.com/v0/tokens", { signal: AbortSignal.timeout(15000) }).then((r) => readJson(r)) as Promise<any[]>;
export function oneClickTokens(now = Date.now(), get: () => Promise<unknown> = readTokenList): Promise<any[]> {
  if (!tokenList || now - tokenList.at > TOKEN_LIST_KEPT_MS) {
    const list = get() as Promise<any[]>;
    tokenList = { at: now, list };
    list.catch(() => { if (tokenList?.list === list) tokenList = undefined; });
  }
  return tokenList.list;
}

/**
 * A price the core holds money to, or null (audit, core integrity 5): only a finite number above zero is a price. A $0
 * price let the Extension's session skip its dollar caps (subwallets.ts sessionStart: "price ? ... : 0"); as null, the
 * session refuses to start (no price, no session), as every other reader of it already treats no price.
 */
export function positivePrice<C>(ask: (chain: C) => Promise<number | null>): (chain: C) => Promise<number | null> {
  return async (chain) => {
    const v = await ask(chain);
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
}

/** SOL, BNB and ETH (Robinhood Chain's coin) in dollars from 1Click's token list, if updated in the last 15 minutes.
 *  SOL, BNB and ETH come from the list kept 20 s (oneClickTokens, D145: a move's price on the way to its sheet); NEAR is
 *  read afresh as before (it has its own one-minute snapshot, H1, and a protection's limits read it, NF-09). */
export async function oneClickNativeUsd(chain: "sol" | "bsc" | "hood" | "near", kept = chain !== "near"): Promise<number | null> {
  const id = { sol: "nep141:sol.omft.near", bsc: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", hood: "nep141:eth.omft.near", near: "nep141:wrap.near" }[chain];
  try {
    const list: any[] = await (kept ? oneClickTokens() : readTokenList());
    if (!Array.isArray(list)) return null;
    const t = list.find((x) => x?.assetId === id);
    const price = Number(t?.price);
    const fresh = Date.now() - Date.parse(t?.priceUpdatedAt) < 15 * 60_000;
    return Number.isFinite(price) && price > 0 && fresh ? price : null;
  } catch {
    return null;
  }
}

/** The networks set-up's deposit watcher reads (the wallets' own free nodes): Solana and the EVM chains they read. */
const FUND_WATCHED: ReadonlySet<string> = new Set(["sol", "eth", "base", "arb", "hood", "gnosis", "bsc"]);

/**
 * A coin's dollar price on BNB Chain or Robinhood Chain from the relay's market route (GeckoTerminal behind it, kept 10 s
 * there), asked by the core itself: the reference a session prices a route-chosen trade against (the fix review). Only
 * an answer the relay dated in the last minute; null otherwise.
 */
function relayMarketPrice(base: string): (chain: "bsc" | "hood" | "sol" | "near", coin: string) => Promise<number | null> {
  const network = { bsc: "bsc", hood: "robinhood", sol: "solana", near: "near" } as const;
  return async (chain, coin) => {
    // re-review B1: a Solana coin's price too (a no-sheet sale is valued at it), by its mint; a NEAR coin by its contract
    // (review H1, 3 Nov: a Rhea trade is valued at it)
    if (!(chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : chain === "near" ? /^[a-z0-9._-]{2,64}$/ : /^0x[0-9a-f]{40}$/).test(coin)) return null;
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/v0/market/gt/simple/networks/${network[chain]}/token_price/${coin}`, { signal: AbortSignal.timeout(5000) });
      const dated = Date.parse(res.headers.get("date") ?? "");
      const age = Number(res.headers.get("age") ?? "0");
      if (!res.ok || !(Date.now() - dated < 60_000) || !(age >= 0 && age < 60)) return null;
      const usd = Number((await readJson(res))?.data?.attributes?.token_prices?.[coin]);
      return Number.isFinite(usd) && usd > 0 ? usd : null;
    } catch {
      return null;
    }
  };
}

/**
 * Many coins' dollar prices at once from the relay's market route (GeckoTerminal's token_price, up to 30 a read, kept 10 s
 * there), for a site wallet's coin list (site-coins.ts). Display only: an answer older than a minute, or a coin with no
 * price, is left out.
 */
function relayMarketPrices(base: string): (chain: "bsc" | "hood" | "sol", coins: string[]) => Promise<Map<string, number>> {
  const network = { bsc: "bsc", hood: "robinhood", sol: "solana" } as const;
  return async (chain, coins) => {
    const out = new Map<string, number>();
    const ok = coins.filter((c) => (chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-f]{40}$/).test(c));
    for (let i = 0; i < ok.length; i += 30) {
      const part = ok.slice(i, i + 30);
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}/v0/market/gt/simple/networks/${network[chain]}/token_price/${part.join(",")}`, { signal: AbortSignal.timeout(5000) });
        const dated = Date.parse(res.headers.get("date") ?? "");
        const age = Number(res.headers.get("age") ?? "0");
        if (!res.ok || !(Date.now() - dated < 60_000) || !(age >= 0 && age < 60)) continue;
        const prices = (await readJson(res))?.data?.attributes?.token_prices ?? {};
        for (const c of part) {
          const usd = Number(prices[c] ?? prices[c.toLowerCase()]);
          if (Number.isFinite(usd) && usd > 0) out.set(c, usd);
        }
      } catch {
        // no prices from this read: its coins show without dollars
      }
    }
    return out;
  };
}

/** A NEAR Intents coin in dollars, its decimals and its symbol (plain letters only), from 1Click's token list if updated
 *  in the last 15 minutes. The list is kept 20 s (oneClickTokens): a swap's sheet and the next one don't each fetch it. */
async function oneClickTokenPrice(tokenId: string): Promise<{ usd: number; decimals: number; symbol?: string } | null> {
  if (tokenId === USDC || tokenId === USDT) return { usd: 1, decimals: 6, symbol: tokenId === USDC ? "USDC" : "USDT" };
  try {
    const list = await oneClickTokens();
    const t = Array.isArray(list) ? list.find((x) => x?.assetId === tokenId) : undefined;
    const usd = Number(t?.price), decimals = t?.decimals;
    const fresh = Date.now() - Date.parse(t?.priceUpdatedAt) < 15 * 60_000;
    const plain = typeof t?.symbol === "string" && /^[A-Za-z0-9.$_-]{1,12}$/.test(t.symbol) ? (t.symbol as string) : undefined;
    // the exact coin (TN2 review M2): a symbol 1Click lists for more than one token is said with its contract
    const twins = plain ? list.filter((x: any) => x?.symbol === plain).length : 0;
    const contract = tokenId.replace(/^nep141:/, "").slice(0, 64);
    const symbol = plain && twins > 1 ? (/^[a-z0-9._-]+$/.test(contract) ? `${plain} (${contract})` : undefined) : plain;
    return Number.isFinite(usd) && usd > 0 && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 && fresh ? { usd, decimals, ...(symbol ? { symbol } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * Which kinds of separate wallet each app may use. One wallet per chain (D55): Trade, Browser, the apps in Apps (social)
 * and ZeroFee Chat (app id "chat"; slice 1 had "bitchat", which no app is: security review 2 Nov, Low) share the chain wallets (the trade and browser kinds; "chain" in subwallet.create), with
 * every site's and Chat's request on the sheet; Spending's balance on NEAR (trade/near) is Trade's alone. The Extension,
 * Pay and Wallet keep their own.
 */
type Kind = "trade" | "extension" | "browser" | "pay" | "private" | "site";
const CHAIN_KINDS: readonly string[] = ["trade", "browser", "chain"];
/** A site's own wallets (site-wallets.ts): Browser's engine and the site apps (social) only; the core still binds each to
 *  its own site's page, so neither can sign with one for anything else. */
const SITE_KINDS: readonly string[] = [...CHAIN_KINDS, "site"];
const KINDS_OF: Record<string, readonly string[]> = { trade: CHAIN_KINDS, browser: SITE_KINDS, social: CHAIN_KINDS, chat: CHAIN_KINDS, extension: ["extension"], pay: ["pay"], wallet: ["private"] };
/** What an app may only see and make (list, read, create, have shown through Details), never sign with: a site's own
 *  wallet for Trade (Spending's host: it lists and fills them) and the site apps (social: their settings). */
const SEE_KINDS: Record<string, readonly string[]> = { trade: ["site"], social: ["site"] };
/** May this app use this wallet? A chain app reaches the chain wallets; on NEAR, Spending's balance and the NEAR coin
 *  wallet (Rhea trades, 3 Nov) only Trade (the private pocket is Wallet's own kind). */
const mayUse = (app: string, w: { kind: string; chain: string }): boolean => (KINDS_OF[app] ?? []).includes(w.kind as Kind) && (w.chain !== "near" || w.kind === "private" || app === "trade");
/** May this app see this wallet (list it, read what it holds, have its key shown through Wallet's Details)? What it may
 *  use, and for Trade (Spending's host) a site's own wallet too: Spending lists it, fills it (Make ready) and shows its
 *  key from Details. Trade never signs with one (mayUse), and the core signs with one only for its own site's page. */
const maySee = (app: string, w: { kind: string; chain: string }): boolean => mayUse(app, w) || (SEE_KINDS[app] ?? []).includes(w.kind);
/** The web wallet's three wallets as the core stores them (WEB_WALLETS: SOL's and ETH (RH)'s chain wallet, NEAR's trading
 *  wallet; a chain wallet is the trade kind), and never a site's or a replaced one. */
const webWalletSeen = (w: { kind: string; chain: string; site?: unknown; oldWords?: unknown }): boolean => w.kind === "trade" && (w.chain === "sol" || w.chain === "hood" || w.chain === "near") && !w.site && !w.oldWords;
const APP_NAMES: Record<string, string> = { social: APP_STORE_NAME };
const appName = (app: string) => APP_NAMES[app] ?? app.charAt(0).toUpperCase() + app.slice(1);

const CHAIN_WORDS: Record<string, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };
/** A separate wallet as the sheet names it: "your Solana wallet" (D55: one per chain; an older one says so), "your card
 *  wallet", "your private pocket". */
function ownWalletName(w: { kind: string; chain: string; current?: boolean; label?: string }): string {
  if (w.kind === "private") return PRIVATE_POCKET;
  if (w.kind === "trade" && w.chain === "near") return TRADING_BALANCE;
  if (w.kind === "pay") return "your card wallet";
  if (w.kind === "extension") return "your laptop's trading wallet";
  if (w.kind === "site") return `your ${w.label ?? "site's wallet"}`;
  // a chain's own wallet is its Home row (FLOW-V4, D108): "your SOL row", "your ETH on Robinhood row"; an older one says so
  const row = ROW_WORDS[w.chain];
  if (row) return w.current === false ? `an older ${row} wallet` : `your ${row} wallet`;
  return `your ${w.current === false ? "older " : ""}${CHAIN_WORDS[w.chain] ?? w.chain} wallet`;
}
/** Home V4's row names (packages/wallet Home.tsx ROW_NAME), for the core's sheets. */
const ROW_WORDS: Record<string, string> = { sol: "SOL", hood: "Robinhood", bsc: "BNB" };

interface Saved {
  accountId: string;
  /** "funding": a self-funded account waiting for its NEAR (the setup key's address has been shown). */
  stage: "funding" | "creating" | "needs-backup" | "ready" | "recovering";
  /** The backup words' recovery key went on chain with the account itself (the setup transaction), so backing up
   *  only shows and checks the words: no second sheet. */
  recoveryIn?: boolean;
  /** An account from before J2 whose words were written down with "Check later" (gone now): the app reminds them until a
   *  check matches. */
  checkDue?: boolean;
  /** When this device finished moving the account here from the words (A12): Activity says earlier history isn't here. */
  restoredAtIso?: string;
}

const STATE = "state";
/** When this device set the account's rules up (ms): the contract's first 24 hours are its set-up window. */
const CREATED_AT = "account-created-ms";
/** The recovery delay the person chose at set-up (seconds, as text), until the set-up transaction has carried it. */
const DELAY_CHOICE = "recovery-delay-choice";
/** A self-funded account's one-time classical setup key, kept until the account's own keys and rules are in. */
const SETUP_KEY = "setup-key";
/** "Add money to start" (fund-start.ts): the addresses asked for and the checklist's own notes, until it is seen done. */
const FUND_ORDERS = "fund-orders";
const FUND_ORDERS_KEPT = 5;
/** Openings the core resumes by itself once the chain shows what a failed one made (finding 1), before Try again. */
const FUND_RESUMES_MAX = 3;
/** Finding 23: an opening stopped by NEAR's nodes being busy (429) is tried again by the core itself, this many times,
 *  the first after FUND_BUSY_FIRST_MS and each wait twice the last (at most FUND_BUSY_MAX_MS), never a burst; the
 *  screen keeps "Opening your account" meanwhile. Only past them does it wait for the person's Try again. */
export const FUND_BUSY_RETRIES = 6;
export const FUND_BUSY_FIRST_MS = 5_000;
export const FUND_BUSY_MAX_MS = 60_000;
/** The NEAR that opened the account (subwallet.received, kind "open"): kept for good, unlike the checklist's record. */
const OPENED_WITH = "account-opened-with";
/** The deposit watcher (J2): how long one read of a coin's own network may take, and how often 1Click's status is asked. */
const FUND_WATCH_MS = 4000;
const FUND_STATUS_MS = 3500;
/** The setup key kept after the opening while a coin's address may still pay into its address (keepLateKey). */
const FUND_LATE_KEY = "fund-late-setup-key";
/** Who this device may be the second device for, inside the core: someone's guardian. */
const SECOND_DEVICE_SPACE = /^guardian$/;

/**
 * One second device's own place in the core's vault (audit IOS-4): "second-device:<space>:<name>", sealed to the chip on
 * the phone (Seal.wanted). A key the page kept before under its own vault name (`legacy`: "zerofee-guardian"), in the
 * same Keychain, moves in the first time it's read, so a pairing carries on.
 */
function secondDeviceVault(vault: Vault, space: string, legacy: string): Vault {
  const at = (name: string) => `second-device:${space}:${name}`;
  return {
    async get(name) {
      const own = await vault.get(at(name));
      if (own) return own;
      const old = await vault.get(`${legacy}:${name}`);
      if (old) {
        await vault.put(at(name), old);
        await vault.delete(`${legacy}:${name}`);
      }
      return old;
    },
    put: (name, bytes) => vault.put(at(name), bytes),
    delete: (name) => vault.delete(at(name)),
  };
}
/** Kept back from the funding for the creating call: NEAR charges its gas up front at a pessimistic price (about
 *  0.1 NEAR for 100 Tgas, mostly refunded after), so the deposit can't be the whole balance. 0.15 NEAR. What is left
 *  of it, the refund included, goes to the new account too: the setup address deletes itself into it (emptySetupAddress). */
const FUNDING_FEE = 150_000_000_000_000_000_000_000n;
/** On top of the contract's storage: the keys, the contract's state, and the first fees. */
export const FUNDING_MARGIN = 350_000_000_000_000_000_000_000n;
/** An account that runs the published rules by hash stores no code: its keys, the hash and its first state, about
 *  4.8 KB (0.048 NEAR at NEAR's 1e19 yocto a byte; the UI's measurement, 28 Oct). */
export const BY_HASH_STORAGE_YOCTO = 48_000_000_000_000_000_000_000n;
/** What stays with a new account as storage: the rules by hash once published, else this build's copy of the code. */
export const fundingStorage = (wasmBytes: number, byHash: boolean): bigint => (byHash ? BY_HASH_STORAGE_YOCTO : BigInt(wasmBytes) * 10n ** 19n);
const REGISTRAR: Record<string, string> = { mainnet: "near", testnet: "testnet" };
const DEVICE_SEED = "device-seed";
const RECOVERY_SEED = "recovery-seed";
const RECIPIENTS = "known-recipients";
/** The fence (the audit's C1, 7 Nov): the highest nonce this device's key may have signed, kept sealed so it outlives a restart. */
const NONCE_MARK = "nonce-mark";
/** The backup words' seed between the setup transaction (which put their recovery key on chain) and the moment the
 *  words are shown and checked (or "Check later"): this device's vault only, then deleted. */
const PENDING_WORDS = "pending-words";
/** Words first (J2): the sha256 of the pending words' seed once they were shown and three were checked, before any money.
 *  Their key still goes on chain only with the account (setUp); this says the check is done, for exactly those words. */
const WORDS_CHECKED = "words-checked-first";
/** The contract's u64::MAX: a second device's clock stopped while a recovery waits (second_device_ages). */
const U64_MAX = "18446744073709551615";
/** New backup words (recovery.renew): their seed, kept on this device until their change runs on chain or is gone. */
const RENEW_WORDS = "renew-words";
/** When the new words' change was asked for (ms): until a few minutes after, a node not showing it yet proves nothing. */
const RENEW_AT = "renew-asked-ms";
/** New words whose key turned up on the account other than as its backup key: kept, never shown as new, nothing moved. */
const RENEW_ASIDE = "renew-words-aside";
/** Set when new words ran (before anything is marked, so a crash can't skip it): the old words' pocket and float are
 *  watched and emptied into the new ones until it ends (its value: until when, in ms, as text). Audit 2. */
const SWEEP_DUE = "old-words-sweep-due";
/** The old wallets are watched this long after money was last seen in them (an Add quoted to the old pocket before the
 *  words changed, or a refund to it, can still land: 1Click signs a quote for days and refunds after it). */
const SWEEP_WATCH_MS = 7 * 86_400_000;
/** The background sweep reads the old wallets at most this often (each read is two 1Click sign-ins). */
const SWEEP_EVERY_MS = 10 * 60_000;
const RENEW_SETTLE_MS = 10 * 60_000;
/** ZeroFee Chat's names for an account that came to this device without its backup words (no hot root): a seed made
 *  here once, from this device's own randomness (BitChat's own way: a device secret), never from a key that moves money. */
const CHAT_DEVICE_SEED = "chat-device-seed";
/** ZeroFee Chat's NEAR names (chat-keys.ts): the account's notes, kept to show again. Public data, not secrets. */
const CHAT_NAMES = "chat-names";
/** What kind each second device paired here is ("laptop", "guardian"), by its key's handle. */
const SECOND_KINDS = "second-device-kinds";
/** The dollars each NEAR limit was set from, on this device: [nearLimitYocto, usd][] (N5: the limit the person chose). */
const PROTECTION_USD = "protection-usd";
type SecondDeviceKind = "laptop" | "guardian";
/** What the background alerts already told about (alerts.poll), so each is told once. */
const ALERTS_SEEN = "alerts-seen";
const guardDog = () => import("./guard-dog.ts");
const safeUpdateMod = () => import("./safe-update.ts");
/** Wrong words typed to turn approvals back on (recovery.rearm): how many, and until when the screen is locked. */
const REARM_TRIES = "rearm-tries";
const REARM_MAX_TRIES = 5;
const REARM_LOCK_MS = 15 * 60_000;
const CALL_GAS = 30_000_000_000_000n;
/** The account's own `upgrade`: it places a waiting change, or at Face ID switches the code at once. */
const UPGRADE_CALL_GAS = 50_000_000_000_000n;
/** Release 9 (R8-RS1): the finish of a recovery reserves gas for its callback (on_recovery_key) on top of its own
 *  work: 45 Tgas from release 10's round 4c (G4-1; 30 before), so it carries 100 Tgas (45 or less fails for the
 *  prepaid gas). NEAR checks 0.1 NEAR of the words' 0.25 allowance for it before it runs, and charges far less. */
const FINISH_GAS = 100_000_000_000_000n;
/** The most NEAR the recovery key can ever spend on fees. It can't send money at all. */
const RECOVERY_KEY_ALLOWANCE = 250_000_000_000_000_000_000_000n;


/** Enough for run() to carry out a waiting payment's own steps. */
const RUN_GAS = 300_000_000_000_000n;
/** The Safe update's finish in one transaction (under NEAR's 300 Tgas): the listing's run (state only, YES_GAS 25), then
 *  the switch's (upgrade_check's fixed 50 Tgas, the install, the contract's own work; YES_GAS 80, with room). */
const SAFE_UPDATE_LISTING_RUN_GAS = 40_000_000_000_000n;
const SAFE_UPDATE_SWITCH_RUN_GAS = 200_000_000_000_000n;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** account.keyProof's answer (the "Your key" proof card). `fingerprint`: this device's key, short ("91bshR…cLuH"). */
export interface KeyProof {
  kind: "secure-chip" | "recovery-words" | "development";
  fingerprint: string;
  /** The chip key only: the key the chip gave just now, short, and whether its handle loaded and gave the kept key. */
  chipFingerprint?: string;
  chipHeld?: boolean;
  /** The chip key only: when the chip made it (the Keychain's own date for it). */
  madeAtIso?: string;
  /** Each node's read, separately: its name and whether it lists this device's key on the account. */
  nodes: { node: string; found: boolean }[];
  matches: boolean;
  /** The web demo's own answer: a sample key on a sample account, said so on the card (L6). */
  sample?: true;
}

/** "ml-dsa-65-hash:91bshRxyz…abcLuH" → "91bshR…cLuH", the short form the approval sheet and Security show. */
export const shortFingerprint = (handle: string): string => {
  const h = handle.slice(handle.indexOf(":") + 1);
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
};

/** The set-up screen's choice of recovery delay (product decision, 29 Oct): one line each on what it means. Fixed after set-up. */
export function recoveryChoices(network: Network): { seconds: number; label: string; line: string; default: boolean }[] {
  const choices = network === "mainnet" ? ACCOUNT_POLICY.recoveryDelayChoices : [60, ...ACCOUNT_POLICY.recoveryDelayChoices];
  return choices.map((seconds) => ({
    seconds,
    label: duration(seconds),
    line: `How long a stranger with your words must wait before a new device gets your account. You can stop them in that time.`,
    default: seconds === ACCOUNT_POLICY.defaultRecoveryDelaySeconds,
  }));
}
/** Same bytes? Every byte compared, whatever differs first. */
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.reduce((d, x, i) => d | (x ^ b[i]!), 0) === 0;
/** Release 10 round 4c: the phone's own calls that add or renew a key carry held.ts's key-add row (KEY_CALL_GAS, 75 Tgas):
 *  those that add one run a check after it with 40 Tgas reserved (the contract's DEVICE_KEY_CHECK_GAS, AGENT_CALLBACK_GAS),
 *  so the reservation, the add and the state. The same figure as a yes that adds a key (held.ts YES_GAS). */
export { KEY_CALL_GAS };
const KEY_ADDING_CALLS = new Set(["add_second_device", "set_recovery_key", "agent_set", "agent_renew_key", "refill_recovery_key"]);
/** The gas a call carries by default, by its method: a key-adding call's KEY_CALL_GAS, else CALL_GAS. */
export const methodCallGas = (method: string): bigint => (KEY_ADDING_CALLS.has(method) ? KEY_CALL_GAS : CALL_GAS);
export const call = (method: string, args: Record<string, unknown> = {}, gas = methodCallGas(method)): CoreAction => ({ kind: "call", method, args: utf8(JSON.stringify(args)), gas, depositYocto: 0n });
/** A post-quantum key as the contracts take it: base64 of its borsh form (tag 2 + 1,952 bytes). */
export const borshKey = (publicKey: string) => bytesToBase64(new Uint8Array([2, ...decodePublicKey(publicKey)]));

/**
 * Three of the words, at three different positions (1–24), checked against the seed they came from. `named`: a wrong one
 * is named by its position, only where the page itself showed the words (the web); on ZeroFee's own screen it isn't.
 */
function checkThree(seed: Uint8Array, positions: unknown, words: unknown, named: boolean): void {
  const okPositions = Array.isArray(positions) && positions.length === 3 && new Set(positions).size === 3 && positions.every((p) => Number.isInteger(p) && p >= 1 && p <= 24);
  if (!okPositions || !Array.isArray(words) || words.length !== 3 || !words.every((w) => typeof w === "string")) {
    throw new ProblemError(securityProblems.requestInvalid("Send three different word positions (1 to 24) and the three words."));
  }
  const expected = seedToWords(seed);
  (positions as number[]).forEach((p, i) => {
    if ((words[i] as string).trim().toLowerCase() !== expected[p - 1]) throw new ProblemError(securityProblems.wordWrong(named ? p : undefined));
  });
}
/** A second device's key: NEAR lets it call only approve and decline (and, from release 7, answer a recovery), on the account itself. */
const isSecondDeviceKey = (p: ChainPermission, accountId: string) => p.kind === "function-call" && p.receiverId === accountId && isSecondDeviceMethods(p.methods);
/** A second device with less than this left for its network fees is offered a refill. */
const REFILL_BELOW_YOCTO = 10n ** 23n;
/** A device key on an account with the account contract: NEAR lets it call only the device methods, on the account itself. */
const isDeviceKey = (p: ChainPermission, accountId: string) => p.kind === "full" || (p.kind === "function-call" && p.receiverId === accountId && p.methods.includes("execute"));

/** Testnet's free account service said "not now" and when: the core says that wait, never a guess. */
export class HelperBusy extends Error {
  readonly untilMs: number;
  constructor(untilMs: number) {
    super("the account service is busy");
    this.untilMs = untilMs;
  }
}

/** How long a 429 asks to wait: Retry-After (seconds or a date), else its words ("retry in 10 hours"); null if neither. */
export function retryAfterMs(header: string | null, body: string, nowMs: number): number | null {
  if (header && /^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  if (header && !Number.isNaN(Date.parse(header))) return Math.max(0, Date.parse(header) - nowMs);
  const m = /retry (?:in|after) (\d+(?:\.\d+)?)\s*(second|sec|minute|min|hour|hr|day)s?/i.exec(body);
  if (!m) return null;
  const unit = m[2].toLowerCase().startsWith("s") ? 1000 : m[2].toLowerCase().startsWith("m") ? 60_000 : m[2].toLowerCase().startsWith("h") ? 3_600_000 : 86_400_000;
  return Math.round(Number(m[1]) * unit);
}

async function testnetFaucet(accountId: string, publicKey: string): Promise<void> {
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  if (res.status === 429) {
    const wait = retryAfterMs(res.headers.get("retry-after"), await readText(res).catch(() => ""), Date.now());
    throw new HelperBusy(Date.now() + (wait ?? 60 * 60_000));
  }
  if (!res.ok) throw new Error(`faucet ${res.status}`);
}

/** "after 4:14 AM" / "in about 30 hours": the wait in plain words, on this device's clock. A clock time, never "in 8
 *  minutes": the words stay on screen, and a count that doesn't move is false a minute later (grade 02h, H5: "Try again
 *  in 8 minutes" at 6:33 and still at 6:40). Rounded up to the minute, so a tap at the time said is never early. */
export function waitWords(untilMs: number, nowMs: number): string {
  const left = untilMs - nowMs;
  if (left < 20 * 3_600_000) return `after ${new Date(Math.ceil(untilMs / 60_000) * 60_000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return `in about ${Math.round(left / 3_600_000)} hours`;
}

/** A sheet that threw: a named refusal (a ProblemError: the person wasn't checked) is passed on; anything else is a no. */
const namedOnly = (e: unknown): false => {
  if (e instanceof ProblemError) throw e;
  return false;
};

/** A site code's own problem (SiteCodes.swift reads `code`; the line is what a screen shows). */
function codesProblem(code: string, line: string): ProblemError {
  return new ProblemError({ code, whatHappened: line, money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } as Problem);
}

export class DemoCore implements Bridge {
  private readonly chain: Chain;
  private readonly vault: Vault;
  private readonly policyWasm: () => Promise<Uint8Array>;
  private readonly delaySeconds: number;
  private readonly createAccount: (accountId: string, publicKey: string) => Promise<void>;
  private readonly createRetryMs: number;
  private readonly settleMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly nativeSheet?: (words: PlainWords) => Promise<boolean>;
  private readonly userVerified?: (reason: string) => Promise<boolean>;
  private readonly safeStepUp?: (reason: string) => Promise<boolean>;
  /** Paused or stopped on this phone, before NEAR may show it (second review, L-a): no new pocket day until Resume. */
  private agentStopped = false;
  /** ZeroFee's relay (privateQuotes), for the email alerts. */
  private readonly relayBase?: string;
  private readonly siteCodes: boolean;
  private readonly codesStepUp?: () => Promise<boolean>;
  private readonly mailOpt?: { host: string; domain: string };
  private readonly nativeTyping?: (purpose: "restore" | "check" | "rearm" | "codes") => Promise<string[] | null>;
  private readonly approvalKey?: { changed(): Promise<boolean>; reset(): Promise<void> };
  private readonly nativeWords?: (words: string[], kid: boolean, renew?: boolean) => Promise<{ positions: number[]; words: string[] } | null>;
  private readonly watchIntervalMs: number;
  private readonly fundStatusEveryMs: number;
  private readonly fundBusyFirstMs: number;
  private readonly indexRetryMs: number;
  private readonly protection: unknown[] | undefined;
  private readonly prices: () => Promise<Prices>;
  private readonly subwallets: SubWallets;
  private readonly gnosis: GnosisReader;
  private readonly deviceKeys: DeviceKeys;
  private readonly oneClick: OneClickLookup;
  private readonly quoteKey: string | undefined;
  /** NEAR in dollars for the funding checklist's words (the same reader the separate wallets use): words only. */
  private readonly nativeUsd: (chain: "sol" | "bsc" | "hood" | "near") => Promise<number | null>;
  private readonly quoter: OneClickQuoter;
  private readonly secretsInMemory: boolean;
  /** The chains' readers the wallets use, shared by the deposit watcher (J2): free nodes, read only. */
  private readonly solReader: SolChain;
  private readonly evmReader: EvmChain;

  private readonly listeners = new Map<string, Set<(payload: any) => void>>();
  private readonly approvals = new Map<string, (approve: boolean) => void>();
  /** This device as someone's second device, inside the core (audit IOS-4), one per space, made on first use. */
  private readonly asSecondDevice = new Map<string, SecondDeviceCore>();
  /** Recovery words shown but not yet confirmed. Memory only: never stored. */
  private backupSeed: Uint8Array | null = null;
  private device: DevSigner | null = null;
  /** The recovery watcher's stop, while it runs (on the clock's beat, so Wallet's balance poll shares its reads). */
  private watching: (() => void) | null = null;
  private lastPending: string | null = null;
  /** The watcher's ticks: the open app's alert marking runs on every ALERTS_EVERY-th one (grade 01c, P12). */
  private watchTicks = 0;
  private readonly sheetPrices: boolean;
  /** The web wallet's door (web-wallet.ts): set only when this core runs as the web wallet. */
  private readonly web: WebDoor | null;

  /** See DemoCoreOptions.unstampedIsShell. */
  private readonly unstampedIsShell: boolean;

  constructor(options: DemoCoreOptions) {
    this.unstampedIsShell = options.unstampedIsShell ?? unstampedMayBeShell(globalThis as never);
    // Mainnet has no faucet and no sponsor: accounts there are self-funded (account.create shows where to send NEAR).
    if (options.chain.network !== "testnet" && options.createAccount) throw new Error("on mainnet, accounts are self-funded");
    this.chain = options.chain;
    this.vault = options.vault;
    this.secretsInMemory = options.secretsInMemory === true;
    this.web = options.webWallet ? new WebDoor(options.vault, () => this.subwallets, options.webWallet) : null;
    this.sheetPrices = options.sheetPrices === true;
    this.policyWasm = options.policyWasm;
    // How long a new device must wait before it can use the account, so the real phone (and the second device) can stop it.
    // Release 7 (product decision, 29 Oct): 48 hours unless the person chooses otherwise at set-up (account.create, from
    // account.recoveryChoices). A change then waits 72 hours, and the words alone finish after 7 days. Testnet and the
    // sandbox run the short-waits build with a minute.
    this.delaySeconds = options.recoveryDelaySeconds ?? (options.chain.network === "mainnet" ? ACCOUNT_POLICY.defaultRecoveryDelaySeconds : 60);
    this.createAccount = options.createAccount ?? testnetFaucet;
    this.createRetryMs = options.createRetryMs ?? 2000;
    this.settleMs = options.settleMs ?? 1500;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
    this.nativeSheet = options.sheet;
    this.userVerified = options.userVerified;
    this.safeStepUp = options.safeStepUp;
    this.nativeWords = options.showWords;
    this.relayBase = options.privateQuotes;
    this.siteCodes = options.siteCodes === true;
    this.codesStepUp = options.codesStepUp;
    this.mailOpt = options.mail;
    this.nativeTyping = options.typeWords;
    this.approvalKey = options.approvalKey;
    this.watchIntervalMs = options.watchIntervalMs ?? 30_000;
    this.fundStatusEveryMs = options.fundStatusEveryMs ?? FUND_STATUS_MS;
    this.fundBusyFirstMs = options.fundBusyFirstMs ?? FUND_BUSY_FIRST_MS;
    this.indexRetryMs = options.indexRetryMs ?? 2500;
    this.protection = options.protection;
    const priceChain = bandPriceChain(options.chain);
    this.prices = options.prices ?? (() => bandPrices(priceChain));
    this.gnosis = options.gnosis ?? new RpcGnosis();
    this.deviceKeys = options.deviceKeys ?? vaultDeviceKeys(this.vault, DEVICE_SEED);
    this.oneClick = options.oneClick ?? oneClickStatus;
    this.quoteKey = options.quoteKey;
    this.quoter = options.quoter ?? oneClickQuote;
    this.nativeUsd = options.nativeUsd ?? oneClickNativeUsd;
    this.solReader = options.sol ?? new RpcSolChain();
    this.evmReader = options.evm ?? new RpcEvmChain();
    this.subwallets = new SubWallets({
      vault: this.vault,
      sol: this.solReader,
      evm: this.evmReader,
      // NEAR's two nodes, for the NEAR coin wallet's Rhea trades and its moves (3 Nov)
      near: options.chain,
      usdPrice: positivePrice(options.nativeUsd ?? oneClickNativeUsd),
      tokenPrice: oneClickTokenPrice,
      ...(options.privateQuotes ? { marketPrice: relayMarketPrice(options.privateQuotes), marketPrices: relayMarketPrices(options.privateQuotes) } : {}),
      ...(options.showSecret ? { showSecret: options.showSecret } : {}),
      ...(options.scrypt ? { scrypt: options.scrypt } : {}),
      ...(options.quoteKey ? { quoteKey: options.quoteKey } : {}),
      ...(options.intentsSalt ? { intentsSalt: options.intentsSalt } : options.intentsSalt !== null && options.chain.network === "mainnet" ? { intentsSalt: () => this.intentsSalt(), forgetSalt: () => this.forgetSalt() } : {}),
      privateStatus: options.privateQuotes ? privateStatusFrom(options.privateQuotes, options.privateQuotesLoopback === true) : undefined,
      floatRelay: options.privateQuotes ? floatRelayFrom(options.privateQuotes, options.privateQuotesLoopback === true) : undefined,
      mainAccount: () => this.saved().then((s) => (s?.stage === "ready" ? s.accountId : null)),
      approve: this.approveOnSheet,
      emit: (e, p) => this.emit(e, p),
      ...(options.secretsInMemory ? { hotKeysInMemory: true } : {}),
      // AgentZero's own wallet: a test's own setting only (on by default, agent-route.ts)
      ...(options.agentWallet ? { agentWallet: options.agentWallet } : {}),
    });
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
    // Anything that isn't a read may change the account's state: the kept one goes (before it runs, and after it ends).
    const changes = !READS.has(method) && !QUIET_READS.has(method);
    if (changes) this.stateEpoch++;
    try {
      const r = (await this.dispatch(method, this.whoAsked(method, params))) as { status?: unknown; id?: unknown } | null;
      // S-1: a change this phone placed (it came back waiting) is its own, never news to it.
      if (r?.status === "waiting" && typeof r.id === "string") this.noteMine({ held: r.id });
      return { ok: r as T };
    } catch (e) {
      if (e instanceof ProblemError) return { problem: e.problem };
      return { problem: unexpectedFor(method, e) };
    } finally {
      if (changes) this.stateEpoch++;
    }
  }

  /**
   * The web wallet's account.state: "none" until its words are kept, then "ready" with `web: true`. The account it
   * names is the NEAR wallet's own (a plain account with no contract and no recovery): never a Safe.
   */
  private async webState(): Promise<{ stage: "none" | "ready"; web: true; account?: AccountInfo }> {
    if (!this.web || !(await this.web.ready())) return { stage: "none", web: true };
    const near = (await this.web.call("account.web.status", {}) as { wallets: { wallet: string; address: string }[] }).wallets.find((w) => w.wallet === "near");
    return { stage: "ready", web: true, account: { accountId: near?.address ?? "", network: this.chain.network, keys: [], recovery: null } };
  }

  /**
   * Audit pass 2, item 2: who asked. ZeroFee's own screens say so (SHELL_APP, stamped only by the shell's own bridge,
   * asShell); the id is taken off, so every check below reads "no app" as theirs, as before. An app says its id
   * (forApps). A call that names no one, or names "", is refused, unless this core may take it as the shell's (a Node
   * process: the tests and the test tools).
   */
  private whoAsked(method: string, params: Record<string, unknown>): Record<string, unknown> {
    const app = params.app;
    if (app === SHELL_APP) {
      const { app: _shell, ...rest } = params;
      return rest;
    }
    if (app === undefined && this.unstampedIsShell) return params;
    if (typeof app !== "string" || app === "") throw new ProblemError(securityProblems.requestNotAllowed("This request didn't say which app it came from."));
    return params;
  }

  /**
   * D134, item 3: account.state is read once per open. One open asked it 5 to 7 times (the shell's gate, Home's child
   * check on every refresh, Earn, the ledger twice), each a head and five reads on two nodes. A "ready" or "needs-backup"
   * answer is kept STATE_KEPT_MS and every caller meanwhile shares it (and one in flight); any call that isn't a read,
   * and any event the core sends (a recovery, a held change), drops it. Every other stage (funding, recovering) is read
   * each time: the screens that wait on it ask again and again.
   */
  private stateKept: { at: number; epoch: number; value: Promise<Awaited<ReturnType<DemoCore["state"]>>> } | null = null;
  private stateEpoch = 0;
  private keptState(): ReturnType<DemoCore["state"]> {
    // each caller its own copy (review L5): one changing what it got never changes another's. Plain objects and arrays
    // only (an answer is JSON-shaped); JavaScriptCore has no structuredClone (tools/ios/core-no-url.test.ts).
    const own = <V,>(v: V): V => (Array.isArray(v) ? v.map(own) : v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, own(x)])) : v) as V;
    const k = this.stateKept;
    if (k && k.epoch === this.stateEpoch && Date.now() - k.at < STATE_KEPT_MS) return k.value.then(own);
    const mine = { at: Date.now(), epoch: this.stateEpoch, value: this.state() };
    this.stateKept = mine;
    mine.value.then(
      (v) => {
        if (this.stateKept !== mine) return;
        if (v.stage === "ready" || v.stage === "needs-backup") mine.at = Date.now();
        else this.stateKept = null;
      },
      () => this.stateKept === mine && (this.stateKept = null),
    );
    return mine.value.then(own);
  }

  /** D134, item 4: whose account this is, from this device's vault alone (no network): the Safe's balance read starts
   *  with it at unlock, beside account.state. Null before the account is made. */
  private async accountId(): Promise<{ accountId: string; network: Network } | null> {
    const s = await this.saved();
    if (!s || s.stage === "funding" || s.stage === "creating") return null;
    if (this.chain.network === "mainnet") proxySafe(s.accountId);
    return { accountId: s.accountId, network: this.chain.network };
  }

  on<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (payload: any) => void);
    this.listeners.set(event, set);
    if (event === "recovery.started") this.startWatching();
    return () => {
      set.delete(handler as (payload: any) => void);
      if (event === "recovery.started" && set.size === 0) this.stopWatching();
    };
  }

  /**
   * The guardian's second device, run here rather than in the page (audit IOS-4): its key is sealed
   * in the core's vault and its sheet is this core's. The shell only: an app's call is security.method.unknown.
   */
  private async secondDevice(method: string, p: Record<string, unknown>): Promise<unknown> {
    if (p.caller !== undefined || p.app !== undefined) throw new ProblemError(securityProblems.methodUnknown(method));
    const space = p.space;
    if (typeof space !== "string" || !SECOND_DEVICE_SPACE.test(space)) throw new ProblemError(securityProblems.requestInvalid("space is guardian"));
    let device = this.asSecondDevice.get(space);
    if (!device) {
      device = new SecondDeviceCore({ chain: this.chain, vault: secondDeviceVault(this.vault, space, `zerofee-${space}`), approve: (w) => this.approveOnSheet(w) });
      this.asSecondDevice.set(space, device);
    }
    const { space: _, ...params } = p;
    const res = await device.call(method, params);
    if ("problem" in res) throw new ProblemError(res.problem);
    return res.ok;
  }

  /**
   * ZeroFee Chat's seed (nostr.ts CHAT_PATH under the hot root), for Chat's own calls only (forApps stamps `app`): no
   * other app, and not the shell, signs a chat message. Nothing here returns a secret: a place's public key, or an
   * event the core built and signed itself (kind 20000/20001, its own tags and clock).
   */
  private async chatSeedFor(p: Record<string, unknown>, method: string): Promise<Uint8Array> {
    if (p.app !== "chat") throw new ProblemError(securityProblems.methodUnknown(method));
    // A name already made on this device stays, so it never changes under the person.
    const made = await this.vault.get(CHAT_DEVICE_SEED);
    if (made?.length === 32) return made;
    // With the backup words here (every account made or restored on this device): names from the words, so a restore
    // brings the same names back.
    const root = await this.vault.get(HOT_ROOT);
    if (root) {
      try {
        return chatSeed(root);
      } finally {
        root.fill(0);
      }
    }
    // An account that came here without its words: names made on this device, never 24 typed words just to post (UX
    // walk 2 Nov). Chat names carry no money; a payment in Chat goes from Wallet, under the account's own rules.
    if (!(await this.saved())?.accountId) throw new ProblemError(securityProblems.accountNone());
    const seed = crypto.getRandomValues(new Uint8Array(32));
    await this.vault.put(CHAT_DEVICE_SEED, seed);
    return seed;
  }

  /**
   * ZeroFee Chat's keys (chat-keys.ts): a place's key, the person's named key there or their NEAR rooms' key; the
   * signed messages, the private messages, and the account's note that names a chat key (J3 part 2): signed by the
   * device key after this core's sheet, or by the phone's chip on its own sheet (signChatName). Chat only.
   */
  private chatKeysFor(p: Record<string, unknown>, method: string): ChatKeys {
    if (p.app !== "chat") throw new ProblemError(securityProblems.methodUnknown(method));
    if (this.chatKeys) return this.chatKeys;
    return (this.chatKeys = new ChatKeys({
      seed: () => this.chatSeedFor({ app: "chat" }, method),
      account: async () => {
        const s = await this.saved();
        return s?.stage === "ready" ? s.accountId : null;
      },
      signNote: async ({ account, chatKey, until, nonce, hash, words }) => {
        const key = await this.deviceKey();
        let signature: Uint8Array | null;
        if (key.signChatName) signature = await key.signChatName({ accountId: account, chatKey, until, nonce });
        // A chip key signs only what it builds itself: without signChatName it can't sign this note.
        else if (key.signOnSheet) throw new ProblemError(securityProblems.requestNotAllowed("This phone can't show your NEAR account in Chat yet."));
        else signature = (await this.approveOnSheet(words).catch(namedOnly)) ? await key.signHash(hash) : null;
        if (!signature) return null;
        return { publicKey: key.publicKey, signature: `${key.publicKey.split(":")[0]}:${base58(signature)}` };
      },
      load: async () => {
        const raw = await this.vault.get(CHAT_NAMES);
        return raw ? new TextDecoder().decode(raw) : null;
      },
      save: async (json) => (json === null ? this.vault.delete(CHAT_NAMES) : this.vault.put(CHAT_NAMES, utf8(json))),
    }));
  }
  private chatKeys: ChatKeys | null = null;

  /** Stop watching and treat every open approval as "no". */
  close(): void {
    this.subwallets.endAll("ended");
    this.stopWatching();
    for (const answer of this.approvals.values()) answer(false);
  }

  private dispatch(method: string, p: Record<string, unknown>): Promise<unknown> {
    // The web wallet: its own door first; anything that needs the Safe is refused by name before it runs.
    if (this.web) {
      if (method.startsWith("account.web.")) return this.web.call(method, p);
      if (!webAllows(method, p)) return Promise.reject(new ProblemError(securityProblems.webNoSafe()));
      if (method === "account.state") return this.webState();
      if (method === "account.id") return Promise.resolve(null);
      if (method === "approval.answer") return this.answerWeb(p.id, p.approve, p.password);
      // Trade's first session after the lock opened: the password once, on its own sheet; inside the caps it is instant after
      if (method === "subwallet.session.start" && !this.webTradeOpen) return this.openWebTrade().then(() => this.dispatch(method, p));
      // Trade starts its session when it opens, never at the tap (product decision, 4 Nov: one tap is the trade). The password still
      // gates every signature: a signature before it (the person said no when Trade opened) asks it first, and a preflight
      // before it reads nothing (it asks no one)
      if ((method === "subwallet.signTx" || method === "subwallet.sign") && !this.webTradeOpen) return this.openWebTrade().then(() => this.dispatch(method, p));
      if (method === "subwallet.preflight" && !this.webTradeOpen) return Promise.resolve({ ok: false });
    }
    // AgentZero's door: its code loads the first time it asks (agent-door.ts), never in Home's first load. A pause or a
    // revoke stops its pocket's trading at once, before that load, whatever NEAR answers (D107).
    if (method.startsWith("account.agent.")) {
      if (method === "account.agent.pause" || method === "account.agent.revoke") {
        this.agentStopped = true;
        this.subwallets.endAgentPocket("stopped"); // also ends a job's act scope (agent-act.ts reads this Stop count)
        void this.vault.delete("agent-act-scope").catch(() => undefined);
      }
      return import("./agent-door.ts").then((k) => k.agentCall(this.agentCtx(), method, p));
    }
    if (method.startsWith("site2fa.")) return this.siteCodeKeep(method, p);
    // The person's own sign-in mailbox (K1): ZeroFee's own screens only, never an app (AgentZero included), and
    // only when the app's settings name a mail host; it needs the hot root (the words), not a finished account; its code
    // loads the first time it's asked (site-mail.ts).
    if (method.startsWith("sitemail.")) {
      if (p.app !== undefined || p.caller !== undefined) throw new ProblemError(securityProblems.methodUnknown(method));
      return import("./site-mail.ts").then((k) => k.siteMailCall(method, p, { vault: this.vault, host: this.mailOpt?.host ?? null, domain: this.mailOpt?.domain ?? null }));
    }
    switch (method) {
      case "account.state":
        return this.keptState();
      case "account.id":
        return this.accountId();
      case "account.create":
        return this.createOnce(p);
      // "Add money to start": the shell's own screens only (forApps never lets an app ask these).
      case "account.fund.coins":
        return this.fundCoins();
      case "account.fund.start":
        return this.fundStart(p);
      case "account.fund.status":
        return this.fundStatus();
      case "account.fund.note":
        return this.fundNote(p);
      // Money that came in, kept for good: Activity's lasting "Received" rows, the Statement's and AgentZero's "how much
      // came in" (each Add once it ended, the NEAR that opened the account), and for the ledger's Safe watch the coins the
      // float's own moves to or from the Safe touched since `since`. Wallet's ledger only.
      case "subwallet.received":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet reads what came in."));
          })
          .then(() => this.received(p.since));
      case "account.recoveryChoices":
        return Promise.resolve(recoveryChoices(this.chain.network));
      case "account.keyProof":
        return this.keyProof();
      case "account.removeKey":
        return this.removeKey(p.handle);
      case "account.protection.get":
        return p.room === true ? this.protectionRoom() : this.protectionGet();
      case "account.rules":
        return this.rulesInfo();
      case "account.rules.update":
        return this.rulesUpdate();
      // The Safe's update (product decision, 5 Nov): its card and held screen (safe-update.ts). Read from the chain and this
      // build's own release list only.
      case "account.safeUpdate":
        return this.safeUpdate();
      case "account.safeUpdate.cancel":
        return this.safeUpdateCancel();
      case "account.safeUpdate.finish":
        return this.safeUpdateFinish();
      case "account.nearPrice":
        return this.sheetNearUsd().then((usd) => ({ usd }));
      case "account.protection.set":
        return this.protectionSet(p.bands);
      case "account.waiting":
        return this.waiting();
      case "account.waiting.run":
        return this.runWaiting(p.id);
      case "account.waiting.cancel":
        return this.cancelWaiting(p.id);
      case "account.waiting.status":
        return this.waitingStatus(String(p.id));
      case "account.secondDevice.pair":
        // `kind`: a laptop (or spare phone) of the person's own, or a guardian: a trusted person's ZeroFee.
        return this.pairSecondDevice(p.qr ?? p.publicKey, p.kind === "guardian" ? "guardian" : "laptop");
      case "account.secondDevices":
        return this.secondDevices();
      case "account.secondDevice.refill":
        return this.refillSecondDevices();
      case "account.secondDevice.setLimit":
        return this.secondDeviceLimit(p.usd);
      // Separate wallets: only once the account is ready (backed up). An app (stamped by forApps) reaches only its own
      // kind of wallet.
      case "subwallet.list":
        // the web wallet (product decision, 4 Nov): no Safe, and Home IS its three wallets, so Wallet lists them (Add shows each
        // one's own address; Send names its source). A list only: signing stays each wallet's own app's (mayUse).
        return this.ready().then(async () => (await this.subwallets.list()).filter((w) => p.app === undefined || maySee(String(p.app), w) || (this.web !== null && p.app === "wallet" && webWalletSeen(w))));
      case "subwallet.create":
        // Spending's balance on NEAR (trade/near) is Trade's and ZeroFee's own screens' only: Browser, Apps and Chat never
        // make it nor learn its address (security review 2 Nov, Low), as mayUse keeps it out of their subwallet.list.
        return this.ready()
          .then(() => this.ownKind({ ...p, kind: p.kind ?? "chain" }, true))
          .then(() => {
            // and the NEAR coin wallet (review L4): Trade's only, as its trades are
            if ((p.kind === "trade" || p.kind === "browser") && p.chain === "near") this.tradeOnly(p);
            return this.subwallets.create(p.kind, p.chain, p.slot, p.siteId);
          });
      // NEAR coins on Rhea (3 Nov): the NEAR coin wallet's address, its trade built and signed by the core from Trade's
      // ask, and a coin's account in it. Trade's and ZeroFee's own screens' only; nothing is sent here
      case "subwallet.near.wallet":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.nearCoinWallet());
      case "subwallet.near.trade":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.nearTrade(p.ask));
      case "subwallet.near.register":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.nearRegister(p.coin, p.poolId));
      // NEAR coins under 2 s (near-rhea.ts): one swap on the wallet's own Rhea balance, and "Ready NEAR for trading" (its
      // NEAR into its own account in Rhea, sent by the core). Trade's only
      case "subwallet.near.rheaSwap":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.nearRheaSwap(p.ask));
      // the person's own server for the core's own checks and reads (own-core.ts): ZeroFee's own Status only
      case "subwallet.own.set":
        return import("./own-core.ts").then((m) => m.ownIntoCore(p));
      case "subwallet.own.state":
        return import("./own-core.ts").then((m) => m.ownCoreState(p));
      case "subwallet.near.rheaAdd":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.nearRheaAdd(p.amount));
      // a kept trade's coin back from Ref's lost and found (the audit's MUST, 7 Nov): signed here, sent by Trade. Trade's only
      case "subwallet.near.rheaClaim":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.nearRheaClaim(p.coin));
      // The raw app id goes in (D55): a session covers only the app that started it, never a site's request.
      // Speed: Trade's own Solana, BNB Chain or Robinhood Chain transaction read ahead of the tap (SubWallets.preflight;
      // EVM: the coin signTx will be told, and the trade's earlier steps it runs after); signs nothing
      case "subwallet.preflight":
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.preflight(p.id, p.tx, p.app === undefined ? undefined : String(p.app), p.site, p.minSlot, p.coin, p.before));
      case "subwallet.signTx":
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.signTx(p.id, p.tx, p.why, p.coin, p.app ? appName(String(p.app)) : undefined, p.site, p.app === undefined ? undefined : String(p.app), p.symbol, undefined, p.minSlot, p.ask));
      // A site's transaction, sent and confirmed by the core (D29 wallet mode). EVM: { call }, the core picks nonce, fees, gas.
      case "subwallet.sign":
        return this.ready()
          .then(() => this.ownKind(p))
          .then(() => {
            const asker = p.app ? appName(String(p.app)) : undefined, app = p.app === undefined ? undefined : String(p.app);
            return p.call !== undefined ? this.subwallets.sendCall(p.id, p.call, p.why, p.site, asker, app) : this.subwallets.sendSol(p.id, p.tx, p.why, p.site, asker, app);
          });
      // A public transfer from a chain wallet: shut for every app and every build (the HARD RULE: every money move goes
      // through NEAR Confidential; 83, 6 Nov). No screen sends it: Home's Send is ledger.hiddenFromRow and ledger.sendFromSafe.
      case "subwallet.send":
        return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("A public send from a wallet is off. Home's Send goes through NEAR Confidential.")));
      // The web wallet's private Send (QA's real path for WEB_SEND_OPEN, 5 Nov): one confidential 1Click quote from
      // the SOL or ETH (RH) wallet straight to the payee, the core's own quote and sheet (subwallets.sendPrivate). Wallet's
      // own Send only; its status by the core's own kept tag.
      case "subwallet.sendPrivate":
        if (p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Send in Home sends from your chain wallets.")));
        return this.ready().then(() => this.subwallets.sendPrivate(p.chain, p.to, p.toTokenId, p.amount, String(p.app)));
      // the web Send's tokens held (W4): what each wallet holds of the coins the core sends privately; Wallet's own read
      case "subwallet.sendCoins":
        if (p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Send in Home sends from your chain wallets.")));
        return this.ready().then(() => this.subwallets.sendCoins());
      case "subwallet.sendPrivate.status":
        if (p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Send in Home sends from your chain wallets.")));
        return this.ready().then(() => this.subwallets.sendPrivateStatus(p.depositAddress));
      case "subwallet.balances":
        return this.ready().then(() => this.ownKind(p, true)).then(() => this.subwallets.balances(p.id));
      // A site's own wallet's coins, named and priced (site-coins.ts): the site's app page (pump.fun, GMGN). Display only.
      case "subwallet.coins":
        return this.ready().then(() => this.ownKind(p, true)).then(() => this.subwallets.coins(p.id, p.fresh === true));
      case "subwallet.read":
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.siteRead(p.id, p.method, p.params));
      case "subwallet.signMessage":
        // agent / tap / load: the phone's host's words (IsolatedCore stamps them from the window that asked), Browser's only
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.signMessage(p.id, p.message, p.site, p.app ? appName(String(p.app)) : undefined, p.app === undefined ? undefined : String(p.app), p.app === "browser" ? p.agent : undefined, p.app === "browser" ? p.tap : undefined, p.app === "browser" ? p.load : undefined));
      case "subwallet.signTypedData":
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.signTypedData(p.id, p.typedData, p.site, p.app ? appName(String(p.app)) : undefined));
      case "subwallet.session.start":
        // In dollars: the Trade session, over every trading wallet (`id` only with the first trade's `firstTx`).
        if (p.perTxUsd !== undefined || p.totalUsd !== undefined) {
          return this.ready()
            .then(() => this.tradeOnly(p))
            .then(() => this.ownKind({ ...p, kind: "trade" }))
            .then(() => this.subwallets.tradeSessionStart(p.perTxUsd, p.totalUsd, p.minutes, p.why, p.app ? appName(String(p.app)) : undefined, p.id, p.firstTx, p.coin));
        }
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.sessionStart(p.id, p.perTx, p.total, p.minutes, p.why, p.app ? appName(String(p.app)) : undefined, p.firstTx, p.coin, p.app === undefined ? undefined : String(p.app)));
      case "subwallet.session.end":
        if (p.id === TRADE_SESSION) return this.ready().then(() => this.tradeOnly(p)).then(() => (this.subwallets.endSession(TRADE_SESSION, "ended"), { ok: true }));
        return this.ready().then(() => this.ownKind(p)).then(() => (this.subwallets.endSession(String(p.id), "ended"), { ok: true }));
      case "subwallet.session.endAll":
        // The shell calls this when the page hides or the phone locks. It needs no ready account: ending is always safe.
        this.subwallets.endAll(p.reason === "locked" ? "locked" : "ended");
        return Promise.resolve({ ok: true });
      // The float's fee guard (float.ts), for Trade's planner: Trade's own, and ZeroFee's screens.
      case "subwallet.float.limits":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatLimits(p.prices === true));
      case "subwallet.float.balance":
        // Wallet reads it too (only reads): Home's NEAR wallet lists the SOL or ETH a stopped forward left there by name
        return this.ready().then(() => this.tradeOnly(p, 1)).then(() => this.subwallets.floatBalance());
      case "subwallet.float.out":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatOut(p.chain, p.slot, p.amount, p.key, p.to));
      case "subwallet.float.in":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatIn(p.chain, p.slot, p.amount, p.key, p.from));
      // the NEAR coin wallet (Rhea trades): Make ready and Put away, only through NEAR Confidential (D153/D70)
      case "subwallet.float.nearOut":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatNearOut(p.amount, p.key, p.usd));
      case "subwallet.float.nearIn":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatNearIn(p.amount, p.key, p.usd));
      // Home's row for the NEAR coin wallet reads it too (Wallet, as for Spending's balance): read only
      case "subwallet.near.balance":
        return this.ready().then(() => this.tradeOnly(p, 1)).then(() => this.subwallets.nearCoinBalance());
      // The Add's quote (main → float): Trade asks, or Wallet's ledger.toTrading on its behalf. Nothing moves here.
      case "subwallet.float.quoteAdd":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "trade" && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("An app can only use its own separate wallets."));
          })
          .then(() => this.subwallets.floatQuoteAdd(p.amount, p.tokenId, p.job));
      // The pocket's way out: home to the main balance, and where each move is (Wallet, or the shell's renew screen).
      case "subwallet.private.home":
      case "subwallet.private.move":
      case "subwallet.private.moves":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet moves money out of your private balance."));
          })
          .then((): Promise<unknown> => (method === "subwallet.private.home" ? this.subwallets.privateHome(p.tokenId, p.amount, p.key) : method === "subwallet.private.move" ? this.subwallets.privateMove(p.id) : this.subwallets.privateMoves()));
      case "subwallet.private.balances":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet reads your private balance."));
          })
          .then(() => this.subwallets.confidentialBalances("private"));
      // What the replaced words' pocket and float still hold, and each coin's move to the new one (audit 2); and the
      // person's Try again for it. Wallet and the renew screen only.
      case "subwallet.oldWords":
      case "subwallet.oldWords.moves":
      case "subwallet.oldWords.move":
        return this.ready()
          .then(() => {
            if (p.app && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet reads your private balance."));
          })
          .then((): Promise<unknown> => (method === "subwallet.oldWords" ? this.subwallets.oldWordsMoney() : method === "subwallet.oldWords.moves" ? this.subwallets.oldWordsMoves() : this.sweepAgain()));
      // Home's line for an Add on its way into Hidden (V4 step 6): Wallet's read only
      case "subwallet.private.addsOnWay":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet reads your private balance."));
          })
          .then(() => this.subwallets.privateAddsOnWay());
      // Home's Add and Request (E1, E2; D127): a one-time confidential address on the coin's own chain, into the float,
      // then on to the chain's wallet or the Safe; and Home's line for each. Wallet's own sheet only.
      // `subwallet.add.watch`: the one-time addresses still open, for the phone's push on them; `subwallet.add.seen`: that
      // push saw money reach one (it is asked about at once, then on every read until 1Click says where it went)
      case "subwallet.add.quote":
      case "subwallet.add.onWay":
      case "subwallet.add.watch":
      case "subwallet.add.seen":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet's Add asks."));
          })
          .then((): Promise<unknown> => (method === "subwallet.add.quote" ? this.subwallets.addQuote(p.chain, p.to, p.key, p.usd) : method === "subwallet.add.watch" ? this.subwallets.addWatch() : method === "subwallet.add.seen" ? this.subwallets.addSeen(p.address).then((seen) => ({ seen })) : this.subwallets.addsOnWay()));
      case "subwallet.private.quoteIn":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only Wallet moves money into your private balance."));
          })
          .then(() => this.subwallets.privateQuoteIn(p.tokenId, p.amount, p.outside === true, p.through === true, p.intents === true, p.job));
      case "subwallet.float.home":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatHome(p.amount, p.key, p.parked));
      // Social Trading's Move back (product decision, 2 Nov): a site's own wallet → the Safe, on the core's own sheet. Only Wallet's
      // money sheet (the person's own tap) or ZeroFee's own screens start it: never Browser (a site's page drives it),
      // never the site apps, Trade or Chat. Job 3's High stands: nothing moves out of a site's wallet without this sheet.
      case "subwallet.site.moveBack":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only your own tap in the money sheet moves money back from a site's wallet."));
          })
          .then(() => this.subwallets.siteMoveBack(p.id, p.amount, p.key));
      // Move's take-out of every site wallet at once: one core sheet for every leg, the same guard as one move back
      case "subwallet.site.moveBackAll":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet") throw new ProblemError(securityProblems.requestNotAllowed("Only your own tap in the money sheet moves money back from a site's wallet."));
          })
          .then(() => this.subwallets.siteMoveBackAll(p.legs));
      // ST3: what a site's Add costs, in dollars (two dry quotes, display only: nothing kept, signed or moved). Its app
      // rule is in site-add-cost.ts (loaded with the first ask, the Home budget), checked before anything is read: the
      // Browser's money sheet (on Wallet's bridge), the Browser tab and ZeroFee's own screens; never a site's page
      // (Browser's engine), Trade, Chat or the apps.
      case "subwallet.site.addCost":
        return this.ready().then(() => this.subwallets.siteAddCost(p));
      // Home's Swap: what it really brings, from 1Click's dry quotes (UI's mainnet rehearsal, 3 Nov); nothing moves
      case "subwallet.float.swapCost":
        return this.ready().then(() => this.subwallets.swapCost(p));
      // Audit C1: the connected site's own wallet, made on first connect (the Browser's engine, for the page on screen; on
      // the phone `site` is WebKit's). Never a shared chain wallet.
      // Trade's door before the tap: will a no-sheet signature of `usd` dollars ask? Read only, from the one cap.
      case "subwallet.cap.check":
        return this.ready().then(() => this.subwallets.capCheck(p.usd));
      case "subwallet.site.forHost":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "browser") throw new ProblemError(securityProblems.requestNotAllowed("Only the Browser makes a site's own wallet."));
          })
          .then(() => this.subwallets.siteFor(p.site, p.chain));
      // AgentZero's own window's sign-in wallet (ruling b): its pocket, on its sign-in sites only; the Browser only
      case "subwallet.site.forAgent":
        return this.ready().then(() => this.subwallets.agentSiteFor(p.site, p.chain, p.app === undefined ? undefined : String(p.app)));
      // The sign-ins a site's own wallet signed with no sheet (read only): Social trading's wallet sheet says when.
      case "subwallet.site.signIns":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet" && p.app !== "social") throw new ProblemError(securityProblems.requestNotAllowed("Only Home and Social Trading read your sign-ins."));
          })
          .then(() => this.subwallets.siteSignIns());
      // Where each Move back is (read only): the money sheet, ZeroFee's screens and the Social Trading hub's line.
      case "subwallet.site.moveBacks":
        return this.ready()
          .then(() => {
            if (p.app !== undefined && p.app !== "wallet" && p.app !== "social") throw new ProblemError(securityProblems.requestNotAllowed("Only Home and Social Trading read your moves back."));
          })
          .then(() => this.subwallets.siteMoveBacks());
      // a move's own read: Trade's, and Home's Swap in place following its one swap (read only)
      case "subwallet.float.move":
        return this.ready().then(() => this.tradeOnly(p, 1)).then(() => this.subwallets.floatMove(p.id));
      // A NEAR coin bought or sold inside Spending (TN2, D74): Trade's, and Home's Swap (Wallet, V4 step 5, D111). The
      // tap is the yes: floatSwap raises no sheet for either (subwallets.ts; only AgentZero's agentSwap can). A session only
      // ever starts for Trade's stamped calls; one Wallet names is dropped, never started.
      case "subwallet.float.swapQuote":
        // AgentZero may ask a dry price too (quote_dry): display only, nothing kept, signed or moved, no address back
        return this.ready().then(() => (p.app === "agent" ? undefined : this.tradeOnly(p, 1))).then(() => this.subwallets.floatSwapQuote(p.side, p.coin, p.amount));
      case "subwallet.float.swap":
        return this.ready().then(() => this.tradeOnly(p, 1)).then(() => this.subwallets.floatSwap(p.side, p.coin, p.amount, p.atLeast, p.key, { app: p.app === undefined ? undefined : String(p.app) }, p.app === "wallet" ? undefined : p.session));
      // read only: Trade's, and Home's (its Activity lists the swaps in place; a reload picks up a swap still running)
      case "subwallet.float.moves":
        return this.ready().then(() => this.tradeOnly(p, 1)).then(() => this.subwallets.floatMoveList());
      // The Safe's swap in place (product decision, 5 Nov, safe-swap.ts): the quote the core asks for itself, for Home's Swap and
      // Trade's native coins (through ledger.swap); the Safe's own sheet then checks its one mt_transfer against it
      // the public Safe swap is gone (product decision, 8 Nov; safe-swap-private.ts): the ledger swaps from
      // the Safe only through Private (wallet safe-send.ts swapFromSafe), so this door says no, by name, before any price
      case "subwallet.safeSwapQuote":
        if (SAFE_SWAP_PRIVATE) return Promise.reject(new ProblemError(securityProblems.subwalletRefused("Swaps from your Safe go through NEAR Confidential. Nothing moved.")));
        return this.ready().then(() => this.tradeOnly(p, 1)).then(() => this.subwallets.safeSwapQuote(p.from, p.to, p.amount, p.atLeast));
      // C2: a Move's wallet parts, kept by this core's own read for its one Safe sheet (Spending's, as Trade)
      case "subwallet.moveOthers":
        // only Spending's own engine (Trade's bridge, for Home's Move): never an app, a site, AgentZero or a call naming no one
        if (p.app !== "trade") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Move in Home says its wallets' parts.")));
        return this.ready().then(() => this.subwallets.moveOthers(p.job, p.others, p.end === true));
      case "subwallet.float.addStatus":
        return this.ready().then(() => this.tradeOnly(p)).then(() => this.subwallets.floatAddStatus(p.depositAddress, p.job));
      // V4 Send: Hidden from a row (SOL, ETH on Robinhood) under one Approve (subwallets.hiddenFromRow). Wallet's own Send only.
      case "subwallet.hiddenFromRow":
        if (p.app !== undefined && p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Send pays from Private.")));
        return this.ready().then(() => this.subwallets.hiddenFromRow(p.chain, p.inDeposit, p.outDeposit, p.intent, p.outTag, p.why, p.payee, p.coin));
      case "subwallet.privatePay":
        return this.ready().then(() => this.ownKind(p)).then(async () => this.subwallets.privatePay(p.id, p.depositAddress, p.intent, p.why, p.statusTag, p.inDeposit, p.send === true, p.payee, (await import("./send-words.ts")).pairAsked(p), p.job, p.sendJob));
      // a Move's plan (the audit's ruling, 7 Nov: one fill for the whole Move), worked out and kept by this core. Wallet's own only
      case "subwallet.movePlan":
        if (p.app !== undefined && p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Another app asked Private to pay, so ZeroFee stopped this. Nothing moved.")));
        return this.ready().then(() => this.subwallets.movePlan(p.job, p.tokenId, p.parts, p.share, p.price, p.decimals, p.whole, p.safeHas));
      // the one Face ID's leg 2 (the audit's MUST, 6 Nov): kept in this core's vault, handed to 1Click by the core itself only once
      // leg 1 reads SUCCESS with its tag; deleted when the Send's job ends. Wallet's own Send only
      case "subwallet.pairHand":
        if (p.app !== undefined && p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Send pays from Private.")));
        return this.ready().then(() => this.subwallets.pairHand(p.inDeposit, p.outDeposit));
      case "subwallet.pairEnd":
        if (p.app !== undefined && p.app !== "wallet") return Promise.reject(new ProblemError(securityProblems.requestNotAllowed("Only your own Send pays from Private.")));
        return this.ready().then(() => this.subwallets.pairEnd(p.inDeposit, p.outDeposit));
      case "subwallet.export":
        return this.ready()
          .then(() => this.ownKind(p, true))
          .then(async () => {
            // The card wallet's key leaves only from Settings (the shell), never through an app's code (D34).
            if (p.app !== undefined && (await this.subwallets.list()).find((w) => w.id === p.id)?.kind === "pay") throw new ProblemError(securityProblems.requestNotAllowed("The card wallet's key is shown only from Settings."));
            // D55: a chain wallet's key is shown only from Wallet's Details, through Spending's host (Trade's bridge) or
            // ZeroFee's own screens: never from Browser, an app in Apps or Chat, which a site's or a chat's page drives.
            if (p.app !== undefined && p.app !== "trade") throw new ProblemError(securityProblems.requestNotAllowed("A wallet's key is shown only from Wallet's Details."));
          })
          .then(() => this.subwallets.export(p.id));
      case "subwallet.linkStart":
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.linkStart(p.kind));
      case "subwallet.import":
        return this.ready().then(() => this.ownKind(p)).then(() => this.subwallets.import(p.kind, p.sealed));
      // Reading only, before Pay saves or tops up a card address: no key involved.
      // ZeroFee Chat (D55): its name in a place and its signed messages there. Chat only; the key never leaves.
      case "nostr.publicKey":
      case "nostr.sign":
      case "nostr.seal":
      case "nostr.open":
      case "nostr.bind":
      case "nostr.bound":
      case "nostr.unbind":
        return this.chatKeysFor(p, method).call(method, p);
      case "card.check":
        if (p.product !== "gnosis-pay") throw new ProblemError(securityProblems.requestInvalid("ZeroFee can check only Gnosis Pay cards for now."));
        return checkGnosisPayAccount(p.address, this.gnosis);
      // The card's EURe, for Pay's card tile: read from the coin on both nodes (a disagreement is a Problem).
      case "card.balance":
        return readCardBalance(p.address, this.gnosis);
      case "account.activity":
        return this.activity(p.limit);
      case "recovery.check":
        return this.check(p.words);
      case "recovery.words":
        return this.words();
      case "recovery.confirm":
        // With ZeroFee's own words screen the check runs there (backup) and never from a caller (audit CORE-01).
        if (this.nativeWords) throw new ProblemError(securityProblems.requestNotAllowed("On this device your backup words are checked on ZeroFee's own screen."));
        return this.confirm(p.positions, p.words);
      case "recovery.backup":
        return this.backup();
      case "recovery.status":
        return this.status();
      // Background alerts (the phone's refresh task; the open app marks what it showed): only what's new since last asked.
      case "alerts.poll":
        return this.alertsPoll(p.notify !== false);
      // Email alerts from the relay (apps/quotes/alerts.mjs): asks it to email a link that turns them on, or stops them.
      // Is the relay's email door open end to end (its /v0/health "alerts")? Asked before the row shows, so nobody types an
      // email or signs a proof for a door that answers 503 (the relay hunt's B1, 5 Nov).
      case "account.alertsEmail.available":
        return this.alertsAvailable();
      case "account.alertsEmail":
        return this.alertsEmail("subscribe", p.email);
      case "account.alertsEmailStop":
        return this.alertsEmail("remove-ask", p.email);
      case "recovery.renew":
        return this.renew();
      case "recovery.renewConfirm":
        if (this.nativeWords) throw new ProblemError(securityProblems.requestNotAllowed("On this device your new words are checked on ZeroFee's own screen."));
        return this.renewConfirm(p.positions, p.words);
      case "recovery.cancel":
        return this.cancel();
      case "secondDevice.state":
      case "secondDevice.requests":
      case "secondDevice.answer":
        return this.secondDevice(method, p);
      case "recovery.start":
        return this.startRecovery(p.words, p.accountId);
      case "recovery.rearm":
        return this.rearm(p.thenRecover === true);
      case "recovery.finish":
        return this.finishRecovery();
      case "tx.describe":
        return this.ready().then((s) => s.describe(p.request as TxRequest));
      case "tx.request":
        return this.ready().then((s) => s.request(p.request as TxRequest));
      case "approval.answer":
        return this.answer(p.id, p.approve);
      default:
        // D119 perps (the build's PERPS_NETWORK): Trade's and ZeroFee's own screens only (perps/service.ts perpsCall checks
        // the app first), loaded on the first call, never in Home's first load; money in and out through Trading (landing 3)
        if (method.startsWith("perps.")) return import("./perps/service.ts").then((m) => m.perpsCall({ vault: this.vault, approve: this.approveOnSheet, ready: () => this.ready(), money: { toPerps: (u, k, r) => this.subwallets.floatToPerps(u, k, r), fromPerps: (u, k, pay) => this.subwallets.floatFromPerps(u, k, pay) } }, method, p));
        throw new ProblemError(securityProblems.methodUnknown(method));
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async saved(): Promise<Saved | null> {
    const raw = await this.vault.get(STATE);
    return raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
  }

  private async save(state: Saved): Promise<void> {
    await this.vault.put(STATE, utf8(JSON.stringify(state)));
  }

  private async forget(): Promise<void> {
    for (const name of [STATE, RECOVERY_SEED, RECIPIENTS, PENDING_WORDS, WORDS_CHECKED, HOT_ROOT, FUND_ORDERS, CREATED_AT, RENEW_WORDS, RENEW_AT, RENEW_ASIDE, ALERTS_SEEN, SECOND_KINDS, PROTECTION_USD, CHAT_DEVICE_SEED, CHAT_NAMES]) await this.vault.delete(name);
    await this.deviceKeys.forget();
    this.device = null;
    this.backupSeed?.fill(0);
    this.backupSeed = null;
  }

  /** The account's device key (a software key, or the phone's chip key). */
  private async deviceKey(): Promise<AccountKey> {
    const key = await this.deviceKeys.get();
    if (!key) throw new ProblemError(securityProblems.keyMissing());
    return key;
  }

  private async key(name: string, kind: "development" | "recovery-words"): Promise<SoftwareKey> {
    const seed = await this.vault.get(name);
    if (!seed) throw new ProblemError(securityProblems.keyMissing());
    return SoftwareKey.fromSeed(seed, kind);
  }

  /** NEAR in dollars: ONE snapshot for every screen and sheet (grade 02h, H1: Wallet $30.40, Send's review $30.41 and
   *  the sheet $30.34 for the same 7.1049 NEAR, each priced on its own). From 1Click's public list, kept a minute and
   *  handed to the apps as `account.nearPrice`, so Wallet, Send's review and the sheet say the same dollars for the same
   *  amount. Words only: what is signed never depends on it. Null when it can't be read (the words then say NEAR alone).
   *  A failed read is not kept, so the next screen asks again. */
  private sheetPrice: { at: number; value: Promise<number | null> } | null = null;
  private sheetNearUsd(): Promise<number | null> {
    if (!this.sheetPrices) return Promise.resolve(null);
    if (!this.sheetPrice || Date.now() - this.sheetPrice.at > NEAR_PRICE_KEPT_MS) {
      const made = { at: Date.now(), value: oneClickNativeUsd("near").catch(() => null) };
      this.sheetPrice = made;
      void made.value.then((v) => v === null && this.sheetPrice === made && (this.sheetPrice = null));
    }
    return this.sheetPrice.value;
  }

  private async deviceSigner(accountId: string): Promise<DevSigner> {
    if (this.device?.accountId === accountId) return this.device;
    const raw = await this.vault.get(RECIPIENTS);
    const known = new Set<string>(raw ? JSON.parse(new TextDecoder().decode(raw)) : []);
    this.device = new DevSigner({
      accountId,
      chain: this.chain,
      key: await this.deviceKey(),
      approve: this.approveOnSheet,
      knownRecipients: known,
      onNewRecipient: () => void this.vault.put(RECIPIENTS, utf8(JSON.stringify([...known]))),
      // the fence: written before every signature, read once (dev-signer nonceFloor); kept by key, so another key's is ignored
      nonceMark: {
        get: async () => { const raw = await this.vault.get(NONCE_MARK); return raw ? new TextDecoder().decode(raw) : null; },
        put: (value) => this.vault.put(NONCE_MARK, utf8(value)),
      },
      // The account's own record of sends, so one made on another device or before a restore is known too (02f).
      // NEAR and every coin it sent (activity.ts recipientsOf): the same list the first-time warning reads for all of them
      // a partial history (B33) isn't kept as the whole list of people paid before: the next sheet asks again (review L1;
      // meanwhile a name only reads as new, the safe side)
      pastRecipients: async () => {
        const past = await this.chain.pastTransactions(accountId, 50);
        if (past.partial) throw new ProblemError(securityProblems.historyUnreachable());
        return past.filter((tx) => tx.ok).flatMap(recipientsOf);
      },
      // A move to one of the account's own separate wallets is named by it on the sheet (the core's own list).
      ownWallets: async () => new Map((await this.subwallets.list()).map((w) => [w.address, ownWalletName(w)])),
      // A quote this core asked for itself (the Add, a move into Private) is read through the relay; any other, from 1Click.
      oneClick: async (depositAddress) => (await this.ownQuote(depositAddress)) ?? this.oneClick(depositAddress),
      // A plain transfer of a coin to a 1Click address (the move into Private from the account itself): only a quote
      // this core asked for itself is read, through the relay, as 1Click signed it.
      ownQuote: (depositAddress) => this.ownQuote(depositAddress),
      // a Move's Private leg joined to this move into Private, from the core's own record (subwallets privateLeg)
      privateLeg: async (depositAddress) => this.subwallets.privateLeg(depositAddress),
      // the tag (audit, 5 Nov): an address the core's own Swap or Move door asked for puts the request paying it under that
      // tag, so it signs only as exactly that swap or move (a forged quote at it, or a payment beside it, is refused)
      intentOf: (depositAddress) => this.subwallets.intentOf(depositAddress),
      // a Send's payout joined to this move into Private (subwallets sendPayout): its fill sheet says it
      sendPayout: async (depositAddress) => this.subwallets.sendPayout(depositAddress),
      // the one Face ID (audit, 6 Nov): a Send's leg 2 held for its fill's one sheet, released by its signature only, once
      pairOf: (paid) => this.subwallets.pairOf(paid),
      releasePair: (inDeposit, hash) => this.subwallets.releasePair(inDeposit, hash),
      dropPair: (inDeposit) => this.subwallets.dropPair(inDeposit),
      endPair: (inDeposit) => this.subwallets.pairEnd(inDeposit),
      // the action's last signature is made, before anything is sent: the shell makes its job then ("Job created.")
      onSigned: (job) => this.emit("job.signed", job ? { jobKey: job } : {}),
      // a job's sheet is about to show (the chip's on the phone): its row waits on the Face ID (the audit's MUST, 7 Nov)
      onAsked: (job) => this.emit("approval.asked", { jobKey: job }),
      ...(this.quoteKey ? { quoteKey: this.quoteKey } : {}),
      changeLevel: (method, band, block) => this.changeLevel(accountId, method, band, block),
      nearUsd: () => this.sheetNearUsd(),
    });
    // The account's record of sends, read once in the background soon after unlock: the first Send sheet doesn't wait
    // for it (grade 02g, G18). Late, so Home's own reads go first; never keeps a test process alive.
    const signer = this.device;
    const t = setTimeout(() => signer.warmPast(), 1500) as unknown as { unref?: () => void };
    t.unref?.();
    return this.device;
  }

  private async ready(): Promise<DevSigner> {
    // The web wallet: ready once its words are kept; the Safe's signer it would give is never there (any use refuses).
    if (this.web) {
      if (!(await this.web.ready())) throw new ProblemError(securityProblems.accountNone());
      return noSafeSigner<DevSigner>();
    }
    const s = await this.saved();
    if (!s) throw new ProblemError(securityProblems.accountNone());
    if (s.stage === "needs-backup" || s.stage === "creating") throw new ProblemError(securityProblems.backupNeeded());
    if (s.stage !== "ready") throw new ProblemError(securityProblems.notReady());
    return this.deviceSigner(s.accountId);
  }

  /** Words first (J2): where the words are made before the money and go on chain with the account (fundWallets' rule:
   *  mainnet, a vault that keeps them (the phone's Keychain, never a browser: K-2), the pinned account contract). */
  private wordsFirstOk: boolean | null = null;
  private async wordsFirst(): Promise<boolean> {
    if (this.chain.network !== "mainnet" || this.secretsInMemory) return false;
    this.wordsFirstOk ??= hex(sha256(await this.policyWasm())) === ACCOUNT_POLICY.sha256Hex;
    return this.wordsFirstOk;
  }

  /** The words checked before the money are exactly these words (`seed`: the ones whose key went on chain), or the
   *  pending words still kept here (their seed's sha256). */
  private async wordsCheckedFirst(seed?: Uint8Array): Promise<boolean> {
    const [mark, kept] = await Promise.all([this.vault.get(WORDS_CHECKED), seed ? Promise.resolve(seed) : this.vault.get(PENDING_WORDS)]);
    return !!mark && !!kept && kept.length === 32 && hex(mark) === hex(sha256(kept));
  }

  /** Words first (J2, O-2a/O-2c): a set-up waiting for money whose words go on chain with the account and aren't checked
   *  yet. The one test for account.state's wordsDue, fundStart's refusal and the opening's wait. */
  private async wordsWait(s?: Saved | null): Promise<boolean> {
    const saved = s === undefined ? await this.saved() : s;
    return saved?.stage === "funding" && (await this.wordsFirst()) && !(await this.wordsCheckedFirst());
  }

  /** Checked first, and the account opened with their key but the record still says the words wait (a race with the
   *  opening): ready now, so the checked words are never shown again (security review J2, L2). */
  private async promoteCheckedFirst(s: Saved): Promise<boolean> {
    if (s.stage !== "needs-backup" || !s.recoveryIn || !(await this.wordsCheckedFirst())) return false;
    await this.wordsDone(s, false);
    return true;
  }

  /** `wordsDue`: a new mainnet account's words come first (J2): show and check them before the money is asked for. */
  private async state(): Promise<{ stage: Stage; account?: AccountInfo; wordsCheckDue?: true; wordsDue?: true; setupUntilIso?: string; restoredAtIso?: string }> {
    const s = await this.saved();
    if (!s) return { stage: "none" };
    if (s.stage === "ready" || s.stage === "needs-backup") void this.fundSweepLate().catch(() => undefined);
    // Self-funded, not finished: account.create carries on (and never forgets a setup key that may hold NEAR).
    // Words first (J2): where the words go on chain with the account, they are written down and checked before any money.
    if (s.stage === "funding" || (s.stage === "creating" && (await this.vault.get(SETUP_KEY)))) return { stage: "needs-funding", ...((await this.wordsWait(s)) ? { wordsDue: true as const } : {}) };
    // Checked before the money, the account opened since (an opening that ended before the check was kept): ready.
    if (await this.promoteCheckedFirst(s)) return this.state();
    // A crash between "ready" and dropping the checked words' seed (review L3): it goes now.
    if (s.stage === "ready" && ((await this.vault.get(WORDS_CHECKED)) || (await this.vault.get(PENDING_WORDS)))) await this.dropPendingWords();
    // D139: the Safe's own reads (and only its) may use the relay's FastNEAR proxy (chain.ts safeOnly)
    if (this.chain.network === "mainnet") proxySafe(s.accountId);
    const signer = await this.deviceSigner(s.accountId);
    const account = await signer.account();
    const mine = handleOf((await this.deviceKey()).publicKey);
    const onAccount = account.keys.some((k) => k.handle === mine);
    if (s.stage === "creating") {
      // An earlier create stopped half-way. Carry on if the device key made it onto the account, else start over.
      if (!onAccount) {
        await this.forget();
        return { stage: "none" };
      }
      s.stage = "needs-backup";
      await this.save(s);
    }
    if (s.stage !== "recovering" && !onAccount) throw new ProblemError(securityProblems.keyMissing());
    // H34: the set-up window's end (the account's first 24 hours, as this device made it), while it lasts.
    const created = Number(new TextDecoder().decode((await this.vault.get(CREATED_AT)) ?? new Uint8Array()));
    const setupUntil = Number.isFinite(created) && created > 0 ? created + 86_400_000 : 0;
    return { stage: s.stage, account, ...(s.checkDue ? { wordsCheckDue: true as const } : {}), ...(setupUntil > Date.now() ? { setupUntilIso: new Date(setupUntil).toISOString() } : {}), ...(s.restoredAtIso ? { restoredAtIso: s.restoredAtIso } : {}) };
  }

  /**
   * The "Your key" proof card (L6, the product chip question): where this device's key is, and that it is the key on the
   * account, read from two nodes separately (each named). `matches` only when both nodes list it and, for the chip key,
   * the chip itself gave the same public key just now. Anything that can't be read throws its Problem: never a match.
   */
  private async keyProof(): Promise<KeyProof> {
    const s = await this.saved();
    if (!s || s.stage === "funding" || s.stage === "creating" || s.stage === "recovering") throw new ProblemError(securityProblems.keyMissing());
    const key = await this.deviceKey();
    const handle = handleOf(key.publicKey);
    let chip: { publicKey: string; held: boolean; madeAtIso?: string } | null = null;
    if (key.kind === "secure-chip") {
      chip = key.proof ? await key.proof().catch(() => null) : null;
      if (!chip) throw new ProblemError(securityProblems.chipUnread());
    }
    const block = await this.chain.commonBlock();
    const reads = this.chain.accessKeysEach
      ? await this.chain.accessKeysEach(s.accountId, block)
      : [{ node: "", keys: await this.chain.accessKeys(s.accountId, block) }];
    const nodes = reads.map((r) => ({ node: r.node, found: r.keys.some((k) => k.handle === handle) }));
    const chipSame = !chip || (chip.held && chip.publicKey === key.publicKey);
    // A browser's key (grade 1 Nov, D25): made with the account on this device, so its day is the account's.
    const createdMs = chip ? 0 : Number(new TextDecoder().decode((await this.vault.get(CREATED_AT)) ?? new Uint8Array()));
    const madeAtIso = chip?.madeAtIso ?? (Number.isFinite(createdMs) && createdMs > 0 ? new Date(createdMs).toISOString() : undefined);
    return {
      kind: key.kind,
      fingerprint: shortFingerprint(handle),
      ...(chip ? { chipFingerprint: shortFingerprint(handleOf(chip.publicKey)), chipHeld: chip.held } : {}),
      ...(madeAtIso ? { madeAtIso } : {}),
      nodes,
      matches: nodes.length >= 2 && new Set(nodes.map((n) => n.node)).size >= 2 && nodes.every((n) => n.found) && chipSame,
    };
  }

  // ── Creating an account ────────────────────────────────────────────────────────────────────────────────────────

  private async create(p: Record<string, unknown> = {}): Promise<AccountInfo | Funding> {
    const saved = await this.saved();
    const selfFunded = this.chain.network === "mainnet" || p.fund === "self";
    const resuming = selfFunded && (saved?.stage === "funding" || (saved?.stage === "creating" && !!(await this.vault.get(SETUP_KEY))));
    if (saved && !resuming) throw new ProblemError(securityProblems.accountExists());
    const wasm = await this.policyWasm();
    const wasmHash = hex(sha256(wasm));
    // The account contract (protection by amount) for every new account. Off mainnet, the same release's short-waits build
    // (a minute's shortest delay) is taken too; mainnet only the pinned one. The older recovery-only contract is never
    // installed any more (audit, core integrity 4: its phone key is a full-access key, and its recovery leaves the old
    // key on the account); accounts that already run it are still read.
    const withRules = wasmHash === ACCOUNT_POLICY.sha256Hex || (this.chain.network !== "mainnet" && wasmHash === ACCOUNT_POLICY.shortWaits.sha256Hex);
    if (!withRules) throw new ProblemError(securityProblems.buildMismatch());
    // The person's recovery delay (product decision, 29 Oct): one of the app's choices on mainnet (D49: 48 h, 3, 7, 14 or 30 days;
    // 48 h unless chosen), kept here until the set-up transaction carries it; it never changes afterwards.
    if (p.recoveryDelaySeconds !== undefined) {
      const chosen = Number(p.recoveryDelaySeconds);
      const allowed = this.chain.network === "mainnet" ? ACCOUNT_POLICY.recoveryDelayChoices.includes(chosen) : Number.isInteger(chosen) && chosen >= 60 && chosen <= 30 * 86_400;
      if (!allowed) throw new ProblemError(securityProblems.requestInvalid("recoveryDelaySeconds must be one of account.recoveryChoices"));
      await this.vault.put(DELAY_CHOICE, utf8(String(chosen)));
    }
    if (selfFunded) return this.createSelfFunded(saved, wasm, withRules);

    // The key made at "Make your key" is kept through a failed try (nothing is on chain yet), so "Try again" needs no
    // Face ID again: a key already here is used, and only a missing one is made.
    if (!(await this.deviceKeys.get())) await this.deviceKeys.make();
    const accountId = `zf-${hex(crypto.getRandomValues(new Uint8Array(5)))}.testnet`;
    await this.save({ accountId, stage: "creating" });

    const setupPrivate = privateKeyFromRandom();
    const setupPublic = publicKeyFromPrivate(setupPrivate);
    try {
      this.emit("account.create.step", { step: 1 });
      // A hiccup is tried again by itself, twice, with "Still working…" on screen; a "not now" with its own wait is
      // waited out only if it is short, otherwise said as it is.
      for (let attempt = 1; ; attempt++) {
        try {
          await this.createAccount(accountId, setupPublic);
          break;
        } catch (e) {
          const busyFor = e instanceof HelperBusy ? e.untilMs - Date.now() : 0;
          if (e instanceof HelperBusy && busyFor > 30_000) throw new ProblemError(securityProblems.accountCreateLater(new Date(e.untilMs).toISOString(), waitWords(e.untilMs, Date.now())));
          if (attempt >= 3) throw e;
          this.emit("account.create.step", { step: 1, retrying: true });
          await new Promise((r) => setTimeout(r, Math.max(busyFor, this.createRetryMs * attempt)));
        }
      }
      await this.waitForAccount(accountId);
    } catch (e) {
      // Nothing is on chain: the unfinished record goes, the device key stays for the next try.
      await this.vault.delete(STATE);
      if (e instanceof ProblemError) throw e;
      throw new ProblemError(securityProblems.accountCreateFailed());
    }

    return this.setUp(accountId, wasm, withRules, setupPrivate, false);
  }

  /**
   * A self-funded account (mainnet, where there is no faucet and no sponsor):
   * 1. a one-time classical setup key is made and kept; its implicit address is where the person sends NEAR from any
   *    wallet (`needs-funding`, with the amount: the contract's storage plus a margin);
   * 2. once two nodes see it, that key asks the registrar to create the named account with almost all of it, then the
 *    setup address deletes itself into the new account, so the rest (the creating call's fee room) follows: nothing
 *    is left at the setup address;
   * 3. the same one setup transaction as always: the device's post-quantum key in, the account's rules installed, the
   *    setup key deleted.
   * Each step can be resumed by calling account.create again; the setup key is kept until step 3 is done, so NEAR
   * sent to it is never stranded.
   */
  private async createSelfFunded(saved: Saved | null, wasm: Uint8Array, withRules: boolean): Promise<AccountInfo | Funding> {
    let s = saved;
    if (!s) {
      await this.deviceKeys.make();
      await this.vault.put(SETUP_KEY, utf8(privateKeyFromRandom()));
      s = { accountId: `zf-${hex(crypto.getRandomValues(new Uint8Array(5)))}.${this.chain.network === "mainnet" ? "near" : "testnet"}`, stage: "funding" };
      await this.save(s);
    }
    const setupPrivate = new TextDecoder().decode((await this.vault.get(SETUP_KEY))!);
    const setupPublic = publicKeyFromPrivate(setupPrivate);
    const fundAddress = hex(fromBase58(setupPublic.slice("ed25519:".length)));
    // finding 23: the opening's own reads and sends may use the relay's paid door (D111: the account's own)
    if (this.chain.network === "mainnet") proxyOpening([fundAddress, s.accountId]);
    // The create landed though its answer didn't (finding 1): the named account holds this phone's setup key, so it
    // carries on from there, and never asks the registrar a second time.
    if (s.stage === "funding" && (await this.madeOnChain(s))) {
      s.stage = "creating";
      await this.save(s);
    }
    if (s.stage === "funding") {
      // The same choice set-up makes (setUp's `install`): the published rules by hash once two nodes show them, else
      // this build's own copy. Publication is permanent, so a by-hash ask can't later meet a copy's set-up.
      const storageYocto = fundingStorage(wasm.length, withRules && (await this.rulesPublished()));
      const needYocto = storageYocto + FUNDING_MARGIN;
      const haveYocto = (await this.chain.account(fundAddress, await this.chain.commonBlock()))?.balanceYocto ?? 0n;
      if (haveYocto < needYocto) return { stage: "needs-funding", accountId: s.accountId, fundAddress, needYocto: needYocto.toString(), haveYocto: haveYocto.toString(), storageYocto: storageYocto.toString() };
      // O-2c (QA, 3 Nov): words first for the opening too. NEAR that came before the words are checked waits at the
      // setup address (its key kept here, nothing lost); the account opens once they are.
      if (await this.wordsWait(s)) return { stage: "needs-funding", accountId: s.accountId, fundAddress, needYocto: needYocto.toString(), haveYocto: haveYocto.toString(), storageYocto: storageYocto.toString(), wordsDue: true };
      // the money that opened it, kept for good (Activity's "Received"): written again by a try after a refund
      await this.vault.put(OPENED_WITH, utf8(JSON.stringify({ accountId: s.accountId, yocto: haveYocto.toString(), atIso: new Date().toISOString() })));
      s.stage = "creating";
      await this.save(s);
      this.emit("account.create.step", { step: 1 });
      const creator = new DevSigner({ accountId: fundAddress, chain: this.chain, key: { publicKey: setupPublic, signHash: async (h) => signClassical(h, setupPrivate) as Uint8Array }, approve: async () => true });
      const args = utf8(JSON.stringify({ new_account_id: s.accountId, new_public_key: setupPublic }));
      const out = await creator.run(REGISTRAR[this.chain.network], [{ kind: "call", method: "create_account", args, gas: 100_000_000_000_000n, depositYocto: haveYocto - FUNDING_FEE }]);
      if (out.status !== "done") {
        // The registrar refunds a failed create to the setup address: back to waiting, nothing lost.
        s.stage = "funding";
        await this.save(s);
        throw new ProblemError(out.status === "problem" ? out.problem : securityProblems.accountCreateFailed());
      }
      await this.waitForAccount(s.accountId);
    }
    // Before the setup key can be forgotten, the setup address gives the new account all it still holds (the creating
    // call's fee room): nothing is left behind there. Resumed here too, until the address is gone.
    await this.emptySetupAddress(fundAddress, s.accountId, setupPublic, setupPrivate);
    const info = await this.setUp(s.accountId, wasm, withRules, setupPrivate, true);
    await this.noteOpeningKept(s.accountId);
    return info;
  }

  /**
   * What opening the account keeps (finding 10: "Received 12.00 NEAR · opened your account" over a Safe of 11.85 NEAR,
   * the 0.15 NEAR between them in no row): the NEAR that came in, less what the Safe can use right after set-up (its
   * storage, the fee reserve and the opening's fees, availableYocto). Read once, as set-up ends and before any move, and
   * kept with the opening's record. Set-up never fails on it: unread, the opening's row says no figure.
   */
  private async noteOpeningKept(accountId: string): Promise<void> {
    try {
      const raw = await this.vault.get(OPENED_WITH);
      const o = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { accountId?: string; yocto?: string; keptYocto?: string }) : null;
      if (!o || o.accountId !== accountId || o.keptYocto !== undefined || !/^\d{1,40}$/.test(o.yocto ?? "")) return;
      const kept = BigInt(o.yocto!) - availableYocto(await this.chain.account(accountId, await this.chain.commonBlock()));
      if (kept > 0n && kept < BigInt(o.yocto!)) await this.vault.put(OPENED_WITH, utf8(JSON.stringify({ ...o, keptYocto: kept.toString() })));
    } catch {
      /* unread: the opening's row says no figure for it */
    }
  }

  /**
   * The one-time setup address deletes itself into the new account (DeleteAccount, beneficiary the account): every yocto
   * it holds moves, so none is stranded once the setup key is gone. Only into an account two nodes show, and only once
   * its balance has stopped moving (the creating call's gas refund lands a block after it). Already gone: nothing to do.
   * A failure keeps the setup key and the stage, so account.create tries again from here.
   */
  private async emptySetupAddress(fundAddress: string, accountId: string, setupPublic: string, setupPrivate: string): Promise<void> {
    let last: bigint | null = null;
    for (let i = 0; i < 10; i++) {
      const block = await this.chain.commonBlock();
      const [here, into] = await Promise.all([this.chain.account(fundAddress, block), this.chain.account(accountId, block)]);
      if (!here) return;
      if (!into) throw new ProblemError(securityProblems.accountCreateFailed());
      if (here.balanceYocto === last) {
        const key = await this.chain.accessKey(fundAddress, setupPublic, block);
        if (!key) throw new ProblemError(securityProblems.accountCreateFailed());
        const bytes = releaseTxBytes({ signerId: fundAddress, publicKey: setupPublic, nonce: key.nonce + 1n, receiverId: fundAddress, blockHash: block.hash, actions: [{ kind: "delete-account", beneficiaryId: accountId }] });
        // Deleting the signer makes NEAR's gas refund to it fail by nature: the step counts once the address is gone.
        await this.chain.send(signedReleaseTx(bytes, signClassical(sha256(bytes), setupPrivate) as Uint8Array), txHashOf(bytes), fundAddress).catch(() => undefined);
        if (!(await this.chain.account(fundAddress, await this.chain.commonBlock()))) return;
        throw new ProblemError(securityProblems.accountCreateFailed());
      }
      last = here.balanceYocto;
      await new Promise((r) => setTimeout(r, this.settleMs));
    }
    throw new ProblemError(securityProblems.accountCreateFailed());
  }

  // ── Add money to start (fund-start.ts): any big coin opens the account ───────────────────────────────────────────

  /**
   * The words' wallets exist before the money comes (D43, D55): a coin's refund goes to the account's own wallet on its
   * network, made from the backup words, so the words are made now (kept in this device's vault until shown, as setUp
   * already keeps them) and their hot root with them. Only where setUp will put those very words on chain with the
   * account: the phone (its vault is the Keychain), mainnet, the pinned account contract. A browser keeps no words no
   * one has seen (audit K-2): there, NEAR alone opens an account.
   */
  private async fundWallets(): Promise<boolean> {
    if (this.chain.network !== "mainnet" || this.secretsInMemory) return false;
    if (hex(sha256(await this.policyWasm())) !== ACCOUNT_POLICY.sha256Hex) return false;
    if (!(await this.vault.get(HOT_ROOT))) await this.keepHotRoot(await this.pendingWords());
    return true;
  }

  /** The self-funded account waiting for money, with its setup address and what it needs in all; else a Problem. */
  private async fundTarget(): Promise<{ s: Saved; fundAddress: string; needYocto: bigint }> {
    const s = await this.saved();
    const setup = await this.vault.get(SETUP_KEY);
    if (!s || !setup || (s.stage !== "funding" && s.stage !== "creating")) throw new ProblemError(securityProblems.fundNotOpening());
    const fundAddress = hex(fromBase58(publicKeyFromPrivate(new TextDecoder().decode(setup)).slice("ed25519:".length)));
    const wasm = await this.policyWasm();
    const withRules = hex(sha256(wasm)) === ACCOUNT_POLICY.sha256Hex || (this.chain.network !== "mainnet" && hex(sha256(wasm)) === ACCOUNT_POLICY.shortWaits.sha256Hex);
    const needYocto = fundingStorage(wasm.length, withRules && (await this.rulesPublished())) + FUNDING_MARGIN;
    return { s, fundAddress, needYocto };
  }

  /** subwallet.received: the Adds that ended and the NEAR that opened the account (its dollars priced on the first read
   *  after, then fixed); `since` (ms): the coins the float's own Safe moves touched since then. */
  private async received(since: unknown): Promise<{ adds: Received[]; opened: Received | null; touched?: string[] }> {
    const [adds, touched] = await Promise.all([
      this.subwallets.addsReceived().catch(() => [] as Received[]),
      typeof since === "number" && Number.isFinite(since) ? this.subwallets.safeTouched(since).catch(() => null) : Promise.resolve(undefined),
    ]);
    const raw = await this.vault.get(OPENED_WITH);
    let o = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { accountId?: string; yocto?: string; keptYocto?: string; atIso?: string; usd?: string }) : null;
    const s = await this.saved();
    // only once the account is open (an opening refunded and tried again rewrote it), and only this account's
    const open = !!o && s?.accountId === o.accountId && (s?.stage === "ready" || s?.stage === "needs-backup") && /^\d{1,40}$/.test(o.yocto ?? "") && BigInt(o.yocto!) > 0n;
    if (open && o!.usd === undefined) {
      const px = await this.sheetNearUsd().then((v) => v ?? this.nativeUsd("near")).catch(() => null);
      if (px) {
        o = { ...o!, usd: ((Number(o!.yocto) / 1e24) * px).toFixed(2) };
        await this.vault.put(OPENED_WITH, utf8(JSON.stringify(o)));
      }
    }
    const opened: Received | null = open ? { id: `open:${o!.accountId}`, kind: "open", chain: "near", into: "safe", tokenId: "near", decimals: 24, amount: o!.yocto!, ...(o!.usd ? { usd: o!.usd } : {}), ...(o!.keptYocto && /^\d{1,40}$/.test(o!.keptYocto) ? { keptAmount: o!.keptYocto } : {}), atIso: o!.atIso ?? new Date(0).toISOString() } : null;
    // touched unread: every coin counts as touched (the Safe watch counts nothing then)
    return { adds, opened, ...(touched === undefined ? {} : { touched: touched ?? ["*"] }) };
  }

  private async fundRecord(): Promise<FundRecord> {
    const raw = await this.vault.get(FUND_ORDERS);
    const r = raw ? (JSON.parse(new TextDecoder().decode(raw)) as FundRecord) : null;
    return r && Array.isArray(r.orders) ? r : { orders: [] };
  }

  private async fundKeep(r: FundRecord): Promise<void> {
    await this.vault.put(FUND_ORDERS, utf8(JSON.stringify(r)));
  }

  /** account.fund.coins: what can open this account, NEAR always; the others where the words' wallets can be made. */
  private async fundCoins(): Promise<{ coins: (Pick<FundCoin, "id" | "symbol" | "name" | "network"> & { likely?: true })[]; open: { near: string; usd?: string } }> {
    const { needYocto } = await this.fundTarget();
    const swaps = await this.fundWallets();
    // What opening costs, for the screen's one line (words only: every amount asked for is the core's own, as above).
    const nearUsd = await this.sheetNearUsd().then((v) => v ?? this.nativeUsd("near")).catch(() => null);
    return {
      // D155: every chain's own coin NEAR Intents takes (in the test proof build), the likely ones first and marked
      coins: fundOffered().filter((c) => c.id === "near" || swaps).map(({ id, symbol, name, network }) => ({ id, symbol, name, network, ...(FUND_LIKELY.includes(id) ? { likely: true as const } : {}) })),
      open: { near: coinText(needYocto, 24), ...(nearUsd ? { usd: ((Number(needYocto) / 1e24) * nearUsd).toFixed(2) } : {}) },
    };
  }

  /**
   * account.fund.start { coin }: the address to send that coin to. NEAR: the account's own setup address, no swap. Any
   * other: the private route (fund-start.ts): a one-time confidential address the core asks the pinned relay for itself,
   * into the person's own confidential balance (refunds there too), every term checked in float-add.ts, then NEAR on
   * to the account being opened; kept in the vault, so the checklist survives a restart. Nothing is signed here.
   */
  private async fundStart(p: Record<string, unknown>): Promise<FundView> {
    // Words first (J2, O-2a): where the words go on chain with the account, this door gives no address before they are
    // checked, whatever the screens do. An address already given is still read (account.fund.status); a browser (no
    // words before the account, K-2) is not asked. NEAR sent straight to the setup address waits there (O-2c).
    if (await this.wordsWait()) throw new ProblemError(securityProblems.fundWordsFirst());
    // only a coin set-up offers now (D115); an address already asked for is still read by its own coin
    const coin = fundOffered().find((c) => c.id === p.coin);
    if (!coin) throw new ProblemError(securityProblems.fundCoinUnknown());
    const { fundAddress, needYocto } = await this.fundTarget();
    const r = await this.fundRecord();
    if (coin.id === "near") {
      const order: FundOrder = { coinId: "near", depositAddress: fundAddress, refundTo: fundAddress, fundAddress, needYocto: needYocto.toString(), amountIn: needYocto.toString(), minAmountIn: needYocto.toString(), deadlineIso: "", startedAtMs: Date.now() };
      await this.fundKeep({ ...r, orders: [...r.orders, order].slice(-FUND_ORDERS_KEPT), fullNeedYocto: needYocto.toString(), away: false });
      return this.fundStatus();
    }
    if (!(await this.fundWallets())) throw new ProblemError(securityProblems.fundCoinUnknown());
    // Only a chain with a private route (fund-start.ts fundOffered): never the public quote any more. D155: SOL, ETH (RH)
    // and every other chain's own coin NEAR Intents takes (setup-coins.ts), all through the same one-time address.
    if (coin.chain !== "sol" && coin.chain !== "hood" && !setupCoin(coin.chain)) throw new ProblemError(securityProblems.fundCoinUnknown());
    const have = (await this.chain.account(fundAddress, await this.chain.commonBlock()))?.balanceYocto ?? 0n;
    // What the account still needs: an earlier coin may have brought part of it already.
    const still = needYocto > have ? needYocto - have : 0n;
    if (still === 0n) return this.fundStatus();
    // The private route (fund-start.ts, the Home plan §4): a one-time address into the person's own confidential balance,
    // refunds there too, then NEAR on to the setup address (float-add.ts addSetup). Sized at the core's own NEAR price
    // for what is still needed, with room; 1Click's signed quote is checked in the core's float moves.
    const nearUsd = await this.sheetNearUsd().then((v) => v ?? this.nativeUsd("near")).catch(() => null);
    if (!nearUsd || nearUsd <= 0) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
    const usd = (Number(still) / 1e24) * nearUsd * FUND_PRIVATE_ROOM;
    const addKey = `fund-${hex(crypto.getRandomValues(new Uint8Array(12)))}`;
    const a = await this.subwallets.addQuote(coin.chain, undefined, addKey, undefined, { address: fundAddress, usd });
    const order: FundOrder = {
      coinId: coin.id, depositAddress: a.depositAddress, refundTo: "", fundAddress, needYocto: still.toString(), amountIn: a.amountIn, minAmountIn: a.minAmountIn,
      amountInUsd: usd.toFixed(2), deadlineIso: a.deadlineIso ?? a.untilIso, startedAtMs: Date.now(),
      // 1Click's time and the move on's own half a minute (D137: no private gap before it)
      ...(a.etaSeconds ? { etaSeconds: a.etaSeconds + 30 } : {}),
      route: "private", addKey,
    };
    await this.fundKeep({ ...r, orders: [...r.orders, order].slice(-FUND_ORDERS_KEPT), fullNeedYocto: needYocto.toString(), away: false });
    return this.fundStatus();
  }

  /** The background opening, once: the checklist's "Opening your account" runs here, whether or not a screen is up. */
  private fundOpening: Promise<void> | null = null;
  private fundOpenFailed = false;
  /** Openings resumed by the core itself since the last Try again (finding 1): a few, never a loop. */
  private fundResumes = 0;
  /** Finding 23: tries made again after NEAR's nodes were busy, and when the next may start (0: now). */
  private fundBusyRetries = 0;
  private fundBusyUntil = 0;

  /**
   * Finding 1 (4 Nov, real money): an opening whose last step threw after its transaction landed (a slow node, a
   * confirm that timed out) waited on "Your account isn't open yet… Try again" for minutes while the chain showed the
   * account open; only a reload went on. The chain decides instead, one read a poll and only after a failure: the named
   * account made by this phone's own setup key (stage funding: the create landed though its answer didn't), or made at
   * all (stage creating: past the create). Then the opening carries on from where it stopped, which sends no money
   * again: the create runs only while the named account isn't there (createSelfFunded), the set-up only while this
   * phone's key isn't on it (setUp's alreadyIn).
   */
  private async madeOnChain(s: Saved): Promise<boolean> {
    try {
      const block = await this.chain.commonBlock();
      if (s.stage === "creating") return !!(await this.chain.account(s.accountId, block));
      const setup = await this.vault.get(SETUP_KEY);
      return s.stage === "funding" && !!setup && !!(await this.chain.accessKey(s.accountId, publicKeyFromPrivate(new TextDecoder().decode(setup)), block));
    } catch {
      return false;
    }
  }

  /**
   * The deposit watcher's read (J2): what the address holds of the coin on its own network (SOL or an SPL coin on
   * Solana; ETH or an ERC-20 on Ethereum, Base, Arbitrum, Robinhood Chain), from the free nodes the wallets already use;
   * EVM reads take the lower of two nodes. Null when it can't be read within FUND_WATCH_MS: never "nothing there".
   */
  private async depositHeld(coin: FundCoin, address: string): Promise<bigint | null> {
    const read = async (): Promise<bigint | null> => {
      // D155: only the networks the wallets already read; any other chain (Bitcoin…) is followed by 1Click's word alone
      if (coin.chain === "near" || !FUND_WATCHED.has(coin.chain)) return null;
      if (coin.chain === "sol") {
        if (!coin.token) return this.solReader.balance ? this.solReader.balance(address) : null;
        if (!this.solReader.tokenAccounts) return null;
        return (await this.solReader.tokenAccounts(address)).filter((a) => a.mint === coin.token).reduce((t, a) => t + a.amount, 0n);
      }
      const chain = coin.chain as EvmWalletChain;
      if (coin.token) return this.evmReader.tokenBalance(chain, coin.token, address);
      const rows = ((await this.evmReader.account?.(chain, address)) ?? []).filter((x): x is { latest: number; pending: number; balance: bigint } => x !== null);
      return rows.length ? rows.reduce((low, x) => (x.balance < low ? x.balance : low), rows[0].balance) : null;
    };
    // One read at a time (re-review L-D): a hung node's late read is never joined by another every 2 s.
    if (this.depositReading) return null;
    const running = read().catch(() => null);
    this.depositReading = running;
    void running.finally(() => {
      if (this.depositReading === running) this.depositReading = null;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FUND_WATCH_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    try {
      return await Promise.race([running, late]);
    } finally {
      clearTimeout(timer);
    }
  }
  private depositReading: Promise<bigint | null> | null = null;

  /** 1Click's status for an address, asked at most every fundStatusEveryMs (the screen reads every 2 s while it waits). */
  private lastStatus: { address: string; atMs: number; raw: unknown } | null = null;
  private async oneClickSlowly(address: string): Promise<unknown> {
    const last = this.lastStatus;
    if (last && last.address === address && Date.now() - last.atMs < this.fundStatusEveryMs) return last.raw;
    const raw = await this.oneClick(address).catch(() => null);
    this.lastStatus = { address, atMs: Date.now(), raw };
    return raw;
  }

  /**
   * account.fund.status: the checklist, each step from what was read (1Click's signed status for the order's address, the
   * account's setup address on two nodes, the core's own stage), never from the clock. Once the NEAR is there, the core
   * opens the account itself (account.create's own path, one at a time), so it opens with the screen closed too.
   */
  private async fundStatus(): Promise<FundView> {
    let r = await this.fundRecord();
    let order = r.orders.at(-1) ?? null;
    let coin = fundCoin(order?.coinId) ?? FUND_COINS[0];
    const s = await this.saved();
    const stage: FundFacts["stage"] = s?.stage === "ready" ? "ready" : s?.stage === "needs-backup" ? "needs-backup" : s?.stage === "creating" ? "creating" : "needs-funding";
    if (!order) {
      if (stage === "ready" || stage === "needs-backup" || !s) throw new ProblemError(securityProblems.fundNotOpening());
    }
    const opened = stage === "ready" || stage === "needs-backup";
    const target = order ? null : await this.fundTarget();
    const fundAddress = order?.fundAddress ?? target!.fundAddress;
    // finding 23: the setup address and the account it opens are the account's own reads (D111): the relay's paid door
    if (this.chain.network === "mainnet" && !opened) proxyOpening(s ? [fundAddress, s.accountId] : [fundAddress]);
    const fullNeed = BigInt(r.fullNeedYocto ?? order?.needYocto ?? target!.needYocto);
    // The setup address's own NEAR, on two nodes (an earlier coin's, or NEAR sent by hand, count too). A failed read is
    // unread (null), never "nothing there"; an address that doesn't exist yet holds nothing.
    let haveYocto: bigint | null = null;
    if (!opened) {
      const acct = await this.chain.commonBlock().then((b) => this.chain.account(fundAddress, b)).then((x) => x, () => undefined);
      haveYocto = acct === undefined ? null : acct?.balanceYocto ?? 0n;
    }
    // O-2c review M: NEAR at the setup address (or an opening under way) with no address on record (sent straight to
    // the address account.create gave, or a record from before): kept as a NEAR order, so every screen shows its
    // checklist (waiting for the words, or opening), never the coins while the account opens.
    if (!order && !opened && target && (stage === "creating" || (haveYocto !== null && haveYocto >= fullNeed))) {
      const need = target.needYocto.toString();
      const kept: FundOrder = { coinId: "near", depositAddress: fundAddress, refundTo: fundAddress, fundAddress, needYocto: need, amountIn: need, minAmountIn: need, deadlineIso: "", startedAtMs: Date.now() };
      await this.fundKeep({ ...r, orders: [kept], fullNeedYocto: r.fullNeedYocto ?? need });
      r = await this.fundRecord();
      order = kept;
      coin = FUND_COINS[0];
    }
    // the private route's word comes from the core's own job (its quote checked there, read through the pinned relay);
    // an order from before, from 1Click's signed status as it was
    const swap = order && order.coinId !== "near" && !opened
      ? order.route === "private" ? await this.subwallets.setupFacts(order.addKey!, this.fundStatusEveryMs).catch(() => null) : readSwap(await this.oneClickSlowly(order.depositAddress), order, Date.now(), this.quoteKey ?? undefined)
      : null;
    // An opening already begun (the named account made, the setup address spent or gone) carries on from where it
    // stopped whatever the address holds now (security review 2 Nov: it never resumed, and the screen asked again).
    const begun = stage === "creating";
    const arrived = begun || (haveYocto !== null && haveYocto >= fullNeed);
    // O-2c: the NEAR is here but the words aren't checked: it waits at the setup address, nothing opens yet.
    const waitsForWords = arrived && !begun && !opened && (await this.wordsWait(s));
    // A failed opening waits for the person's Try again (account.fund.note { retry }), never a loop of tries, unless the
    // chain already shows what it made (finding 1): then the core carries on by itself, a few times at most.
    const resume = !opened && !!s && this.fundOpenFailed && !this.fundOpening && this.fundResumes < FUND_RESUMES_MAX && (await this.madeOnChain(s));
    if (resume) this.fundResumes++;
    if ((arrived || resume) && !opened && !waitsForWords && !this.fundOpening && (resume || !this.fundOpenFailed) && Date.now() >= this.fundBusyUntil) {
      // The rest beyond the opening, as it stood when the opening began: what the checklist's last step moves to Private.
      if (r.haveAtOpen === undefined && haveYocto !== null && haveYocto >= fullNeed) await this.fundKeep({ ...r, haveAtOpen: haveYocto.toString(), needAtOpen: fullNeed.toString() });
      this.fundOpenFailed = false;
      this.fundOpening = this.createOnce({}).then(
        () => {
          this.fundBusyRetries = 0;
          this.fundBusyUntil = 0;
        },
        (e) => {
          // NEAR's nodes busy (429) or unreachable: nothing was decided, so the core tries again by itself, spaced out
          // (finding 23); only another kind of failure, or the last of those tries, waits for the person's Try again
          if (e instanceof ProblemError && e.problem.code === "security.nodes.unreachable" && this.fundBusyRetries < FUND_BUSY_RETRIES) {
            this.fundBusyUntil = Date.now() + Math.min(FUND_BUSY_MAX_MS, this.fundBusyFirstMs * 2 ** this.fundBusyRetries);
            this.fundBusyRetries++;
            return;
          }
          this.fundOpenFailed = true;
        },
      ).finally(() => {
        this.fundOpening = null;
      });
    }
    const kept = await this.fundRecord();
    // The deposit watcher (J2): the deposit address on the coin's own network, read on free nodes each time the screen
    // asks (every two seconds while it waits), so money shows within seconds of its block, before 1Click's own word.
    // Display only: it ticks "seen" and starts the ETA; 1Click's signed status and the NEAR on chain decide the rest.
    let onChain: bigint | null = null;
    let watched = order;
    if (order && order.coinId !== "near" && !opened && !arrived && (!swap || swap.status === "PENDING_DEPOSIT")) {
      // Past the address's hour the network isn't read again (review L4): only what was seen in time counts.
      const live = Date.parse(shownUntil(order)) > Date.now();
      const read = overBase(live ? await this.depositHeld(coin, order.depositAddress) : null, order);
      onChain = read.arrived;
      const more = read.arrived !== null && read.arrived > BigInt(order.seenUnits ?? "0");
      if (read.base !== undefined || more) watched = { ...order, ...(read.base !== undefined ? { baseUnits: read.base } : {}), ...(more ? { seenUnits: read.arrived!.toString() } : {}) };
    }
    // When money was first seen (the watcher's word or 1Click's): the start of the swap's live ETA.
    if (watched && watched.seenAtMs === undefined && ((onChain ?? 0n) > 0n || (swap !== null && swap.status !== "PENDING_DEPOSIT"))) watched = { ...watched, seenAtMs: Date.now() };
    if (watched && watched !== order) {
      // Read the record again right before writing (the read above can take seconds; a new address or a note may have
      // been kept meanwhile: review M2), and patch only this address's order, never the rest.
      const now = await this.fundRecord();
      const w = watched;
      if (now.orders.some((o) => o.depositAddress === w.depositAddress)) await this.fundKeep({ ...now, orders: now.orders.map((o) => (o.depositAddress === w.depositAddress ? { ...o, baseUnits: w.baseUnits ?? o.baseUnits, seenUnits: w.seenUnits ?? o.seenUnits, seenAtMs: o.seenAtMs ?? w.seenAtMs } : o)) });
    }
    const restYocto = kept.haveAtOpen && kept.needAtOpen ? BigInt(kept.haveAtOpen) - BigInt(kept.needAtOpen) : 0n;
    const nearUsd = await this.sheetNearUsd().then((v) => v ?? this.nativeUsd("near")).catch(() => null);
    const restWorth = restYocto > 0n && (nearUsd ? (Number(restYocto) / 1e24) * nearUsd >= FUND_REST_MIN_USD : restYocto >= FUND_REST_MIN_YOCTO);
    const rest = restWorth ? { yocto: restYocto, moved: kept.restMoved === true, moving: !!kept.restMovementId && kept.restMoved !== true } : null;
    const { state, steps } = fundSteps({ order: watched, coin, swap, onChain, haveYocto, needYocto: fullNeed, stage, opening: !!this.fundOpening, openFailed: this.fundOpenFailed, rest, nowMs: Date.now() });
    const changing = steps.some((x) => x.key === "near" && x.state === "now");
    const etaIso = changing && watched?.seenAtMs && watched.etaSeconds ? new Date(watched.seenAtMs + watched.etaSeconds * 1000).toISOString() : undefined;
    const wordsDone = stage === "ready" || (stage !== "needs-backup" && (await this.wordsCheckedFirst()));
    const usdOf = (units: string, ofUnits: string, usd?: string) => (usd && /^\d+(\.\d+)?$/.test(usd) && BigInt(ofUnits) > 0n ? ((Number(usd) * Number(units)) / Number(ofUnits)).toFixed(2) : undefined);
    const nearDollars = (yocto: bigint) => (nearUsd ? ((Number(yocto) / 1e24) * nearUsd).toFixed(2) : undefined);
    const owed = coin.id === "near" ? (haveYocto !== null && haveYocto < fullNeed ? fullNeed - haveYocto : fullNeed) : null;
    return {
      coin: { id: coin.id, symbol: coin.symbol, name: coin.name, network: coin.network },
      state,
      steps,
      stage: stage === "ready" || stage === "needs-backup" ? stage : "needs-funding",
      away: kept.away === true,
      ...(waitsForWords ? { waitsForWords: true as const } : {}),
      ...(order
        ? {
            deposit: coin.id === "near"
              ? { address: fundAddress, amount: coinText(owed!, 24), minimum: coinText(owed!, 24), ...(nearDollars(owed!) ? { usd: nearDollars(owed!) } : {}), untilIso: "" }
              : {
                  address: order.depositAddress,
                  ...(order.memo ? { memo: order.memo } : {}),
                  amount: coinText(order.amountIn, coin.decimals),
                  minimum: coinText(order.minAmountIn, coin.decimals),
                  ...(usdOf(order.amountIn, order.amountIn, order.amountInUsd) ? { usd: usdOf(order.amountIn, order.amountIn, order.amountInUsd) } : {}),
                  ...(usdOf(order.minAmountIn, order.amountIn, order.amountInUsd) ? { minimumUsd: usdOf(order.minAmountIn, order.amountIn, order.amountInUsd) } : {}),
                  untilIso: shownUntil(order),
                },
            // the private route names no wallet: a refund goes to the person's own confidential balance
            ...(order.refundTo ? { refundTo: order.refundTo } : {}),
          }
        : {}),
      wordsDone,
      ...(etaIso ? { etaIso } : {}),
      ...(swap?.depositedIn ? { arrived: coinText(swap.depositedIn, coin.decimals, "down") } : coin.id === "near" && haveYocto ? { arrived: coinText(haveYocto, 24, "down") } : onChain ? { arrived: coinText(onChain, coin.decimals, "down") } : {}),
      ...(swap?.refunded ? { refunded: coinText(swap.refunded, coin.decimals, "down") } : {}),
      ...(rest ? { rest: { near: coinText(rest.yocto, 24, "down"), ...(nearDollars(rest.yocto) ? { usd: nearDollars(rest.yocto) } : {}), ...(kept.restMovementId ? { movementId: kept.restMovementId } : {}) } } : {}),
    };
  }

  /**
   * account.fund.note: what the page tells the core to keep for the checklist: `away` (the person closed the screen and
   * went into the app), the rest's move into Private (`restMovementId`, then `restMoved` once Wallet's own record of it
   * reads done), or `finished` (the checklist was seen done: the record goes). Nothing here moves money.
   */
  private async fundNote(p: Record<string, unknown>): Promise<{ ok: true }> {
    const r = await this.fundRecord();
    if (p.finished === true) {
      await this.vault.delete(FUND_ORDERS);
      return { ok: true };
    }
    const next: FundRecord = { ...r };
    if (typeof p.away === "boolean") next.away = p.away;
    if (typeof p.restMovementId === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(p.restMovementId)) next.restMovementId = p.restMovementId;
    if (p.restMoved === true && next.restMovementId) next.restMoved = true;
    if (p.retry === true) {
      this.fundOpenFailed = false;
      this.fundResumes = 0;
      this.fundBusyRetries = 0;
      this.fundBusyUntil = 0;
    }
    await this.fundKeep(next);
    return { ok: true };
  }

  /**
   * A coin's address stays live at 1Click past the opening (its signed deadline: 3 days on a FLEX quote), and it pays
   * NEAR to the setup address, which the opening deleted (security review 2 Nov: NEAR landing there later would recreate
   * it under a key nobody held). So the setup key is kept, apart, until every address asked for has run out and a day
   * more, and whatever lands there is swept into the account (fundSweepLate).
   */
  private async keepLateKey(setupPrivate: string, accountId: string): Promise<void> {
    const r = await this.fundRecord();
    const until = Math.max(0, ...r.orders.filter((o) => o.coinId !== "near").map((o) => Date.parse(o.deadlineIso)).filter(Number.isFinite));
    if (!until) return;
    await this.vault.put(FUND_LATE_KEY, utf8(JSON.stringify({ key: setupPrivate, accountId, untilMs: until + 86_400_000 })));
  }

  private lateSweptAt = 0;
  /** Late NEAR at the old setup address goes into the account; once the last address has run out and it is empty, the key goes. */
  private async fundSweepLate(): Promise<void> {
    if (Date.now() - this.lateSweptAt < 10 * 60_000) return;
    this.lateSweptAt = Date.now();
    const raw = await this.vault.get(FUND_LATE_KEY);
    if (!raw) return;
    const late = JSON.parse(new TextDecoder().decode(raw)) as { key: string; accountId: string; untilMs: number };
    const pub = publicKeyFromPrivate(late.key);
    const address = hex(fromBase58(pub.slice("ed25519:".length)));
    const here = await this.chain.account(address, await this.chain.commonBlock());
    if (here && here.balanceYocto > 0n) await this.emptySetupAddress(address, late.accountId, pub, late.key);
    else if (!here && Date.now() > late.untilMs) await this.vault.delete(FUND_LATE_KEY);
  }

  /** account.create, one at a time: a second ask while one runs gets the same answer (never two creates at once). */
  private creatingNow: Promise<AccountInfo | Funding> | null = null;
  private createOnce(p: Record<string, unknown>): Promise<AccountInfo | Funding> {
    if (this.creatingNow) return this.creatingNow;
    const run = this.create(p).finally(() => {
      if (this.creatingNow === run) this.creatingNow = null;
    });
    this.creatingNow = run;
    return run;
  }

  /** The one setup transaction on a brand-new account the classical setup key controls. */
  private async setUp(accountId: string, wasm: Uint8Array, withRules: boolean, setupPrivate: string, selfFunded: boolean): Promise<AccountInfo> {
    const setupPublic = publicKeyFromPrivate(setupPrivate);
    const device = await this.deviceKey();
    // Self-funded: the account holds the person's NEAR, so a failure here keeps the setup key and can be retried.
    const giveUp = async () => {
      if (!selfFunded) await this.forget();
    };
    // One transaction, signed by the throwaway classical key: add the post-quantum device key, install the account's
    // rules, and delete the classical key. It only touches the brand-new, empty account, so no approval is asked.
    // With the account contract, the device key can only call the contract's device methods: no full-access key remains.
    const setup = new DevSigner({
      accountId,
      chain: this.chain,
      key: { publicKey: setupPublic, signHash: async (h) => signClassical(h, setupPrivate) as Uint8Array },
      approve: async () => true,
    });
    // With the account contract, the backup words' recovery key goes in the same transaction (its first one needs only
    // the Face ID level, and the setup is the account itself), so the first run has one sheet, not two. The words are
    // made now and kept in this device's vault until they are shown on screen and checked (wordsHere, confirm).
    // The new account's bands, before anything is sent: DEFAULT_PROTECTION in dollars at today's prices. No prices, no
    // account set up yet.
    const bands = !withRules ? null : this.protection ?? (await this.prices().then((prices) => contractBands(defaultBands(this.chain.network), prices, this.chain.network)).catch(async (e) => {
      await giveUp();
      throw e instanceof ProblemError ? e : new ProblemError(securityProblems.nodesUnreachable());
    }));
    // A browser (audit K-2) never keeps words no one has seen: its words are made when they are shown, in memory only,
    // and their key goes on chain once three are checked (confirm: the first backup key goes at once). A page closed
    // before then leaves no key nobody wrote down; the words just change.
    const pending = withRules && !this.secretsInMemory ? await this.pendingWords() : null;
    // These words are the account's from the start: the hot wallets come from them too (hot-keys.ts).
    if (pending) await this.keepHotRoot(pending);
    const recoveryKey = pending ? SoftwareKey.fromSeed(pending, "recovery-words") : null;
    const recoveryPublic = recoveryKey?.publicKey ?? null;
    recoveryKey?.destroy();
    // Resumed after the setup transaction already went through: go straight to checking it.
    // The first-run screen's three lines (account.create.step): the account, then its key and rules, then the check.
    this.emit("account.create.step", { step: 2 });
    const alreadyIn = selfFunded && !!(await this.chain.accessKey(accountId, device.publicKey, await this.chain.commonBlock()));
    // The rules by hash once the release is published as a global contract (the contract review's FI-2: no 232 KB copy per
    // account), else this build's own copy. Either way the check below holds the account to the pinned code hash.
    const install: CoreAction = !alreadyIn && withRules && (await this.rulesPublished()) ? { kind: "use-global", codeHash: fromBase58(ACCOUNT_POLICY.codeHashBase58) } : { kind: "deploy", code: wasm };
    const outcome: TxOutcome = alreadyIn ? { status: "done", txHash: "", explorerUrl: "" } : await setup.run(accountId, [
      {
        kind: "add-key",
        publicKey: device.publicKey,
        permission: withRules ? { kind: "function-call", receiverId: accountId, methods: [...ACCOUNT_POLICY.deviceMethods], allowanceYocto: null } : { kind: "full" },
      },
      install,
      // Release 5 on: the contract is told its phone, so it knows its device keys from the start (audit F1).
      withRules ? call("new", { recovery_delay_seconds: String(await this.chosenDelay()), bands, device_key: borshKey(device.publicKey) }) : call("new", { delay_seconds: String(await this.chosenDelay()) }),
      ...(recoveryPublic ? [call("set_recovery_key", { public_key: borshKey(recoveryPublic) }, ownCallGas("SetRecoveryKey"))] : []),
      { kind: "delete-key", publicKey: setupPublic },
    ]);
    if (outcome.status !== "done") {
      await giveUp();
      throw new ProblemError(outcome.status === "problem" ? outcome.problem : securityProblems.accountCreateFailed());
    }
    // When the rules went in: the contract's first 24 hours are its set-up window (audit F1), and the sheet says so.
    if (!alreadyIn) await this.vault.put(CREATED_AT, utf8(String(Date.now())));

    // Check the result on two nodes: the post-quantum device key, the backup words' recovery key (only its two
    // methods) when it went in too, nothing else, and the official rules installed.
    this.emit("account.create.step", { step: 3 });
    const block = await this.chain.commonBlock();
    const [keys, acct] = await Promise.all([this.chain.accessKeys(accountId, block), this.chain.account(accountId, block)]);
    const deviceOk = keys.some((k) => k.handle === handleOf(device.publicKey) && (withRules ? k.permission.kind === "function-call" && isDeviceKey(k.permission, accountId) : k.permission.kind === "full"));
    const recoveryOk = !recoveryPublic || keys.some((k) => k.handle === handleOf(recoveryPublic) && k.permission.kind === "function-call" && k.permission.receiverId === accountId && k.permission.methods.join() === RECOVERY_POLICY.recoveryKeyMethods.join());
    const onlyDevice = keys.length === (recoveryPublic ? 2 : 1) && deviceOk && recoveryOk;
    const expectedCode = !withRules ? RECOVERY_POLICY.codeHashBase58 : hex(sha256(wasm)) === ACCOUNT_POLICY.shortWaits.sha256Hex ? ACCOUNT_POLICY.shortWaits.codeHashBase58 : ACCOUNT_POLICY.codeHashBase58;
    if (!onlyDevice || codeOf(acct) !== expectedCode) {
      await giveUp();
      throw new ProblemError(securityProblems.accountCreateFailed());
    }
    await this.vault.delete(DELAY_CHOICE);
    await this.keepLateKey(setupPrivate, accountId);
    await this.vault.delete(SETUP_KEY);
    // Words first (J2): the key that just went in is from the very words checked before the money: the account is
    // ready, with no second words step. Otherwise the words come now, as before.
    const checkedFirst = !!recoveryPublic && !!pending && (await this.wordsCheckedFirst(pending));
    await this.save({ accountId, stage: checkedFirst ? "ready" : "needs-backup", ...(recoveryPublic ? { recoveryIn: true } : {}) });
    if (checkedFirst) await this.dropPendingWords();
    return (await this.deviceSigner(accountId)).account();
  }

  /**
   * True only when two nodes show the pinned account contract published under its code hash, with the pinned code's
   * sha256. Anything else (none published, another copy, nodes that disagree or don't answer): false, and set-up deploys
   * its own copy, as before the publish.
   */
  private async rulesPublished(release: { codeHashBase58: string; sha256Hex: string } = ACCOUNT_POLICY): Promise<boolean> {
    if (!this.chain.globalContractSha256) return false;
    try {
      return (await this.chain.globalContractSha256(release.codeHashBase58, await this.chain.commonBlock())) === release.sha256Hex;
    } catch {
      return false;
    }
  }

  private async waitForAccount(accountId: string): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const block = await this.chain.commonBlock();
      if (await this.chain.account(accountId, block)) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new ProblemError(securityProblems.accountCreateFailed());
  }

  /** Remove another phone's key, e.g. the lost one after a recovery. Never this device's key, never the backup key. */
  private async removeKey(handle: unknown): Promise<TxOutcome> {
    const signer = await this.ready();
    const accountId = signer.accountId;
    const block = await this.chain.commonBlock();
    const target = (await this.chain.accessKeys(accountId, block)).find((k) => k.handle === handle);
    if (!target) throw new ProblemError(securityProblems.requestInvalid("That key isn't on your account."));
    if (target.handle === handleOf((await this.deviceKey()).publicKey)) {
      throw new ProblemError(securityProblems.requestNotAllowed("This device can't remove its own key."));
    }
    const isDevice = isDeviceKey(target.permission, accountId) || (target.permission.kind === "function-call" && isSecondDeviceMethods(target.permission.methods));
    if (!isDevice) throw new ProblemError(securityProblems.requestNotAllowed("The backup key changes only with new backup words."));
    // the audit (rule 1): with the account contract, a key goes only through its remove_key, which takes post-quantum keys only
    // (lib.rs). A classical key there is refused before anything is signed, never a sheet that fails on chain.
    const rules = await this.hasRules(accountId, block);
    if (rules && !target.handle.startsWith("ml-dsa-65")) throw new ProblemError(securityProblems.requestNotAllowed("This older key can only be replaced from its own device. Replace it from that device."));
    // NEAR needs the full key to remove it. The contract's own record of its second devices first (H09: the laptop's key
    // was added by the contract's own receipt, so no transaction's add-key names it), then the history. Either is only a
    // hint: the key must hash to the handle two nodes listed.
    const mine = (keys: string[]) => keys.find((k) => k.startsWith("ml-dsa-65:") && handleOf(k) === target.handle);
    // A classical key (a leftover set-up key, Security's Quantum-safe sheet) is listed as its own full text; never a
    // second device's (a release-4 laptop's key came in the contract's receipt, so it takes the update path below).
    const secondDevice = target.permission.kind === "function-call" && isSecondDeviceMethods(target.permission.methods);
    const full = target.handle.startsWith("ed25519:") && !secondDevice ? target.handle : mine(await this.secondDeviceKeys(accountId, block)) ?? mine(await this.chain.keysFromHistory(accountId));
    // Before release 6 the contract keeps no record of a second device's full key, and its key came in the contract's own
    // receipt, so no history names it: a retry can never find it. Say so, and the step that works (proof r4, the audit's rule 8).
    if (!full) {
      const code = codeOf(await this.chain.account(accountId, block));
      const offer = policyVersion(code, this.chain.network) < 6 ? offeredUpdateFor(code, this.chain.network) : null;
      throw new ProblemError(offer && (await this.rulesPublished(offer)) ? securityProblems.removeNeedsUpdate() : securityProblems.keyNotFound());
    }
    // With the account contract, removing a key goes through its strictest protection (it may wait).
    return rules ? signer.run(accountId, [call("remove_key", { public_key: borshKey(full) })]) : signer.run(accountId, [{ kind: "delete-key", publicKey: full }]);
  }

  /**
   * The full keys of the account's second devices, from the contract's own record (second_device_ages, release 6 on),
   * read at `block`. The history can't name them: the contract adds a second device's key in its own receipt, never as
   * a transaction's add-key (H09, a lost laptop's removal; and its refill). An older release: none.
   */
  private async secondDeviceKeys(accountId: string, block: Block): Promise<string[]> {
    const view = await this.chain.view(accountId, "second_device_ages", {}, block).catch(() => null);
    return Array.isArray(view) ? view.map((row) => (Array.isArray(row) && typeof row[0] === "string" ? mlDsaHandle(row[0]) : null)).filter((k): k is string => k !== null) : [];
  }

  /** The account's own history, in words, with which key signed each step. Reading only. */
  private async activity(limit: unknown): Promise<ActivityItem[]> {
    const s = await this.saved();
    if (!s || s.stage === "creating") throw new ProblemError(securityProblems.accountNone());
    const n = typeof limit === "number" && Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
    // k-security crawl (4 Nov, S3: "Reading your account's history…", then "NEAR is busy right now"): the rows come from
    // FastNEAR's history index, so busy NEAR nodes no longer hold them back. The keys (who signed) and the waiting list
    // are read on the nodes beside it; when those don't answer the rows still show, with "Another key" (activityItem).
    const head = this.chain.commonBlock().catch(() => null);
    const [past, block] = await Promise.all([this.chain.pastTransactions(s.accountId, n), head]);
    const keys = block ? await this.chain.accessKeys(s.accountId, block).catch(() => null) : null;
    const mine = handleOf((await this.deviceKey()).publicKey);
    // A change saved to wait says "waiting" only while the account still holds it (read only when a row needs it).
    const waiting = block && past.some((tx) => tx.held)
      ? new Set((((await this.chain.view(s.accountId, "waiting_requests", {}, block).catch(() => null)) as { id?: unknown }[] | null) ?? []).map((w) => String(w?.id)))
      : undefined;
    return past.map((tx) => activityItem(tx, keys, mine, this.chain.network, waiting));
  }

  // ── Protection by amount (the account contract) ──

  /** Is the account contract (protection by amount) on this account? Checked by its code hash, on two nodes. */
  private async hasRules(accountId: string, at?: Block): Promise<boolean> {
    const block = at ?? (await this.chain.commonBlock());
    return isAccountPolicy(codeOf(await this.chain.account(accountId, block)), this.chain.network);
  }

  private async rulesSigner(at?: Block): Promise<DevSigner> {
    const signer = await this.ready();
    if (!(await this.hasRules(signer.accountId, at))) throw new ProblemError(securityProblems.methodUnknown("Your account's rules are an older version. They have no payment limits. Update them in Security."));
    return signer;
  }

  /**
   * The account's protection as the contract holds it (`bands`), and the same in dollars (`usd`, see usdBands) so the
   * Protection screen opens on the account's real rules. A price is read only when a limit is in NEAR alone (testnet).
   */
  private async protectionGet(at?: { signer: DevSigner; block: Block; prices?: Promise<Prices>; count?: false }): Promise<{ bands: unknown; secondDevices: number; usd: ProtectionBand[] | null }> {
    const signer = at?.signer ?? (await this.ready());
    const block = at?.block ?? (await this.chain.commonBlock());
    // The rules (and the count, for the screen) are asked beside the check that this account has rules, at the same block
    // (speed, 2 Nov: one round trip, not two), and used only once it has. Save reads no count: nothing in it uses one.
    const reads = Promise.all([this.chain.view(signer.accountId, "protection", {}, block), at?.count === false ? 0 : this.chain.view(signer.accountId, "second_device_count", {}, block)]);
    void reads.catch(() => undefined);
    if (!(await this.hasRules(signer.accountId, block))) throw new ProblemError(securityProblems.methodUnknown("Your account's rules are an older version. They have no payment limits. Update them in Security."));
    const [bands, secondDevices] = await reads;
    // One price for the page, its sheet and the Waiting screen (L11): the sheet's own, kept a minute.
    let usd = usdBands(bands, null);
    if (!usd && Array.isArray(bands) && bands.length) usd = usdBands(bands, (await this.sheetNearUsd()) ?? (await (at?.prices ?? this.prices()).then((p) => p.near, () => null)));
    return { bands, secondDevices: Number(secondDevices ?? 0), usd };
  }

  /** Send's own read (audit 10's A4, 8 Nov): the rules plus what one Send from the Safe can still take today, its fill
   *  included (send-fill.ts sendRoom over the contract's band state, the figure the over-limit refusal says), so Send's
   *  "ready" and Max never offer what the rules refuse. Asked only with `room` (the spent read is Send's alone, never
   *  Protection's or Home's). No figure: the rules have no Face ID band in coins, or the spent read failed. */
  private async protectionRoom(): Promise<{ bands: unknown; secondDevices: number; usd: ProtectionBand[] | null; sendLeftUsd?: number }> {
    const signer = await this.ready();
    const block = await this.chain.commonBlock();
    const spentP = this.chain.view(signer.accountId, "spent_today", {}, block).catch(() => undefined);
    const got = await this.protectionGet({ signer, block });
    const spent = await spentP;
    if (spent === undefined) return got;
    const room = (await import("./send-fill.ts")).sendRoom(got.bands, spent);
    return room ? { ...got, sendLeftUsd: room.leftUsd } : got;
  }

  /** Dollar bands → coin amounts at today's prices, fixed when saved; then the contract's set_protection (approval sheet). */
  private async protectionSet(raw: unknown): Promise<TxOutcome> {
    // Speed (2 Nov; 6.6 s to the sheet in grade 02e): what the sheet needs goes out at once, not one round trip after
    // another. 1Click's prices are public and wait for nothing of the account's. The rules as they stand and the sheet's
    // own reads are asked at one block, beside the check that the account has rules. Nothing is decided earlier than before.
    const pricesP = this.prices();
    void pricesP.catch(() => undefined);
    const ready = await this.ready();
    const block = await this.chain.commonBlock();
    const nowP = this.protectionGet({ signer: ready, block, prices: pricesP, count: false }).catch(() => null);
    ready.warm([{ receiverId: ready.accountId, actions: [call("set_protection")] }], block);
    const signer = await this.rulesSigner(block);
    const bands = Array.isArray(raw) ? (raw as ProtectionBand[]) : [];
    const valid =
      bands.length >= 1 &&
      bands.length <= 8 &&
      bands.every((b, i) => (i === bands.length - 1 ? b?.upToUsd === null : typeof b?.upToUsd === "number" && b.upToUsd > 0 && b.upToUsd <= 1e9)) &&
      bands.every((b) => ["faceid", "wait", "device", "both"].includes(b?.level) && (b.level === "faceid" || b.level === "device" || (Number.isInteger(b.waitSeconds) && b.waitSeconds! >= 60 && b.waitSeconds! <= 31 * 86_400)));
    // 31 days, as the contract (the contract review, FB-4): the wait a band gets when the last second device goes can be the
    // floor of a 30-day delay, and the person can then save those rules again.
    if (!valid) throw new ProblemError(securityProblems.requestInvalid("Give one to eight payment sizes, smallest first. The last one has no limit. Each wait is 1 minute to 31 days."));
    const [prices, now] = await Promise.all([pricesP, nowP]);
    const onChain = keepUntouched(contractBands(bands, prices, this.chain.network), bands, now?.bands, now?.usd ?? null);
    return signer.run(signer.accountId, [call("set_protection", { bands: onChain })]);
  }

  // ── Agent (the account contract v3) ──

  /** The device signer, on an account whose contract has Agent (v3 on, not the current release; by code hash on two nodes). */
  private async modulesSigner(): Promise<DevSigner> {
    const signer = await this.ready();
    const block = await this.chain.commonBlock();
    // Agent: release 3/4 (modules) or release 10 (its own key with a daily limit, D57: only once the person updated).
    const code = codeOf(await this.chain.account(signer.accountId, block));
    if (!hasModules(code, false, this.chain.network) && !hasAgent(code, this.chain.network)) {
      throw new ProblemError(securityProblems.methodUnknown("This account's rules don't have AgentZero."));
    }
    return signer;
  }

  // ── The account's rules: which release it runs, and the update to ZeroFee's current one (D57, 2 Nov) ──

  /**
   * The release the account runs (`release`), the one it is offered (`current`: ZeroFee's current release from release 2
   * to 8, release 10 from release 9), and, when that one can be installed, `update`: the wait the account's own rules put
   * on it (its strictest band, as any key change). Offered only for one of ZeroFee's own releases (by code hash), and only
   * when two nodes show the offered release published under its pinned hash with its pinned sha256.
   * Release 9 on, a release must be on the account's own list first (`allowed_releases`). Its `upgrade` places that
   * listing (AllowRelease), which runs after the words-only fallback wait (or with a second device's yes, held that long):
   * `listFirst` says so, `waitSeconds` is the listing's wait and `thenWaitSeconds` the switch's own wait after it.
   */
  private async rulesInfo(): Promise<{ release: number; current: number; update?: { waitSeconds: number; needsSecondDevice: boolean; listFirst?: true; thenWaitSeconds?: number; waiting?: { id: string; readyAtIso: string } } }> {
    const signer = await this.ready();
    const block = await this.chain.commonBlock();
    const code = codeOf(await this.chain.account(signer.accountId, block));
    const release = policyVersion(code, this.chain.network);
    const offer = offeredUpdateFor(code, this.chain.network);
    const current = offer?.version ?? Math.max(release, policyVersion(ACCOUNT_POLICY.codeHashBase58));
    if (!offer || !(await this.rulesPublished(offer))) return { release, current };
    const [bands, held, listed] = await Promise.all([
      this.chain.view(signer.accountId, "protection", {}, block),
      this.chain.view(signer.accountId, "waiting_requests", {}, block),
      release >= 9 ? this.chain.view(signer.accountId, "allowed_releases", {}, block) : Promise.resolve(null),
    ]);
    const strictest = (Array.isArray(bands) ? (bands as { level: PolicyLevel }[]).at(-1)?.level : undefined) ?? "FaceId";
    // The wait the contract really gives the upgrade: its strictest band; from release 5 at least its floor (audit F1).
    const level = release >= 5 ? await this.changeLevel(signer.accountId, "upgrade", strictest, block) : strictest;
    const levelWait = typeof level === "object" ? Number("Wait" in level ? level.Wait.seconds : level.Both.seconds) : 0;
    const needsSecondDevice = level === "Device" || (typeof level === "object" && "Both" in level);
    const waits = Array.isArray(held) ? (held as { id?: unknown; change?: { Upgrade?: { code_hash?: unknown }; AllowRelease?: { code_hash?: unknown; asked_at_ns?: unknown } }; ready_at_ns?: unknown; approved?: unknown }[]) : [];
    const isOffer = (h: unknown) => shaHexOf(h) === offer.sha256Hex;
    const said = (w: (typeof waits)[number], readyNs: bigint) => ({ id: String(w.id), readyAtIso: new Date(Number(readyNs / 1_000_000n)).toISOString() });
    const onList = release < 9 || (Array.isArray(listed) && listed.some(isOffer));
    // Release 9 on: the listing first. It runs no sooner than the fallback wait from when it was asked (and its level's),
    // unless a second device said yes (the contract's own `approved`).
    const listWait = onList ? levelWait : Math.max(levelWait, await this.listingWaitSeconds(signer.accountId, block));
    const listing = onList ? undefined : waits.find((w) => isOffer(w?.change?.AllowRelease?.code_hash));
    // held.ts's one rule (listingRunsAtNs), so account.rules and account.waiting say the same time; a yes counts only from
    // second devices on the account for the fallback wait (R9-AL1), as the contract's finish.
    const yesCounts = listing?.approved === true && (await allFallbackAged(this.chain, signer.accountId, block));
    const listingReadyNs = listing && /^\d+$/.test(String(listing.change!.AllowRelease!.asked_at_ns)) ? listingRunsAtNs(listing, BigInt(listWait) * 1_000_000_000n, yesCounts) : null;
    // An update already placed: it is said as waiting, never offered twice; behind a waiting listing, no sooner than it
    // (the contract's finish refuses a switch to a release not yet on the list).
    const placed = waits.find((w) => w?.change?.Upgrade);
    if (placed && /^\d+$/.test(String(placed.ready_at_ns))) {
      const own = BigInt(String(placed.ready_at_ns));
      return { release, current, update: { waitSeconds: levelWait, needsSecondDevice, waiting: said(placed, listingReadyNs !== null && listingReadyNs > own ? listingReadyNs : own) } };
    }
    if (onList) return { release, current, update: { waitSeconds: levelWait, needsSecondDevice } };
    if (listing && listingReadyNs !== null) {
      return { release, current, update: { waitSeconds: listWait, needsSecondDevice, listFirst: true, thenWaitSeconds: levelWait, waiting: said(listing, listingReadyNs) } };
    }
    // What the person gets is said by Security (rules-update.ts), from `release`: words stay out of the core's first load.
    return { release, current, update: { waitSeconds: listWait, needsSecondDevice, listFirst: true, thenWaitSeconds: levelWait } };
  }

  /** Release 9 on: the least wait before the phone alone can put a release on the account's list: the words-only fallback
   *  (`fallback_seconds`), never less than a change's floor (the delay plus the lesser of the delay and a day). */
  private async listingWaitSeconds(accountId: string, block: Block): Promise<number> {
    const [fallback, delay] = await Promise.all([this.chain.view(accountId, "fallback_seconds", {}, block), this.chain.view(accountId, "delay_seconds", {}, block)]);
    const d = Number(delay);
    const f = Number(fallback);
    if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(f) || f <= 0) throw new ProblemError(securityProblems.nodesUnreachable());
    return Math.max(f, d + Math.min(d, 86_400));
  }

  /** Update the account's rules to the release it is offered (its compiled, published hash), through its own `upgrade` and
   *  sheet: ONE Face ID. From release 9 a release goes on the account's list first: the same transaction asks `upgrade`
   *  twice, so the first places the listing (AllowRelease) and the second, asked while it waits, the switch (lib.rs
   *  upgrade: `asked`). A listing already waiting (asked by an older app) gets only the switch. Its time is the contract's:
   *  the held screen reads it from waiting_requests (account.safeUpdate), never from this answer. */
  private async rulesUpdate(): Promise<TxOutcome> {
    const info = await this.rulesInfo();
    if (!info.update) throw new ProblemError(securityProblems.requestNotAllowed(info.release >= info.current ? "Your account already has ZeroFee's newest rules." : "Your account can't take this update right now."));
    const signer = await this.ready();
    const block = await this.chain.commonBlock();
    const offer = offeredUpdateFor(codeOf(await this.chain.account(signer.accountId, block)), this.chain.network);
    if (!offer) throw new ProblemError(securityProblems.requestNotAllowed("Your account can't take this update right now."));
    const held = (await this.chain.view(signer.accountId, "waiting_requests", {}, block)) as { change?: { Upgrade?: { code_hash?: unknown }; AllowRelease?: { code_hash?: unknown } } }[] | null;
    const waits = Array.isArray(held) ? held : [];
    if (waits.some((w) => w?.change?.Upgrade)) throw new ProblemError(securityProblems.requestNotAllowed("The update is already waiting. It goes when its wait is over."));
    const listed = waits.some((w) => shaHexOf(w?.change?.AllowRelease?.code_hash) === offer.sha256Hex);
    const sha = Uint8Array.from(offer.sha256Hex.match(/../g)!.map((h) => parseInt(h, 16)));
    const ask = () => call("upgrade", { code_hash: bytesToBase64(sha) }, UPGRADE_CALL_GAS);
    const calls = info.update.listFirst && !listed ? [ask(), ask()] : [ask()];
    const { releaseNote } = await import("./release-notes.ts");
    // Each sheet says what it does and its true wait (QA, 5 Nov): the listing (the account's own list first, the
    // switch right after it) waits the listing's wait; a switch alone waits its level's (a second device's yes never makes
    // it sooner: "Without it, it waits longer" was false on release 4). A switch behind a listing already waiting: until it.
    const u = info.update;
    const listedNow = calls.length === 2;
    const behindMs = !listedNow && u.waiting ? Date.parse(u.waiting.readyAtIso) - Date.now() : 0;
    const switchWait = duration(Math.max(u.thenWaitSeconds ?? u.waitSeconds, Math.ceil(behindMs / 1000)));
    const steps = listedNow
      ? [`First, your Safe allows the new version. That takes ${duration(u.waitSeconds)}.`, "Then it switches right away. You can cancel before that."]
      : [`Your Safe switches to the new version in ${switchWait}. You can cancel until then.`, ...(u.needsSecondDevice ? ["Your second device must also say yes. The wait stays the same."] : [])];
    const sheet: Approve = (w, next) => this.approveOnSheet({ ...w, title: "Update your Safe", lines: [releaseNote(offer.version), "Your money and settings stay as they are.", ...steps, ...w.lines.slice(-1)] }, next);
    const out = await signer.run(signer.accountId, calls, undefined, sheet);
    // The contract answers the switch with its level's time only; it runs no sooner than its listing (held.ts).
    return out.status === "waiting" && u.listFirst
      ? { ...out, readyAtIso: updateRunsAtIso(out.readyAtIso, { levelSeconds: u.thenWaitSeconds ?? u.waitSeconds, listSeconds: u.waitSeconds, listedNow, ...(u.waiting ? { listingReadyIso: u.waiting.readyAtIso } : {}) }) }
      : out;
  }

  /** The Safe's update as its card and held screen show it (safe-update.ts): the compiled offer against the code on chain,
   *  and the waiting release steps, each hash checked against this build's own list. */
  private async safeUpdate(): Promise<import("./safe-update.ts").SafeUpdate> {
    const signer = await this.ready();
    const block = await this.chain.commonBlock();
    const [rules, held, keys, yesFrom, mod] = await Promise.all([
      this.rulesInfo().catch(() => null),
      // Read or the card stays hidden: an unread list could hide unknown code behind an offer.
      this.hasRules(signer.accountId, block).then((has) => (has ? heldRequests(this.chain, signer.accountId) : [])),
      this.chain.accessKeys(signer.accountId, block).catch(() => [] as ChainKey[]),
      this.chain.view(signer.accountId, "second_device_yes_from", {}, block).catch(() => null),
      safeUpdateMod(),
    ]);
    // R9-AL1 (QA): a laptop's yes makes the update sooner only once it is on the account for the fallback wait
    // (release 10's second_device_yes_from: 0); release 9 has no such view, so it is never promised there.
    const soonerByYes = keys.some((k) => isSecondDeviceKey(k.permission, signer.accountId)) && Array.isArray(yesFrom) && yesFrom.some((d) => Array.isArray(d) && String(d[1]) === "0");
    return mod.safeUpdateOf(rules, held, soonerByYes);
  }

  /** Cancel every waiting step of the Safe's update (or of unknown code), in one transaction: one Face ID. */
  private async safeUpdateCancel(): Promise<TxOutcome> {
    const u = await this.safeUpdate();
    if (u.state === "none" || u.state === "offer") throw new ProblemError(securityProblems.waitingGone());
    const signer = await this.rulesSigner();
    const sheet: Approve = (w, next) => this.approveOnSheet({ ...w, title: u.state === "unknown" ? "Cancel the unknown code" : "Cancel your Safe's update", lines: ["Nothing changes on your account.", ...w.lines.slice(-1)] }, next);
    const out = await signer.run(signer.accountId, u.ids.map((id) => call("cancel", { id })), undefined, sheet);
    for (const id of u.ids) this.ended(id, "cancelled", out);
    return out;
  }

  /** Every step's wait is over: run them in order (the listing, then the switch) in one transaction, one Face ID. Gas:
   *  the listing is state only (held.ts YES_GAS); the switch carries upgrade_check's fixed 50 Tgas and the install. */
  private async safeUpdateFinish(): Promise<TxOutcome> {
    const u = await this.safeUpdate();
    if (u.state !== "ready") throw new ProblemError(u.state === "held" ? securityProblems.stillWaiting(u.readyAtIso) : securityProblems.waitingGone());
    const signer = await this.rulesSigner();
    const gas = u.ids.length === 2 ? [SAFE_UPDATE_LISTING_RUN_GAS, SAFE_UPDATE_SWITCH_RUN_GAS] : [RUN_GAS];
    const sheet: Approve = (w, next) => this.approveOnSheet({ ...w, title: "Finish your Safe's update", lines: [u.whatChanged, "Your money and settings stay as they are.", ...w.lines.slice(-1)] }, next);
    const out = await signer.run(signer.accountId, u.ids.map((id, i) => call("run", { id }, gas[i]!)), undefined, sheet);
    for (const id of u.ids) this.ended(id, "ran", out);
    return out;
  }

  /** One call on the account's own contract, through the approval sheet. */
  private async own(method: string, args: Record<string, unknown> = {}): Promise<TxOutcome> {
    const signer = await this.modulesSigner();
    return signer.run(signer.accountId, [call(method, args)]);
  }

  /** AgentZero's door (agent-door.ts, loaded the first time it asks): what it borrows from the core. */
  private agentCtx(): AgentCtx {
    return {
      chain: this.chain, vault: this.vault, subwallets: this.subwallets, nativeSheet: this.nativeSheet, userVerified: this.userVerified, relayBase: this.relayBase, mailOpt: this.mailOpt,
      quoter: this.quoter, quoteKey: this.quoteKey, oneClick: this.oneClick, approveOnSheet: (w, next) => this.approveOnSheet({ ...w, asker: "agent" }, next), nativeUsd: this.nativeUsd,
      ready: () => this.ready(), modulesSigner: () => this.modulesSigner(), noteMine: (a) => this.noteMine(a), cancelWaiting: (id) => this.cancelWaiting(id),
      stopped: (set) => (set === undefined ? this.agentStopped : (this.agentStopped = set)),
      ...(this.web ? { web: true } : {}),
    };
  }

  /** An app's own kinds of separate wallet (KINDS_OF): the chain wallets for Trade, Browser, Apps and Chat; Extension's
   *  linked wallet; and so on. */
  /** `see`: a list, a balance or a key shown through Wallet's Details (maySee), never a signature. */
  private async ownKind(p: Record<string, unknown>, see = false): Promise<void> {
    if (p.app === undefined) return; // ZeroFee's own screens (whoAsked: stamped SHELL_APP, or a Node process's own call)
    const app = String(p.app);
    const kinds = KINDS_OF[app];
    const refuse = () => {
      throw new ProblemError(securityProblems.requestNotAllowed("An app can only use its own separate wallets."));
    };
    if (!kinds || (p.kind !== undefined && !kinds.includes(String(p.kind)) && !(see && (SEE_KINDS[app] ?? []).includes(String(p.kind))))) refuse();
    if (p.id !== undefined) {
      const w = (await this.subwallets.list()).find((x) => x.id === p.id);
      if (!w || !(see ? maySee(app, w) : mayUse(app, w))) refuse();
    }
  }

  /** Spending's balance and its moves, and the Trade session: Trade's own (and ZeroFee's screens), no other app's (D55).
   *  `swap`: a swap inside Spending, which Home's Swap sheet in Wallet may also ask for (V4 step 5). */
  private tradeOnly(p: Record<string, unknown>, swap?: 1): void {
    if (p.app !== undefined && p.app !== "trade" && !(swap && p.app === "wallet")) throw new ProblemError(securityProblems.requestNotAllowed("Only Trade can move your NEAR wallet's money and start fast trading."));
  }

  /**
   * The level release 5 really gives a change to the rules or keys (audit F1): at least the recovery delay plus as much
   * again (up to a day more), except, in the account's first 24 hours, its set-up steps (and the first second device,
   * which goes at once). Outside a window this device knows of, the floor is said: never a shorter wait than the real one.
   * The first backup key goes at once (the words checked at set-up); new words after it wait the floor like any change
   * (re-audit 2, N1 (a)).
   */
  private async changeLevel(accountId: string, method: string, band: PolicyLevel, block: Block): Promise<PolicyLevel> {
    const created = Number(new TextDecoder().decode((await this.vault.get(CREATED_AT)) ?? new Uint8Array()));
    const settingUp = Number.isFinite(created) && created > 0 && Date.now() < created + 86_400_000;
    if (settingUp && method === "add_second_device" && Number((await this.chain.view(accountId, "second_device_count", {}, block)) ?? 0) === 0) return "FaceId";
    if (settingUp && ["set_protection", "add_second_device"].includes(method)) return band;
    if (method === "set_recovery_key" && (await this.saved())?.stage === "needs-backup") return "FaceId";
    const delay = Number(await this.chain.view(accountId, "delay_seconds", {}, block));
    if (!Number.isFinite(delay) || delay <= 0) throw new ProblemError(securityProblems.nodesUnreachable());
    const floor = delay + Math.min(delay, 86_400);
    const longer = (s: unknown) => String(Math.max(Number(s), floor));
    if (band === "FaceId") return { Wait: { seconds: String(floor) } };
    if (band === "Device") return { Both: { seconds: String(floor) } };
    if ("Wait" in band) return { Wait: { seconds: longer(band.Wait.seconds) } };
    return { Both: { seconds: longer(band.Both.seconds) } };
  }

  /**
   * NEAR Intents' current salt (intents.near current_salt), on two nodes; mainnet only (testnet has no intents.near).
   * It goes only into a sign-in that reads a confidential balance (oneclick-account.ts), and intents.near changes it
   * rarely, so the agreed answer is kept SALT_KEEP_MS (the read budget, 2 Nov: Spending's every look at its balance read
   * it again, a head and a view on two nodes). A balance read that fails forgets it (forgetSalt): the next asks again.
   */
  private salt: { at: number; value: Promise<string | null> } | null = null;
  private async intentsSalt(): Promise<string | null> {
    if (this.chain.network !== "mainnet") return null;
    if (!this.salt || Date.now() - this.salt.at >= SALT_KEEP_MS) {
      const value = this.chain.commonBlock().then((block) => this.chain.view(INTENTS.account, "current_salt", {}, block)).then((salt) => (typeof salt === "string" && /^[0-9a-f]{8}$/.test(salt) ? salt : null));
      const mine = { at: Date.now(), value };
      this.salt = mine;
      value.then((s) => s === null && this.salt === mine && (this.salt = null), () => this.salt === mine && (this.salt = null));
    }
    return this.salt.value;
  }
  private forgetSalt(): void {
    this.salt = null;
  }

  /** A 1Click quote this core asked for itself (the Add into Trading, a move into Private), by its deposit address. */
  private async ownQuote(depositAddress: string): Promise<unknown | null> {
    return (await this.subwallets.floatAddFacts(depositAddress)) ?? (await this.subwallets.privateInFacts(depositAddress)) ?? (await this.subwallets.safeSwapFacts(depositAddress));
  }

  /** Cancel a held request, on a sheet that says which one. */
  private async cancelWaiting(id: unknown): Promise<TxOutcome> {
    await this.warmOwn([call("cancel", { id: String(id) })]);
    const item = (await this.waiting()).find((w) => w.id === String(id));
    if (!item) throw new ProblemError(securityProblems.waitingGone());
    const signer = await this.rulesSigner();
    // A held change: nothing changes, and its own lines are what it would have done, said as such (grade 02g, E15: a
    // Cancel sheet read "Up to $500: runs as soon as you approve").
    const before = item.change ? ["Nothing changes on your account.", ...(item.lines.length ? ["It would have set:"] : [])] : ["Nothing from it goes out."];
    const sheet: Approve = (w, next) => this.approveOnSheet({ ...w, title: `Cancel: ${item.title}`, lines: [...before, ...item.lines, ...w.lines.slice(-1)], ...withItemDetails(item, w) }, next);
    return this.ended(item.id, "cancelled", await signer.run(signer.accountId, [call("cancel", { id: item.id })], undefined, sheet));
  }

  /** Requests the account's rules are holding, in plain words. */
  private async waiting(): Promise<HeldRequest[]> {
    const signer = await this.ready();
    const block = await this.chain.commonBlock();
    // The list and the words' price are asked beside the check that the account has rules (speed, 2 Nov: one round trip,
    // not three), and the list is given only once it has.
    const held = heldRequests(this.chain, signer.accountId, this.sheetNearUsd());
    void held.catch(() => undefined);
    if (!(await this.hasRules(signer.accountId, block))) throw new ProblemError(securityProblems.methodUnknown("Your account's rules are an older version. They have no payment limits. Update them in Security."));
    return held;
  }

  /**
   * The sheet's own reads for a call on the account itself, asked now at the block the screen's reads use (DevSigner.warm):
   * the sheet then follows its checks without a round trip of its own. Nothing is decided here; a failure is dropped.
   */
  private async warmOwn(actions: CoreAction[]): Promise<void> {
    const signer = await this.ready().catch(() => null);
    const block = signer && (await this.chain.commonBlock().catch(() => null));
    if (signer && block) signer.warm([{ receiverId: signer.accountId, actions }], block);
  }

  /** Send a held request whose wait is over. Checked first, so nobody signs (and pays a fee) for a certain refusal. */
  private async runWaiting(id: unknown): Promise<TxOutcome> {
    await this.warmOwn([call("run", { id: String(id) }, RUN_GAS)]);
    const item = (await this.waiting()).find((w) => w.id === String(id));
    if (!item) throw new ProblemError(securityProblems.waitingGone());
    if (item.needsSecondDevice) throw new ProblemError(securityProblems.needsSecondDevice());
    if (!item.ready) throw new ProblemError(securityProblems.stillWaiting(item.readyAtIso));
    const signer = await this.rulesSigner();
    // The sheet names the request itself, not just its number.
    // A held change to the account is finished, never "sent" (grade 30 Oct, item 5).
    const sheet: Approve = (w, next) => this.approveOnSheet({ ...w, title: `${item.change ? "Finish it now" : "Send it now"}: ${item.title}`, lines: [...item.lines, ...w.lines.slice(-1)], ...withItemDetails(item, w) }, next);
    return this.ended(item.id, "ran", await signer.run(signer.accountId, [call("run", { id: item.id }, RUN_GAS)], undefined, sheet));
  }

  /** Tell listeners (e.g. the ledger's Activity) that a hold ended here, then pass the outcome on. */
  private ended(id: string, ended: "ran" | "cancelled", outcome: TxOutcome): TxOutcome {
    if (outcome.status === "done") this.emit("account.waiting.ended", { id, ended, txHash: outcome.txHash, explorerUrl: outcome.explorerUrl });
    return outcome;
  }

  /**
   * Where a held request stands, even if it ended on another device: still waiting, or ended by which call, read from
   * the account's own transactions (run or approve: it ran; cancel; decline).
   */
  private async waitingStatus(id: string): Promise<{ state: "waiting" | "ran" | "cancelled" | "declined" | "unknown"; txHash?: string; explorerUrl?: string }> {
    const signer = await this.rulesSigner();
    if ((await this.waiting()).some((w) => w.id === id)) return { state: "waiting" };
    const states: Record<string, "ran" | "cancelled" | "declined"> = { run: "ran", approve: "ran", cancel: "cancelled", decline: "declined" };
    for (const tx of await this.chain.pastTransactions(signer.accountId, 50)) {
      if (!tx.ok || tx.receiverId !== signer.accountId) continue;
      for (const a of tx.actions) {
        if (a.kind !== "call" || !states[a.method]) continue;
        try {
          if (String(JSON.parse(new TextDecoder().decode(a.args)).id) === id) return { state: states[a.method], txHash: tx.hash, explorerUrl: explorerUrl(this.chain.network, tx.hash) };
        } catch {
          // not this one
        }
      }
    }
    return { state: "unknown" };
  }

  /** Add a second device (the laptop, or a spare phone): its post-quantum key, scanned from its screen. */
  /** Add the laptop (or a spare phone) as the second device, from the code its screen shows. Strictest level. */
  private async pairSecondDevice(code: unknown, kind: SecondDeviceKind): Promise<TxOutcome> {
    const signer = await this.rulesSigner();
    let publicKey: string;
    try {
      if (typeof code !== "string") throw new Error();
      publicKey = keyFromLaptopCode(code);
    } catch {
      throw new ProblemError(securityProblems.pairingCodeWrong(kind === "guardian" ? "their ZeroFee" : "your laptop"));
    }
    this.noteMine({ key: publicKey });
    const outcome = await signer.run(signer.accountId, [call("add_second_device", { public_key: borshKey(publicKey) }, ownCallGas("AddSecondDevice"))]);
    // What kind of second device it is, for Security's "Phone + laptop" (the chain knows only its key).
    if (outcome.status === "done" || outcome.status === "waiting") {
      const kinds = await this.secondDeviceKinds();
      kinds[handleOf(publicKey)] = kind;
      await this.vault.put(SECOND_KINDS, utf8(JSON.stringify(kinds)));
    }
    return outcome;
  }

  private async secondDeviceKinds(): Promise<Record<string, SecondDeviceKind>> {
    try {
      return JSON.parse(new TextDecoder().decode((await this.vault.get(SECOND_KINDS)) ?? utf8("{}")));
    } catch {
      return {};
    }
  }

  /**
   * This account's second devices and what each is: a laptop or a guardian paired here, or one paired elsewhere. `needsRefill` (release 5 on): its fee allowance is unlimited (added before release 5: refilling caps it,
   * audit F4) or under 0.1 NEAR (it pays its own network fees to say yes or no).
   */
  private async secondDevices(): Promise<{ handle: string; kind: SecondDeviceKind | "second device"; needsRefill: boolean; needsReAdd?: true; countsFullyFromIso?: string; waitsForMove?: true }[]> {
    const s = await this.saved();
    const signer = await this.ready();
    const kinds = await this.secondDeviceKinds();
    const block = await this.chain.commonBlock();
    const [keys, acct] = await Promise.all([this.chain.accessKeys(signer.accountId, block), this.chain.account(signer.accountId, block)]);
    const renewable = policyVersion(codeOf(acct!), this.chain.network) >= 5;
    // Release 7 on: a second device added under release 6 can't answer a move to a new device until it's added again.
    const recoveryAware = policyVersion(codeOf(acct!), this.chain.network) >= 7;
    // When each counts fully (on the account for a change's wait; the contract's second_device_ages, release 6): its
    // moment, or stopped while a move to a new device waits. Unreadable (an older release): nothing is said.
    const ages = new Map<string, string>();
    if (policyVersion(codeOf(acct!), this.chain.network) >= 6) {
      const view = await this.chain.view(signer.accountId, "second_device_ages", {}, block).catch(() => null);
      // Keys are listed on chain by their hash handle (ml-dsa-65-hash:…), the view gives the whole key.
      if (Array.isArray(view)) for (const [k, at] of view) if (typeof k === "string" && typeof at === "string") ages.set(mlDsaKeyHandle(mlDsaHandle(k) ?? ""), at);
    }
    return keys
      .filter((k) => isSecondDeviceKey(k.permission, signer.accountId))
      .map((k) => {
        const allowance = k.permission.kind === "function-call" ? k.permission.allowanceYocto : null;
        const at = ages.get(k.handle);
        const age = !at || !/^\d+$/.test(at) || at === "0" ? {} : at === U64_MAX ? { waitsForMove: true as const } : { countsFullyFromIso: new Date(Number(BigInt(at) / 1_000_000n)).toISOString() };
        const methods = k.permission.kind === "function-call" ? k.permission.methods : [];
        const reAdd = recoveryAware && !(methods.includes("approve_recovery") && methods.includes("refuse_recovery")) ? { needsReAdd: true as const } : {};
        return { handle: k.handle, kind: kinds[k.handle] ?? "second device", needsRefill: renewable && (allowance === null || allowance < REFILL_BELOW_YOCTO), ...reAdd, ...age };
      });
  }

  /**
   * "Refill your laptop": each second device that needs it gets its fee allowance back (1 NEAR, the contract's cap). The
   * same key, added again: the contract renews it at once and changes nothing else (audit F4, F17).
   */
  private async refillSecondDevices(): Promise<TxOutcome> {
    const signer = await this.rulesSigner();
    const due = (await this.secondDevices()).filter((d) => d.needsRefill || d.needsReAdd);
    if (due.length === 0) throw new ProblemError(securityProblems.requestInvalid("Your second devices already have their fees, and they're set up."));
    const reAdd = due.some((d) => d.needsReAdd);
    // The contract's own record first (its key adds are never a transaction's add-key), then the history.
    const block = await this.chain.commonBlock();
    const history = [...(await this.secondDeviceKeys(signer.accountId, block)), ...(await this.chain.keysFromHistory(signer.accountId))];
    const full = due.map((d) => history.find((k) => k.startsWith("ml-dsa-65:") && handleOf(k) === d.handle));
    if (full.some((k) => !k)) throw new ProblemError(securityProblems.keyNotFound());
    // Release 6 → 7: adding the same key again gives it the two new methods (say yes to, or refuse, a move to a new device)
    // and refills its fees; the sheet says that plainly.
    const sheet: Approve = (w, next) =>
      this.approveOnSheet(reAdd
        ? { ...w, title: due.length === 1 ? "Re-add your second device" : "Re-add your second devices", lines: ["Then it can also say yes or no to a move to a new device. Nothing else changes.", "It can spend up to 1 NEAR from your Safe on network fees, to say yes or no.", ...w.lines.slice(-1)] }
        : { ...w, title: due.length === 1 ? "Refill your second device's network fees" : "Refill your second devices' network fees", lines: ["It can again spend up to 1 NEAR from your Safe on network fees, to say yes or no. Nothing else changes.", ...w.lines.slice(-1)] }, next);
    for (const k of full) this.noteMine({ key: k! });
    return signer.run(signer.accountId, full.map((k) => call("add_second_device", { public_key: borshKey(k!) }, ownCallGas("AddSecondDevice"))), undefined, sheet);
  }

  /**
   * "Ask my laptop above $X" (or always): today's bands, cut at X, with the second device added above it. Each band
   * keeps its wait. The new bands go through set_protection, so the sheet shows them all before Face ID.
   */
  private async secondDeviceLimit(usd: unknown): Promise<TxOutcome> {
    const signer = await this.rulesSigner();
    const always = usd === "always";
    if (!always && !(typeof usd === "number" && Number.isFinite(usd) && usd >= 1 && usd <= 1e9)) {
      throw new ProblemError(securityProblems.requestInvalid("Say an amount in dollars, or always."));
    }
    const block = await this.chain.commonBlock();
    const [raw, count] = await Promise.all([this.chain.view(signer.accountId, "protection", {}, block), this.chain.view(signer.accountId, "second_device_count", {}, block)]);
    if (!Number(count ?? 0)) throw new ProblemError(securityProblems.requestNotAllowed("Add your laptop first."));
    const prices = await this.prices();
    const micros = BigInt(Math.round(prices.near * 1e6));
    const usdOf = (yocto: string) => Math.round(Number((BigInt(yocto) * micros) / 10n ** 24n) / 1e6);
    const levelOf = (l: any): { level: ProtectionBand["level"]; waitSeconds?: number } =>
      l === "FaceId" ? { level: "faceid" } : l === "Device" ? { level: "device" } : l?.Wait ? { level: "wait", waitSeconds: Number(l.Wait.seconds) } : { level: "both", waitSeconds: Number(l?.Both?.seconds) };
    const bands: ProtectionBand[] = ((raw as any[]) ?? []).map((b) => {
      const near = Array.isArray(b.up_to) ? b.up_to.find(([coin]: [string]) => coin === "near") : null;
      return { upToUsd: b.up_to === null ? null : near ? usdOf(near[1]) : 0, ...levelOf(b.level) };
    });
    if (!bands.length) throw new ProblemError(securityProblems.nodesUnreachable());
    const withDevice = (b: ProtectionBand): ProtectionBand => (b.level === "faceid" ? { ...b, level: "device" } : b.level === "wait" ? { ...b, level: "both" } : b);
    const cut = always ? 0 : Math.round(usd as number);
    // Every boundary there is, plus the new one; each piece keeps the level of the band it falls in.
    const tops = [...new Set([...bands.map((b) => b.upToUsd).filter((t): t is number => t !== null && t > 0), ...(cut > 0 ? [cut] : [])])].sort((a, b) => a - b);
    const covering = (top: number | null) => bands.find((b) => top !== null && b.upToUsd !== null && top <= b.upToUsd) ?? bands[bands.length - 1];
    const pieces: ProtectionBand[] = [...tops, null].map((top, i) => {
      const bottom = i === 0 ? 0 : tops[i - 1];
      const band = { ...covering(top), upToUsd: top };
      return bottom >= cut ? withDevice(band) : band;
    });
    // Neighbours that ask for the same thing become one band.
    const merged: ProtectionBand[] = [];
    for (const b of pieces) {
      const last = merged[merged.length - 1];
      if (last && last.level === b.level && (last.waitSeconds ?? 0) === (b.waitSeconds ?? 0)) last.upToUsd = b.upToUsd;
      else merged.push({ ...b });
    }
    return this.protectionSet(merged.map((b) => ({ upToUsd: b.upToUsd, level: b.level, ...(b.level === "wait" || b.level === "both" ? { waitSeconds: b.waitSeconds } : {}) })));
  }

  // ── Backup words ───────────────────────────────────────────────────────────────────────────────────────────────

  private async words(): Promise<{ words: string[] }> {
    // With their own screen, the words never leave the core but to it (recovery.backup).
    if (this.nativeWords) throw new ProblemError(securityProblems.requestNotAllowed("On this device your backup words show on ZeroFee's own screen."));
    return this.wordsHere();
  }

  private async wordsHere(): Promise<{ words: string[] }> {
    const s = await this.saved();
    if (s?.stage === "funding" && (await this.wordsFirst())) {
      // Words first (J2): the very words the account's recovery key and its wallets come from, kept in this device's
      // vault since the coins were offered (or made now). Once checked they are never shown again.
      if (await this.wordsCheckedFirst()) throw new ProblemError(securityProblems.notReady());
      this.backupSeed ??= await this.pendingWords();
      return { words: seedToWords(this.backupSeed) };
    }
    if (s?.stage !== "needs-backup") throw new ProblemError(securityProblems.notReady());
    // Checked before the money, the opening raced the check: ready, never shown again (review L2).
    if (await this.promoteCheckedFirst(s)) throw new ProblemError(securityProblems.notReady());
    // Already on chain (recoveryIn): the very words whose key went in with the account; otherwise new ones.
    this.backupSeed ??= s.recoveryIn ? await this.vault.get(PENDING_WORDS) : crypto.getRandomValues(new Uint8Array(32));
    if (!this.backupSeed) throw new ProblemError(securityProblems.notReady());
    return { words: seedToWords(this.backupSeed) };
  }

  /** The words checked before the money are on chain with the account now: their kept seed and mark go. */
  private async dropPendingWords(): Promise<void> {
    await this.vault.delete(PENDING_WORDS);
    await this.vault.delete(WORDS_CHECKED);
    this.backupSeed?.fill(0);
    this.backupSeed = null;
  }

  /** The hot wallets' root from the account's words (hot-keys.ts), kept on this device; the first one stays. */
  private async keepHotRoot(wordsSeed: Uint8Array): Promise<void> {
    if (!(await this.vault.get(HOT_ROOT))) await this.vault.put(HOT_ROOT, hotRoot(wordsSeed));
  }

  /** The words for the setup transaction: made once and kept in this device's vault until shown and checked. */
  private async pendingWords(): Promise<Uint8Array> {
    const had = await this.vault.get(PENDING_WORDS);
    if (had && had.length === 32) return had;
    const seed = crypto.getRandomValues(new Uint8Array(32));
    await this.vault.put(PENDING_WORDS, seed);
    return seed;
  }

  /** The words are written down and checked: the bank opens. ("Check later" is gone, J2: the check is never skipped.) */
  private async wordsDone(s: Saved, checkDue: boolean): Promise<{ ok: true }> {
    // "ready" first, then the seed goes (re-review L-A): a crash in between leaves a ready account whose leftover seed the
    // next state() sweeps, never one stuck at its words with no seed to show.
    await this.save({ accountId: s.accountId, stage: "ready", ...(checkDue ? { checkDue: true } : {}), ...(s.restoredAtIso ? { restoredAtIso: s.restoredAtIso } : {}) });
    await this.dropPendingWords();
    return { ok: true };
  }

  /** The backup step on the words' own screen: show them, check three, then add the recovery key (the approval sheet). */
  private async backup(): Promise<{ ok: true }> {
    if (!this.nativeWords) throw new ProblemError(securityProblems.methodUnknown("This device shows backup words on the page: use recovery.words."));
    const { words } = await this.wordsHere();
    const picked = await this.nativeWords(words, false).catch(() => null);
    if (!picked) {
      // Stopped: the words leave memory (new ones, or the vault's own when their key went in with the account).
      this.backupSeed?.fill(0);
      this.backupSeed = null;
      throw new ProblemError(securityProblems.backupDeclined());
    }
    // No positions (an older words screen's "Check later", gone in J2): the check wasn't done, so nothing is done.
    if (Array.isArray(picked.positions) && picked.positions.length === 0) {
      this.backupSeed?.fill(0);
      this.backupSeed = null;
      throw new ProblemError(securityProblems.backupDeclined());
    }
    return this.confirm(picked.positions, picked.words);
  }

  private async confirm(positions: unknown, words: unknown): Promise<{ ok: true }> {
    const s = await this.saved();
    if (s?.stage === "funding" && this.backupSeed && (await this.wordsFirst())) {
      // Words first (J2): three checked, before any money. Nothing is signed: their key goes on chain with the account
      // (setUp). The mark is for exactly the words kept here, so other words can never count as checked.
      checkThree(this.backupSeed, positions, words, !this.nativeWords);
      const kept = await this.vault.get(PENDING_WORDS);
      if (!kept || kept.length !== 32 || hex(kept) !== hex(this.backupSeed)) throw new ProblemError(securityProblems.notReady());
      await this.vault.put(WORDS_CHECKED, sha256(kept));
      kept.fill(0);
      this.backupSeed.fill(0);
      this.backupSeed = null;
      return { ok: true };
    }
    if (s?.stage !== "needs-backup" || !this.backupSeed) throw new ProblemError(securityProblems.notReady());
    checkThree(this.backupSeed, positions, words, !this.nativeWords);
    // Their key went in with the account: the words are checked, nothing more to sign.
    if (s.recoveryIn) return this.wordsDone(s, false);
    return this.addBackupKey(s, false);
  }

  /** The words' key on chain (the approval sheet), then the bank opens. `checkDue`: "Check later" (a browser's). */
  private async addBackupKey(s: Saved, checkDue: boolean): Promise<{ ok: true }> {
    if (!this.backupSeed) throw new ProblemError(securityProblems.notReady());
    // The words are confirmed: now, and only now, the recovery key goes on-chain, limited by NEAR to the two methods it
    // may call. Its allowance caps what it can ever spend on fees; it can't send money.
    const recovery = SoftwareKey.fromSeed(this.backupSeed, "recovery-words");
    const signer = await this.deviceSigner(s.accountId);
    let outcome: TxOutcome;
    try {
      outcome = (await this.hasRules(s.accountId))
        ? (this.noteMine({ key: recovery.publicKey }), await signer.run(s.accountId, [call("set_recovery_key", { public_key: borshKey(recovery.publicKey) }, ownCallGas("SetRecoveryKey"))]))
        : await signer.run(s.accountId, [
            {
              kind: "add-key",
              publicKey: recovery.publicKey,
              permission: { kind: "function-call", receiverId: s.accountId, methods: [...RECOVERY_POLICY.recoveryKeyMethods], allowanceYocto: RECOVERY_KEY_ALLOWANCE },
            },
          ]);
    } finally {
      recovery.destroy();
    }
    if (outcome.status === "declined") throw new ProblemError(securityProblems.backupDeclined());
    if (outcome.status === "problem") throw new ProblemError(outcome.problem);
    // The words are the account's now: the hot wallets come from them from here on (hot-keys.ts).
    await this.keepHotRoot(this.backupSeed);
    this.backupSeed.fill(0);
    this.backupSeed = null;
    await this.save({ accountId: s.accountId, stage: "ready", ...(checkDue ? { checkDue: true } : {}), ...(s.restoredAtIso ? { restoredAtIso: s.restoredAtIso } : {}) });
    return { ok: true };
  }

  /**
   * New backup words. Made here and shown, three checked (recovery.renewConfirm, or on the phone's own words screen in
   * this call), then the account's backup key is replaced through its rules: a change's wait (3 days on a 48-hour
   * account), and a recovery started meanwhile drops it; none can be asked while one waits (re-audit 2, N1 (a): the
   * words beat the phone). The seed stays in this device's vault until the change runs; then the hot wallets' root moves
   * to the new words (syncRenew).
   */
  private async renew(): Promise<{ words: string[] } | TxOutcome> {
    const s = await this.saved();
    if (s?.stage !== "ready") throw new ProblemError(securityProblems.notReady());
    // The check for a recovery under way is asked beside the check for rules, at one block (speed, 2 Nov), and still
    // answered in the same order.
    const block = await this.chain.commonBlock();
    const noRecovery = this.noRecoveryWaiting(s.accountId, block);
    void noRecovery.catch(() => undefined);
    if (!(await this.hasRules(s.accountId, block))) throw new ProblemError(securityProblems.requestNotAllowed("New words need your account's rules."));
    await this.syncRenew();
    if (await this.vault.get(RENEW_AT)) throw new ProblemError(securityProblems.renewWaiting());
    await noRecovery;
    // Asked again before the check: the same words, not a second set. Never words whose key is already on the account
    // (QA sd-security (a): old words shown as new). Its backup key (that key, on the account itself, with the backup key's
    // methods only, as recovery.check reads it; no recovery waits, above): a change that ran with no mark kept, followed
    // now. On NEAR in any other way (QA's SHOULD): nothing is marked and nothing moves; kept aside, never shown.
    let seed = await this.vault.get(RENEW_WORDS);
    const on = seed?.length === 32 ? await this.renewKeyOn(s.accountId, seed) : "none";
    if (on === "backup") {
      await this.vault.put(RENEW_AT, utf8(String(Date.now())));
      await this.syncRenew();
      seed = null;
    } else if (on === "other") {
      await this.vault.put(RENEW_ASIDE, seed!);
      seed = null;
    }
    if (!seed || seed.length !== 32) {
      seed = crypto.getRandomValues(new Uint8Array(32));
      await this.vault.put(RENEW_WORDS, seed);
    }
    // QA's real lap (k-trade3): the new words leave the core only after the person's strong check, right before
    // they are painted, held here like the rotation (Face ID on the phone, the passkey on the web app, the password on the
    // web wallet). A no, or a check that fails: no words, nothing changed; asked again, the same new set.
    if (!(await this.approveOnSheet(SHOW_NEW_WORDS))) {
      seed.fill(0);
      throw new ProblemError(securityProblems.renewDeclined());
    }
    const words = seedToWords(seed);
    seed.fill(0);
    if (!this.nativeWords) return { words };
    const picked = await this.nativeWords(words, false, true).catch(() => null);
    // No "Check later" here: new words must be checked before the old ones go. Stopped: they're forgotten (audit CORE-01).
    if (!picked || !Array.isArray(picked.positions) || picked.positions.length === 0) {
      await this.vault.delete(RENEW_WORDS);
      throw new ProblemError(securityProblems.renewDeclined());
    }
    return this.renewConfirm(picked.positions, picked.words);
  }

  private async renewConfirm(positions: unknown, words: unknown): Promise<TxOutcome> {
    const s = await this.saved();
    const seed = await this.vault.get(RENEW_WORDS);
    if (s?.stage !== "ready" || !seed || (await this.vault.get(RENEW_AT))) throw new ProblemError(securityProblems.notReady());
    try {
      checkThree(seed, positions, words, !this.nativeWords);
      // The sheet's own reads go out beside the check for a recovery under way, at its block (speed, 2 Nov).
      const signer = await this.deviceSigner(s.accountId);
      const block = await this.chain.commonBlock();
      signer.warm([{ receiverId: s.accountId, actions: [call("set_recovery_key", {}, ownCallGas("SetRecoveryKey"))] }], block);
      await this.noRecoveryWaiting(s.accountId, block);
      const key = SoftwareKey.fromSeed(seed, "recovery-words");
      const sheet: Approve = (w, next) =>
        this.approveOnSheet({ ...w, title: "Replace your backup words", lines: ["Your new words become your account's backup key. Your old words stop working when this goes through.", ...w.lines.slice(1)] }, next);
      let outcome: TxOutcome;
      // Marked before it is signed (QA sd-security (a)): a crash or a lost answer after it went can never leave these
      // words unmarked, to be shown again as new while the hot wallets stay on the old ones. A no forgets them.
      await this.vault.put(RENEW_AT, utf8(String(Date.now())));
      try {
        outcome = await signer.run(s.accountId, [call("set_recovery_key", { public_key: borshKey(key.publicKey) }, ownCallGas("SetRecoveryKey"))], undefined, sheet);
      } finally {
        key.destroy();
      }
      if (outcome.status !== "done" && outcome.status !== "waiting") {
        for (const name of [RENEW_WORDS, RENEW_AT]) await this.vault.delete(name);
        return outcome;
      }
      await this.syncRenew();
      return outcome;
    } finally {
      seed.fill(0);
    }
  }

  /**
   * Review of 134e5b5b, 5: the sweep runs beside the sync, never inside it (status and renew don't wait on 1Click), one
   * at a time, and at most every 10 minutes unless `now` (the root just moved, or the person's Try again).
   */
  private sweepFlight: Promise<OldWordsSweep> | null = null;
  private sweepAtMs = 0;
  private sweepInBackground(now = false): void {
    if (this.sweepFlight || (!now && Date.now() - this.sweepAtMs < SWEEP_EVERY_MS)) return;
    this.sweepAtMs = Date.now();
    const flight = this.sweepOnce(false);
    this.sweepFlight = flight;
    void flight.catch(() => undefined).finally(() => {
      if (this.sweepFlight === flight) this.sweepFlight = null;
    });
  }

  /**
   * One pass: the new words' pocket and float made, the old ones' coins moved into them (SubWallets.sweepOldWords). The
   * watch goes on while anything is moving, waiting to be asked again or unread, and for 7 days after (review 1): money
   * can still land on an old wallet. A coin out of tries or too small to move doesn't hold it open: Wallet shows it, with
   * Try again (`again`), which watches again.
   */
  private async sweepOnce(again: boolean): Promise<OldWordsSweep> {
    const r = await this.subwallets.rotateAfterNewWords(again).catch((): OldWordsSweep => ({ moving: 0, left: 1, coins: [], unread: true }));
    const until = Number(new TextDecoder().decode((await this.vault.get(SWEEP_DUE)) ?? new Uint8Array()));
    if (again || r.moving > 0 || r.unread || r.coins.some((c) => c.state === "waiting")) await this.vault.put(SWEEP_DUE, new TextEncoder().encode(String(Date.now() + SWEEP_WATCH_MS)));
    else if (!(until > Date.now())) await this.vault.delete(SWEEP_DUE);
    return r;
  }

  /** Wallet's Try again for the old words' money: a pass now, every coin's count started over (not a too-small one). */
  private async sweepAgain(): Promise<OldWordsSweep> {
    await this.sweepFlight?.catch(() => undefined);
    this.sweepAtMs = Date.now();
    const flight = this.sweepOnce(true);
    this.sweepFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.sweepFlight === flight) this.sweepFlight = null;
    }
  }

  /** Is this seed's key on the account now: as its backup key (the contract adds it so: on the account itself, the backup
   *  key's methods only; the contract has no view of its own record, lib.rs:436), in some other way, or not at all? */
  private async renewKeyOn(accountId: string, seed: Uint8Array, at?: Block): Promise<"backup" | "other" | "none"> {
    const key = SoftwareKey.fromSeed(seed, "recovery-words");
    const handle = key.publicKeyHandle;
    key.destroy();
    const p = (await this.chain.accessKeys(accountId, at ?? (await this.chain.commonBlock()))).find((k) => k.handle === handle)?.permission;
    if (!p) return "none";
    return p.kind === "function-call" && p.receiverId === accountId && p.methods.join() === RECOVERY_POLICY.recoveryKeyMethods.join() ? "backup" : "other";
  }

  /** The contract refuses new words while a move to a new device waits: said before any words are made or signed. */
  private async noRecoveryWaiting(accountId: string, at?: Block): Promise<void> {
    if ((await this.chain.view(accountId, "pending", {}, at ?? (await this.chain.commonBlock()))) !== null) throw new ProblemError(securityProblems.renewRecoveryWaiting());
  }

  /**
   * New words' change, followed: once the account's keys hold the new backup key, the hot wallets' root moves to the new
   * words and every hot wallet made before is marked as opening with the old words (still listed, still working, each in
   * its place; new places come from the new words). Gone from the waiting list without running (cancelled, or dropped by
   * a recovery start), the new words are forgotten. Nothing is signed here.
   */
  private async syncRenew(): Promise<void> {
    const seed = await this.vault.get(RENEW_WORDS);
    // The old words' pocket and float, watched and emptied in the background (never before the root has moved: until
    // then, RENEW_WORDS is still here and the steps below run again).
    if (!seed && (await this.vault.get(SWEEP_DUE))) this.sweepInBackground();
    const askedAt = Number(new TextDecoder().decode((await this.vault.get(RENEW_AT)) ?? new Uint8Array()));
    const s = await this.saved();
    if (!seed || !askedAt || s?.stage !== "ready") return;
    const key = SoftwareKey.fromSeed(seed, "recovery-words");
    const asBorsh = borshKey(key.publicKey);
    key.destroy();
    const block = await this.chain.commonBlock();
    // In as the account's backup key, never only somewhere on NEAR (QA's SHOULD): then the hot root moves.
    if ((await this.renewKeyOn(s.accountId, seed, block)) === "backup") {
      // Security audit 4 Nov, finding 2: Private and the NEAR float move to the new words' wallets, emptied of the old.
      // The flag goes in first (review 4): a crash after the marks can't skip the sweep.
      await this.vault.put(SWEEP_DUE, new TextEncoder().encode(String(Date.now() + SWEEP_WATCH_MS)));
      // Marked first, while the hot root is still the old words' (a browser keeps those wallets' keys in memory only
      // until now: markOldWords puts each in the vault before the root moves).
      await this.subwallets.markOldWords();
      await this.vault.put(HOT_ROOT, hotRoot(seed));
      seed.fill(0);
      for (const name of [RENEW_WORDS, RENEW_AT]) await this.vault.delete(name);
      this.sweepInBackground(true);
      this.emit("recovery.renewed", {});
      return;
    }
    seed.fill(0);
    if (Date.now() < askedAt + RENEW_SETTLE_MS) return;
    const waiting = (await this.chain.view(s.accountId, "waiting_requests", {}, block)) as { change?: { SetRecoveryKey?: { public_key?: string } } }[] | null;
    if (Array.isArray(waiting) && !waiting.some((w) => w.change?.SetRecoveryKey?.public_key === asBorsh)) {
      for (const name of [RENEW_WORDS, RENEW_AT]) await this.vault.delete(name);
    }
  }

  private mineWrites: Promise<void> = Promise.resolve();
  /** S-1: remembers what this phone started, so its own changes aren't news to it (guard-dog.ts). */
  private noteMine(add: { held?: string; key?: string }): void {
    this.mineWrites = this.mineWrites.then(() => guardDog().then((g) => g.noteMine(this.vault, add))).catch(() => undefined);
  }

  /**
   * Background alerts (outside study item 4): what's new on the account since it was last asked, in plain words, each
   * told once. A recovery started; a request held by the account's protection. `notify`
   * false (the open app's own watch): mark it all as seen, tell nothing. Read on two nodes like everything else; signs
   * nothing. No account, or one made before protection by amount: only the recovery is watched.
   */
  private async alertsPoll(notify: boolean, known?: NonNullable<AccountInfo["recovery"]>): Promise<{ alerts: { kind: "recovery" | "held" | "key"; id: string; title: string; body: string }[] }> {
    // S-1: an account this phone guards, as its second device, is watched too (with or without an account of its own).
    const guarded = await this.secondDevice("secondDevice.alerts", { space: "guardian" }).then((a) => a as { kind: "held" | "key"; id: string; title: string; body: string }[], () => []);
    const s = await this.saved();
    if (s?.stage !== "ready") return { alerts: notify ? guarded : [] };
    const raw = await this.vault.get(ALERTS_SEEN);
    let seen: { recovery?: string | null; held?: string[]; keys?: string[] } = {};
    try {
      seen = raw ? JSON.parse(new TextDecoder().decode(raw)) : {};
    } catch {
      seen = {};
    }
    const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const alerts: { kind: "recovery" | "held" | "key"; id: string; title: string; body: string; unknownCode?: true }[] = [];
    const status = known ?? (await this.status());
    const recovery = status.pending?.readyAtIso ?? null;
    if (recovery && recovery !== seen.recovery) {
      alerts.push({ kind: "recovery", id: `recovery:${recovery}`, title: "Someone started moving your account to a new device", body: `If it wasn't you, open ZeroFee and stop it before ${when(recovery)}.` });
    }
    const rules = await this.hasRules(s.accountId).catch(() => false);
    const held = rules ? await this.waiting() : [];
    // S-1: new keys and new waiting changes, minus this phone's own (guard-dog.ts, loaded only here).
    await this.mineWrites;
    const news = await (await guardDog()).phoneGuard({ chain: this.chain, vault: this.vault, accountId: s.accountId, held, seen, when, rules });
    alerts.push(...news.alerts, ...guarded);
    // MUST 1 (QA): unknown code waiting is always told first, above a recovery's alert too.
    alerts.sort((x, y) => Number(!!y.unknownCode) - Number(!!x.unknownCode));
    await this.vault.put(ALERTS_SEEN, utf8(JSON.stringify({ recovery, ...news.seen })));
    return { alerts: notify ? alerts : [] };
  }

  /** The relay's own word that email alerts work there (GET /v0/health → alerts: "on"); anything else, or no answer: off. */
  private async alertsAvailable(): Promise<{ on: boolean }> {
    if (!this.relayBase) return { on: false };
    try {
      const res = await fetch(`${this.relayBase.replace(/\/$/, "")}/v0/health`, { signal: AbortSignal.timeout(10_000) });
      const body = res.ok ? ((await res.json()) as { alerts?: unknown }) : null;
      return { on: body?.alerts === "on" };
    } catch {
      return { on: false };
    }
  }

  /**
   * Email alerts (Layer 2): the relay emails a link that turns them on, or one that stops them. It keeps only this
   * account's name and the email (apps/quotes/alerts.mjs); nothing here is signed or kept on the phone.
   */
  /**
   * The relay's proof that this account asks for alerts (apps/quotes/README.md "Proof of the account", audit NF-01): a
   * NEP-413 signature by the account's device key over four fixed lines, the relay's host as recipient, a deadline 8
   * minutes ahead. The phone's chip signs it on its own sheet (Swift builds and shows it: AlertsProof); any other key
   * after this core's sheet. Checked here before it goes. Null: not approved.
   */
  private async alertsProof(accountId: string, email: string): Promise<{ deadline: string; nonce: string; publicKey: string; signature: string } | null> {
    const key = await this.deviceKey();
    const recipient = httpsOrigin(this.relayBase)?.host;
    if (!recipient) throw new ProblemError(securityProblems.partnerUnreachable("the alerts server"));
    const deadline = new Date(Date.now() + 8 * 60_000).toISOString();
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const message = ["ZeroFee email alerts", `Account: ${accountId}`, `Email: ${email}`, `Until: ${deadline}`].join("\n");
    const hash = nep413Hash({ message, nonce: base64(nonce), recipient });
    let signature: Uint8Array | null;
    if (key.signAlertsProof) {
      signature = await key.signAlertsProof({ accountId, email, deadline, nonce });
    } else {
      const words: PlainWords = { title: `Turn on email alerts to ${email}`, lines: [`For ${accountId}`, "This address gets an email when a payment or change starts on your account.", `It signs a note for ${recipient} only. No money moves.`], warnings: [], effect: [] };
      signature = (await this.approveOnSheet(words).catch(namedOnly)) ? await key.signHash(hash) : null;
    }
    if (!signature) return null;
    if (key.publicKey.startsWith("ml-dsa-65:") && !signatureIsValid(hash, signature, key.publicKey)) throw new ProblemError(securityProblems.signatureInvalid());
    return { deadline, nonce: base64(nonce), publicKey: key.publicKey, signature: `${key.publicKey.split(":")[0]}:${base58(signature)}` };
  }

  /**
   * A site's two-factor backup with the words (decision G; site-2fa-backup.ts): the phone's host only (siteCodes,
   * no app). backup {site, entry} and forget {site} change the relay's sealed keep; restore {sites} gives the host
   * those sites' entries, which it seals under Face ID at once (SiteCodes.swift), and only after the person proved it
   * now (siteCodeRestore). Needs the hot root (an account made or restored here with its words) and the relay.
   */
  private async siteCodeKeep(method: string, p: Record<string, unknown>): Promise<unknown> {
    if (!this.siteCodes || p.app !== undefined || p.caller !== undefined) throw new ProblemError(securityProblems.methodUnknown(method));
    if (!this.relayBase) throw codesProblem("site2fa.off", "This phone isn't set up to back up codes.");
    const k = await import("./site-2fa-backup.ts");
    try {
      if (method === "site2fa.restore") {
        const sites = Array.isArray(p.sites) ? p.sites.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
        return await this.siteCodeRestore(k, this.relayBase, sites);
      }
      const site = typeof p.site === "string" ? p.site : "";
      const root = await this.vault.get(HOT_ROOT);
      if (!root) throw codesProblem("site2fa.no-words", "Your 24 words aren't on this phone, so codes aren't backed up.");
      const keys = k.keepKeys(root);
      root.fill(0);
      try {
        if (method === "site2fa.backup") return await k.backUpCode(this.relayBase, keys, site, k.checkedCode(site, p.entry)).then(() => ({ backedUp: true }));
        if (method === "site2fa.forget") return await k.forgetCode(this.relayBase, keys, site).then(() => ({ forgotten: true }));
        throw new ProblemError(securityProblems.methodUnknown(method));
      } finally {
        keys.forget();
      }
    } catch (e) {
      if (e instanceof ProblemError) throw e;
      if (e instanceof Error && /^(unknown site|not a code)/.test(e.message)) throw codesProblem("site2fa.unknown", "ZeroFee doesn't keep this kind of code.");
      throw codesProblem("site2fa.unreachable", "ZeroFee's backup didn't answer. Your code is still on this phone.");
    }
  }

  /**
   * site2fa.restore (review MUST 1): the words' copy is opened only after the person proved it now, never with the key
   * at rest alone (someone who knows the passcode could add their face). No words' key here, or no keep for these words:
   * every entry null at once, nothing asked. Otherwise a fresh Face ID with the account's own approval key; or, when
   * that key is refused because the faces changed (or the host has no step-up), the 24 words typed on the phone's own
   * screen, which must be this account's. A no, or other words: { declined: true } and nothing opened.
   */
  private async siteCodeRestore(k: typeof import("./site-2fa-backup.ts"), relay: string, sites: string[]): Promise<{ entries: Record<string, unknown>; declined?: true }> {
    const none = { entries: Object.fromEntries(sites.map((s) => [s, null])) };
    const atRest = await this.vault.get(HOT_ROOT);
    if (!atRest) return none;
    try {
      const peek = k.keepKeys(atRest);
      try {
        if (!(await k.keepExists(relay, peek))) return none;
      } finally {
        peek.forget();
      }
      const changed = this.approvalKey ? await this.approvalKey.changed().catch(() => true) : true;
      let root: Uint8Array;
      if (!changed && this.codesStepUp) {
        if (!(await this.codesStepUp().catch(() => false))) return { ...none, declined: true };
        root = atRest.slice();
      } else {
        if (!this.nativeTyping) return { ...none, declined: true };
        const words = await this.nativeTyping("codes").catch(() => null);
        if (!words || wordsProblem(words)) return { ...none, declined: true };
        const seed = wordsToSeed(words);
        root = hotRoot(seed);
        seed.fill(0);
        if (root.length !== atRest.length || root.some((b, i) => b !== atRest[i])) {
          root.fill(0);
          return { ...none, declined: true };
        }
      }
      const keys = k.keepKeys(root);
      root.fill(0);
      try {
        return { entries: await k.restoreCodes(relay, keys, sites) };
      } finally {
        keys.forget();
      }
    } finally {
      atRest.fill(0);
    }
  }

  private async alertsEmail(action: "subscribe" | "remove-ask", email: unknown): Promise<{ asked: true } | { declined: true }> {
    const s = await this.saved();
    if (s?.stage !== "ready") throw new ProblemError(securityProblems.notReady());
    if (typeof email !== "string" || !/^[^\s@<>"'(),;:\\]{1,64}@[A-Za-z\d-]{1,63}(\.[A-Za-z\d-]{1,63}){0,4}\.[A-Za-z]{2,24}$/.test(email.trim())) {
      throw new ProblemError(securityProblems.requestInvalid("That isn't an email address."));
    }
    if (!this.relayBase) throw new ProblemError(securityProblems.requestNotAllowed("Email alerts aren't set up on this device."));
    // Turning them on takes the account's own proof (the relay refuses any other); asking for the stop link doesn't.
    const proof = action === "subscribe" ? await this.alertsProof(s.accountId, email.trim()) : undefined;
    if (proof === null) return { declined: true };
    let res: Response;
    try {
      res = await fetch(`${this.relayBase.replace(/\/$/, "")}/v0/alerts/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: s.accountId, email: email.trim(), ...(proof ? { proof, zone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}) }), signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ProblemError(securityProblems.partnerUnreachable("ZeroFee's email alerts"));
    }
    if (res.ok) return { asked: true };
    const why = ((await readJson(res).catch(() => null)) as { whatHappened?: unknown } | null)?.whatHappened;
    if (res.status === 503) throw new ProblemError(securityProblems.requestNotAllowed("ZeroFee's email alerts aren't ready yet."));
    if (res.status === 400 && typeof why === "string") throw new ProblemError(securityProblems.requestInvalid(why.slice(0, 160)));
    throw new ProblemError(securityProblems.partnerUnreachable("ZeroFee's email alerts"));
  }

  /** The words to use: on the phone, typed on its own screen (never the page's); elsewhere, the page's. */
  private async typed(words: unknown, purpose: "restore" | "check" | "rearm"): Promise<unknown> {
    if (!this.nativeTyping) return words;
    if (words !== undefined) throw new ProblemError(securityProblems.requestNotAllowed("On this device you type your words on ZeroFee's own screen."));
    const got = await this.nativeTyping(purpose).catch(() => null);
    if (!got) throw new ProblemError(securityProblems.wordsStopped());
    return got;
  }

  /**
   * Practice: do these words rebuild this account's backup key? Signs nothing and stores nothing; the words are used
   * once, in memory, to compute the key's public handle.
   */
  private async check(words: unknown): Promise<{ matches: boolean }> {
    const s = await this.saved();
    if (s?.stage !== "ready") throw new ProblemError(securityProblems.notReady());
    const seed = seedFromTyped(await this.typed(words, "check"));
    const key = SoftwareKey.fromSeed(seed, "recovery-words");
    const handle = key.publicKeyHandle;
    key.destroy();
    const block = await this.chain.commonBlock();
    const keys = await this.chain.accessKeys(s.accountId, block);
    const p = keys.find((k) => k.handle === handle)?.permission;
    const matches = p?.kind === "function-call" && p.receiverId === s.accountId && p.methods.join() === RECOVERY_POLICY.recoveryKeyMethods.join();
    // An older account whose hot wallets were made on the phone only: from the first check that matches, new ones come
    // from these words (hot-keys.ts), so a restore brings them back.
    if (matches) await this.keepHotRoot(seed);
    seed.fill(0);
    // A "Check later" reminder ends with the first check that matches.
    if (matches && s.checkDue) await this.save({ accountId: s.accountId, stage: s.stage, ...(s.restoredAtIso ? { restoredAtIso: s.restoredAtIso } : {}) });
    return { matches };
  }

  /** The delay the set-up transaction carries: the person's choice if one was made, else this core's default. */
  private async chosenDelay(): Promise<number> {
    const raw = await this.vault.get(DELAY_CHOICE);
    return raw ? Number(new TextDecoder().decode(raw)) : this.delaySeconds;
  }

  // ── Recovery: on this device ────────────────────────────────────────────────────────────────────────────────────

  private async status(): Promise<NonNullable<AccountInfo["recovery"]>> {
    await this.syncRenew().catch(() => undefined);
    const s = await this.saved();
    if (!s || s.stage === "creating") throw new ProblemError(securityProblems.accountNone());
    const block = await this.chain.commonBlock();
    // The account first (a node takes four reads at once), then the recovery reads behind it.
    const reading = this.chain.account(s.accountId, block);
    warmRecovery(this.chain, s.accountId, block);
    const acct = await reading;
    const recovery = acct && (await recoveryState(this.chain, s.accountId, codeOf(acct)!, block));
    return recovery ?? { delaySeconds: 0, pending: null };
  }

  private async cancel(): Promise<TxOutcome> {
    const signer = await this.ready();
    const status = await this.status();
    if (!status.pending) throw new ProblemError(securityProblems.recoveryNone());
    // Release 6 (re-audit R1, R3): say what the stop really does on this account.
    const block = await this.chain.commonBlock();
    const acct = await this.chain.account(signer.accountId, block);
    if (policyVersion(codeOf(acct!), this.chain.network) < 6) return signer.run(signer.accountId, [call("cancel_recovery")]);
    const aged = Number(await this.chain.view(signer.accountId, "second_devices_of_age", {}, block));
    const delay = status.delaySeconds;
    // Re-audit 7 (R7-2): with a second device of age the phone stops a move once, and never one that device said yes to.
    if (aged > 0 && status.pending.approved) throw new ProblemError(securityProblems.recoveryStopApproved());
    if (aged > 0 && status.pending.stopAtIso) throw new ProblemError(securityProblems.recoveryStopAsked());
    const line = aged > 0
      ? `You can ask this only once. The move stops in ${duration(Math.min(86_400, Math.floor(delay / 2)))}, or now with your second device's yes.`
      : `The move stops now. Then payments wait ${duration(delay + Math.min(delay, 86_400))}, so a thief gains nothing.`;
    const sheet: Approve = (w, next) => this.approveOnSheet({ ...w, lines: [...w.lines.slice(0, -1), line, ...w.lines.slice(-1)] }, next);
    return signer.run(signer.accountId, [call("cancel_recovery")], undefined, sheet);
  }

  private startWatching(): void {
    if (this.watching) return;
    this.watching = everyAligned(this.watchIntervalMs, () => void this.checkRecovery());
    void this.checkRecovery();
  }

  private stopWatching(): void {
    this.watching?.();
    this.watching = null;
  }

  private async checkRecovery(): Promise<void> {
    try {
      const s = await this.saved();
      if (s?.stage !== "ready") return;
      const status = await this.status();
      const readyAtIso = status.pending?.readyAtIso ?? null;
      if (readyAtIso && readyAtIso !== this.lastPending) this.emit("recovery.started", { readyAtIso });
      this.lastPending = readyAtIso;
      // The status just read, for the screens that show it (Home's freeze banner): one read every tick for all of them,
      // never one of their own beside this one (grade 01c, P12: the same status was read three times a tick).
      this.emit("recovery.status", status);
      // What the open app shows needs no background alert later: marked with the status already read, every few ticks
      // (it only keeps a background alert from repeating what the person saw).
      if (this.watchTicks++ % ALERTS_EVERY === 0) await this.alertsPoll(false, status).catch(() => undefined);
    } catch {
      // A missed check is retried on the next tick; nothing is signed here.
    }
  }

  // ── Recovery: on a new device ───────────────────────────────────────────────────────────────────────────────────

  /**
   * Face ID changed on this device (audit IOS-1b): every approval that isn't the account key's is refused, for good, until
   * the 24 words are typed on ZeroFee's own screen. They must be this account's (its backup key on chain, and the hot
   * wallets' root this device keeps); then the phone makes a new approval key, bound to the faces enrolled now. A thief
   * who knows the passcode doesn't have the words. Five wrong tries lock it for 15 minutes.
   * The account key on this device can't sign again either (the contract's rule needs a move): `thenRecover` starts the
   * move to this device with the same words, after this device forgets its account (it comes back when the move finishes).
   */
  private async rearm(thenRecover: boolean): Promise<{ rearmed: true; readyAtIso?: string }> {
    if (!this.nativeTyping || !this.approvalKey) throw new ProblemError(securityProblems.requestNotAllowed("Only the phone's own screen turns approvals back on."));
    const s = await this.saved();
    if (s?.stage !== "ready") throw new ProblemError(securityProblems.notReady());
    const tries = JSON.parse(new TextDecoder().decode((await this.vault.get(REARM_TRIES)) ?? utf8("{}"))) as { count?: number; untilMs?: number };
    if ((tries.untilMs ?? 0) > Date.now()) throw new ProblemError(securityProblems.rearmLocked(new Date(tries.untilMs!).toISOString()));
    if (!(await this.approvalKey.changed())) throw new ProblemError(securityProblems.faceIdUnchanged());
    const words = await this.typed(undefined, "rearm");
    let seed: Uint8Array | null = null;
    try {
      seed = seedFromTyped(words);
    } catch {
      seed = null;
    }
    const theirs = seed && (await this.wordsAreThisAccount(s.accountId, seed));
    if (!seed || !theirs) {
      seed?.fill(0);
      const count = (tries.count ?? 0) + 1;
      await this.vault.put(REARM_TRIES, utf8(JSON.stringify(count >= REARM_MAX_TRIES ? { count: 0, untilMs: Date.now() + REARM_LOCK_MS } : { count })));
      throw new ProblemError(securityProblems.wordWrong());
    }
    await this.vault.delete(REARM_TRIES);
    await this.approvalKey.reset();
    if (!thenRecover) {
      seed.fill(0);
      return { rearmed: true };
    }
    await this.forget();
    try {
      return { rearmed: true, ...(await this.startRecoveryWith(seed, s.accountId)) };
    } finally {
      seed.fill(0);
    }
  }

  /** Are these words this account's? Its backup key is on chain (two nodes), and they make the hot root this device keeps. */
  private async wordsAreThisAccount(accountId: string, seed: Uint8Array): Promise<boolean> {
    const root = await this.vault.get(HOT_ROOT);
    if (root && !equalBytes(root, hotRoot(seed))) return false;
    const recovery = SoftwareKey.fromSeed(seed, "recovery-words");
    try {
      const k = await this.chain.accessKey(accountId, recovery.publicKey, await this.chain.commonBlock());
      return k?.permission.kind === "function-call" && k.permission.methods.includes("start_recovery");
    } finally {
      recovery.destroy();
    }
  }

  private async startRecovery(words: unknown, accountId: unknown): Promise<{ readyAtIso: string }> {
    if (await this.saved()) throw new ProblemError(securityProblems.accountExists());
    return this.startRecoveryWith(seedFromTyped(await this.typed(words, "restore")), accountId);
  }

  private async startRecoveryWith(seed: Uint8Array, accountId: unknown): Promise<{ readyAtIso: string }> {
    const recovery = SoftwareKey.fromSeed(seed, "recovery-words");

    // An index suggests which account holds this key; two nodes must confirm it before we believe it. The agreed block is
    // asked beside the index (speed, 2 Nov): kept a second, it is the one used below when the index answers in time;
    // otherwise a fresh one is read there, as before.
    void this.chain.commonBlock().catch(() => undefined);
    let candidates = typeof accountId === "string" ? [accountId] : await this.chain.accountsForKey(recovery.publicKeyHandle);
    for (let i = 0; i < 4 && candidates.length === 0; i++) {
      await new Promise((r) => setTimeout(r, this.indexRetryMs));
      candidates = await this.chain.accountsForKey(recovery.publicKeyHandle);
    }
    const block = await this.chain.commonBlock();
    // Speed (2 Nov): the reads that follow a match, asked beside the key check (one round trip, not three), at its block:
    // the account, its recovery reads, and the sheet's gas price. The key checks go first (a node takes four reads at
    // once). Each is still decided on where it was, in order.
    const keyReads = candidates.slice(0, 4).map((candidate) => this.chain.accessKey(candidate, recovery.publicKey, block));
    keyReads.forEach((read) => void read.catch(() => undefined));
    for (const candidate of candidates.slice(0, 2)) {
      void this.chain.account(candidate, block).catch(() => undefined);
      warmRecovery(this.chain, candidate, block);
    }
    void this.chain.gasPrice(block).catch(() => undefined);
    let found: string | null = null;
    for (const [i, candidate] of candidates.entries()) {
      const k = await (keyReads[i] ?? this.chain.accessKey(candidate, recovery.publicKey, block));
      const p = k?.permission;
      if (p?.kind === "function-call" && p.receiverId === candidate && p.methods.includes("start_recovery")) {
        found = candidate;
        break;
      }
    }
    if (!found) throw new ProblemError(securityProblems.wordsNoAccount());
    const acct = await this.chain.account(found, block);
    const before = acct && (await recoveryState(this.chain, found, codeOf(acct)!, block));
    if (before?.pending) throw new ProblemError(securityProblems.recoveryAlready(before.pending.readyAtIso));

    const device = await this.deviceKeys.make();
    await this.vault.put(RECOVERY_SEED, seed);
    // The hot wallets come back from the same words (hot-keys.ts); they're listed again once the account is this device's.
    await this.keepHotRoot(seed);
    await this.save({ accountId: found, stage: "recovering" });
    const newKey = bytesToBase64(new Uint8Array([2, ...decodePublicKey(device.publicKey)]));

    const signer = new DevSigner({ accountId: found, chain: this.chain, key: recovery, approve: this.approveOnSheet, nearUsd: () => this.sheetNearUsd() });
    const outcome = await signer.run(found, [call("start_recovery", { new_key: newKey })]);
    recovery.destroy();
    if (outcome.status !== "done") {
      await this.forget();
      throw new ProblemError(outcome.status === "problem" ? outcome.problem : securityProblems.recoveryDeclined());
    }
    const after = await this.status();
    if (!after.pending) throw new ProblemError(securityProblems.recoveryStopped());
    return { readyAtIso: after.pending.readyAtIso };
  }

  private async finishRecovery(): Promise<AccountInfo> {
    const s = await this.saved();
    if (s?.stage !== "recovering") throw new ProblemError(securityProblems.notReady());
    // Speed (2 Nov): the sheet's own reads (the words' key, the gas price) go out beside the recovery's, at its block, so
    // the sheet follows the checks without a round trip of its own. Nothing is decided before the checks below.
    const recovery = (await this.vault.get(RECOVERY_SEED)) ? await this.key(RECOVERY_SEED, "recovery-words") : null;
    let outcome: TxOutcome;
    try {
      const signer = recovery && new DevSigner({ accountId: s.accountId, chain: this.chain, key: recovery, approve: this.approveOnSheet, nearUsd: () => this.sheetNearUsd() });
      const finish = [call("finish_recovery", {}, FINISH_GAS)];
      if (signer) signer.warm([{ receiverId: s.accountId, actions: finish }], await this.chain.commonBlock());
      const { pending } = await this.status();
      if (!pending) {
        // The other phone cancelled. Start over from the words.
        await this.forget();
        throw new ProblemError(securityProblems.recoveryStopped());
      }
      if (Date.now() < Date.parse(pending.readyAtIso)) throw new ProblemError(securityProblems.recoveryWaiting(pending.readyAtIso));
      // Release 7: with a second device of age on the account, the finish needs its yes, or the words-only fallback.
      if (pending.canFinishAtIso && Date.now() < Date.parse(pending.canFinishAtIso)) throw new ProblemError(securityProblems.recoveryWaiting(pending.canFinishAtIso));
      if (!signer) throw new ProblemError(securityProblems.keyMissing());
      outcome = await signer.run(s.accountId, finish);
    } finally {
      recovery?.destroy();
    }
    if (outcome.status === "declined") throw new ProblemError(securityProblems.recoveryDeclined());
    if (outcome.status === "problem") throw new ProblemError(outcome.problem);

    await this.vault.delete(RECOVERY_SEED);
    await this.save({ accountId: s.accountId, stage: "ready", restoredAtIso: new Date().toISOString() });
    const state = await this.state();
    // The hot wallets the words make, listed again. A chain that can't be read now only delays one: asking for it later
    // makes the same key.
    await this.subwallets.rediscover(["trade", "private", "browser", "pay", "site"], this.chain.network === "mainnet").catch(() => []);
    return state.account!;
  }

  // ── Approval ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Ask the shell's sheet. Nobody listening means nobody can see the words, so the answer is "no". */
  /** One approval sheet at a time: a second request waits its turn, so it can never replace the words on screen. */
  private sheets: Promise<unknown> = Promise.resolve();
  private readonly approveOnSheet: Approve = (asked, next) => {
    // Every sheet opens here: whatever built the words, they are readable as they stand (audit CORE-02).
    const words = readableWords(asked);
    // A key with its own sheet (the phone's chip, S1.6): that sheet is the one sheet. It is told these exact words and
    // an id, and the next approval waits until it has closed.
    if (next) {
      const turn = this.sheets.then(() => (next.shown(words, hex(crypto.getRandomValues(new Uint8Array(16)))), true));
      this.sheets = turn.then(() => next.finished).catch(() => undefined);
      return turn;
    }
    const turn = this.sheets.then(() => this.showSheet(words)).then((yes) => this.steppedUp(yes, words));
    this.sheets = turn.catch(() => undefined);
    return turn;
  };

  /** D143 on the web: the sheet's yes counts only with a fresh check that the person is there (safeStepUp). A no on the
   *  sheet asks nothing more; a check that doesn't pass is refused by name (a ProblemError), and nothing is signed.
   *  Rule 4 (phone test, 5 Nov: a Solana sale asked Face ID): a hot key's one-tap sheet (`tap`, set only by the core's
   *  own hot-key sheets: hot-sheets.ts, subwallets.ts capSheet, near-coin.ts) is the whole ask; the passkey is the Safe's,
   *  and a send to an outside address past the cap (its sheet has no `tap`: subwallets.ts faceIdIf) still asks it. */
  private async steppedUp(yes: boolean, words: PlainWords): Promise<boolean> {
    // the web wallet: its step-up is the password on the sheet itself (answerWeb), never a passkey
    if (!yes || this.nativeSheet || !this.safeStepUp || this.web || words.tap === true) return yes;
    if (await this.safeStepUp(words.title).catch(() => false)) return true;
    throw new ProblemError(securityProblems.safeNotVerified());
  }

  private showSheet(words: PlainWords): Promise<boolean> {
    if (this.nativeSheet) return this.nativeSheet(words).then((yes) => yes === true, () => false);
    return new Promise<boolean>((resolve) => {
      if (!this.listeners.get("approval.needed")?.size) return resolve(false);
      const id = hex(crypto.getRandomValues(new Uint8Array(16)));
      const timer = setTimeout(() => settle(false), this.approvalTimeoutMs);
      const settle = (approve: boolean) => {
        clearTimeout(timer);
        this.approvals.delete(id);
        resolve(approve);
      };
      this.approvals.set(id, settle);
      // D146: the app that asked rides with it, so the shell's sheet shows only while that app is on screen
      // The web wallet's sheet asks for the password with Approve (answerWeb)
      this.emit("approval.needed", { id, words, ...(words.asker ? { app: words.asker } : {}), ...(this.web ? { password: true } : {}) });
    });
  }

  /** The web wallet's sheet: a yes counts only with the password typed on it (a wrong one is counted toward the wait, and
   *  the sheet stays open to type it again); a no needs nothing. Never a passkey: the web wallet has none. */
  private async answerWeb(id: unknown, approve: unknown, password: unknown): Promise<{ ok: true }> {
    if (typeof id !== "string" || !this.approvals.has(id)) throw new ProblemError(securityProblems.notReady());
    if (approve === true) await this.web!.passwordFirst(password);
    const settle = this.approvals.get(id);
    if (!settle) throw new ProblemError(securityProblems.notReady());
    settle(approve === true);
    return { ok: true };
  }

  /** Trade on the web (WEB_TRADE): open once per unlock (a lock reloads the page, so this starts false again). */
  private webTradeOpen = false;
  private webTradeAsk: Promise<void> | null = null;
  private openWebTrade(): Promise<void> {
    return (this.webTradeAsk ??= this.approveOnSheet({ title: "Trade from this browser", lines: ["After this, trades under your limits need no password. That lasts until ZeroFee locks."], warnings: [], effect: [], asker: "trade", tap: true })
      .then((yes) => {
        if (!yes) throw new ProblemError(securityProblems.webTradeDeclined());
        this.webTradeOpen = true;
      })
      .finally(() => {
        this.webTradeAsk = null;
      }));
  }

  private async answer(id: unknown, approve: unknown): Promise<{ ok: true }> {
    const settle = typeof id === "string" ? this.approvals.get(id) : undefined;
    if (!settle) throw new ProblemError(securityProblems.notReady());
    settle(approve === true);
    return { ok: true };
  }

  private emit(event: string, payload: unknown): void {
    this.stateEpoch++; // a recovery, a held change, a session ending: account.state is read fresh
    for (const handler of this.listeners.get(event) ?? []) {
      try {
        handler(payload);
      } catch {
        // A broken listener must not stop the core.
      }
    }
  }
}

/** Typed words → the 32-byte seed, or a Problem naming exactly what is wrong. */
function seedFromTyped(words: unknown): Uint8Array {
  const list = Array.isArray(words) ? words.map(String) : typeof words === "string" ? [words] : [];
  const problem = wordsProblem(list);
  if (problem?.kind === "count") throw new ProblemError(securityProblems.wordsCount(problem.got));
  if (problem?.kind === "unknown-word") throw new ProblemError(securityProblems.wordUnknown(problem.position));
  if (problem?.kind === "checksum") throw new ProblemError(securityProblems.wordsChecksum());
  return wordsToSeed(list);
}

/** A release's sha256 as the contract names it (base64 of 32 bytes), in hex; anything else: null. */
function shaHexOf(b64: unknown): string | null {
  if (typeof b64 !== "string") return null;
  try {
    const bytes = base64ToBytes(b64);
    return bytes.length === 32 ? hex(bytes) : null;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
