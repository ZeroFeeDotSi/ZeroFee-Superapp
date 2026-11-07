// MockBridge: a stand-in for the whole bridge, so an app can build and test its screens before the real layers land.
// It answers every method in docs/interfaces.md with realistic sample data, approves every signature by default, moves
// movements from "moving" to "done" with events, and can be told to answer any method with a Problem (to preview every
// error screen) or to decline signatures.
//
// Development and tests only. Nothing here holds a real key, and the sample addresses are made up. The one network it
// touches is NEAR, read-only, for Chat's NEAR reads when the web demo passes options.nearReads (J3 part 2). Never
// show one outside a screen marked "Sample data".
import { hiddenCoin } from "@zerofee/core/hidden-coins";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { APP_STORE_NAME } from "@zerofee/core/app-store";
import { isPairingCode } from "@zerofee/core/pairing-code";
import type { Problem } from "@zerofee/core/problem";
import type { AccountInfo, PlainWords, RecoveryPending, TxOutcome, TxRequest } from "@zerofee/core/signer";
import { KNOWN_COINS, NATIVE as WALLET_NATIVE } from "@zerofee/core/evm";
import type { EvmWalletChain } from "@zerofee/core/evm";
import { createFloatMock, SAMPLE_NEAR_COINS, type FloatMockOptions, type FloatMove, type FloatSnapshot } from "./mock-float.ts";
import { approvalWords } from "./approval-words.ts";
import { SIM_KEY_KIND } from "./key-place.ts";
import { needWords } from "@zerofee/core/rule-words";
import { SHOW_NEW_WORDS } from "@zerofee/core/show-new-words";
import { defaultBands, recoveryChoices, shortFingerprint, type KeyProof } from "@zerofee/core/demo-core";
import { securityProblems } from "@zerofee/core/security-problems";
import { dollarWords, fourPlacesText, outsideShort, titleMoney } from "@zerofee/core/format";
import { endsTitle } from "@zerofee/core/onward-ends";
import { ProblemError } from "@zerofee/core/problem";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { SAFE_SEND_FILL_OPEN } from "@zerofee/core/safe-send-fill-open";
import { LEG_WORDS, SEND_LEG_WORDS, fillStepUsd, privateRows, privateShort, quoted, sendTitle } from "@zerofee/core/private-route";
import { moveSheet, moveSplitUsd, othersForSheet, sheetOthers } from "@zerofee/core/move-plan";
import { NETWORK_FEE_USD } from "@zerofee/core/float-floors";
import { FEES_KEPT } from "@zerofee/core/zero-fee";
import { AGENT_PRIVATE_ROUTE, AGENT_TOP_UP_OFF } from "@zerofee/core/agent-route";
import { ownWalletWords } from "@zerofee/core/own-wallet-words";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Chain } from "@zerofee/core/chain";
import { ChatKeys } from "@zerofee/core/chat-keys";
import { sha256 } from "@noble/hashes/sha2.js";
import { daoPolicy, daosOf, keyOnAccount, nearProfile, networkOf } from "@zerofee/core/chat-reads";
import { base58 } from "@zerofee/core/sol/bytes";
import { SITE_WALLETS, hostSite, siteWallet } from "@zerofee/core/site-hosts";
import { ADD_LEAST_USD, ADD_OPEN, ADD_SHOWN_MS, ADD_USED, COIN_SHOWN_DECIMALS, REQUEST_MOST_USD, type AddAddress, type AddChain } from "@zerofee/core/add-outside";

/** The real ledger's refusal of a Send's fill while it is shut (wallet-problems.ts safeSendShut, word for word: a test
 *  holds them equal). */
export const SAFE_SEND_SHUT: Problem = {
  code: "ledger.safe-send.shut",
  whatHappened: "Sending from your Safe opens soon. Your money is still in your Safe.",
  money: { state: "safe", where: "in your Safe" },
  next: { kind: "nothing", label: "Go back" },
};

/** A sample account name of the web demo: never a real account (the demo's accounts are made up, per browser). */
export const SAMPLE_ACCOUNT = /^zf-sample\d{6}\.testnet$/;
/** A sample account's "key" (J3 part 2): derived from its name, public by design (sample money only). The demo signs
 *  its sample Chat names with it, and only this mock's ledger.accountKey takes it, for sample names; the core and the
 *  real ledger never know it (diff review L2). */
export function sampleAccountSecret(account: string): Uint8Array {
  return sha256(new TextEncoder().encode(`ZeroFee sample account key\n${account}`));
}

export interface MockOptions {
  /** This demo's own sample account name (the web demo's ?demo: each browser its own, demo-start.ts demoAccountId), so
   *  two demo windows are two people and one can pay the other (J3 C1). Default: SAMPLE_ACCOUNT_ID. */
  accountId?: string;
  /** The web demo's laptop: only SAMPLE_LAPTOP_CODE adds a second device, any other code is refused before the sheet. */
  sampleLaptop?: boolean;
  /** The Sim's backup words after `round` sets of new words (round 0: the account's own). With it, recovery.renew gives
   *  the next round's words, recovery.renewConfirm replaces them through the sheet and the rules (QA sd-security (a), (b)),
   *  and recovery.check compares typed words with the account's. */
  sampleWords?: (round: number) => string[];
  /** Answer these methods with this Problem instead of data, e.g. { "ledger.withdraw": someProblem }. */
  fail?: Record<string, Problem>;
  /** Every signature the person "approves" comes back declined instead. */
  decline?: boolean;
  /** Pretend network time per call (default 250 ms). */
  latencyMs?: number;
  /** How long a movement stays "moving" before "done" (default 2500 ms). */
  settleMs?: number;
  /** Tests: the timer the timed steps (a movement settling, a credit landing) run on, in place of setTimeout, so a test
   *  that reads a movement before it settles holds them on its own clock, never on the wall clock (default: setTimeout). */
  timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
  /**
   * The coin list ledger.tokens answers with. Pay passes its recorded 1Click list (RECORDED_TOKENS from
   * @zerofee/pay/testing/recorded-tokens.ts) so sample payment codes resolve to real coins; the default is a short list.
   */
  tokens?: MockToken[];
  /**
   * Every tx.request comes back `waiting` for this many seconds, as when the account's protection holds a big payment.
   * The held request then shows in account.waiting, and account.waiting.run / .cancel act on it (the shell's Waiting
   * screen calls those; apps only pass the outcome to useShell().showWaiting).
   */
  holdSeconds?: number;
  /**
   * Ask the approval sheet before signing (tx.request, subwallet.sign, and the ledger's pay / transfer / withdraw /
   * convert): `approval.needed { id, words }` goes out and the answer waits for `approval.answer { id, approve }`;
   * "no" is `declined` (a Problem ending in .declined from the ledger). Default true, but only when something is
   * listening for `approval.needed` (the demo's sheet); with nobody listening, as in tests, it signs at once.
   */
  askApproval?: boolean;
  /**
   * A mainnet account waiting for its NEAR: `account.state` says `needs-funding`, and each `account.create` answers
   * `needs-funding` with the next amount from `haveYocto` (the last repeats), until `arrivesAfterCalls` calls have been
   * made (default: one per amount); after that `account.create` returns the account. Sample data: nothing is watched.
   */
  needsFunding?: { needYocto: string; haveYocto: string[]; fundAddress?: string; arrivesAfterCalls?: number };
  /** The web demo's sample account starts with Hidden set up and holding this much (QA, V4 Send): a demo walk shows
   *  Pay → Approve → Paid. Only the web demo passes it; a real account is never this bridge. */
  hiddenStart?: { usdc: string; near: string };
  /** The Move route's Safe → Private fill (core safe-fill-open.ts, VITE_SAFE_FILL_OPEN): tests set it; the Sim reads the build's. */
  safeFillOpen?: boolean;
  /** The web demo: a brand-new account has no history from before it existed (3 Nov e2e walk, 143: a set-up minutes old
   *  listed "Kiosk · 1 h", "Received · 3 h", "Sent · Yesterday"). Activity starts empty; tests keep the sample rows. */
  freshHistory?: boolean;
  /** Chains with a sample trading wallet from the start (Solana always); ?demo passes ["sol", "hood", "bsc"]. */
  tradeChains?: string[];
  /**
   * A sample only (ST13's proof shots; the dev demo's ?gmgnbnb, never the public build): GMGN gets a BNB wallet holding
   * this many dollars of BNB, and Take out moves it home as it does Solana. The real core has no GMGN BNB wallet and
   * moves a site's wallet home on Solana only (subwallets.ts siteMoveBack): this stands in for a second funded wallet.
   */
  sampleGmgnBnbUsd?: number;
  /**
   * ZeroFee Chat's NEAR reads (J3 part 2: ledger.accountKey, ledger.daoPolicy, ledger.nearProfile, ledger.daosOf, and
   * ledger.recipientInfo for a real name), read-only on NEAR itself: the web demo passes core's RpcChain per network.
   * Without it (tests) nothing here touches a network: a real name reads as not found, sample names as samples.
   */
  nearReads?: (network: "mainnet" | "testnet") => Pick<Chain, "network" | "commonBlock" | "accessKey" | "view" | "account"> | undefined;
  /** Trade's float: how long its moves take, how they end, and its dollars at the start (mock-float.ts). */
  float?: FloatMockOptions;
  /**
   * `?demo&keep`: the whole sample state is saved here (debounced, and at once when a timed move lands or the page
   * hides) and read back when the mock is made, so a reload carries on exactly where it was. Timed moves keep their
   * absolute due times: what's left is re-armed, anything already due lands at once, each exactly once.
   */
  persist?: { storage: Pick<Storage, "getItem" | "setItem">; key?: string };
  /**
   * The account contract's own rules (contracts/account-policy/src/lib.rs), so the public ?demo behaves as the real app:
   * - every payment counts toward a rolling 24-hour total in dollars, and the first band that covers the total with it
   *   decides: Face ID runs at once; a wait (or a second device) holds it in account.waiting, cancellable until then;
   * - a payment at a partner's price (a swap, a cross-chain pay) that would be held is refused before the sheet, as the
   *   core refuses it (securityProblems.quoteCantWait): its price lasts a minute;
   * - every change to the protection or the keys waits the change wait (the recovery delay plus up to 24 hours: 3 days on
   *   the default 48-hour account, release 7), tighter or looser, so the backup words can stop it first;
   * - while a recovery is open (freeze(), startRecovery()), every payment waits that long too.
   * A hold lasts its real wait (`demoWaitSeconds` in tests); account.waiting.skip moves one to its end (the web demo's
   * "Skip ahead", which only this bridge lists).
   */
  mainnetRules?: { demoWaitSeconds?: number };
  /** The sample account's name and network (default: zf-sample000001.testnet on testnet). The public ?demo passes a
   *  neutral name on mainnet, so no testnet word shows there. */
  account?: { accountId: string; network: AccountInfo["network"] };
  /** Security's Quantum-safe card, its other state: a classical (ed25519) key left on the account, e.g. a set-up key
   *  that survived a recovery. It lists as another phone's key, as the core lists one, and Remove takes it off. */
  oldKey?: boolean;
}

/** The saved blob's version: a blob with another one (or one that doesn't parse) is dropped and the demo starts fresh. */
export const MOCK_STATE_VERSION = 1;
/** How long an Add into the apps wallet takes to land in the demo (a Solana transfer's second, not the 2.5 s cross-chain send). */
export const APPS_WALLET_SETTLE_MS = 400;
export const MOCK_STATE_KEY = "zerofee.demo.keep";
/** Each timed step the mock owes, by what it does (never a closure), so a restore can do it exactly as the first page would have. */
type JobWork =
  | { kind: "settle"; movementId: string; ends: string; balances: boolean }
  | { kind: "float.credit"; micro: string }
  | { kind: "private.land"; amount: string; rowIndex: number }
  | { kind: "private.home"; tokenId: string; amount: string; usd: string }
  /** A Move's leg paid from Private: its movement ends and the wallet has it (a chain wallet's own coin, or the NEAR wallet's USDC). */
  | { kind: "private.pay"; movementId: string; wallet: string; usd: number };
type Job = JobWork & { id: number; dueAt: number };
let warnedFresh = false;

/** One coin, as ledger.tokens returns it (Pay's Token shape). */
export interface MockToken { assetId: string; chain: string; symbol: string; decimals: number; contract: string | null; priceUsd?: string; name?: string; icon?: string }

export interface MockBridge extends Bridge {
  /** Fire an event by hand, e.g. mock.emit("recovery.started", { readyAtIso }). */
  emit(event: string, payload: unknown): void;
  /** With `persist`: save the whole state now (pagehide calls it). Without: nothing. */
  flush(): void;
  /** ?demo's "Try: someone starts a recovery": until `untilIso` payments wait (mainnetRules), as on chain; null ends it. */
  freeze(untilIso: string | null, pending?: { readyAtIso: string } | null): void;
  /**
   * ?demo's move to a new device, release 7 (lib.rs): the backup words start it now. With the account's laptop (added here
   * when it has none, `laptop`), the finish needs the laptop's yes after the delay (secondDevice.answer), or the
   * words-only fallback; the laptop can refuse it; payments wait until the earliest finish. Emits recovery.changed.
   */
  startRecovery(options?: { laptop?: boolean }): RecoveryPending;
  /** The Sim's backup words now (options.sampleWords): what its "Fill in this account's words" helper types. */
  sampleWordsNow(): string[] | null;
}

/** The code the demo's laptop shows when it is added (Security, Add my laptop): a pairing code's shape, "ZFL1:" and about
 *  3,100 letters, and the letters a person checks on both screens. Only this code adds the demo's laptop; any other is
 *  refused before the sheet ("That isn't the code your laptop shows"), never accepted. */
// sd-security (h): no look-alike of the letters inside the code (it held "K7Q2M3XA" beside the letters K7Q2 M9XA: a person
// comparing the two read a mismatch). The letters are a check of the code, never a piece of it.
export const SAMPLE_LAPTOP_CODE = `ZFL1:${"QPZLHN3RWVYT6JDG".repeat(196).slice(0, 3123)}A`;
export const SAMPLE_LAPTOP_LETTERS = "K7Q2 M9XA";
/** The demo laptop's key handle (the sample second device). */
const LAPTOP_HANDLE = "ml-dsa-65-hash:Qz8mLaptopKeyH4nd1e00000000000000000003";
/** R7-1, the laptop's words for its own removal (SecondDeviceCore's REMOVAL_WARNING). */
const REMOVAL_WARNING = "Not you? Use your 24 words to move your account to a new device.";

/** The public web demo's account name: no network word, and short and dotless, so no one can create it on NEAR (names
 *  under 32 characters without a dot are the registrar's alone): nothing sent to it can land anywhere. */
export const PUBLIC_SAMPLE_ACCOUNT_ID = "zf-account";
/** The key "Show its key" shows in the demo: key-shaped, but it holds "0" and "l", which base58 has no letters for, and
 *  it is neither 64 hex nor backup words, so no wallet on any chain can read it (MockBridge.addresses.test.ts). */
export const SAMPLE_KEY = "qRsDB0Plju5bT9fV0Mjsl7VfVRb0MKuDbloZHP03BdRRFZl3m0o9jP3f53Ml0qbFRRVohPy0lFRD5ZB7Bo0Xfl7F";
/** The demo's own deposit targets, each unusable on its chain (MockBridge.addresses.test.ts runs each chain's check):
 *  Solana with "0" and "I" (not base58); EVM in mixed case with the wrong EIP-55 checksum; Bitcoin failing bech32;
 *  Stellar with "0" (not base32); NEAR implicit-looking ids in capitals (no NEAR account has one). */
export const SAMPLE_SOL = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";
// Shaped like a real address (3 Nov e2e walk, 144: "0x5a 3E00 0000 … 005a 3E", mostly zeros, read as a placeholder), still
// mixed case with the wrong EIP-55 checksum.
export const SAMPLE_EVM = "0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39";
/** The apps wallet (the Browser wallet on Solana) in the demo: its own made-up address ("0", "O", "I" and "l", not
 *  base58), so its sample money is never the trading wallet's. It reads as no words: it was once a sentence about
 *  sample money, shown on a sheet and in Activity (grade 1 Nov, item 5); no screen names it now either. */
export const SAMPLE_SOL_SOCIAL = "Vxcwr0VZweDCtlXhgsC7VLO6btymh3f0VipgiBI1va54";
export const SAMPLE_BTC = "bc1qzf0wa11etb1t000000000000000000000000";
export const SAMPLE_XLM = "GZF0WALLET0000000000000000000000000000000000000000000000";
/** Trading's cash on NEAR, and Hidden's account, in the demo: shaped like an implicit id, never "F1F1 … F1F1" (3 Nov e2e
 *  walk, 144: read as a placeholder). 66 hex in capitals: no NEAR account has capitals, and a NEAR account is at most 64
 *  characters, so even lowercased (Pay's findTyped lowercases what is typed) it is no account (security review M1). */
export const SAMPLE_FLOAT = "B1DEB8CAD259EE3E38403A563E54C7104A4278E3B6D796AEC84488914639FAA6F4";
export const SAMPLE_POCKET = "1C7B7DFCF6426A856CA0DC51F03EDE72DA6D61ABD650CEE0A39A5F993768CA9297";

/**
 * Add's one-time addresses in the demo (D127): a new one per ask (the same key gives the same one), shaped like the
 * chain's own, and taken by NO wallet on any chain (MockBridge.add-address.test.ts): Solana's is 44 base58 letters
 * starting with "z", worth over 2^256, so no 32-byte key; an EVM one has 41 hex digits, which no EVM wallet takes, even
 * lowercased (the security review of f614dc72: a valid lowercase form could be someone's). The sheets label them
 * "Sample" (finding 56: `sample: true`).
 */
export function sampleAddAddress(chain: string, key: string): string {
  let h = 0x811c9dc5;
  for (const c of `${chain}:${key}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  const next = () => {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h;
  };
  if (chain === "sol") {
    // finding 56: base58 letters only, so it reads like a Solana address; it starts with "z" (57), so its 44 letters
    // are worth over 2^256 and decode to 33 bytes: no Solana key, as written or lowercased
    const b58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    return ["z", ...Array.from({ length: 43 }, () => b58[next() % b58.length]!)].join("");
  }
  const hex = Array.from({ length: 41 }, () => "0123456789abcdef"[next() % 16]!).map((c) => (/[a-f]/.test(c) && next() % 2 ? c.toUpperCase() : c));
  return `0x${hex.join("")}`;
}

/** "1 day", "8 days", "2 minutes": a wait in words. */
export function waitWords(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds >= 86400) return unit(Math.round(seconds / 86400), "day");
  if (seconds >= 3600) return unit(Math.round(seconds / 3600), "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}

/** A sample implicit address (64 hex) for the funding screen. Not anyone's account. */
const SAMPLE_FUND_ADDRESS = "5B1E3F0A9C7D4E2B8A6F1D3C5E7A9B0C2D4F6E8A1B3C5D7E9F0A2B4C6D8E0F13";

/** The one sample account name: ?demo's Security and Wallet both show it (Screens.tsx takes it from here). */
export const SAMPLE_ACCOUNT_ID = "zf-sample000001.testnet";
const ACCOUNT: AccountInfo = {
  accountId: SAMPLE_ACCOUNT_ID,
  network: "testnet",
  keys: [
    { handle: "ml-dsa-65-hash:Qz8mDeviceKeyH4nd1e000000000000000000001", role: "device", kind: "development", current: true },
    { handle: "ml-dsa-65-hash:Qz8mRecoveryKeyH4nd1e0000000000000000002", role: "recovery", kind: "recovery-words" },
    { handle: "ml-dsa-65-hash:Qz8mAgentZeroKeyH4nd1e000000000000000003", role: "agent", kind: "development" },
  ],
  recovery: { delaySeconds: 172800, pending: null },
};

/** A classical key as NEAR lists it (the key itself, never an "ml-dsa-65-hash:" handle): `oldKey`'s. */
export const OLD_KEY_HANDLE = "ed25519:7Xq2SampleOldKey9mT4";
/** `oldKey`'s keys: the leftover full-access one, and a session key (classical on purpose, a function-call key the
 *  contract's role gates refuse), which Security lists but never counts against Quantum-safe. */
const OLD_KEYS: AccountInfo["keys"] = [
  { handle: OLD_KEY_HANDLE, role: "device", kind: "development", access: "full" },
  { handle: "ed25519:4Rm8SampleSessionKey2", role: "session", kind: "development", access: "function-call" },
];

const CHAINS = [
  { id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR" },
  { id: "sol", name: "Solana", icon: "sol", nativeSymbol: "SOL", minDeposit: "0.00125" },
  { id: "base", name: "Base", icon: "base", nativeSymbol: "ETH", minDeposit: "0.001" },
  { id: "eth", name: "Ethereum", icon: "eth", nativeSymbol: "ETH", minDeposit: "0.005" },
  { id: "btc", name: "Bitcoin", icon: "btc", nativeSymbol: "BTC", minDeposit: "0.0002" },
  { id: "bsc", name: "BNB Chain", icon: "bsc", nativeSymbol: "BNB", minDeposit: "0.01" },
  { id: "hood", name: "Robinhood Chain", icon: "hood", nativeSymbol: "ETH", minDeposit: "0.000000000000000001" },
  { id: "stellar", name: "Stellar", icon: "xlm", nativeSymbol: "XLM" },
];

/** Each chain's own coin: 1Click's asset ids (Robinhood Chain's from the live list, checked by Wallet on 25 Oct). */
const NATIVE: Record<string, string> = {
  near: "nep141:wrap.near",
  sol: "nep141:sol.omft.near",
  base: "nep141:base.omft.near",
  eth: "nep141:eth.omft.near",
  btc: "nep141:btc.omft.near",
  hood: "nep141:hood.omft.near",
  bsc: "nep245:v2_1.omni.hot.tg:56_11111111111111111111",
  stellar: "nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz",
};

/** Whether the demo's Receive takes `token` on `chain` (ledger.depositAddress): none (the chain's own coin), an asset id,
 *  or "near" on NEAR (Wallet's ledger's NATIVE_NEAR: the account's own NEAR, by name). A bare symbol is a coin it doesn't know. */
export function mockReceives(chain: string, token: unknown): boolean {
  if (token === undefined || token === null) return true;
  if (typeof token !== "string") return false;
  if (token === "near") return chain === "near";
  return token.includes(":");
}

/** A coin as a person reads it in a Problem: its symbol when the demo knows it, else "That coin". Never an id. */
export function coinWords(token: unknown): string {
  if (token === "near") return "NEAR";
  const known = [...BALANCES, ...DEFAULT_TOKENS.map((t) => ({ tokenId: t.assetId, symbol: t.symbol }))].find((t) => t.tokenId === token)?.symbol;
  if (known) return known;
  return typeof token === "string" && /^[A-Za-z]{2,10}$/.test(token) ? token.toUpperCase() : "That coin";
}

/** The bridge's minimum for the coin asked for: the chain's own coin has the chain's; USDC is 1; any other coin: none known. */
function depositMinimum(c: { id: string; minDeposit?: string }, token: unknown): string {
  if (token === undefined || token === null || token === NATIVE[c.id]) return c.minDeposit ?? "0";
  return token === USDC_BASE || token === USDC_SOL || token === USDC_NEAR ? "1" : "0";
}

/** Made-up deposit addresses in each chain's shape. Not anyone's: never show one outside a "Sample data" screen. */
const SAMPLE_ADDRESS: Record<string, string> = {
  near: ACCOUNT.accountId,
  sol: SAMPLE_SOL,
  base: SAMPLE_EVM,
  eth: SAMPLE_EVM,
  btc: SAMPLE_BTC,
  bsc: SAMPLE_EVM,
  hood: SAMPLE_EVM,
  stellar: SAMPLE_XLM,
};
/** A made-up Gnosis Pay card account (a Safe on Gnosis Chain) that card.check says yes to in the demo. */
export const SAMPLE_CARD = "0x2527" + "0".repeat(32) + "f10d"; // 40 hex characters, a valid EVM address
/** Chains that need a memo with every deposit. */
const MEMO: Record<string, string> = { stellar: "5013" };

// Real NEAR Intents asset ids (1Click's list), so codes for these coins resolve; a little USDC on Solana and on Base so
// the demo can pay codes for coins the account holds.
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** 1Click's fee on a Convert in the Sim (its quote's own note: "about 0.2%"). */
const CONVERT_FEE = 0.002;
/** "1240.5" → 1240500000n: a USDC amount (6 decimals) in smallest units, exactly. */
const toMicro = (amount: string): bigint => {
  const [w, f = ""] = amount.replace(/^-/, "").split(".");
  const n = BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  return amount.startsWith("-") ? -n : n;
};
/** 1239977735n → "1239.977735", trailing zeros dropped. */
const fromMicro = (n: bigint): string => {
  const a = n < 0n ? -n : n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n < 0n ? "-" : ""}${a / 1_000_000n}${frac ? `.${frac}` : ""}`;
};

const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
/** What the bridge credits on each network (Chain.coins): the chain's own coin, plus USDC where the sample has it. */
const COINS: Record<string, string[]> = { near: ["nep141:wrap.near", USDC_NEAR], sol: ["nep141:sol.omft.near", USDC_SOL], base: ["nep141:base.omft.near", USDC_BASE], eth: ["nep141:eth.omft.near", "nep141:eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near"] };
const BALANCES = [
  { tokenId: USDC_NEAR, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "1240.5", usd: "1240.5", bridged: false, held: "ledger", listed: true },
  // Sent from a NEAR wallet: in the account itself, not the ledger (D14). Counts in the one balance all the same.
  { tokenId: USDC_NEAR, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: "60", usd: "60", bridged: false, held: "account", listed: true },
  { tokenId: USDC_SOL, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "sol", amount: "42.1", usd: "42.1", bridged: true, held: "ledger", listed: true },
  { tokenId: USDC_BASE, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "base", amount: "18", usd: "18", bridged: true, held: "ledger", listed: true },
  { tokenId: "nep141:wrap.near", symbol: "NEAR", name: "NEAR", icon: "near", chain: "near", amount: "312.4", usd: "1383.93", bridged: false, held: "ledger", listed: true },
  // NEAR on the account itself (a NEAR wallet sent it): what can be spent, its storage and the fee reserve already left
  // out, as Wallet's ledger shows it. It pays an Add to Trading too (tokenId "near": wrapped and sent in one transaction).
  { tokenId: "near", symbol: "NEAR", name: "NEAR", icon: "near", chain: "near", amount: "12.5", usd: "55.37", bridged: false, held: "account", listed: true },
  { tokenId: "nep141:sol.omft.near", symbol: "SOL", name: "Solana", icon: "sol", chain: "sol", amount: "4.82", usd: "490.43", bridged: true, held: "ledger", listed: true },
  { tokenId: "nep141:eth.omft.near", symbol: "ETH", name: "Ether", icon: "eth", chain: "eth", amount: "0.415", usd: "974.22", bridged: true, held: "ledger", listed: true },
  { tokenId: "nep141:btc.omft.near", symbol: "BTC", name: "Bitcoin", icon: "btc", chain: "btc", amount: "0.0123", usd: "989.6", bridged: true, held: "ledger", listed: true },
  // No unlisted coin in the sample: a judge read "Unlisted coin · Calls itself USDC" as a bug. How an unlisted coin is
  // kept apart is tested in packages/wallet/src/app/format.test.ts.
];

// USDC at $1 in the sample, as its rows count it (usd = amount) and tokenPrice prices it: at 0.999545 a $25.00 send read
// "$24.99" in Activity (a web test). The Sim's money adds up to the cent.
const DEFAULT_TOKENS: MockToken[] = [
  { assetId: USDC_NEAR, chain: "near", symbol: "USDC", decimals: 6, contract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", priceUsd: "1", name: "USD Coin", icon: "usdc" },
  { assetId: USDC_SOL, chain: "sol", symbol: "USDC", decimals: 6, contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", priceUsd: "1", name: "USD Coin", icon: "usdc" },
  { assetId: USDC_BASE, chain: "base", symbol: "USDC", decimals: 6, contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", priceUsd: "1", name: "USD Coin", icon: "usdc" },
  { assetId: "nep141:wrap.near", chain: "near", symbol: "NEAR", decimals: 24, contract: "wrap.near", priceUsd: "4.43", name: "NEAR", icon: "near" },
  { assetId: "nep141:sol.omft.near", chain: "sol", symbol: "SOL", decimals: 9, contract: null, priceUsd: "101.75", name: "Solana", icon: "sol" },
  { assetId: "nep141:eth.omft.near", chain: "eth", symbol: "ETH", decimals: 18, contract: null, priceUsd: "2347.51", name: "Ether", icon: "eth" },
  // A euro stablecoin, so a SEPA bank code has a rate in the demo (Pay's M3); 1Click lists EURe on mainnet.
  { assetId: "nep141:gnosis-0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430.omft.near", chain: "gnosis", symbol: "EURe", decimals: 18, contract: "0x420ca0f9b9b604ce0fd9c18ef134c705e5fa3430", priceUsd: "1.12", name: "EURe", icon: "eure" },
  // DAI on Ethereum, so Agent's "Add DAI" lands on a DAI network in the demo (Wallet picks the first network that receives it).
  { assetId: "nep141:eth-0x6b175474e89094c44da98b954eedeac495271d0f.omft.near", chain: "eth", symbol: "DAI", decimals: 18, contract: "0x6b175474e89094c44da98b954eedeac495271d0f", priceUsd: "0.9998", name: "Dai", icon: "dai" },
  { assetId: "nep141:btc.omft.near", chain: "btc", symbol: "BTC", decimals: 8, contract: null, priceUsd: "80456", name: "Bitcoin", icon: "btc" },
  // BNB Chain's own coin (1Click's id), at the recorded market's price, so a BNB trading wallet's coin has dollars in the demo.
  { assetId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", chain: "bsc", symbol: "BNB", decimals: 18, contract: null, priceUsd: "744.17", name: "BNB", icon: "bnb" },
  // The NEAR coins Home's Swap buys in place (mock-float.ts SAMPLE_NEAR_COINS, at its prices): Home names and prices what
  // the NEAR wallet holds from this list, so a coin bought in the Sim shows on Home (QA's Sim crawl, 5 Nov).
  ...Object.entries(SAMPLE_NEAR_COINS).filter(([id]) => id !== "nep141:eth.omft.near" && id !== "nep141:sol.omft.near" && id !== "nep141:wrap.near").map(([assetId, c]): MockToken => ({ assetId, chain: "near", symbol: c.symbol, decimals: c.decimals, contract: assetId.slice(7), priceUsd: String(c.usd), name: c.symbol, icon: c.symbol.toLowerCase() })),
];

/** An app's own words for a sheet (Trade's `why`, `label`): short, one line, no control characters. Else none. The core's words stay the title; these ride under it as a hint. */
function appWords(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t && t.length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/.test(t) ? t : undefined;
}
/** An amount for a sheet's title: at most 4 significant digits ("0.491787154" -> "0.4918"), no trailing zeros. */
function roundedAmount(x: unknown): string {
  const n = Number(x);
  if (!Number.isFinite(n) || n === 0) return n === 0 ? "0" : String(x ?? "");
  const k = Math.floor(Math.log10(Math.abs(n))) - 3;
  const r = k > 0 ? String(Math.round(n / 10 ** k) * 10 ** k) : n.toFixed(Math.min(-k, 20)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return r;
}

/** The core's `about`: an amount rounded DOWN to 4 significant digits, "about" only when that changed it (intents.ts). */
export function aboutAmount(x: unknown): { exact: string; title: string } {
  const t = String(x ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return { exact: t, title: t };
  const [i, f = ""] = t.split(".");
  const units = BigInt(i + f);
  const show = (n: bigint) => {
    const d = n.toString().padStart(f.length + 1, "0");
    const out = f.length ? `${d.slice(0, d.length - f.length)}.${d.slice(d.length - f.length)}` : d;
    return out.includes(".") ? out.replace(/0+$/, "").replace(/\.$/, "") : out;
  };
  const drop = 10n ** BigInt(Math.max(0, units.toString().length - 4));
  const exact = show(units), short = show(units - (units % drop));
  return { exact, title: short === exact ? exact : `about ${short}` };
}
const CHAIN_WORDS: Record<string, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", eth: "Ethereum", base: "Base", gnosis: "Gnosis", arb: "Arbitrum" };

/** Decimal-string maths for the mock's quotes, in millionths, so amounts never pick up float noise ("4.242000000000001"). */
const MICRO = 1_000_000n;
function micro(x: string): bigint {
  const [i, f = ""] = x.trim().split(".");
  return BigInt(i || "0") * MICRO + BigInt((f + "000000").slice(0, 6));
}
function decimal(n: bigint): string {
  const i = n / MICRO, f = (n % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}
/** A coin's smallest units as decimal text ("0.0515" for 51_500_000 lamports), every place kept. */
const unitsText = (n: bigint, decimals: number): string => {
  const d = 10n ** BigInt(decimals), f = (n % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${n / d}.${f}` : `${n / d}`;
};
/** Who a pay went to, as the real ledger keeps it (ledger.ts payeeText): the NEAR name, or the address as given. */
const payee = (to: unknown): { to?: string } => {
  const t = to as { kind?: unknown; accountId?: unknown; address?: unknown } | undefined;
  const who = t?.kind === "ledger" ? t.accountId : t?.kind === "chain" ? t.address : undefined;
  return typeof who === "string" && who.trim() ? { to: who.trim() } : {};
};
/** n × (1 + bps/10000), rounded up to the micro unit (a quote's "at most" never understates). */
const plusBps = (x: string, bps: number) => decimal((micro(x) * BigInt(10000 + bps) + 9999n) / 10000n);

// Sample rows link to no explorer: there is nothing on any chain to see.
const ACTIVITY = [
  { atIso: iso(-4 * 60e3), title: "Removed a key, so it can't sign for you any more", lines: [], by: "This device", ok: true, txHash: "sample1" },
  { atIso: iso(-3600e3), title: "Added your backup words", lines: [], by: "This device", ok: true, txHash: "sample2" },
];
/** A sample signature's outcome links nowhere (empty: the screens show no explorer button). */
const NO_EXPLORER = "";

function iso(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * A call this bridge has no answer for. It reaches the web demo's screens, which read as the product, so it says so
 * calmly, in the product's words: never "mock", never a method name (the method stays in the code, for tests).
 */
export const NOT_READY: Problem = {
  code: "mock.unknown",
  whatHappened: "This isn't available yet. Nothing was sent.",
  money: { state: "safe", where: "in your account" },
  next: { kind: "nothing", label: "Go back" },
};
const unknown = (_method: string): Problem => ({ ...NOT_READY });

const laptopCodeWrong = (): Problem => ({
  code: "security.pair.code-wrong",
  whatHappened: "That isn't the code your laptop shows.",
  money: { state: "not-involved" },
  next: { kind: "fix-input", label: "Paste the code again", field: "code" },
  more: "On your laptop, open ZeroFee and choose Second device. Copy the code it shows, then paste it here. Nothing was added.",
});
const invalidPairingCode = (kind?: unknown): Problem => securityProblems.pairingCodeWrong(kind === "guardian" ? "their ZeroFee" : "your laptop");

/** A protection band as the apps send it (docs/interfaces.md, account.protection.set). */
type Band = { upToUsd: number | null; level: "faceid" | "wait" | "device" | "both"; waitSeconds?: number };

/**
 * "Ask my laptop above $X" (or always), as the core cuts it (demo-core secondDeviceLimit): today's bands cut at X, the
 * second device added above it, each band keeping its wait; neighbours that ask for the same thing become one band.
 */
function limitBands(today: Band[], usd: unknown): Band[] | null {
  const always = usd === "always";
  if (!always && !(typeof usd === "number" && Number.isFinite(usd) && usd >= 1 && usd <= 1e9)) return null;
  const bands: Band[] = today.length ? today : [{ upToUsd: null, level: "faceid" }];
  const withDevice = (b: Band): Band => (b.level === "faceid" ? { ...b, level: "device" } : b.level === "wait" ? { ...b, level: "both" } : b);
  const cut = always ? 0 : Math.round(usd as number);
  const tops = [...new Set([...bands.map((b) => b.upToUsd).filter((t): t is number => t !== null && t > 0), ...(cut > 0 ? [cut] : [])])].sort((a, b) => a - b);
  const covering = (top: number | null) => bands.find((b) => top !== null && b.upToUsd !== null && top <= b.upToUsd) ?? bands[bands.length - 1];
  const pieces = [...tops, null].map((top, i) => {
    const band = { ...covering(top), upToUsd: top };
    return (i === 0 ? 0 : tops[i - 1]) >= cut ? withDevice(band) : band;
  });
  const merged: Band[] = [];
  for (const b of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.level === b.level && (last.waitSeconds ?? 0) === (b.waitSeconds ?? 0)) last.upToUsd = b.upToUsd;
    else merged.push({ ...b });
  }
  return merged;
}

/** account.protection.set's bands in the contract's shape, as account.protection.get returns them: each limit in USDC
 *  units and in wNEAR at the sample price, as rules saved today count every coin (every-coin.ts; a list without wNEAR is
 *  the older rules that hold NEAR at any size, which a new account never has). */
function demoBands(raw: unknown): unknown[] {
  return (Array.isArray(raw) ? raw : []).map((b: { upToUsd?: unknown; level?: unknown; waitSeconds?: unknown }) => {
    const seconds = String(Number(b?.waitSeconds) > 0 ? Number(b.waitSeconds) : 86400);
    const level = b?.level === "device" ? "Device" : b?.level === "wait" ? { Wait: { seconds } } : b?.level === "both" ? { Both: { seconds } } : "FaceId";
    const usd = Number(b?.upToUsd);
    const near = Number.isFinite(usd) && usd > 0 ? (BigInt(Math.round((usd / 4.43) * 1e6)) * 10n ** 18n).toString() : "0";
    return { up_to: b?.upToUsd == null || !(usd > 0) ? null : [["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", String(Math.round(usd * 1e6))], ["nep141:wrap.near", near]], level };
  });
}

/** The calls that go through the approval sheet first (when something listens for it; see MockOptions.askApproval). */
/** A Send's approval sheet (QA F4, linkability hunt, 5 Nov: never "privately"; the copywriter): what NEAR
 *  Confidential hides, and what it doesn't. A Send from a wallet shows that wallet in its first public step, so it says
 *  only the second half. */
export const SEND_UNNAMED = "Your account isn't named on the chain. The amount and time can still be matched.";
export const SEND_MATCHED = "The amount and time can still be matched.";
/** Where Home's Send lands, by the payee's chain (packages/wallet send-to.ts LANDS_AS, in a sheet's words). */
// "ETH (RH)" already says its network (D124): its lines never add "on Robinhood Chain"
/** What a Sim payout brings in dollars, of what leaves Private (1 %: the network's fees, named on the fill sheet). */
const SIM_PAYOUT_KEEPS = 0.99;
const LANDS_ID: Record<string, string> = { sol: "nep141:sol.omft.near", eth: "nep141:eth.omft.near", base: "nep141:base.omft.near" };
const SEND_LANDS: Record<string, { coin: string; network: string }> = {
  sol: { coin: "SOL", network: "Solana" }, hood: { coin: "ETH (RH)", network: "Robinhood Chain" }, eth: { coin: "ETH", network: "Ethereum" },
  base: { coin: "ETH", network: "Base" }, bsc: { coin: "BNB", network: "BNB Chain" }, near: { coin: "wNEAR", network: "NEAR" },
};
// D143 (core approval-policy.ts): only what the Safe's own account signs asks. A hot key's signature (a chain wallet's
// Send from Home, a site's transaction, a session, a NEAR wallet swap, a Move back) never does, as in the core.
/** A sheet's job, as the core reads it (dev-signer.ts TxRequest.job): a request's `job`, or a ledger call's own `job` (a
 *  Move's or Swap's key, private-move.ts), well formed only (16 to 64 letters, digits, - or _). Pure. */
export function jobKeyOf(method: string, params: Record<string, unknown>): string | undefined {
  const k = method === "tx.request" ? (params.request as { job?: unknown } | undefined)?.job : params.job;
  return typeof k === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(k) ? k : undefined;
}
const NEEDS_YES = new Set(["ledger.sendFromSafe", "subwallet.export","ledger.toTrading", "tx.request", "ledger.pay", "ledger.transfer", "ledger.withdraw", "ledger.convert", "ledger.toPrivate", "account.waiting.run", "account.waiting.cancel", "account.secondDevice.pair", "account.secondDevice.setLimit", "account.protection.set", "recovery.cancel", "account.agent.set", "account.agent.setBudget", "account.agent.revoke", "recovery.renewConfirm"]);
// New backup words are shown only after the person's yes, as the core (QA's real lap, k-trade3).
NEEDS_YES.add("recovery.renew");
// The Safe's swap in place (Native coins' Buy and Sell) is one tap, its receipt in the same sheet (the hard rule,
// via the design review, 5 Nov): no "Check this" sheet in the Sim. (The phone's Face ID is the core's, not this sheet.)
/** A "no" on the sheet for a ledger movement (docs/interfaces.md: a Problem whose code ends in .declined). */
const signatureDeclined = (): Problem => ({
  code: "ledger.signature.declined",
  whatHappened: "You said no, so nothing was sent.",
  money: { state: "safe", where: "in your Safe" },
  next: { kind: "nothing", label: "Go back" },
});
const answerUnknown = (): Problem => ({
  code: "security.approval.not-ready",
  whatHappened: "There's nothing waiting for that answer.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
});
// The core's own words for a held request that can't run (docs/interfaces.md, account.waiting.run).
const notYet = (untilIso: string): Problem => ({
  code: "security.waiting.not-yet",
  whatHappened: "It's still waiting.",
  money: { state: "safe", where: "in your Safe" },
  next: { kind: "wait", label: "Wait", untilIso },
});
/** SOL's sample price when the bridge is given none (options.float.priceUsd): the float's own default, so one price. */
const SIM_SOL_USD = 150;
/** AgentZero's copy job's sample leader's coins (agent AgentApp.tsx SAMPLE_BUYS) as the Sim's sample coins: a token of the
 *  Sim's own form and a sample price. Any other name: none (refused, nothing moved). */
const SAMPLE_JOB_COINS: Record<string, { token: string; symbol: string; name: string; priceUsd: number }> = {
  BONK: { token: "sim-bonk", symbol: "BONK", name: "Bonk", priceUsd: 0.0000247 },
  WIF: { token: "sim-wif", symbol: "WIF", name: "dogwifhat", priceUsd: 2.11 },
};
const sampleCoin = (symbol: unknown) => SAMPLE_JOB_COINS[String(symbol ?? "").toUpperCase()] ?? { token: "", symbol: String(symbol ?? "").slice(0, 10), name: "", priceUsd: 0 };
const linkProblem = (code: string, whatHappened: string): Problem => ({
  code,
  whatHappened,
  money: { state: "safe", where: "in the extension on your laptop" },
  next: { kind: "nothing", label: "Start again" },
});
/** An Add paid with a coin other than USDC: which coin, how much of it, and the sample price it converts at. */
type PayWith = { tokenId: string; amount: string; price: number };
const balanceLow = (needed: string, symbol: string): Problem => ({ code: "ledger.balance.low", whatHappened: `You need ${needed} ${symbol} for this, with its fee.`, money: { state: "safe", where: "in your Safe" }, next: { kind: "open", label: "Add money", screen: "receive" } });
const privateProblem =(code: string, whatHappened: string): Problem => ({ code, whatHappened, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } });
const notFound = (id: string): Problem => ({
  code: "security.waiting.not-found",
  whatHappened: "That isn't waiting any more.",
  money: { state: "safe", where: "in your Safe" },
  next: { kind: "nothing", label: "Go back" },
  more: id,
});

export function createMockBridge(options: MockOptions = {}): MockBridge {
  const latency = options.latencyMs ?? 250;
  const settle = options.settleMs ?? 2500;
  /** ZeroFee Chat's sample seed: this demo's own, random; kept with the rest of the demo (?demo keeps it over a reload),
   *  so after a reload the person is still the same person in a place and their own posts still read "You" (J3 C2). */
  const chatSample = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const store = new Map<string, string>();
  /** Add's one-time addresses asked for (subwallet.add.quote), by the sheet's key: the same key gives the same one. */
  const addAsks = new Map<string, AddAddress>();
  /** The account's protection, in the contract's shape and in dollars: from the start what set-up writes for a new
   *  account (the core's defaultBands; the demo stands for the public, mainnet app), then the demo's last save. */
  let appBands: Band[] = defaultBands("mainnet");
  let protectionBands: unknown[] = demoBands(appBands);
  /** This mock's own account: a laptop added in the demo (account.secondDevice.pair) shows as its second device. */
  // The Sim's device key is a sample key in no chip (the audit's MUST, 7 Nov: it said "secure-chip" for options.account, the
  // public Sim, so its screens could say "secure chip"): SIM_KEY_KIND, whatever account is given.
  const account: AccountInfo = { ...ACCOUNT, ...(options.accountId ? { accountId: options.accountId } : {}), ...(options.account ?? {}), keys: [...ACCOUNT.keys.map((k) => (k.role === "device" ? { ...k, kind: SIM_KEY_KIND } : { ...k })), ...(options.oldKey ? OLD_KEYS : [])] };
  const subwallets: { id: string; kind: string; chain: string; address: string; label: string; site?: string; slot?: number; current?: boolean }[] = [
    { id: "sw-trade-sol", kind: "trade", chain: "sol", address: SAMPLE_ADDRESS.sol, label: "Solana wallet", slot: 0, current: true },
    // ?demo seeds every chain's trading wallet (option), so all three chains trade at once; tests keep Solana alone.
    ...(options.tradeChains ?? []).filter((c) => c !== "sol").map((c) => ({ id: `sw-trade-${c}`, kind: "trade", chain: c, address: SAMPLE_ADDRESS[c] ?? SAMPLE_ADDRESS.base, label: c === "hood" ? "Robinhood Chain wallet" : c === "bsc" ? "BNB Chain wallet" : `${c} wallet`, slot: 0, current: true })),
  ];
  /** Finding 63: SOL's one price in this bridge: the float's (an Add's SOL was bought at it), for a site wallet's coins,
   *  its Take out and its sample trades alike. Valued at another, $2.91 that arrived read $4.43. */
  const solUsd = (): number => options.float?.priceUsd?.("sol") ?? SIM_SOL_USD;
  /** A site wallet's Take out's home leg, by its key: the site's name (crawl F6: its row said "From NEAR wallet"). Set
   *  once the Take outs below are made. */
  let homeSite: (key: string | undefined) => string | undefined = () => undefined;
  const float = createFloatMock(options.float ?? {}, () => subwallets, () => options.decline === true, (usdc, key) => {
  // A Take out landing (the Add in reverse): the main USDC row is credited and a trading movement from "trading" shows in Activity.
  const dollars = fromMicro(usdc);
  moveMainUsdc(usdc);
  // its id is Trade's own key for the move, so Wallet's Activity shows Spending's row and this one as one (by id)
  const site = homeSite(key);
  const m: Record<string, unknown> = { id: key ?? `mv-${movements.length + 1}`, kind: "trading", status: "moving", amount: dollars, from: "trading", to: USDC_NEAR, startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], ...(site ? { site } : {}) };
  movements.unshift(m);
  emit("ledger.balancesChanged", {});
  later({ kind: "settle", movementId: m.id as string, ends: "done", balances: false }, settle);
}, { changed: (landed) => (landed ? flush() : changed()) });
  const SAMPLE_GMGN_BNB = "sw-site-gmgn-bsc";
  if (options.sampleGmgnBnbUsd && options.sampleGmgnBnbUsd > 0) {
    subwallets.push({ id: SAMPLE_GMGN_BNB, kind: "site", site: "gmgn", chain: "bsc", address: "0x6d6e676d62736373616d706c65000000000000b1", label: "GMGN wallet", current: true });
    float.takeNative(SAMPLE_GMGN_BNB, BigInt(Math.round((options.sampleGmgnBnbUsd / (options.float?.priceUsd?.("bsc") ?? 744.17)) * 1e9)) * 1_000_000_000n);
  }
  // A few sample movements in Wallet's Movement shape, newest first, so Activity has rows in the demo. `amount` is a bare
  // decimal; the coin comes from the asset id in `from` (pay, withdraw) or `to` (deposit).
  /** What the demo moved into a Browser wallet on Solana (Social trading's social wallet), in lamports, by wallet id:
   *  a send out to it lands here when its movement is done, and subwallet.balances says it. Spent through the demo
   *  engine's own count (trade demo-engine `moved`). */
  const walletNative = new Map<string, bigint>();
  /** Sim's sample sites (packages/browser SimSite.tsx): the sample coins a site's wallet bought there, by wallet id. */
  const simHeld = new Map<string, Map<string, { symbol: string; name: string; decimals: number; amount: bigint; priceUsd: number }>>();
  /** A sample trade in a site's own wallet on Solana: its SOL into a sample coin (buy) or the coin back to SOL (sell).
   *  The Sim's sites (sim.site.trade) and AgentZero's copy job on sample money (account.agent.spend) trade through it,
   *  so a receipt is only ever for a trade that moved the wallet's money (QA 5 Nov: a $5 BONK receipt, nothing moved). */
  const simSiteSol = (site: unknown) => {
    const s = siteWallet(String(site ?? ""));
    if (!s || !s.chains.includes("sol")) throw linkProblem("security.request.invalid", "site is a listed site with a Solana wallet");
    let w = subwallets.find((x) => x.kind === "site" && x.site === s.site && x.chain === "sol");
    if (!w) {
      const h = sha256(new TextEncoder().encode(`zerofee-sample-site:${s.site}:sol`));
      w = { id: `sw-site-${s.site}-sol`, kind: "site", site: s.site, chain: "sol", address: base58(h), label: `${s.name} wallet` };
      subwallets.push(w);
    }
    return w;
  };
  /** Dollars of SOL put into a site's sample wallet for one trade (AgentZero's wallet paying through it). */
  const simSiteCash = (site: unknown, usd: number) => {
    const w = simSiteSol(site);
    walletNative.set(w.id, (walletNative.get(w.id) ?? 0n) + BigInt(Math.round((usd / solUsd()) * 1e9)));
  };
  const simTrade = (site: unknown, side: unknown, coinIn: unknown, usdIn: unknown) => {
    const w = simSiteSol(site);
    const coin = coinIn as { token?: unknown; symbol?: unknown; name?: unknown; priceUsd?: unknown } | undefined;
    const token = String(coin?.token ?? ""), priceUsd = Number(coin?.priceUsd);
    if (!/^sim-[a-z0-9]{2,12}$/.test(token) || !(priceUsd > 0)) throw linkProblem("security.request.invalid", "coin is a sample coin { token: sim-…, symbol, name, priceUsd }");
    const held = simHeld.get(w.id) ?? new Map();
    simHeld.set(w.id, held);
    const c = held.get(token) ?? { symbol: String(coin?.symbol ?? "").slice(0, 10), name: String(coin?.name ?? "").slice(0, 40), decimals: 6, amount: 0n, priceUsd };
    c.priceUsd = priceUsd;
    const has = float.native(w.id) + (walletNative.get(w.id) ?? 0n);
    if (side === "buy") {
      const usd = Number(usdIn);
      if (!(usd > 0)) throw linkProblem("security.request.invalid", "usd is a buy's dollars");
      if (usd > 100) throw securityProblems.subwalletRefused("A trade over $100 needs Face ID, on the iPhone app.");
      const lamports = BigInt(Math.round((usd / solUsd()) * 1e9));
      if (lamports > has) return { status: "short", haveUsd: Math.round((Number(has) / 1e9) * solUsd() * 100) / 100 };
      walletNative.set(w.id, (walletNative.get(w.id) ?? 0n) - lamports);
      const units = BigInt(Math.floor((usd / priceUsd) * 1e6));
      c.amount += units;
      held.set(token, c);
      changed();
      return { status: "done", side: "buy", usd, amount: units.toString(), decimals: 6 };
    }
    if (side === "sell") {
      if (c.amount <= 0n) return { status: "none" };
      const usd = Math.round((Number(c.amount) / 1e6) * priceUsd * 100) / 100;
      walletNative.set(w.id, (walletNative.get(w.id) ?? 0n) + BigInt(Math.round((usd / solUsd()) * 1e9)));
      const sold = c.amount;
      c.amount = 0n;
      held.set(token, c);
      changed();
      return { status: "done", side: "sell", usd, amount: sold.toString(), decimals: 6 };
    }
    throw linkProblem("security.request.invalid", "side is buy or sell");
  };
  const lamportsOf = (amount: unknown): bigint => {
    const m = /^(\d+)(?:\.(\d{1,9}))?\d*$/.exec(String(amount ?? ""));
    return m ? BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0")) : 0n;
  };
  const ownSocialWallet = (to: unknown) => subwallets.find((w) => w.kind === "browser" && w.chain === "sol" && w.address === to);
  const movements: Record<string, unknown>[] = options.freshHistory ? [] : [
    { id: "mv-3", kind: "pay", status: "done", from: USDC_NEAR, to: "kiosk.near", amount: "4.2", label: "Kiosk", startedAtIso: iso(-50 * 60e3), updatedAtIso: iso(-50 * 60e3), explorerUrls: [] },
    { id: "mv-2", kind: "deposit", status: "done", from: "sol", to: USDC_SOL, amount: "42.1", startedAtIso: iso(-3 * 3600e3), updatedAtIso: iso(-3 * 3600e3 + 90e3), explorerUrls: [] },
    { id: "mv-1", kind: "withdraw", status: "done", from: USDC_BASE, to: `${SAMPLE_EVM} on Base`, amount: "18", startedAtIso: iso(-26 * 3600e3), updatedAtIso: iso(-26 * 3600e3 + 60e3), explorerUrls: [] },
  ];
  // Money that came in has a lasting "Received" row each, as the real ledger lists it (wallet received.ts): a landed Add
  // (0.2 SOL into the SOL wallet, its dollars at the demo's $101.75 and what the swaps kept), the NEAR that opened the
  // account (5 NEAR at $4.43) and money someone sent straight to the Safe; with the bridge deposit, $97.10 came in. Kept
  // apart from the demo's own moves (their ids count those) and placed among them by time when Activity is read.
  const received: Record<string, unknown>[] = options.freshHistory ? [] : [
    { id: "add:demo-sol", kind: "deposit", status: "done", from: "sol", to: "nep141:sol.omft.near", amount: "0.2", into: "sol", usd: "20.35", feeUsd: "0.41", startedAtIso: iso(-2 * 3600e3), updatedAtIso: iso(-2 * 3600e3), explorerUrls: [] },
    { id: "safe:demo-usdc", kind: "deposit", status: "done", to: USDC_NEAR, amount: "12.5", into: "safe", usd: "12.50", startedAtIso: iso(-6 * 3600e3), updatedAtIso: iso(-6 * 3600e3), explorerUrls: [] },
    { id: "open:demo", kind: "deposit", status: "done", from: "near", to: "near", amount: "5", into: "safe", opened: true, usd: "22.15", startedAtIso: iso(-50 * 3600e3), updatedAtIso: iso(-50 * 3600e3), explorerUrls: [] },
  ];
  /** Activity as the ledger lists it: the demo's moves in their own order, each Received row before the first older one. */
  const activity = (): Record<string, unknown>[] => {
    const out = [...movements];
    for (const r of received) {
      const at = out.findIndex((m) => String(m.updatedAtIso) < String(r.updatedAtIso));
      out.splice(at < 0 ? out.length : at, 0, r);
    }
    return out;
  };
  const emit = (event: string, payload: unknown) => listeners.get(event)?.forEach((h) => h(payload));
  // Like the real shell: after a partner's page is opened, coming back to this page is device.returned, heard by the
  // app that opened it (Pay offers what was copied there). Only in a browser; tests have no document.
  let awaitingReturn: string | null = null;
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !awaitingReturn) return;
      emit("device.returned", { url: location.href, app: awaitingReturn });
      awaitingReturn = null;
    });
  }
  // The approval sheet, as the core asks it: one request at a time, each with its own id, answered by approval.answer.
  const approvals = new Map<string, (approve: boolean) => void>();
  let sheets: Promise<unknown> = Promise.resolve();
  let sheetCount = 0;
  const ask = (words: PlainWords): Promise<boolean> => {
    const turn = sheets.then(() => new Promise<boolean>((resolve) => {
      const id = `approval-${++sheetCount}`;
      approvals.set(id, (approve) => {
        approvals.delete(id);
        resolve(approve);
      });
      emit("approval.needed", { id, words });
    }));
    sheets = turn.catch(() => undefined);
    return turn;
  };
  // Social Trading's Move back (core subwallets.ts siteMoveBack): a site's own wallet → Spending → the Safe, on the core's
  // own sheet, started from Wallet's money sheet only. Here: the float mock's move in from that wallet, then its move home
  // once it lands (read when the moves back are asked for, as the core goes on home when it reads them).
  const backs: { key: string; backId: string; site: string; homeId?: string }[] = [];
  homeSite = (key) => { const b = key ? backs.find((x) => `${x.key}-home`.slice(0, 64) === key) : undefined; return b ? siteWallet(b.site)?.name ?? b.site : undefined; };
  const goHomeAll = () => {
    for (const b of backs) {
      if (b.homeId) continue;
      const m = (float.answer("subwallet.float.moves", {}) as FloatMove[]).find((x) => x.id === b.backId);
      if (!m || m.status !== "done") continue;
      const h = float.answer("subwallet.float.home", { amount: m.settled?.amountOut ?? m.expected.amount, key: `${b.key}-home`.slice(0, 64) }) as FloatMove | { declined: true };
      if (!("declined" in h)) b.homeId = h.id;
    }
  };
  const siteMoveBacks = () => {
    goHomeAll();
    const all = float.answer("subwallet.float.moves", {}) as FloatMove[];
    return backs.slice().reverse().flatMap((b) => {
      const back = all.find((x) => x.id === b.backId);
      const home = b.homeId ? all.find((x) => x.id === b.homeId) : undefined;
      return back ? [{ back: { ...back, site: b.site, ...(b.homeId ? { homeId: b.homeId } : {}) }, ...(home ? { home } : {}) }] : [];
    });
  };
  const siteMoveBack = async (p: Record<string, unknown>, batched?: true): Promise<unknown> => {
    if (p.app !== undefined && p.app !== "wallet") throw securityProblems.requestNotAllowed("Only your own tap in the money sheet moves money back from a site's wallet.");
    const w = subwallets.find((x) => x.id === p.id && x.kind === "site");
    const site = w ? siteWallet(w.site) : undefined;
    if (!w || !site) throw securityProblems.subwalletUnknown();
    // the sample's GMGN BNB wallet (sampleGmgnBnbUsd) moves home too; any other network is refused, as the core does
    const bnb = Boolean(options.sampleGmgnBnbUsd) && w.id === SAMPLE_GMGN_BNB;
    if (w.chain !== "sol" && !bnb) throw securityProblems.subwalletRefused(`Move back works for your ${site.name} wallet on Solana.`);
    if (typeof p.key !== "string" || !/^[A-Za-z0-9_-]{16,58}$/.test(p.key)) throw securityProblems.requestInvalid("key is this move's own id: 16 to 58 letters, digits, - or _");
    const had = backs.find((b) => b.key === p.key);
    if (had) return siteMoveBacks().find((x) => x.back.id === had.backId)?.back;
    const has = float.native(w.id) + (walletNative.get(w.id) ?? 0n);
    // BNB: 21,000 gas at about 0.1 gwei, kept back as the core keeps a network fee
    const fee = bnb ? 2_100_000_000_000n : 5_000n;
    const units = p.amount === "all" ? has - fee : /^\d{1,30}$/.test(String(p.amount)) ? BigInt(String(p.amount)) : -1n;
    if (units <= 0n || units > has) throw securityProblems.subwalletRefused(`Your ${site.name} wallet has nothing to move back.`);
    const coin = bnb ? { scale: 1e18, symbol: "BNB", usd: options.float?.priceUsd?.("bsc") ?? 744.17 } : { scale: 1e9, symbol: "SOL", usd: solUsd() };
    const usd = (Number(units) / coin.scale) * coin.usd;
    if (batched) return { usd, units, coin, site, run: () => runBack(w, units, p.key as string, site) };
    // D143: a site wallet is a hot key and money only goes home: no sheet, as in the core
    return runBack(w, units, p.key as string, site);
  };
  const runBack = (w: (typeof subwallets)[number], units: bigint, key: string, site: NonNullable<ReturnType<typeof siteWallet>>) => {
    // what the mock float can move: its own count of the wallet first, the rest from the sample's own
    const inFloat = float.native(w.id);
    if (inFloat < units) {
      walletNative.set(w.id, (walletNative.get(w.id) ?? 0n) - (units - inFloat));
      float.takeNative(w.id, units - inFloat);
    }
    const m = float.answer("subwallet.float.in", { chain: w.chain, amount: units.toString(), key, from: w.id }) as FloatMove | { declined: true };
    if ("declined" in m) return m;
    backs.push({ key, backId: m.id, site: site.site });
    changed();
    return { ...m, site: site.site };
  };
  /** Move's take-out of every site wallet: each leg checked as one move back, ONE sheet for all, then each runs. */
  const siteMoveBackAll = async (p: Record<string, unknown>): Promise<unknown> => {
    if (p.app !== undefined && p.app !== "wallet") throw securityProblems.requestNotAllowed("Only your own tap in the money sheet moves money back from a site's wallet.");
    if (!Array.isArray(p.legs) || p.legs.length < 1 || p.legs.length > 8) throw securityProblems.requestInvalid("legs: 1 to 8 site wallets, each { id, amount, key }");
    const legs = [] as { id: string; usd: number; units: bigint; coin: { scale: number; symbol: string }; site: { name: string }; run: () => unknown }[];
    const seen = new Set<string>();
    for (const l of p.legs as Record<string, unknown>[]) {
      // as the core: the same wallet twice, or a key already used, is refused before the sheet (review L3)
      if (seen.has(String(l.id)) || backs.some((b) => b.key === l.key)) throw securityProblems.subwalletUnknown();
      seen.add(String(l.id));
      legs.push({ id: String(l.id), ...((await siteMoveBack({ ...l, app: p.app }, true)) as Omit<(typeof legs)[number], "id">) });
    }
    // D143: no sheet (hot keys, money only going home), as in the core
    return legs.map((l) => { try { return { id: l.id, move: l.run() }; } catch (e) { return { id: l.id, problem: (e as Problem).code ? e : securityProblems.subwalletRefused(`${l.site.name}'s move back didn't go.`) }; } });
  };
  /** What the core refuses before its sheet (and Face ID). */
  const refusedFirst = (method: string, p: Record<string, unknown> = {}): Problem | null =>
    method === "ledger.sendFromSafe" && sendFillShut(p)
      ? SAFE_SEND_SHUT
      : method === "account.secondDevice.setLimit" && !account.keys.some((k) => k.role === "second-device")
      ? { code: "security.request.not-allowed", whatHappened: "Add your laptop first.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } }
      // the demo's laptop: only the code it shows adds it, checked before any sheet (a made-up code is never accepted)
      : method === "account.secondDevice.pair" && options.sampleLaptop && p.kind !== "guardian" && String(p.qr ?? p.publicKey ?? "").trim() !== SAMPLE_LAPTOP_CODE
        ? laptopCodeWrong()
        // finding 54: any code that isn't a whole pairing code is refused before the sheet, a second phone's too
        : method === "account.secondDevice.pair" && !isPairingCode(String(p.qr ?? p.publicKey ?? ""))
          ? invalidPairingCode(p.kind)
          : null;
  /** subwallet.send (Wallet's own Send from a chain wallet, D143), as the core: Wallet's only; the chain's current wallet;
   *  its own coin (or a listed coin on an EVM chain) and enough of it, all before anything is signed. */
  const chatSend = (p: Record<string, unknown>) => {
    const chain = String(p.chain ?? "");
    const coin = p.token === undefined ? undefined : (KNOWN_COINS[chain as EvmWalletChain] ?? []).find((c) => c.token === String(p.token).toLowerCase());
    const w = subwallets.find((x) => x.chain === chain && x.current === true && (x.kind === "trade" || x.kind === "browser"));
    const decimals = coin ? coin.decimals : chain === "sol" ? 9 : 18;
    const m = /^(\d{1,30})(?:\.(\d+))?$/.exec(String(p.amount ?? ""));
    const units = m && (m[2]?.length ?? 0) <= decimals ? BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0") : 0n;
    const symbol = coin ? coin.symbol : chain === "sol" ? "SOL" : WALLET_NATIVE[chain as EvmWalletChain] ?? "";
    const held = !w ? 0n : coin ? 0n : float.native(w.id) + (walletNative.get(w.id) ?? 0n);
    return { chain, coin, w, units, symbol, held };
  };
  const chatSendRefused = (p: Record<string, unknown>): Problem | null => {
    if (p.app !== "wallet") return securityProblems.requestNotAllowed("Only your own Send in Home sends from your chain wallets.");
    const s = chatSend(p);
    if (!(s.chain in CHAIN_WORDS)) return securityProblems.subwalletChain();
    if (p.token !== undefined && !s.coin) return securityProblems.requestInvalid("token is a coin ZeroFee lists on that network");
    if (s.units === 0n) return securityProblems.requestInvalid("amount is the coin's decimal text");
    if (!s.w) return securityProblems.subwalletUnknown();
    if (s.held < s.units) return securityProblems.notEnoughCoin(s.symbol);
    return null;
  };
  // ZeroFee Chat's keys and NEAR names (core chat-keys.ts, the core's own checks), from this demo's sample seed. The
  // sample account's "key" is derived from its name (sampleAccountSecret above: public, sample money only), and
  // signs its Chat name after this demo's sheet, like the core's device key after the core's.
  let chatNames: string | null = null;
  const sampleName = (id: string) => SAMPLE_ACCOUNT.test(id) || id === PUBLIC_SAMPLE_ACCOUNT_ID;
  const samplePublicKey = (id: string) => `ed25519:${base58(ed25519.getPublicKey(sampleAccountSecret(id)))}`;
  const chatKeys = new ChatKeys({
    seed: async () => chatSample.slice(),
    account: async () => (waitingForNear() ? null : account.accountId),
    signNote: async ({ hash, words }) => {
      if (options.askApproval !== false && listeners.get("approval.needed")?.size && !(await ask(words))) return null;
      if (options.decline) return null;
      const secret = sampleAccountSecret(account.accountId);
      return { publicKey: samplePublicKey(account.accountId), signature: `ed25519:${base58(ed25519.sign(hash, secret))}` };
    },
    load: async () => chatNames,
    save: async (json) => {
      chatNames = json;
      changed();
    },
  });
  /**
   * Chat's NEAR reads. A sample name (this demo's, or any zf-sample…testnet) answers the sample way: it exists, and its
   * one key is the one derived from its name; any other name is read on NEAR itself, read-only (options.nearReads), or
   * not found when there's no reader (tests). The real ledger knows nothing of samples (chat-reads.ts).
   */
  const nearRead = async (method: string, p: Record<string, unknown>): Promise<unknown> => {
    const id = String(p.accountId ?? p.dao ?? "").trim();
    const chain = options.nearReads?.(networkOf(id));
    switch (method) {
      case "ledger.recipientInfo":
        // A name on a network this demo doesn't read (a .testnet name on the public build): it can't say (diff review M-B).
        if (!chain) throw new ProblemError(securityProblems.nodesUnreachable());
        return { exists: (await chain.account(id, await chain.commonBlock())) !== null, hasLedgerBalance: false, code: null };
      case "ledger.accountKey":
        if (sampleName(id)) return { onAccount: p.publicKey === samplePublicKey(id) };
        return { onAccount: chain ? await keyOnAccount(chain, id, String(p.publicKey ?? "")).catch(() => null) : false };
      case "ledger.daoPolicy":
        return { policy: chain ? await daoPolicy(chain, id) : null };
      case "ledger.nearProfile":
        return chain && !sampleName(id) ? nearProfile(chain, id).catch(() => ({})) : {};
      case "ledger.daosOf": {
        const opened = Array.isArray(p.opened) ? p.opened.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
        // the demo's own account is a sample: its DAOs are the demo's own (none), never read on a test network (CORS on every walk)
        if (sampleName(id)) return { daos: [] };
        return { daos: chain ? await daosOf(chain, id, opened) : [] };
      }
    }
    return null;
  };
  const NEAR_READS = new Set(["ledger.accountKey", "ledger.daoPolicy", "ledger.nearProfile", "ledger.daosOf"]);
  /** QA's ruling (5 Nov), as the core: a wallet's Send to an address that isn't one of the person's own
   *  wallets asks Face ID every time (the Sim's sheet); to their own wallet it goes on the tap. */
  const outsidePayee = (to: unknown) => {
    const t = (to ?? {}) as { address?: unknown; accountId?: unknown };
    const a = typeof t.address === "string" ? t.address : typeof t.accountId === "string" ? t.accountId : "";
    return !subwallets.some((w) => w.address === a);
  };
  /** The Sim's dry fee for a wallet's Send (ledger.sendFee): the sample price, a 2 % swap cut and 5 cents of network. */
  const sampleSendFee = (p: Record<string, unknown>): { inUsd: string; outUsd: string } | null => {
    const symbol = p.chain === "hood" ? "ETH" : p.chain === "sol" ? "SOL" : null;
    const price = Number((options.tokens ?? DEFAULT_TOKENS).find((t) => t.symbol === symbol)?.priceUsd);
    const n = Number(p.amountIn);
    if (!symbol || !(price > 0) || !(n > 0) || p.coin !== undefined) return null;
    const inUsd = n * price, outUsd = Math.max(0, inUsd * 0.98 - 0.05);
    return { inUsd: inUsd.toFixed(2), outUsd: outUsd.toFixed(2) };
  };
  // a Move paid from Private asks only when the Safe fills Private first (its Face ID); Private alone pays with no sheet (D143)
  // the fill's Approve only while the fill is open: closed, the Move is refused before any sheet, as the real ledger does
  // (private-move.ts), never an Approve that ends "Nothing moved" (QA's Jobs re-crawl, 5 Nov: F1)
  const asksFirst = (method: string, p: Record<string, unknown> = {}) => options.askApproval !== false && (NEEDS_YES.has(method) || (method === "ledger.moveFromPrivate" && Number.isFinite(privateNeed(p).fill) && privateNeed(p).fill > 0 && (options.safeFillOpen ?? SAFE_FILL_OPEN)) || (method === "ledger.hiddenFromRow" && outsidePayee(p.to))) && Boolean(listeners.get("approval.needed")?.size);
  /** As the real ledger (wallet ledger.ts sendFromSafe, QA's MUST; QA test, MUST 3): a Send's fill (`fill`)
   *  to anyone but the person's own wallets is refused by name before any price or sheet, unless the bound path is open
   *  (core SAFE_SEND_FILL_OPEN and this build's fill switch). A Send from Private (no `fill`) goes as before. */
  const sendFillShut = (p: Record<string, unknown>): boolean => {
    if (p.fill !== true || (SAFE_SEND_FILL_OPEN && (options.safeFillOpen ?? SAFE_FILL_OPEN))) return false;
    const t = (p.to ?? {}) as { kind?: unknown; chain?: unknown; address?: unknown; accountId?: unknown };
    const own = t.kind === "ledger" ? subwallets.some((w) => w.kind === "trade" && w.chain === "near" && w.address === t.accountId) : t.kind === "chain" && !!ownTradeWallet(t);
    return !own;
  };
  /** The account's own trading wallet a movement goes to, by chain + address (a payee that isn't one of them is a stranger's). */
  const ownTradeWallet = (to: unknown) => {
    const t = (to ?? {}) as { chain?: unknown; address?: unknown };
    return subwallets.find((w) => w.kind === "trade" && w.address === t.address && (t.chain === undefined || w.chain === t.chain));
  };
  const coinOf = (tokenId: unknown) => [...BALANCES, ...(options.tokens ?? DEFAULT_TOKENS).map((t) => ({ tokenId: t.assetId, symbol: t.symbol }))].find((t) => t.tokenId === tokenId)?.symbol ?? "";
  /** The payment in dollars, the coin after it, as the core's sheet says it (grade 02g, G11): "about $44.30 (10 NEAR)";
   *  the coin figure at most 4 decimals and never trailing zeros (QA's Sim walk, 5 Nov: "1.128673627 NEAR";
   *  53: "1.1 NEAR", never "1.1000"). */
  const coinSaid = (amount: unknown, symbol: string) => fourPlacesText(`${String(amount).replace(/^(\d+)\.(\d*?)0+$/, (_m, w: string, f: string) => (f ? `${w}.${f}` : w))} ${symbol}`);
  const amountOf = (tokenId: unknown, amount: unknown, symbolOf?: string): { amount: string } | Record<string, never> => {
    const symbol = symbolOf ?? coinOf(tokenId);
    const price = Number((options.tokens ?? DEFAULT_TOKENS).find((t) => (symbolOf ? t.symbol === symbolOf : t.assetId === tokenId))?.priceUsd);
    const n = Number(amount);
    // A dollar coin at $1 each, exactly, as the core's sheet counts USDC and USDT (words.ts DOLLAR_COINS).
    if (n > 0 && (symbol === "USDC" || symbol === "USDT")) return { amount: `${dollarWords(n, true)} (${coinSaid(amount, symbol)})` };
    return price > 0 && n > 0 && symbol ? { amount: `${dollarWords(n * price)} (${coinSaid(amount, symbol)})` } : {};
  };
  /** A sheet's title, dollars first (J6, as the core's words.ts): `say(money)` with "$5.00 (1.1765 NEAR)" when the amount
   *  is priced, `say(coin words)` when it isn't. */
  const titled = (say: (money: string) => string, coinWords: string, amount: { amount?: string }) => say(titleMoney(amount.amount) ?? fourPlacesText(coinWords)).replace(/\s+/g, " ").trim();
  /** The coin an Add is paid with when it isn't USDC (any coin of the main balance); undefined for USDC or no tokenId. */
  const addPaidWith = (tokenId: unknown): string | undefined => (typeof tokenId === "string" && tokenId && tokenId !== USDC_NEAR && tokenId !== USDC_SOL && tokenId !== USDC_BASE ? tokenId : undefined);
  /** A move to the account's own trading wallet, in the core's words (intents.ts): dollars first in the title ("$50.04
   *  (0.491787154 SOL)"; "about 0.4917 SOL" with no price), the exact amount in a line, the whole address one tap away
   *  ("The address in full"), never a raw "Details:" line. */
  const ownMove = (kind: "withdraw" | "pay", amount: unknown, tokenId: unknown, w: { chain: string; address: string }) => {
    const a = aboutAmount(amount), sym = coinOf(tokenId), name = `your Spending wallet on ${CHAIN_WORDS[w.chain] ?? w.chain}`, chain = CHAIN_WORDS[w.chain] ?? w.chain;
    const priced = amountOf(tokenId, a.exact);
    const lines = kind === "withdraw"
      ? [`Move ${a.exact} ${sym} from your Safe to ${name}`]
      : [`Send ${a.exact} ${sym} from your Safe to the swap service`, `The swap service promises at least ${a.exact} ${sym} to ${name}`, `If it can't, your ${sym} comes back to your Safe`];
    return { title: titled((m) => `Move ${m} to ${name}`, `${a.title} ${sym}`, priced), lines, details: [{ label: "The address in full", lines: [w.address] }], ...priced };
  };
  const wordsFor = (method: string, p: Record<string, unknown>): PlainWords => {
    if (method === "tx.request") return describe((p.request ?? {}) as TxRequest);
    // the Move route's fill, as the real ledger's Safe sheet for route B (to-private.ts): the Safe's USDC into Private
    if (method === "ledger.moveFromPrivate") {
      const n = privateNeed(p);
      // as the core's one fill sheet (intents.ts legsBlock, moveSheet; the audit's ruling and the copy review's layout, 7 Nov), from the same
      // figures: every part as the plan pays it (Private's own, the fill's), what the Safe signs (the one fill); the title
      // the person's action, or the Swap of one part. A wallet not named, or no part the fill pays: the bytes' own words
      const parts = Array.isArray(p.parts) ? (p.parts as { usd?: unknown; wallet?: unknown }[]) : [];
      const safeC = Math.round((Number.isFinite(n.fill) ? n.fill : 0) * 100);
      const $c = (c: bigint | number) => `$${(Number(c) / 100).toFixed(2)}`;
      const nameOf = (wallet: unknown) => {
        const to = wallet === "near" ? { kind: "trade", chain: "near" } : subwallets.find((w) => w.id === wallet && !(w as { keyExported?: true }).keyExported);
        return { to, name: to ? (to.kind === "trade" ? ({ sol: "your SOL wallet", hood: "your ETH (RH) wallet", bsc: "your BNB wallet", near: "your NEAR wallet" } as Record<string, string>)[to.chain] : undefined) : undefined };
      };
      const going = n.fills.filter((x) => x.fromPrivate > 0 || x.rest > 0).sort((a, b) => a.part - b.part).map((x) => ({ ...nameOf(parts[x.part]?.wallet), priv: BigInt(Math.round(x.fromPrivate * 100)), pay: BigInt(Math.round(x.rest * 100)) }));
      const bound = going.some((x) => x.pay > 0n) && going.every((x) => !!x.name) && going.reduce((t, x) => t + x.pay, 0n) <= BigInt(safeC);
      // the Sim's fill lands whole (its ledger adds the fill less every part it pays to Private): it brings the fill exactly
      // the Move's wallet parts, as the core's sheet reads them: kept by spending.topUp under this job's key (C2)
      const others = bound && typeof p.job === "string" ? sheetOthers(othersForSheet(p.job, "sim")) : [];
      // a Swap of one part (the copy review's (c)): the call says so and that payment pays out another coin than the Safe's
      const one = going.length === 1 && !others.length ? going[0]! : null;
      const outCoin = one && p.swap === true && one.to?.kind === "trade" ? ({ sol: "SOL", hood: "ETH", bsc: "BNB" } as Record<string, string>)[one.to.chain] : undefined;
      // J2-2: what the Swap gives and its fee, from the very cost the form quoted (simSwapCost), so form and sheet say one fee
      const outPx = outCoin ? tokenPrice(({ SOL: "nep141:sol.omft.near", ETH: "nep141:eth.omft.near", BNB: "nep141:bsc.omft.near" } as Record<string, string>)[outCoin]) : 0;
      // (the fill pays the whole part: one payout, one quote; a part Private pays some of itself has two, as the core: none)
      const swapCost = one && one.priv === 0n && outCoin && outPx > 0 ? simSwapCost(Number(one.pay) / 100, "safe", one.to?.chain) : null;
      const swapOut = swapCost && one ? { words: `about ${Math.floor((swapCost.arrivesUsd / outPx) * 1e4) / 1e4} ${outCoin} (about ${$c(Math.round(swapCost.arrivesUsd * 100))})`, fee: one.priv + one.pay - BigInt(Math.round(swapCost.arrivesUsd * 100)) } : null;
      // the audit's ruling (c), 8 Nov: a Move's parts as their quotes give them, from the Sim's one cost (simSwapCost, as the Swap's
      // form and sheet read it), each leg on its own (Private's share and the fill's); at least: 1Click's 1 % slippage
      // the NEAR wallet's leg is USDC into USDC, as 1Click quotes a same-coin move (float-floors: no fee, 99 % promised)
      const leg = (c: bigint, chain: unknown) => { if (c <= 0n) return { got: 0n, least: 0n }; const a = chain === "near" ? Number(c) : Math.round(simSwapCost(Number(c) / 100, "safe", chain).arrivesUsd * 100); return { got: BigInt(a), least: BigInt(Math.floor(a * 0.99)) }; };
      const quotedOf = (x: (typeof going)[number]) => { if (x.to?.kind !== "trade") return {}; const a = leg(x.priv, x.to.chain), b = leg(x.pay, x.to.chain); return { got: a.got + b.got, least: a.least + b.least }; };
      const sheet = bound ? moveSheet(going.map((x) => ({ wallet: x.name!, priv: x.priv, pay: x.pay, ...quotedOf(x) })), BigInt(safeC), $c, { brought: BigInt(safeC), ...(others.length ? { others } : {}), ...(swapOut ? { swapOut } : {}), ...(p.swap === true ? { swap: true } : {}) }) : null;
      const title = sheet ? (outCoin ? `Swap ${$c(sheet.sums.moved)} of USDC for ${outCoin}` : sheet.title) : `Move ${$c(safeC)} to Private`;
      const block = sheet ? sheet.lines : [LEG_WORDS.adds($c(safeC))];
      // `amount`: money leaves the Safe on this sheet, as the core's sheet says it (words.ts), so the Move's job is made on
      // its Approve (job-run.ts movesMoney; the proof, 5 Nov: 910 ms from Approve to "Job created." without it)
      return { title, lines: [...block, LEG_WORDS.seen], warnings: [], effect: [], ...amountOf(USDC_NEAR, (Number.isFinite(n.fill) ? n.fill : 0).toFixed(2)), amountSaid: true };
    }
    // Agent (release 10): its own key with a daily limit, and the kill switch, as the core's sheet says them.
    if (method === "account.agent.set" || method === "account.agent.setBudget") {
      const people = Array.isArray(p.people) ? (p.people as string[]) : [];
      // product decision, 5 Nov: never a daily price. The cap stays in the rules; the sheet says only that it spends from its own wallet.
      return { title: agentSheetTitle(method, Number(p.limitUsd), agentRules?.limitUsd ?? 0), lines: [ownWalletWords().sheet, ...(people.length ? [`It can pay only ${people.join(", ")}.`] : []), "Anything more, you approve yourself.", "Your protection rules still count every payment AgentZero makes."], warnings: [], effect: [] };
    }
    if (method === "account.agent.revoke") {
      return { title: "Stop AgentZero", lines: ["AgentZero's key comes off your account now.", "It can't pay anything after this."], warnings: [], effect: [] };
    }
    // as the core: the strong check before new words are shown (QA's real lap, k-trade3)
    if (method === "recovery.renew") return SHOW_NEW_WORDS;
    if (method === "recovery.renewConfirm") {
      return { title: "Replace your backup words", lines: ["Your new words become your account's backup key. Your old words stop working when this goes through."], warnings: [], effect: [] };
    }
    if (method === "account.secondDevice.pair") {
      return { title: "Add a second device", lines: ["Your laptop can approve or turn down your bigger requests. It can't send anything itself."], warnings: [], effect: [] };
    }
    if (method === "account.protection.set" || method === "account.secondDevice.setLimit") {
      const bands = method === "account.protection.set" ? (Array.isArray(p.bands) ? (p.bands as Band[]) : []) : limitBands(appBands, p.usd) ?? [];
      // The wait's length is on the sheet: it is part of what is approved. One form for every summary of the rules
      // (rule-words.ts, QA sd-security (j): this sheet dropped Face ID from "a 1-day wait and your second device").
      const you = approvalWords().level === "Face ID" ? "Your face" : "Your yes";
      const level = (b: Band) => needWords((["faceid", "wait", "device", "both"] as const).find((l) => l === b.level) ?? "faceid", Number(b.waitSeconds), you);
      return { title: "Save your protection rules", lines: [...bands.map((b, i) => `${b.upToUsd == null ? (i ? "Anything bigger" : "Every payment") : `Up to $${b.upToUsd.toLocaleString("en-US")}`}: ${level(b)}`)], warnings: [], effect: [] };
    }
    // The core's own words name the thing from the request itself (which chain, how long); the app's words ride under as a hint.
    const chainName = (label: string) => (label.split("·").pop()?.trim() ?? label).replace(/ wallet$/, "").replace(/^Robinhood Chain$/, "Robinhood");
    const forApp = appWords(method === "subwallet.session.start" ? p.why : p.label);
    // The asking app by its own name, as the core says it ("Pay says: …", "Trade says: …"). A request with no app stamped
    // on it (a test calling the mock directly) reads as Trade's, whose trading sheets these hints began with.
    const asker = String(p.caller ?? p.app ?? "trade");
    const askerName = asker === "social" ? APP_STORE_NAME : `${asker[0].toUpperCase()}${asker.slice(1)}`;
    const forHint = forApp ? { hint: `${askerName} says: ${forApp}` } : {};
    if (method === "subwallet.session.start") {
      const w = subwallets.find((x) => x.id === String(p.id));
      const minutes = Number(p.minutes ?? 15) || 15;
      // In dollars: the Trade session over every trading wallet (core tradeSessionStart), in the core's words.
      if (p.perTxUsd !== undefined) {
        // One line per fact, as the core: what (the title), how much (the core decodes the trade; here Trade's words carry
        // it), the session.
        const limits = `trades on known exchanges go without asking: up to $${Number(p.perTxUsd)} each plus $1 of network fees, $${Number(p.totalUsd)} in all with fees.`;
        if (typeof p.firstTx === "string") return { title: `${forApp || "Your first trade"}, and trade fast for ${minutes} minutes`, lines: [`Then for ${minutes} minutes, ${limits}`], warnings: [], effect: [], ...forHint };
        return { title: `Fast trading for ${minutes} minutes`, lines: [`From your Spending wallets, ${limits}`, "Anything else still asks you. So does anything sent out of a wallet."], warnings: [], effect: [], ...forHint };
      }
      // With the first trade's bytes (firstTx), the core's one sheet names that trade first; here, sample words.
      if (typeof p.firstTx === "string") return { title: `${forApp || "Your first trade"}, and trade fast for ${minutes} minutes`, lines: [`Then for ${minutes} minutes, trades go without asking: up to $100 each, $500 in all.`], warnings: [], effect: [], ...forHint };
      return { title: `Fast trading${w ? ` on ${chainName(w.label)}` : ""} for ${minutes} minutes`, lines: [`Up to $100 a trade, $500 in all, for ${minutes} minutes.`], warnings: [], effect: [], ...forHint };
    }
    if (method === "subwallet.export") {
      const w = subwallets.find((x) => x.id === String(p.id));
      return { title: `Show the key of your ${w?.label ?? "wallet"}`, lines: ["Anyone who sees this key can take everything in this wallet."], warnings: [], effect: [] };
    }
    // The phone's stop of a move to a new device (the core's recovery.cancel words, release 7).
    if (method === "recovery.cancel") {
      const move = account.recovery?.pending;
      const now = !move?.needsSecondDevice || move.approved;
      return { title: "Stop the move to a new device", lines: [now ? "It stops at once. For a while after, payments wait as long as a change to your rules." : "Because your laptop is on the account, the move stops after a wait. It stops at once if your laptop says yes. Your laptop can also say no."], warnings: [], effect: [] };
    }
    if (method === "account.waiting.run" || method === "account.waiting.cancel") {
      // As the core's sheets name the request itself ("Send it now: Send 6 NEAR to bob.near"); a change to the account is
      // finished, never "sent" (grade 30 Oct, item 5). The hold's own lines ("Waits 3 days…", "You can cancel it until
      // then") are about a wait that this sheet ends, so they aren't repeated on it.
      const item = held.find((h) => h.id === String(p.id));
      const title = item?.title ?? "a request on hold";
      const change = heldChanges.has(String(p.id));
      const own = (item?.lines ?? []).filter((l) => !HOLD_LINE.test(l));
      return method === "account.waiting.run"
        ? { title: `${change ? "Finish it now" : "Send it now"}: ${title}`, lines: [...own, "Fee: at most 0.001 NEAR."], warnings: [], effect: [] }
        : { title: `Cancel: ${title}`, lines: [change ? "Nothing changes on your account." : "Nothing from it goes out.", ...own, "Network fee: at most 0.001 NEAR."], warnings: [], effect: [] };
    }
    // Like the core: "<App> says: <what the app said>" when the app passed words, otherwise no attribution line at all.
    const hint = forHint;
    switch (method) {
      case "ledger.pay": {
        const q = payQuotes.get(String(p.quoteId));
        // Home's Swap or Send from Hidden: the core's own words for a Hidden payment (subwallets.ts privatePay): what leaves
        // Hidden, in the coin You pay showed, and the promise in the coin that arrives; no address on the sheet's lines
        if (q?.confidential) {
          const own = ownTradeWallet(q.to);
          const row = own ? (own.chain === "sol" ? "SOL" : own.chain === "hood" ? "ETH on Robinhood" : own.chain === "bsc" ? "BNB" : own.chain) : null;
          const leaves = String(q.amountIn ?? q.amountOut);
          const paidIn = amountOf(q.fromTokenId, leaves);
          return {
            title: titled((m) => `Pay ${m} from Private`, `${leaves} ${coinOf(q.fromTokenId)}`, paidIn),
            lines: [`The swap service promises at least ${roundedAmount(q.amountOut)} ${coinOf(q.toTokenId)}${row ? ` to your ${row} row` : ""}.`, "It's paid from Private.", "If the swap service can't pay it, it comes back to Private."],
            warnings: [], effect: [], ...paidIn, ...hint,
          };
        }
        const own = q && ownTradeWallet(q.to);
        const moved = own ? ownMove("pay", q.amountOut, q.fromTokenId, own) : undefined;
        // Like the core's words: the amount and coin that arrive, and who gets them, short in the title (0xab5e…3e39) and in
        // full on a "Details:" line, with its network.
        const to = (q?.to ?? {}) as { kind?: string; chain?: string; address?: string; accountId?: string };
        const who = to.address ?? to.accountId;
        const shortWho = who && who.length > 16 ? `${who.slice(0, 6)}…${who.slice(-4)}` : who;
        const paid = q ? amountOf(q.toTokenId, q.amountOut) : {};
        const title = moved?.title ?? (q && who ? titled((m) => `Send ${m} to ${shortWho}`, `${roundedAmount(q.amountOut)} ${coinOf(q.toTokenId)}`, paid) : "Send from your Safe");
        // The network in view wherever it decides whether the money arrives: any address (a 0x… or 64-hex string means
        // different wallets on different networks). Only a named NEAR account (alex.near, x.tg) says NEAR by its own name,
        // so its network goes under Details (the auditor and the second security review, Job 1).
        const net = to.chain === "base" ? "Base" : to.chain === "sol" ? "Solana" : to.chain === "near" ? "NEAR" : to.chain;
        const named = to.chain === "near" && typeof who === "string" && /\.(near|tg)$/.test(who);
        const baseLines = moved?.lines ?? [...(to.chain && !named ? [`On ${net}.`] : []), ...(who && who !== shortWho ? [`Details: ${who}${named ? " on NEAR" : ""}`] : named ? ["Details: on NEAR"] : [])];
        // A fee line only when there is a fee (a same-coin pay moves inside the ledger for nothing).
        const fee = Number(q?.feeUsd);
        const lines = fee > 0 && !moved ? [...baseLines, fee < 0.01 ? "Fee: under 1 cent." : `Fee: about $${fee.toFixed(2)}.`] : baseLines;
        return { title, lines, warnings: [], effect: [], ...(moved?.details ? { details: moved.details } : {}), ...paid, ...hint };
      }
      case "ledger.transfer": {
        // The coin's own symbol and the person's own name for them (the app's label), the account small underneath.
        const name = typeof p.label === "string" && p.label.trim() ? p.label.split(":")[0].trim() : String(p.toAccountId ?? "");
        const amount = /^\d+(\.\d{1,2})?$/.test(String(p.amount)) ? Number(p.amount).toFixed(2) : String(p.amount ?? "");
        const priced = amountOf(p.tokenId, amount);
        return { title: titled((m) => `Send ${m} to ${name}`, `${amount} ${coinOf(p.tokenId)}`, priced), lines: [...(name !== p.toAccountId ? [`To ${String(p.toAccountId ?? "")}.`] : [])], warnings: [], effect: [], ...priced, ...hint };
      }
      case "ledger.withdraw": {
        // Never the raw address or the 9-decimal amount: the amount rounded, and a wallet of the account's own by its label.
        const own = ownTradeWallet({ chain: p.chain, address: p.toAddress });
        const moved = own ? ownMove("withdraw", p.amount, p.tokenId, own) : undefined;
        const priced = amountOf(p.tokenId, p.amount);
        const title = moved?.title ?? titled((m) => `Send out ${m} to ${String(p.chain ?? "another chain")}`, `${roundedAmount(p.amount)} ${coinOf(p.tokenId)}`, priced);
        return { title, lines: moved?.lines ?? [], warnings: [], effect: [], ...(moved?.details ? { details: moved.details } : {}), ...priced, ...hint };
      }
      case "ledger.convert": return { title: "Convert", lines: [], warnings: [], effect: [], ...hint };
      // A Solana wallet's own send (the core reads the amount and the address from the bytes; the sample's bytes carry
      // neither, so the demo says what it is and the app's words ride under it; no sample-money tag on the phone, product decision, 30 Oct).
      // ZeroFee Chat's payment from a chain wallet: the core's own words for a plain transfer, always on the sheet.
      case "subwallet.send": {
        const s = chatSend(p);
        const priced = amountOf(undefined, String(p.amount), s.symbol);
        // the network line, as the core's outside sheet (QA test)
        return { title: titled((m) => `Send ${m}`, `${String(p.amount)} ${s.symbol}`, priced), lines: [`To ${String(p.to)}`, `Public on ${CHAIN_WORDS[s.chain] ?? s.chain}.`, `From your ${CHAIN_WORDS[s.chain] ?? s.chain} wallet`], warnings: [], effect: [], ...priced, ...(p.app === "chat" ? { hint: "ZeroFee Chat asked for this payment." } : {}) };
      }
      // Home's Send from a wallet, both legs on one sheet (the core's hiddenFromRow words): where it lands, named once
      case "ledger.hiddenFromRow": {
        // the core's outside sheet (subwallets.ts OUTSIDE_WORDS): the full address, what they get and the fee, before Face ID
        const { symbol, row } = p.chain === "hood" ? { symbol: "ETH", row: "ETH (RH) wallet" } : { symbol: "SOL", row: "SOL wallet" };
        const amount = String(p.amountIn ?? p.amountOut ?? "");
        const priced = amountOf(undefined, amount, symbol);
        const payee = p.to as { address?: string; accountId?: string } | undefined;
        const fee = sampleSendFee(p);
        const coin = p.chain === "hood" ? "ETH (RH)" : "SOL";
        const lands = SEND_LANDS[payee && "accountId" in payee && payee.accountId ? "near" : String((p.to as { chain?: string } | undefined)?.chain ?? p.chain)] ?? { coin: "its coin", network: "its network" };
        // and what a send hides and what it doesn't (privacy audit, 4 Nov): both steps are public, close in time
        // the network line after the fee, as the core's outsideLines (QA test: "Public on Solana." was missing);
        // the coin figure at most 4 decimals (042: "0.052526348 SOL")
        return { title: `Send from your ${row}`, lines: [`To ${String(payee?.address ?? payee?.accountId ?? "")}`, ...(fee ? [`They get about $${fee.outUsd}`, `Fees · about $${(Number(fee.inUsd) - Number(fee.outUsd)).toFixed(2)}`, FEES_KEPT] : []), `Public on ${lands.network}.`, `First, ${coinSaid(amount, coin)} leaves your ${row} for Private. Anyone can see this step.`, `Then Private pays it as ${lands.coin}${lands.coin.endsWith("(RH)") ? "" : ` on ${lands.network}`}. Anyone can see this step too, soon after the first.`, SEND_MATCHED], warnings: [], effect: [], ...priced };
      }
      // Home's Send from the Safe: the part already in the private balance, straight out (the core's Send sheet)
      case "ledger.sendFromSafe": {
        const id = p.tokenId === "near" ? "nep141:wrap.near" : String(p.tokenId ?? "");
        const priced = amountOf(id, String(p.amount ?? ""));
        const payee = p.to as { kind?: string; chain?: string; address?: string; accountId?: string } | undefined;
        const lands = SEND_LANDS[payee?.kind === "ledger" ? "near" : String(payee?.chain ?? "")] ?? { coin: "its coin", network: "its network" };
        // QA's Sim walk (5 Nov): the payee's line says only what the person checks before Face ID, the address
        // (the core's short form, in full one tap away) and its network, never the coin's machine form ("It goes as wNEAR
        // to …"); the copy review's ruling: "To 0x7D06…7e3D on Ethereum. Public on Ethereum."
        const whom = String(payee?.address ?? payee?.accountId ?? "");
        return fillSheet(p, id, payee, lands, { ...priced, ...hint }) ?? { title: titled((m) => `Send ${m} through NEAR Confidential`, `${String(p.amount ?? "")} ${coinOf(id)}`, priced), lines: [`To ${outsideShort(whom)} on ${lands.network}. Public on ${lands.network}.`, SEND_UNNAMED, "It leaves Private on NEAR. If it can't go, it comes back there."], warnings: [], effect: [], ...(whom !== outsideShort(whom) ? { details: [{ label: "The address in full", lines: [whom] }] } : {}), ...priced, ...hint };
      }
      case "subwallet.signTx": {
        const why = typeof p.why === "string" && p.why.trim() ? { hint: `${asker === "social" ? APP_STORE_NAME : asker} says: ${p.why.trim().slice(0, 80)}` } : {};
        return { title: "Send SOL from your Solana wallet", lines: [], warnings: [], effect: [], ...why };
      }
      case "ledger.toTrading": {
        const payCoin = addPaidWith(p.tokenId);
        const priced = amountOf(payCoin === "near" ? "nep141:wrap.near" : payCoin ?? USDC_NEAR, p.amount);
        // Paid with another coin, it is a swap, in the core's two lines (intents.ts, audit 2 Nov S1): the title with the
        // exact coin once in brackets, and what the swap service promises. No Amount line, no app's echo, no 30 minutes.
        // Home's Move: where it goes on from the NEAR wallet, the asking app's words, last (the core's onwardOf)
        const onward = typeof p.onward === "string" && /^[A-Za-z0-9 $.,'()-]{1,120}$/.test(p.onward) ? { hint: `Wallet says: ${p.onward}` } : {};
        if (payCoin) {
          // what the swap service promises, about 98 % (its 1 % slippage and its fee), never the full price
          const usdc = Math.floor(Number(p.amount) * tokenPrice(payCoin === "near" ? "nep141:wrap.near" : payCoin) * 0.98 * 100) / 100;
          return { title: titled((m) => `Swap ${m} for USDC`, `${roundedAmount(p.amount)} ${coinOf(p.tokenId)}`, priced), lines: [`From your Safe. At least ${usdc.toFixed(2)} USDC lands in Spending.`, "If the swap fails, it comes back to Spending."], warnings: [], effect: [], ...onward };
        }
        // the same coin into Spending: the money sheet's verb and one line, as the core says it (intents.ts, audit S1)
        // a Move on to the person's own chain wallets names where it ends, the route a quiet line (the core's onward-ends.ts)
        const title = titled((m) => `Move ${m} to your NEAR wallet`, `$${roundedAmount(p.amount)}`, priced);
        const ends = endsTitle(title, typeof p.onward === "string" ? p.onward : undefined);
        if (ends) return { title: ends.title, lines: ["From your Safe.", ...ends.lines], warnings: [], effect: [] };
        return { title, lines: ["From your Safe."], warnings: [], effect: [], ...onward };
      }
      case "ledger.toPrivate": {
        const q = privateQuotes.get(String(p.quoteId));
        const priced = q ? amountOf(q.row.tokenId, q.amount) : {};
        return { title: titled((m) => `Move ${m} to Private`, `${q?.amount ?? ""} ${q?.row.symbol ?? ""}`, priced), lines: ["Anyone can see on the network that money moved in."], warnings: [], effect: [], ...priced, ...hint };
      }
      case "ledger.swap": {
        const q = safeQuotes.get(String(p.quoteId ?? ""));
        return { title: q ? `Swap ${roundedAmount(q.amountIn)} ${q.inSymbol} for ${quoted(`${roundedAmount(q.amountOut)} ${q.outSymbol}`)}` : "Swap in your Safe", lines: [], warnings: [], effect: [], ...hint };
      }
      default: return { title: "Sign this", lines: [], warnings: [], effect: [], ...hint };
    }
  };
  const signed = (): TxOutcome => (options.decline ? { status: "declined" } : { status: "done", txHash: "sample-tx", explorerUrl: NO_EXPLORER });
  /** A hot key's send (D143): never asked, so never declined. */
  const hotSent = (): TxOutcome => ({ status: "done", txHash: "sample-tx", explorerUrl: NO_EXPLORER });
  /** Agent's rules on this sample account (release 10), and its receipts for Activity. */
  let agentRules: { limitUsd: number; since: number; paid: { at: number; usd: number }[]; people: string[] } | null = null;
  /** The last its wallet that was in force, kept through a Stop (hunt 5 Nov, 042: Stop then Turn on skipped a held
   *  raise's wait). A turn-on above it waits like a raise: on chain agent_revoke drops the waiting changes and agent_set
   *  waits a change's wait (contracts agent.rs agent_set, agent_revoke). The Sim's first turn-on stays at once. */
  let agentLastLimit: number | null = null;
  /** What is really in AgentZero's sample wallet: taken from the Safe's USDC when it's funded, spent by its jobs, back in
   *  the Safe on a Stop or a lower limit. (6 Nov: "Add $25.00 to AgentZero's wallet, From your Safe" moved nothing.) */
  let agentHeldUsd = 0;
  const safeUsdc = () => balances.filter((b) => b.tokenId === USDC_NEAR).reduce((t, b) => t + Number(b.amount), 0);
  const cents = (n: number) => Math.round(n * 100) / 100;
  /** The wallet's money follows its limit: a higher limit takes the difference from the Safe, a lower one gives it back. */
  const agentLimitMoves = (was: number, now: number) => {
    const add = cents(now - was);
    if (add > 0) {
      debit(USDC_NEAR, add);
      agentHeldUsd = cents(agentHeldUsd + add);
    } else if (add < 0) agentGivesBack(Math.min(agentHeldUsd, -add));
    agentMoneyMoved();
  };
  /** Home reads the Safe again, and its wallets' row and total (home-reads.ts: Spending's parts follow spending.changed). */
  const agentMoneyMoved = () => {
    emit("ledger.balancesChanged", {});
    emit("spending.changed", {});
  };
  const agentGivesBack = (usd: number) => {
    if (!(usd > 0)) return;
    const row = balances.find((b) => b.tokenId === USDC_NEAR && b.held === "ledger") ?? balances.find((b) => b.tokenId === USDC_NEAR);
    if (row) {
      const micro = toMicro(row.amount) + toMicro(usd.toFixed(6));
      Object.assign(row, { amount: fromMicro(micro), usd: fromMicro(micro - (micro % 10_000n)) });
    }
    agentHeldUsd = cents(agentHeldUsd - usd);
  };
  /** The most a limit can take: never more than the Safe's USDC holds. */
  const agentLimitFits = (was: number, now: number) => cents(Math.min(now, was + safeUsdc()));
  /** The agent changes held for their wait (agent_set, agent_set_budget), as the contract lists them. */
  const agentHeld = () => held.filter((h) => /^account\.agent\.set(Budget)?$/.test(heldChanges.get(h.id)?.method ?? ""));
  /** The change still waiting, as the account has it: the page's row says this, so a Cancel in Waiting, a Stop or a reload
   *  can't leave a promise behind. */
  const agentWaiting = (): { waiting?: { usd: number; atIso: string } } => {
    const h = agentHeld().at(-1);
    return h ? { waiting: { usd: Number(heldChanges.get(h.id)?.p.limitUsd), atIso: h.readyAtIso } } : {};
  };
  /** "Ask me first" as the core keeps it on the device (agent-private.ts readAskAbove): null is never. */
  let agentAskAbove: number | null = null;
  /** AgentZero's receipts' chain head (account.agent.receiptHead), apart from the app's own store. */
  let receiptHead: unknown = null;
  const agentReceipts: { atIso: string; title: string; lines: string[]; by: string; ok: boolean; txHash: string }[] = [];
  /** Changes that ran on the account (QA sd-security (j): "It's in Activity now" while Activity said "Nothing yet."). */
  let changeRows: typeof agentReceipts = [];
  const CHANGE_ROW: Record<string, string> = {
    "account.secondDevice.pair": "Added your laptop as a second device",
    "account.protection.set": "Changed your rules",
    "account.secondDevice.setLimit": "Made big payments need your laptop's yes",
    "account.removeKey": "Removed a key. It can't sign for you now.",
    "recovery.renewConfirm": "Changed your backup words",
    "recovery.stop": "Stopped moving your account to a new device",
  };
  let agentPaidCount = 0;
  /** ?oldkey's classical key was removed on this page (a restore doesn't bring it back). */
  let removedOld = false;
  let createCalls = 0;
  const waitingForNear = () => !!options.needsFunding && createCalls < (options.needsFunding.arrivesAfterCalls ?? options.needsFunding.haveYocto.length);
  const held: { id: string; title: string; lines: string[]; readyAtIso: string; needsSecondDevice: boolean; secondDeviceSaidYes?: true }[] = [];
  /** Holds that ran or were cancelled here, for account.waiting.status after they left the list. */
  const endedHolds = new Map<string, "ran" | "cancelled" | "declined">();
  const hold = (request: TxRequest): TxOutcome => {
    if (options.decline) return { status: "declined" };
    const item = { id: `held-${held.length + 1}`, title: request.why || "Sign this", lines: [`To ${request.receiverId}.`], readyAtIso: iso((options.holdSeconds ?? 0) * 1e3), needsSecondDevice: false };
    held.push(item);
    return { status: "waiting", txHash: "sample-tx", explorerUrl: NO_EXPLORER, id: item.id, readyAtIso: item.readyAtIso, needsSecondDevice: false };
  };
  /** A step's words as the core's coin words say it (coins.ts): storage, a coin out, NEAR out. The Sim's mirror only. */
  type MockStep = { receiverId: string; actions: TxRequest["actions"] };
  const actOf = (s: MockStep | undefined) => s?.actions.length === 1 ? (s.actions[0] as { kind: string; method?: string; args?: Record<string, unknown>; yocto?: string }) : undefined;
  const shortAccount = (id: unknown) => (typeof id === "string" && /^[0-9a-f]{64}$/.test(id) ? `the NEAR account ${id.slice(0, 6)}…${id.slice(-4)}` : String(id));
  /** A dollar coin's units (6 decimals) as the core says them ("135"); null: not a dollar coin's whole figure. */
  const usdUnits = (sym: string, amount: unknown) => (/^USD[CT]$/.test(sym) && typeof amount === "string" && /^\d{1,30}$/.test(amount) ? Number(amount) / 1e6 : null);
  /** A step's title as the core's coin words say it (coins.ts): storage, a coin out, NEAR out. The Sim's mirror only. */
  const stepWords = (s: MockStep): string => {
    const a = actOf(s) ?? (s.actions[0] as { kind: string; method?: string; args?: Record<string, unknown>; yocto?: string } | undefined);
    const sym = coinOf(`nep141:${s.receiverId}`);
    if (a?.kind === "call" && a.method === "storage_deposit") return `Let ${shortAccount(a.args?.account_id)} hold ${sym}`;
    if (a?.kind === "call" && a.method === "ft_transfer") return `Send ${usdUnits(sym, a.args?.amount) ?? ""} ${sym} to ${shortAccount(a.args?.receiver_id)}`.replace("Send  ", "Send ");
    if (a?.kind === "transfer") return `Send ${(Number(a.yocto) / 1e24).toFixed(2)} NEAR to ${s.receiverId}`;
    return `Use ${s.receiverId}`;
  };
  const describe = (request: TxRequest): PlainWords => {
    const hint = request.from ? `${request.from[0].toUpperCase()}${request.from.slice(1)} says: ${request.why}` : undefined;
    // separate steps on one sheet (TxRequest.apart, an account that can't chain), as the core's plainWordsApart: the
    // Safe's room-then-pay steps in the copy review's words (7 Nov), any other set every step as a chain says it; never the app's line
    const steps: MockStep[] = [{ receiverId: request.receiverId, actions: request.actions }, ...(request.then ?? [])];
    if (request.apart && steps.length > 1) {
      const title = steps.map(stepWords).join(", then ");
      const room = actOf(steps[0]), pay = actOf(steps[1]);
      const sym = coinOf(`nep141:${steps[0]!.receiverId}`);
      const usd = steps.length === 2 && room?.method === "storage_deposit" && pay?.method === "ft_transfer" && steps[1]!.receiverId === steps[0]!.receiverId && pay.args?.receiver_id === room.args?.account_id ? usdUnits(sym, pay.args?.amount) : null;
      if (usd !== null) {
        const held = Number(balances.find((b) => b.tokenId === `nep141:${steps[0]!.receiverId}` && b.held === "ledger")?.amount ?? NaN);
        const after = Number.isFinite(held) ? [{ token: "Your Safe after", before: "", after: `$${(Math.floor((held - usd) * 100 + 1e-6) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in ${sym}` }] : [];
        return { title, lines: [`1. Your Safe lets NEAR Intents take $${usd.toFixed(2)} in ${sym}.`, "2. Your Safe sends it.", "Step 2 runs only if step 1 worked.", "Fee · about $0.01. A small NEAR deposit comes back to your Safe later."], warnings: [], effect: after };
      }
      return { title, lines: [...steps.map(stepWords), "Each step happens only if the one before it worked.", `Fee: at most ${(0.001 * steps.length).toFixed(3)} NEAR.`], warnings: [], effect: [] };
    }
    return { title: request.why || "Sign this", lines: [`To ${request.receiverId}. Fee: at most 0.001 NEAR.`], warnings: [], effect: [], hint };
  };
  // Private (D27): the pocket starts not set up; ledger.privateSetup makes it, and money moves in through ledger.toPrivate.
  const pocket: { ready: boolean; defaultOn: boolean; rows: (typeof BALANCES)[number][] } = { ready: false, defaultOn: false, rows: [] };
  if (options.hiddenStart) {
    const near = BALANCES.find((b) => b.tokenId === "nep141:wrap.near")!;
    const nearUsd = (Number(options.hiddenStart.near) * (Number(near.usd) / Number(near.amount))).toFixed(2);
    pocket.ready = true;
    subwallets.push({ id: "sw-private-near", kind: "private", chain: "near", address: SAMPLE_POCKET, label: "Private" });
    pocket.rows.push({ ...BALANCES[0]!, amount: options.hiddenStart.usdc, usd: options.hiddenStart.usdc, held: "private" }, { ...near, amount: options.hiddenStart.near, usd: nearUsd, held: "private" });
  }
  /** This bridge's own sample balances, so money moved into Private leaves the main balance here too. */
  const balances = BALANCES.map((b) => ({ ...b }));
  /** The Safe's swap quotes (ledger.swapQuote), by id, until ledger.swap takes one. */
  const safeQuotes = new Map<string, { id: string; from: string; to: string; amountIn: string; amountOut: string; minOut: string; feeUsd: string; etaSeconds: number; expiresAtIso: string; source: "safe"; inSymbol: string; outSymbol: string; px: number; name: string }>();
  let safeQuoteN = 0;
  /**
   * The main USDC row moved by `micro` (USDC's smallest units, 6 decimals): the Add out, a Take out in. Counted in whole
   * units, never Number sums (1225.5 + 14.477735 is not 1239.977735 in floats); its dollars are the amount at $1 to the
   * cent, rounded down as the core's usdOf: Wallet adds dollars up at 2 decimals, and reads more as no dollars at all.
   */
  const moveMainUsdc = (micro: bigint) => {
    const row = balances.find((b) => b.tokenId === USDC_NEAR && b.held === "ledger");
    if (!row) return;
    const have = toMicro(row.amount) + micro;
    Object.assign(row, { amount: fromMicro(have), usd: fromMicro(have - (have % 10_000n)) });
  };
  /** A done send's coin leaves the main balance: from its NEAR Intents row first, then the same coin on the account. The
   *  dollars follow at the row's own price; USDC is counted in whole units (moveMainUsdc's rule). */
  const debit = (tokenId: unknown, amount: unknown) => {
    let left = Number(amount);
    if (typeof tokenId !== "string" || !(left > 0)) return;
    const id = tokenId === "near" ? "near" : tokenId;
    const rows = balances.filter((b) => b.tokenId === id).sort((a, b) => (a.held === "ledger" ? -1 : 0) - (b.held === "ledger" ? -1 : 0));
    for (const row of rows) {
      if (!(left > 0)) break;
      const have = Number(row.amount);
      const take = Math.min(have, left);
      if (!(take > 0)) continue;
      left -= take;
      if (row.tokenId === USDC_NEAR || row.tokenId === USDC_SOL || row.tokenId === USDC_BASE) {
        const micro = toMicro(row.amount) - toMicro(String(Number(take.toFixed(6))));
        Object.assign(row, { amount: fromMicro(micro), usd: fromMicro(micro - (micro % 10_000n)) });
      } else {
        const price = have > 0 && row.usd !== null ? Number(row.usd) / have : 0;
        const rest = Number((have - take).toFixed(9));
        Object.assign(row, { amount: String(rest), usd: row.usd === null ? null : (Math.floor(rest * price * 100) / 100).toFixed(2) });
      }
    }
  };
  /** Where an Add's coin is held: NEAR itself ("near") on the account, any other coin in NEAR Intents. */
  const heldAs = (tokenId: string) => (tokenId === "near" ? "account" : "ledger");
  /** That much of a coin leaves its main-balance row (the Add paid in it); the row's dollars follow at the sample price. */
  const takeCoin = (w: PayWith) => {
    const row = balances.find((b) => b.tokenId === w.tokenId && b.held === heldAs(w.tokenId));
    if (!row) return;
    const left = Math.max(0, Number(row.amount) - Number(w.amount));
    Object.assign(row, { amount: String(Number(left.toFixed(9))), usd: row.usd === null ? null : (Math.floor(left * w.price * 100) / 100).toFixed(2) });
  };
  const payQuotes = new Map<string, { amountOut: string; amountIn?: string; fromTokenId: unknown; toTokenId?: unknown; to: unknown; feeUsd?: string; confidential?: boolean }>();
  const privateQuotes = new Map<string, { amount: string; row: (typeof BALANCES)[number] }>();
  const convertQuotes = new Map<string, { amount: string; from: string; to: string; out: string }>();
  /** A swap inside the Safe landing (ledger.swap, ledger.convert): `amountIn` of `from` leaves its row, `amountOut` of
   *  `to` joins its row (a new row when the Safe had none), each row's dollars at its own price. */
  const swapRows = (from: string, amountIn: string, to: string, amountOut: string, o: { px?: number; symbol?: string; name?: string } = {}) => {
    const take = balances.find((b) => b.tokenId === from && b.held === "ledger");
    if (take) { const per = Number(take.amount) > 0 ? Number(take.usd) / Number(take.amount) : 0; const left = Math.max(0, Number(take.amount) - Number(amountIn)); take.amount = String(Number(left.toFixed(8))); take.usd = (left * (from === USDC_NEAR ? 1 : per)).toFixed(2); }
    const outPx = to === USDC_NEAR ? 1 : o.px ?? tokenPrice(to);
    const give = balances.find((b) => b.tokenId === to && b.held === "ledger");
    if (give) { const n = Number(give.amount) + Number(amountOut); give.amount = String(Number(n.toFixed(8))); give.usd = (n * outPx).toFixed(2); return; }
    const t = (options.tokens ?? DEFAULT_TOKENS).find((x) => x.assetId === to);
    const symbol = o.symbol ?? t?.symbol ?? "coin";
    balances.push({ ...balances[0]!, tokenId: to, symbol, name: o.name ?? t?.name ?? symbol, icon: t?.icon ?? symbol.toLowerCase(), chain: "near", amount: amountOut, usd: (Number(amountOut) * outPx).toFixed(2), bridged: false, held: "ledger", listed: true });
  };
  const pocketUsd = () => pocket.rows.reduce((t, r) => t + Number(r.usd ?? 0), 0);
  /** Home's Swap cost, the Sim's one source (J2-2, 8 Nov: the form said "Fees · about $1.50" and the Check-this "Fee ·
   *  $0.00" for the same Swap): 0.4 % and $0.30 of network fees for each leg on to a chain's wallet. The form's quote
   *  (subwallet.float.swapCost) and the Swap's Check-this read it, so both say one fee. */
  const simSwapCost = (usd: number, from: unknown, to: unknown): { arrivesUsd: number; feeUsd: number } => {
    // each chain leg's network fee from the one table the plan's bound reads (float-floors NETWORK_FEE_USD, the audit's MUST, 8 Nov)
    const net = (x: unknown) => (x === "sol" || x === "hood" || x === "bsc" ? NETWORK_FEE_USD[x] : 0);
    const fee = usd * 0.004 + net(from) + net(to);
    const cents = (x: number) => Math.round(x * 100) / 100;
    return { arrivesUsd: cents(usd - fee), feeUsd: cents(fee) };
  };
  /** A Move paid from Private, as the real ledger's private-move.ts: what it needs, what Private's USDC has, and the
   *  Safe's fill when it is short (a whole step over the need, core fillStepUsd; the extra stays in Private). */
  /** The Safe's row that fills Private with `tokenId`: NEAR on the account for "near", else its NEAR Intents row. */
  const safeFillRow = (raw: string, tokenId: string) => balances.find((b) => (raw === "near" ? b.tokenId === "near" && b.held === "account" : b.tokenId === tokenId && b.held === "ledger"));
  const privateNeed = (p: Record<string, unknown>) => {
    const parts = Array.isArray(p.parts) ? (p.parts as { usd?: unknown }[]) : [];
    const need = Math.round(parts.reduce((n, x) => n + (Number(x?.usd) || 0), 0) * 100) / 100;
    // the coin the Move pays with (the real ledger's `tokenId`, USDC by default; Spending picks it), as Private holds it
    // (the proof, 5 Nov: the sheet counted Private's NEAR, the Sim only its USDC)
    const raw = typeof p.tokenId === "string" && p.tokenId ? p.tokenId : USDC_NEAR;
    const tokenId = raw === "near" ? "nep141:wrap.near" : raw;
    const row = pocket.rows.find((r) => r.tokenId === tokenId);
    const have = tokenId === USDC_NEAR ? Number(row?.amount ?? 0) : Number(row?.usd ?? 0);
    const short = have + 0.000001 < need;
    // the fill, as the real ledger's safe-send.ts fillUnits (any coin: a whole step in dollars at its price; T-F, 6 Nov:
    // the Sim filled only USDC, so a Swap of the Safe's NEAR with Private short was refused after the sheet promised the
    // cover): from the Safe's NEAR Intents row of the coin, or for NEAR on the account ("near") from that row, wrapped
    // (the real core takes that fill since the audit's ruling, 6 Nov: the Safe's own wrap.near storage; real-core-paths T-F)
    const fillable = tokenId === USDC_NEAR || (tokenPrice(tokenId) > 0 && !!safeFillRow(raw, tokenId));
    // ONE fill for the whole Move, as the core's plan sizes it (core moveSplit; the audit's ruling, 7 Nov): Private pays the parts
    // it covers whole, the smallest first; the one fill pays every other part; a site's top-up (`whole`): the fill pays all
    const safeRow = tokenId === USDC_NEAR ? balances.find((b) => b.tokenId === USDC_NEAR && b.held === "ledger") : safeFillRow(raw, tokenId);
    const safeHas = Number(safeRow?.amount ?? 0) * (tokenId === USDC_NEAR ? 1 : tokenPrice(tokenId));
    const split = moveSplitUsd(parts.map((x) => Number(x?.usd) || 0), have, { whole: p.whole === true, safeHas });
    // each part: what Private pays of it from its own share, and what the one fill pays of it (`rest`)
    const fills = split.parts.map((x) => ({ part: x.part, at: x.at, fromPrivate: x.fromPrivate, rest: x.viaFill }));
    return { need, have, tokenId, raw, fills, fill: short ? (fillable ? split.fill : Infinity) : 0 };
  };
  /** A held movement, by its held id: a released one finishes as an unheld one would; a cancelled one stays in main. */
  const heldMoves = new Map<string, { m: Record<string, unknown>; ends: "done" | "refunded"; toTrading?: string; payWith?: PayWith }>();
  /** A Move from Private whose later Safe sheet was turned down: the part (in the ledger's order) it stopped at. */
  const movesStopAt = new WeakMap<object, number>();

  // ── mainnetRules: the account contract's rules (lib.rs `level_for_moves`, `place`, `floor_ns`) ──
  const rules = options.mainnetRules;
  /** Every payment of the last 24 hours, in dollars; a held one by its held id (a cancel drops its row, as drop_pending). */
  let spent: { at: number; usd: number; heldId?: string }[] = [];
  /** Until when a recovery freezes spending (ms; 0: no freeze). */
  let frozenUntil = 0;
  /** The recovery delay was chosen at set-up (account.create): it never changes after. */
  let delayFixed = false;
  /** Changes held for the change wait, by held id: what runs when the hold is released. */
  const heldChanges = new Map<string, { method: string; p: Record<string, unknown> }>();
  /** The Sim's backup words (options.sampleWords): the account's round, and the round shown by Get new words, not yet in. */
  let wordsRound = 0;
  let renewRound: number | null = null;
  const renewHeld = () => [...heldChanges.values()].some((c) => c.method === "recovery.renewConfirm");
  /** Why new words can't be made now, or null (as the core: none while some wait, nor while a move to a new device waits). */
  const renewRefusal = () =>
    !options.sampleWords ? securityProblems.notReady() : renewHeld() ? securityProblems.renewWaiting() : account.recovery?.pending ? securityProblems.renewRecoveryWaiting() : null;
  /** Three of the new words, checked before any sheet, as the core checks them before it signs (checkThree). */
  const renewProblem = (p: Record<string, unknown>): Problem | null => {
    if (account.recovery?.pending) return securityProblems.renewRecoveryWaiting();
    if (!options.sampleWords || renewRound === null || renewHeld()) return securityProblems.notReady();
    const words = options.sampleWords(renewRound);
    const at = Array.isArray(p.positions) ? (p.positions as unknown[]) : [];
    const typed = Array.isArray(p.words) ? (p.words as unknown[]) : [];
    if (at.length !== 3 || new Set(at).size !== 3 || typed.length !== 3 || !at.every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 24)) return securityProblems.requestInvalid("Send three different word positions (1 to 24) and the three words.");
    const bad = at.findIndex((n, i) => String(typed[i]).trim().toLowerCase() !== words[(n as number) - 1]);
    return bad < 0 ? null : securityProblems.wordWrong(at[bad] as number);
  };
  /** A change's wait on chain: the recovery delay plus as much again, up to 24 hours more (lib.rs floor_ns). */
  const changeWaitSeconds = () => {
    const d = account.recovery?.delaySeconds ?? 172800;
    return d + Math.min(d, 86400);
  };
  /** Release 7's words-only fallback: 3 times the delay, at least a week and at most 30 days (lib.rs). */
  const fallbackWaitSeconds = () => Math.min(30 * 86400, Math.max(7 * 86400, 3 * (account.recovery?.delaySeconds ?? 172800)));
  const hasLaptop = () => account.keys.some((k) => k.role === "second-device");
  /** The waiting move, as recovery.status says it (release 7), or null. */
  const pendingMove = (): RecoveryPending | null => account.recovery?.pending ?? null;
  /** A move changed: the account and its freeze say it (frozen_until ends at the earliest finish as things stand). */
  /** Re-audit 7 (R7-2): this move's one phone stop was asked (cleared at every end of a move). */
  let stopAsked = false;
  const setMove = (pending: RecoveryPending | null, frozenUntilMs: number) => {
    if (!pending) {
      // Every end of a move: the phone may stop the next one again, and a stop still waiting goes with this one.
      stopAsked = false;
      for (let i = held.length - 1; i >= 0; i--) {
        if (heldChanges.get(held[i].id)?.method !== "recovery.stop") continue;
        endedHolds.set(held[i].id, "cancelled");
        heldChanges.delete(held[i].id);
        held.splice(i, 1);
      }
    }
    account.recovery = { delaySeconds: account.recovery?.delaySeconds ?? 172800, pending };
    frozenUntil = frozenUntilMs;
    changed();
    emit("recovery.changed", { pending });
  };
  /** A move ends without its finish (the phone's stop, the laptop's refusal): payments stay frozen for the floor. */
  const endMove = () => setMove(null, Date.now() + changeWaitSeconds() * 1000);
  /** The laptop's own request for the waiting move (SecondDeviceCore's recoveryRequest, in its words). */
  const moveRequest = (p: RecoveryPending) => ({
    id: "recovery",
    kind: "Recovery",
    title: "A move to a new device",
    lines: [p.approved ? "This laptop already said yes. A no still ends the move." : `Without a yes, the backup words alone can finish it after ${waitWords(fallbackWaitSeconds())}.`],
    readyAtIso: p.readyAtIso,
    needsSecondDevice: !p.approved,
    ready: false,
    change: true,
  });
  const tokenPrice = (tokenId: unknown): number => {
    if (tokenId === USDC_NEAR || tokenId === USDC_SOL || tokenId === USDC_BASE) return 1;
    const t = (options.tokens ?? DEFAULT_TOKENS).find((x) => x.assetId === (tokenId === "near" ? "nep141:wrap.near" : tokenId));
    if (t?.priceUsd) return Number(t.priceUsd);
    const row = balances.find((b) => b.tokenId === tokenId && b.usd !== null && Number(b.amount) > 0);
    return row ? Number(row.usd) / Number(row.amount) : 0;
  };
  /** What a request moves out, in dollars (0: nothing measured). */
  const usdOfRequest = (method: string, p: Record<string, unknown>): { usd: number; quoted: boolean } | null => {
    switch (method) {
      case "ledger.pay": {
        const q = payQuotes.get(String(p.quoteId));
        if (!q) return null;
        // A pay that swaps or crosses chains runs at 1Click's price: a quote.
        return { usd: Number(q.amountOut) * (tokenPrice(q.toTokenId) || tokenPrice(q.fromTokenId)), quoted: q.fromTokenId !== q.toTokenId };
      }
      case "ledger.transfer": return { usd: Number(p.amount) * tokenPrice(p.tokenId), quoted: false };
      case "ledger.withdraw": return { usd: Number(p.amount) * tokenPrice(p.tokenId), quoted: false };
      case "ledger.toTrading": {
        const coin = addPaidWith(p.tokenId);
        return { usd: Number(p.amount) * (coin ? tokenPrice(coin) : 1), quoted: coin !== undefined };
      }
      case "ledger.convert": {
        const q = convertQuotes.get(String(p.quoteId));
        return q ? { usd: Number(q.amount) * tokenPrice(q.from), quoted: true } : null;
      }
      case "ledger.toPrivate": {
        const q = privateQuotes.get(String(p.quoteId));
        return q ? { usd: Number(q.amount) * tokenPrice(q.row.tokenId), quoted: true } : null;
      }
      default: return null;
    }
  };
  /** Send from the Safe with the fill (the real ledger's safe-send.ts sendFill): the Safe's USDC fills Private by a whole
   *  step (fillStepUsd, the extra kept under the $500 buffer, else exactly the Send), then one payout of the whole Send
   *  from Private; over the band the fill waits, as the Safe's own sends do. */
  /** The Sim's Send-from-the-Safe fill sheet (the real core's send-fill.ts, the copy review's words): the split, the short To row, the
   *  full address open right under it, what they get. Null when Private covers it (the one-step sheet). */
  /** What the payee gets, the coin figure (4 places, down) at the coin's price, as the core reads it from the signed quote;
   *  null when the Sim can't name the coin or price it (the audit's ruling, 5 Nov: refused before the sheet, never a dollars-only
   *  "They get"). */
  const fillGets = (p: Record<string, unknown>, usd: number): string | null => {
    const payee = p.to as { kind?: string; chain?: string } | undefined;
    const key = payee?.kind === "ledger" ? "near" : String(payee?.chain ?? "");
    const tokenId = typeof p.toTokenId === "string" && p.toTokenId ? p.toTokenId : key === "near" ? "nep141:wrap.near" : LANDS_ID[key] ?? "";
    const symbol = typeof p.toTokenId === "string" && p.toTokenId ? coinOf(p.toTokenId) : SEND_LANDS[key]?.coin ?? coinOf(tokenId);
    const px = tokenId ? tokenPrice(tokenId) : 0;
    return symbol && px > 0 ? `${(Math.floor((usd / px) * 1e4) / 1e4).toString()} ${symbol}` : null;
  };
  const fillSheet = (p: Record<string, unknown>, id: string, payee: { chain?: string; address?: string; accountId?: string } | undefined, lands: { coin: string; network: string }, more: Record<string, unknown>) => {
    const c = fillCase(p);
    if (!c || c.id !== id) return null;
    const fill = fillPlan(c);
    const to = String(payee?.address ?? payee?.accountId ?? "");
    const usd$ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // any coin (QA walk, MUST 1: a NEAR Send was refused "Up to 0.871326373 NEAR"): the split in dollars at the coin's
    // price, rounded to the cent once, by the core's own split (From your Safe - Stays in Private = what they get)
    const coinPx = tokenPrice(c.id), askedUsd = c.asked * coinPx;
    const cents = (n: number) => BigInt(Math.round(n * 100));
    // what they get (QA's Sim walk): the coin figure first (4 places, down), then what it is worth to them in brackets
    // (the quote's amountOutUsd, 1 % under the Send here), and the network fees the payout pays, named (T less that);
    // a coin it can't name or price never gets here (refused before the sheet, sendCoinUnknown)
    const outUsd = Number(cents(askedUsd * SIM_PAYOUT_KEEPS)) / 100;
    const gets = fillGets(p, outUsd) ?? "";
    const feesUsd = Number(cents(askedUsd) - cents(outUsd)) / 100;
    // any coin (train 36): the split in dollars at the coin's price, rounded to the cent once
    const sendsUsd = Number(cents(fill * coinPx)) / 100, staysUsd = Number(cents(fill * coinPx) - cents(askedUsd)) / 100;
    // as the real core's fill sheet (send-fill.ts) and every outside sheet (the audit's D37 condition): the FULL address first,
    // unfolded, then where it lands in the copy review's words, then the split and what they get
    // J2-2 (copy review, 8 Nov), as the core's send-fill.ts: "Send $25.00 to alice.near"; From your Safe = they get + Fees + what
    // Private keeps (privateRows, its net change), the Fees row on every sheet, no why sentence
    const $b = (c: bigint) => usd$(Number(c) / 100);
    return { title: sendTitle(usd$(askedUsd), to), lines: [`To ${to}`, SEND_LEG_WORDS.seen(lands.network), `${SEND_LEG_WORDS.gets} · ${gets} (${quoted(usd$(outUsd))})`, `${SEND_LEG_WORDS.sends} · ${usd$(sendsUsd)}`, ...privateRows(cents(staysUsd), $b, { about: true }), SEND_LEG_WORDS.fees(usd$(feesUsd)), SEND_LEG_WORDS.kept], warnings: [], effect: [], ...more,
      // as the real core (intents.ts, the Send's fill): the Amount is what the Safe's bytes move (the fill), said by "Your
      // Safe sends", so no "Amount:" line over it (QA's ledger re-walk, 6 Nov, b/12: "Amount: about $25.00" said the Send)
      ...amountOf(c.id, fill.toFixed(9)), amountSaid: true as const };
  };
  /** Whether a Send from the Safe takes the fill (as the ledger case below decides) and its fill would be held. */
  const sendFillHeld = (p: Record<string, unknown>): boolean => {
    const c = fillCase(p);
    if (!rules || !c) return false;
    const h = holdFor("ledger.transfer", { tokenId: c.id, amount: fillPlan(c).toFixed(9) });
    return !!h && h.why === "band";
  };
  /** Whether a Send from the Safe takes the fill, as the real ledger's safe-send.ts decides it for ANY coin (QA walk,
   *  MUST 1: the Sim filled only USDC): `fill` asked, the fill open, Private short of it, and the coin priced. `raw`: the
   *  Safe's own id ("near": NEAR on the account), `id`: Private's id for it. */
  const fillCase = (p: Record<string, unknown>): { raw: string; id: string; asked: number } | null => {
    const raw = String(p.tokenId ?? ""), id = raw === "near" ? "nep141:wrap.near" : raw;
    const asked = Number(p.amount), held = Number(pocket.rows.find((r) => r.tokenId === id)?.amount ?? 0);
    return p.fill === true && (options.safeFillOpen ?? SAFE_FILL_OPEN) && asked > 0 && asked > held && tokenPrice(id) > 0 ? { raw, id, asked } : null;
  };
  /** The Safe's one place a Send's fill pays from (the real leg 1: one place, never two added): NEAR Intents' row, or
   *  NEAR on the account for "near". */
  const safeRowOf = (raw: string) => balances.find((b) => b.tokenId === raw && (raw === "near" ? b.held === "account" : b.held === "ledger"));
  /** The fill for a Send of `asked` coins, as the real ledger's fillUnits: a whole step in dollars (core fillStepUsd) at the
   *  coin's catalogue price, up to its last place, when the Safe's place holds it and Private's share plus the extra stays at
   *  or under $500 (PRIVATE_BUFFER_USD); else exactly the Send. */
  const fillPlan = (c: { raw: string; id: string; asked: number }): number => {
    const px = tokenPrice(c.id);
    const have = Number(pocket.rows.find((r) => r.tokenId === c.id)?.amount ?? 0);
    const step = Math.ceil((fillStepUsd(c.asked * px) / px) * 1e9 - 1e-6) / 1e9;
    return step > c.asked && Number(safeRowOf(c.raw)?.amount ?? 0) >= step && (have + step - c.asked) * px <= 500 ? step : c.asked;
  };
  /** A coin figure that leaves, at most 4 places, rounded UP (core COIN_SHOWN_DECIMALS: never says less than goes). */
  const coinUp = (n: number) => String(Math.ceil(n * 10 ** COIN_SHOWN_DECIMALS - 1e-6) / 10 ** COIN_SHOWN_DECIMALS);
  /** A Send from the Safe over the day's Face ID limit (audit, 5 Nov: as the real core, refused before Face ID, never
   *  held: its quote can't wait), in the copy review's words: the day's limit and what one Send can still take today, its whole fill
   *  step included (the core's send-fill.ts sendRoom over the contract's band state). */
  const sendOverLimit = (): Problem => {
    const first = appBands[0];
    if (!first || first.level !== "faceid" || first.upToUsd === null) return securityProblems.quoteCantWait();
    const now = Date.now();
    const used = spent.filter((x) => x.heldId !== undefined || x.at + 86400e3 > now).reduce((n, x) => n + x.usd, 0);
    const room = Math.max(0, first.upToUsd - used);
    let lo = 0, hi = Math.floor(room * 100);
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fillStepUsd(mid / 100) <= room + 1e-9) lo = mid; else hi = mid - 1; }
    return securityProblems.sendOverLimit(first.upToUsd, lo / 100, ADD_LEAST_USD);
  };
  const sendFill = (p: Record<string, unknown>, c: { raw: string; id: string; asked: number }): Record<string, unknown>[] => {
    const usdc = c.id === USDC_NEAR;
    const safe = safeRowOf(c.raw);
    let row = pocket.rows.find((r) => r.tokenId === c.id);
    const fill = fillPlan(c), px = tokenPrice(c.id);
    if (!safe || Number(safe.amount) < fill) throw balanceLow(usdc ? fill.toFixed(2) : coinUp(fill), usdc ? "USDC" : safe?.symbol ?? coinOf(c.id));
    if (!pocket.ready) { subwallets.push({ id: "sw-private-near", kind: "private", chain: "near", address: SAMPLE_POCKET, label: "Hidden" }); pocket.ready = true; }
    if (!row) { row = { ...(usdc ? BALANCES[0]! : safe), tokenId: c.id, amount: "0", usd: "0", held: "private" }; pocket.rows.push(row); }
    const payee = p.to as { address?: string; accountId?: string } | undefined;
    const kept = Number((fill - c.asked).toFixed(usdc ? 6 : 9));
    const m: Record<string, unknown> = { id: `safe-send:sim-${movements.length + 1}`, kind: "pay", status: "moving", amount: String(p.amount), from: c.id, to: String(payee?.address ?? payee?.accountId ?? ""),
      ...(kept > 0 ? { kept: String(kept) } : {}), private: true, debited: true, startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [] };
    movements.unshift(m);
    // over the band: refused before the sheet (sendFillHeld, below); never "waits 1 day" for a quoted Send
    if (rules && holdFor("ledger.transfer", { tokenId: c.id, amount: fill.toFixed(usdc ? 6 : 9) })) { movements.shift(); throw sendOverLimit(); }
    // the contract counts what leaves the Safe: the whole fill step, its extra included (core send-fill.ts sendRoom)
    if (rules) spent.push({ at: Date.now(), usd: Math.round(fill * px * 1e6) / 1e6 });
    if (usdc) {
      moveMainUsdc(-toMicro(fill.toFixed(6)));
      const micro = toMicro(row.amount) + toMicro(kept.toFixed(6));
      Object.assign(row, { amount: fromMicro(micro), usd: fromMicro(micro - (micro % 10_000n)) });
    } else {
      // the Safe's row loses the step at its own price; Private's row keeps the extra (still the person's, in Private)
      const per = Number(safe.amount) > 0 && Number(safe.usd) > 0 ? Number(safe.usd) / Number(safe.amount) : px;
      const left = Math.max(0, Number((Number(safe.amount) - fill).toFixed(9)));
      Object.assign(safe, { amount: String(left), usd: (left * per).toFixed(2) });
      const mine = Number((Number(row.amount) + kept).toFixed(9));
      Object.assign(row, { amount: String(mine), usd: (Number(row.usd ?? 0) + kept * per).toFixed(2) });
    }
    emit("ledger.balancesChanged", {});
    later({ kind: "settle", movementId: m.id as string, ends: "done", balances: false }, settle * 2);
    return [{ ...m }];
  };
  const CHANGES = new Set(["account.protection.set", "account.secondDevice.pair", "account.secondDevice.setLimit", "account.removeKey", "recovery.renewConfirm"]);
  /** What the contract would do with a request now: run it, or hold it (how long on chain, and whether a second device must say yes). */
  type Hold = { realSeconds: number; needsSecondDevice: boolean; why: "band" | "freeze" | "change"; over?: number };
  const holdFor = (method: string, p: Record<string, unknown>): Hold | null => {
    if (!rules) return null;
    // Re-audit 7 (R7-1): removing the laptop (of age here) waits the fallback when that's longer than a change's wait.
    if (method === "account.removeKey" && p.handle === LAPTOP_HANDLE) return { realSeconds: Math.max(changeWaitSeconds(), fallbackWaitSeconds()), needsSecondDevice: false, why: "change" };
    // As the contract places a change (lib.rs place): the strictest band's level and at least a change's wait. With a
    // band that asks the laptop, a change asks it too, so "needs Face ID and your second device" is true (grade 1 Nov, item 2).
    if (CHANGES.has(method)) {
      const strict = appBands.filter((x) => x.level === "device" || x.level === "both");
      const own = Math.max(0, ...appBands.filter((x) => x.level === "wait" || x.level === "both").map((x) => Number(x.waitSeconds) || 0));
      return { realSeconds: Math.max(changeWaitSeconds(), own), needsSecondDevice: strict.length > 0 && hasLaptop(), why: "change" };
    }
    const r = usdOfRequest(method, p);
    if (!r) return null;
    if (frozenUntil > Date.now()) return { realSeconds: changeWaitSeconds(), needsSecondDevice: false, why: "freeze" };
    const now = Date.now();
    const total = spent.filter((s) => s.heldId !== undefined || s.at + 86400e3 > now).reduce((n, s) => n + s.usd, 0) + r.usd;
    const i = Math.max(0, appBands.findIndex((b) => b.upToUsd === null || total <= b.upToUsd));
    const band = appBands[i];
    if (!band || band.level === "faceid") return null;
    const realSeconds = band.level === "device" ? 0 : Number(band.waitSeconds) > 0 ? Number(band.waitSeconds) : 86400;
    return { realSeconds, needsSecondDevice: band.level === "device" || band.level === "both", why: "band", over: i > 0 ? appBands[i - 1].upToUsd ?? 0 : 0 };
  };
  /** The words a held request carries: its wait, as the core says it (the contract's real wait). */
  /** A line holdLines wrote (about the wait itself), told apart from a request's own words. */
  const HOLD_LINE = /You can cancel it until then\.$|^Your (second device|laptop) must also say yes\.$/;
  /** The demo's second device by its name: its laptop, one name everywhere (grade 1 Nov, item 7). */
  const deviceWord = () => "your laptop";
  const holdLines = (h: Hold): string[] => {
    const wait = waitWords(h.realSeconds);
    if (h.why === "change") return [`Waits ${wait}${h.needsSecondDevice ? " and needs your laptop's yes" : ""}, so you have time to stop a change you didn't make. You can cancel it until then.`];
    if (h.why === "freeze") return [`A recovery is open, so payments wait ${wait}. You can cancel it until then.`];
    if (h.realSeconds > 0) return [`${h.over ? `Over $${h.over.toLocaleString("en-US")} in 24 hours: it` : "It"} waits ${wait}${h.needsSecondDevice ? ` and needs ${deviceWord()}` : ""}. You can cancel it until then.`];
    return [`${deviceWord().replace(/^y/, "Y")} must also say yes.`];
  };
  /** Hold a request by the rules: listed in account.waiting until its real wait is over (or `demoWaitSeconds`, in tests). */
  const placeHold = (h: Hold, title: string): { id: string; title: string; lines: string[]; readyAtIso: string; needsSecondDevice: boolean } => {
    const seconds = rules?.demoWaitSeconds ?? h.realSeconds;
    const item = { id: `held-${Date.now().toString(36)}-${held.length + 1}`, title, lines: holdLines(h), readyAtIso: iso(seconds * 1e3), needsSecondDevice: h.needsSecondDevice };
    held.push(item);
    return item;
  };
  const verbOf = (kind: string) => (kind === "pay" || kind === "transfer" ? "Send" : kind === "withdraw" ? "Send out" : kind === "private" ? "Move to Private" : "Convert");

  const move = (kind: "convert" | "withdraw" | "deposit" | "pay" | "transfer" | "private" | "trading", amount: string, extra: Record<string, unknown> = {}, ends: "done" | "refunded" = "done", request?: { method: string; p: Record<string, unknown> }) => {
    const m: Record<string, unknown> = { id: `mv-${movements.length + 1}`, kind, status: "moving", amount, startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], ...extra };
    movements.unshift(m);
    const titleOf = () => kind === "trading"
      ? extra.from !== undefined && extra.from !== USDC_NEAR ? `Top up Spending with ${amount} ${coinOf(extra.from)}` : `Top up Spending with $${amount}`
      : `${verbOf(kind)} ${amount}${extra.from !== undefined && coinOf(extra.from) ? ` ${coinOf(extra.from)}` : ""}`;
    // With holdSeconds, the account's protection holds it (D17): the movement waits, nothing moves, and the held request
    // shows in account.waiting like any other.
    if (options.holdSeconds && kind !== "deposit") {
      const h = { id: `held-${held.length + 1}`, title: titleOf(), lines: [], readyAtIso: iso(options.holdSeconds * 1e3), needsSecondDevice: false };
      held.push(h);
      heldMoves.set(h.id, { m, ends });
      Object.assign(m, { status: "waiting", held: { id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: false } });
      return { ...m };
    }
    // mainnetRules: the bands (and a freeze) decide, as on chain; the payment counts toward the 24 hours either way.
    const rule = request && rules ? holdFor(request.method, request.p) : null;
    const usd = request && rules ? usdOfRequest(request.method, request.p)?.usd ?? 0 : 0;
    if (rule) {
      const h = placeHold(rule, titleOf());
      if (usd > 0) spent.push({ at: Date.now(), usd, heldId: h.id });
      heldMoves.set(h.id, { m, ends });
      Object.assign(m, { status: "waiting", held: { id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: h.needsSecondDevice } });
      return { ...m };
    }
    if (usd > 0) spent.push({ at: Date.now(), usd });
    leavesNow(m, ends);
    // into the apps wallet: a Solana transfer lands in about a second, so the demo's does too (grade 1 Nov, item 11:
    // an Add took about 6 s)
    later({ kind: "settle", movementId: m.id as string, ends, balances: true }, typeof extra.toWallet === "string" ? Math.min(settle, APPS_WALLET_SETTLE_MS) : settle);
    return { ...m };
  };
  /** Money that leaves (a send, a pay, a send out) leaves the balance the moment it is sent, as it does on chain: the
   *  balance on Wallet is already the new one when the person taps Done (grade 30 Oct, item 9). Settling only marks it
   *  arrived. */
  const leavesNow = (m: Record<string, unknown>, ends: "done" | "refunded") => {
    if (ends !== "done" || !(m.kind === "transfer" || m.kind === "pay" || m.kind === "withdraw") || m.debited) return;
    debit(m.from as string, m.amount as string);
    m.debited = true;
    emit("ledger.balancesChanged", {});
  };
  /** A change (protection, a second device, its limit), now that it may run: what it does on chain. */
  const applyChange = (method: string, p: Record<string, unknown>) => {
    if (CHANGE_ROW[method]) changeRows.unshift({ atIso: iso(0), title: CHANGE_ROW[method], lines: [], by: "This device", ok: true, txHash: `sample-change-${changeRows.length + 1}` });
    if (method === "account.agent.setBudget") {
      // a higher its wallet, after its wait: the people on it as they were asked then
      if (agentRules) {
        const limitUsd = agentLimitFits(agentRules.limitUsd, Number(p.limitUsd));
        agentLimitMoves(agentRules.limitUsd, limitUsd);
        agentRules = { ...agentRules, limitUsd, people: Array.isArray(p.people) ? (p.people as unknown[]).filter((x): x is string => typeof x === "string") : agentRules.people };
        agentLastLimit = limitUsd;
      }
    } else if (method === "account.agent.set") {
      // a turn-on that waited (above the last limit in force): AgentZero starts now, its spends of before the Stop gone
      const limitUsd = agentLimitFits(0, Number(p.limitUsd));
      agentLimitMoves(0, limitUsd);
      agentRules = { limitUsd, since: Date.now(), paid: [], people: Array.isArray(p.people) ? (p.people as unknown[]).filter((x): x is string => typeof x === "string") : [] };
      agentLastLimit = limitUsd;
    } else if (method === "account.secondDevice.pair") {
      if (!account.keys.some((k) => k.role === "second-device")) account.keys.push({ handle: LAPTOP_HANDLE, role: "second-device", kind: "development" });
    } else if (method === "account.secondDevice.setLimit") {
      const bands = limitBands(appBands, p.usd);
      if (bands) {
        appBands = bands;
        protectionBands = demoBands(bands);
      }
    } else if (method === "account.protection.set") {
      protectionBands = demoBands(p.bands);
      appBands = Array.isArray(p.bands) ? (p.bands as Band[]) : [];
    } else if (method === "account.removeKey") {
      if (p.handle === OLD_KEY_HANDLE) removedOld = true;
      account.keys = account.keys.filter((k) => k.handle !== p.handle);
    } else if (method === "recovery.renewConfirm") {
      wordsRound = Number(p.round) || wordsRound;
      renewRound = null;
      emit("recovery.renewed", {});
    } else if (method === "recovery.stop") {
      // Re-audit 7 (R7-2): a stop nobody answered never ends a move the laptop said yes to.
      const move = pendingMove();
      if (move && !move.approved) endMove();
    }
  };
  /** A change under mainnetRules: held for the change wait, as on chain (tighter or looser). */
  const holdChange = (method: string, p: Record<string, unknown>, title: string): TxOutcome => {
    if (options.decline) return { status: "declined" };
    const h = placeHold(holdFor(method, p)!, title);
    heldChanges.set(h.id, { method, p: JSON.parse(JSON.stringify(p)) });
    return { status: "waiting", txHash: "sample-tx", explorerUrl: NO_EXPLORER, id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: h.needsSecondDevice };
  };
  /** An Add to Trading, once signed: the main balance lets it go at once (one ft_withdraw); the float has it once it lands. */
  /** Trade's float as the core lists it once made (one per account); an Add makes it here if nothing asked for it first. */
  const floatWallet = () => {
    const made = subwallets.find((x) => x.kind === "trade" && x.chain === "near") ?? { id: "sw-trade-near", kind: "trade", chain: "near", address: SAMPLE_FLOAT, label: "Spending" };
    if (!subwallets.includes(made)) subwallets.push(made);
    return made;
  };
  const releaseToTrading = (amount: string, payWith?: PayWith) => {
    floatWallet();
    if (payWith) takeCoin(payWith);
    else moveMainUsdc(-toMicro(amount));
    emit("ledger.balancesChanged", {});
    later({ kind: "float.credit", micro: toMicro(amount).toString() }, settle);
  };

  // Timed steps (?demo&keep needs them as data): each has an absolute due time, leaves `jobs` before it runs (so it runs
  // once), and the state is saved the moment it has run.
  const jobs = new Map<number, { job: Job; timer: unknown }>();
  let jobSeq = 0;
  const timers = options.timers ?? { set: (run: () => void, ms: number): unknown => setTimeout(run, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const arm = (job: Job) => jobs.set(job.id, { job, timer: timers.set(() => runJob(job.id), Math.max(0, job.dueAt - Date.now())) });
  function later(work: JobWork, ms: number) {
    arm({ ...work, id: ++jobSeq, dueAt: Date.now() + ms });
    changed();
  }
  function runJob(id: number) {
    const j = jobs.get(id);
    if (!j) return;
    // the Sim's money lands only online (QA's Jobs hunt, 5 Nov: a Send said Done while the page was offline):
    // offline, the step waits for the page to be back online, as a real network's answer would
    const g = globalThis as { navigator?: { onLine?: boolean }; addEventListener?: (e: string, f: () => void, o?: { once: boolean }) => void };
    if (g.navigator?.onLine === false && g.addEventListener) { timers.clear(j.timer); g.addEventListener("online", () => runJob(id), { once: true }); return; }
    timers.clear(j.timer);
    jobs.delete(id);
    const job = j.job;
    if (job.kind === "settle") {
      const m = movements.find((x) => x.id === job.movementId);
      if (m) {
        Object.assign(m, { status: job.ends, updatedAtIso: iso(0) });
        const social = m.kind === "withdraw" && job.ends === "done" ? (typeof m.toWallet === "string" ? subwallets.find((w) => w.id === m.toWallet) : ownSocialWallet(m.to)) : undefined;
        if (social) walletNative.set(social.id, (walletNative.get(social.id) ?? 0n) + lamportsOf(m.amount));
        // money that left (a send, a pay, a withdraw) leaves the main balance when it is done: the coin row and the total
        if (job.ends === "done" && (m.kind === "transfer" || m.kind === "pay" || m.kind === "withdraw") && !m.debited) debit(m.from, m.amount);
        // a Convert that landed: the coin paid leaves the Safe, the coin got comes in at its quote's figure (once)
        if (job.ends === "done" && m.kind === "convert" && typeof m.to === "string" && typeof m.amountOut === "string" && !m.debited) { swapRows(String(m.from), String(m.amount), m.to, m.amountOut); m.debited = true; }
        emit("ledger.movementUpdated", { movement: { ...m } });
        if (job.balances) emit("ledger.balancesChanged", {});
      }
    } else if (job.kind === "float.credit") float.credit(BigInt(job.micro));
    else if (job.kind === "private.pay") {
      // a leg paid from Private landed: the wallet has it (its own coin at the Sim's price), the NEAR wallet its USDC
      const m = movements.find((x) => x.id === job.movementId);
      const w = subwallets.find((x) => x.id === job.wallet);
      if (job.wallet === "near") float.credit(toMicro(job.usd.toFixed(2)));
      else if (w) {
        const px = options.float?.priceUsd?.(w.chain as never) ?? (w.chain === "sol" ? SIM_SOL_USD : w.chain === "bsc" ? 744.17 : 3500);
        const units = w.chain === "sol" ? BigInt(Math.round((job.usd / px) * 1e9)) : BigInt(Math.round((job.usd / px) * 1e9)) * 1_000_000_000n;
        walletNative.set(w.id, (walletNative.get(w.id) ?? 0n) + units);
      }
      if (m) { Object.assign(m, { status: "done", updatedAtIso: iso(0) }); emit("ledger.movementUpdated", { movement: { ...m } }); }
      emit("ledger.balancesChanged", {});
    }
    else if (job.kind === "private.home") {
      // Out of Private, landed: the coin is back in the main balance, less the move's fee.
      const row = balances.find((b) => b.tokenId === job.tokenId && b.held === "ledger");
      if (row) Object.assign(row, { amount: String(Number(row.amount) + Number(job.amount)), usd: (Number(row.usd ?? 0) + Number(job.usd)).toFixed(2) });
      emit("ledger.balancesChanged", {});
    } else {
      const row = balances[job.rowIndex];
      if (row) {
        const usd = (Number(job.amount) * (Number(row.usd) / Number(row.amount))).toFixed(2);
        Object.assign(row, { amount: String(Number(row.amount) - Number(job.amount)), usd: String(Number(row.usd) - Number(usd)) });
        const had = pocket.rows.find((r) => r.tokenId === row.tokenId);
        if (had) Object.assign(had, { amount: String(Number(had.amount) + Number(job.amount)), usd: (Number(had.usd) + Number(usd)).toFixed(2) });
        else pocket.rows.push({ ...row, amount: job.amount, usd, held: "private" });
        emit("ledger.balancesChanged", {});
      }
    }
    flush();
  }

  /** A hold ends: listed no more, its outcome kept for account.waiting.status, and what it held runs (ran) or doesn't. */
  const endHold = (i: number, ended: "ran" | "cancelled" | "declined", out: { txHash?: string; explorerUrl?: string }) => {
    const [h] = held.splice(i, 1);
    endedHolds.set(h.id, ended);
    const hm = heldMoves.get(h.id);
    heldMoves.delete(h.id);
    // mainnetRules: a released change does what it asked; a cancel drops the payment's row from the 24 hours.
    const hc = heldChanges.get(h.id);
    heldChanges.delete(h.id);
    if (hc && ended === "ran") applyChange(hc.method, hc.p);
    if (ended !== "ran") spent = spent.filter((x) => x.heldId !== h.id);
    else spent = spent.map((x) => (x.heldId === h.id ? { at: Date.now(), usd: x.usd } : x));
    if (hm && ended === "ran") {
      if (hm.toTrading !== undefined) releaseToTrading(hm.toTrading, hm.payWith);
      Object.assign(hm.m, { status: "moving", held: undefined, updatedAtIso: iso(0) });
      leavesNow(hm.m, hm.ends);
      emit("ledger.movementUpdated", { movement: { ...hm.m } });
      later({ kind: "settle", movementId: hm.m.id as string, ends: hm.ends, balances: true }, settle);
    }
    // As the core does: tell listeners the hold ended here, after the answer is on its way.
    setTimeout(() => emit("account.waiting.ended", { id: h.id, ended, txHash: out.txHash, explorerUrl: out.explorerUrl }), 0);
  };
  /** The demo's Trade session for swaps inside Spending, as the core's: until when, and its dollars used. */
  let swapSession: { until: number; usd: number } | undefined;
  const swapAsked = async (p: Record<string, unknown>): Promise<unknown> => {
    const q = float.answer("subwallet.float.swapQuote", p) as { amountIn: string; minAmountOut: string; decimals: number; symbol: string; coinUsd: number };
    const units = BigInt(String(p.amount));
    const usd = p.side === "buy" ? Number(units) / 1e6 : (Number(units) / 10 ** q.decimals) * q.coinUsd;
    // D143 (core approval-policy.ts): the NEAR wallet is a hot key, so a swap never asks; Trade's call with `session`
    // starts one (it only says when it ends), as the core's floatSwap
    const live = swapSession && Date.now() < swapSession.until;
    const pair = !live && p.session && p.app === "trade";
    if (pair) swapSession = { until: Date.now() + 30 * 60_000, usd: 0 };
    if (live || pair) swapSession!.usd += usd;
    const m = float.answer("subwallet.float.swap", p) as Record<string, unknown>;
    return pair && !("declined" in m) ? { ...m, sessionEndsAtIso: new Date(swapSession!.until).toISOString() } : m;
  };
  /** "Ask me first" (the core's agent-private.ts setAskAbove): asking less often is the person's own Approve. */
  const askAboveCall = async (p: Record<string, unknown>): Promise<unknown> => {
    if (!p.set) return { askAboveUsd: agentAskAbove };
    const want = p.usd === null ? null : Number(p.usd);
    if (want !== null && !(Number.isFinite(want) && want >= 0 && want <= 1000)) throw securityProblems.requestInvalid("usd is $0 to $1,000, or null for never");
    const loosens = agentAskAbove !== null && (want === null || want > agentAskAbove);
    const lines = want === null ? ["AgentZero pays without asking you, up to its daily limit."] : [`AgentZero pays up to $${want} without asking you.`, "Above that, it asks you first."];
    if (loosens && (options.decline || !(await ask({ title: "Let AgentZero pay more without asking", lines, warnings: [], effect: [] } as unknown as PlainWords)))) return { declined: true };
    agentAskAbove = want;
    changed();
    return { askAboveUsd: want };
  };
  const answer = (method: string, p: Record<string, unknown>): unknown => {
    switch (method) {
      case "approval.answer": {
        const settle = approvals.get(String(p.id));
        if (!settle) throw answerUnknown();
        settle(p.approve === true);
        return { ok: true };
      }
      case "account.state": return { stage: waitingForNear() ? "needs-funding" : "ready", ...(waitingForNear() ? {} : { account }) };
      case "account.recoveryChoices": return recoveryChoices("mainnet");
      // The "Your key" card in the demo: a sample key, said so (L6). Nothing here was read from a chip or a network.
      case "account.keyProof": {
        const device = account.keys.find((k) => k.current) ?? account.keys[0]!;
        const fingerprint = shortFingerprint(device.handle);
        const proof: KeyProof = { kind: device.kind, fingerprint, nodes: [{ node: "sample", found: true }, { node: "sample", found: true }], matches: true, sample: true };
        return device.kind === "secure-chip" ? { ...proof, chipFingerprint: fingerprint, chipHeld: true, madeAtIso: iso(0) } : proof;
      }
      case "account.create": {
        // Release 7: the person's recovery delay, one of the set-up choices; fixed from here on (account.create again
        // can't change it).
        if (p.recoveryDelaySeconds !== undefined) {
          const chosen = Number(p.recoveryDelaySeconds);
          if (!recoveryChoices("mainnet").some((c) => c.seconds === chosen)) throw securityProblems.requestInvalid("recoveryDelaySeconds must be one of account.recoveryChoices");
          if (!delayFixed) account.recovery = { delaySeconds: chosen, pending: null };
          delayFixed = true;
        }
        const f = options.needsFunding;
        if (!f || !waitingForNear()) return account;
        const call = createCalls++;
        return { stage: "needs-funding", accountId: "zf-sample0001.near", fundAddress: f.fundAddress ?? SAMPLE_FUND_ADDRESS, needYocto: f.needYocto, haveYocto: f.haveYocto[Math.min(call, f.haveYocto.length - 1)] };
      }
      case "account.activity": return [...changeRows, ...agentReceipts, ...ACTIVITY].sort((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso)).slice(0, Number(p.limit ?? 20));
      // Agent on release 10's rules, over sample money: its own key, a daily limit in dollars (rolling 24 hours), the
      // kill switch, and every payment a receipt in Activity. The contract's band rule is the core's on a real account.
      case "account.agent.view": {
        // Off: no limit, but still the sample's (AgentZero's sheets say "sample money" before it is turned on too).
        if (!agentRules) return { limitUsd: 0, spentTodayUsd: "0.00", people: [], sample: true, ...(agentLastLimit !== null ? { lastLimitUsd: agentLastLimit } : {}), ...agentWaiting() };
        const since = Date.now() - 86_400_000;
        const spent = agentRules.paid.filter((x) => x.at > since).reduce((t, x) => t + x.usd, 0);
        return { limitUsd: agentRules.limitUsd, spentTodayUsd: spent.toFixed(2), heldUsd: agentHeldUsd, onSinceIso: new Date(agentRules.since).toISOString(), people: agentRules.people, sample: true, ...agentWaiting() };
      }
      // Home's row and total (packages/wallet agent-row.ts): what is really in AgentZero's sample wallet. None while it's off.
      case "account.agent.balance":
        return agentRules ? { usdcMicros: String(Math.round(agentHeldUsd * 1e6)) } : null;
      // AgentZero's receipts' chain head, kept apart from the app's store (the core keeps it in its vault: agent-receipt-head.ts).
      case "account.agent.receiptHead": {
        if (p.set !== undefined) receiptHead = p.set;
        return { head: receiptHead };
      }
      case "account.agent.set": case "account.agent.setBudget": {
        const usd = Number(p.limitUsd);
        if (!(usd > 0) || usd > 50) throw new ProblemError({ code: "agent.limit.bands", whatHappened: "That's more than AgentZero's wallet can hold. Choose $50 or less.", money: { state: "safe", where: "in your Safe" }, next: { kind: "fix-input", label: "Choose less", field: "limit" } } as Problem);
        // AgentZero's budget pays only the listed people (its key can pay no one else: budget.ts), as the contract does.
        // once each, as the contract's list holds a name once (hunt 5 Nov, 027: "maya.near, maya.near")
        const people = Array.isArray(p.people) ? [...new Set((p.people as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()))] : [];
        // a higher limit on an AgentZero that's on waits the account's safety wait, as AgentZero's wallet sheet says
        // (jobs.ts pocketWaitLine: the recovery delay and up to 24 hours more); a lower one works at once (QA 5 Nov:
        // $50 showed at once while the sheet said 3 days). A new person on the list loosens it too (agent.rs
        // agent_set_budget: only a tightening runs at once), and so does a turn-on above the last limit in force.
        const was = agentRules;
        // the money comes from the Safe (the funding job's "From your Safe"): none there, nothing is asked
        const adds = cents(usd - (was?.limitUsd ?? 0));
        if (adds > safeUsdc() + 1e-9) throw new ProblemError({ code: "agent.funds", whatHappened: `Your Safe has only ${dollarWords(safeUsdc(), true)} in USDC. Nothing moved.`, money: { state: "safe", where: "in your Safe" }, next: { kind: "fix-input", label: "Choose less", field: "limit" } } as Problem);
        const loosens = method === "account.agent.setBudget" && was ? usd > was.limitUsd + 1e-9 || people.some((x) => !was.people.includes(x)) : method === "account.agent.set" && !was && agentLastLimit !== null && usd > agentLastLimit + 1e-9;
        if (loosens) {
          if (options.decline) return { status: "declined" };
          const delay = account.recovery?.delaySeconds ?? 172800;
          const h = placeHold({ realSeconds: delay + Math.min(delay, 86_400), needsSecondDevice: false, why: "change" }, "Add money to AgentZero's wallet");
          heldChanges.set(h.id, { method, p: { limitUsd: usd, people } });
          return { status: "waiting", txHash: "sample-tx", explorerUrl: NO_EXPLORER, id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: false } as TxOutcome;
        }
        if (options.decline) return { status: "declined" };
        agentLimitMoves(was?.limitUsd ?? 0, usd);
        agentRules = { limitUsd: usd, since: Date.now(), paid: agentRules?.paid ?? [], people };
        agentLastLimit = usd;
        return signed();
      }
      case "account.agent.revoke": {
        if (options.decline) return { status: "declined" };
        // agent_revoke: anything for AgentZero still waiting goes with it (agent.rs, audit F9), so no held raise or
        // person comes back unasked
        for (const h of agentHeld()) endHold(held.indexOf(h), "cancelled", {});
        // what's left in its wallet goes back to the Safe with the Stop (the funding page: "You can take it back any time")
        agentGivesBack(agentHeldUsd);
        agentRules = null;
        agentMoneyMoved();
        agentReceipts.unshift({ atIso: iso(0), title: "Stopped AgentZero. Its key is gone", lines: [], by: "This device", ok: true, txHash: "sample-agent-off" });
        return signed();
      }
      // The core's account.agent.cancelWaiting: AgentZero's own looser changes still waiting, each cancelled (in the Sim
      // every held agent change loosens). None waiting: nothing cancelled (hunt 5 Nov, 034: the missing call read as one).
      case "account.agent.cancelWaiting": {
        const outcomes: TxOutcome[] = [];
        for (const h of agentHeld()) {
          const out = signed();
          if (out.status === "done") endHold(held.indexOf(h), "cancelled", out);
          outcomes.push(out);
        }
        if (outcomes.length) changed();
        return { cancelled: outcomes.filter((o) => o.status === "done").length, outcomes };
      }
      case "account.agent.spend": {
        const usd = Number(p.usd);
        // the keep job's top-up: the core refuses it while the private route is shut (agent-private.ts), before any
        // its wallet counts (hunt 5 Nov, 040: "moved $10" with nothing moved, and $10 of the day gone)
        if (p.kind === "top-up" && !AGENT_PRIVATE_ROUTE) throw new ProblemError(securityProblems.requestNotAllowed(AGENT_TOP_UP_OFF));
        // the copy job's trade on sample money: in the sample pump.fun wallet (its sheet: "Pays from the sample pump.fun
        // wallet"), through the Sim's own trade; nothing there, or the trade can't go, is a refusal (never a receipt)
        const trade = p.kind === "buy" || p.kind === "sell" ? sampleCoin(p.coin) : null;
        if (!agentRules) throw new ProblemError({ code: "agent.off", whatHappened: "AgentZero is off. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as Problem);
        const since = Date.now() - 86_400_000;
        const spent = agentRules.paid.filter((x) => x.at > since).reduce((t, x) => t + x.usd, 0);
        if (p.kind !== "sell" && (!(usd > 0) || spent + usd > agentRules.limitUsd + 1e-9 || usd > agentHeldUsd + 1e-9)) throw new ProblemError({ code: "agent.limit.day", whatHappened: "That's more than is left in AgentZero's wallet. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as Problem);
        // A payment goes only to a listed person; a sample move into Spending or a sample trade has no payee.
        if ((p.kind === "pay" || p.kind === "pay-private") && !agentRules.people.includes(String(p.to ?? "").toLowerCase())) throw new ProblemError({ code: "agent.recipient", whatHappened: "Your account lets AgentZero pay only the people on your list. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as Problem);
        if (p.kind !== "pay" && p.kind !== "pay-private" && p.kind !== "top-up" && p.kind !== "buy" && p.kind !== "sell") throw new ProblemError({ code: "agent.kind", whatHappened: "AgentZero can't do that. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as Problem);
        if (trade) {
          const nothing = (line: string) => new ProblemError({ code: "agent.trade", whatHappened: `${line} Nothing moved.`, money: { state: "safe", where: "in your pump.fun wallet" }, next: { kind: "nothing", label: "OK" } } as Problem);
          if (!trade.token) throw nothing(`AgentZero can't trade ${trade.symbol || "that coin"} in the Sim.`);
          // a buy spends AgentZero's wallet (its sheet: "Trades only from AgentZero's own wallet"), through the pump.fun
          // wallet that keeps the coin; that wallet's own money stays as it was
          if (p.kind === "buy") simSiteCash("pump", usd);
          const r = simTrade("pump", p.kind, trade, usd) as { status: string };
          if (r.status !== "done") throw nothing(`AgentZero holds no ${trade.symbol} in your pump.fun wallet.`);
          if (p.kind === "buy") agentHeldUsd = cents(agentHeldUsd - usd);
          agentMoneyMoved();
          changed();
        }
        // a payment to a listed person leaves AgentZero's wallet (the funding took it from the Safe), and Home's total with it
        if (p.kind === "pay" || p.kind === "pay-private") {
          agentHeldUsd = cents(agentHeldUsd - usd);
          agentMoneyMoved();
          changed();
        }
        if (p.kind !== "sell") agentRules.paid.push({ at: Date.now(), usd });
        const n = ++agentPaidCount;
        agentReceipts.unshift({ atIso: iso(0), title: String(p.title ?? `AgentZero paid ${dollarWords(usd, true)}`), lines: ["Paid by AgentZero with its own key, from its own wallet"], by: "AgentZero", ok: true, txHash: `sample-agent-${n}` });
        return { status: "done", txHash: `sample-agent-${n}`, explorerUrl: NO_EXPLORER } as TxOutcome;
      }
      case "recovery.status": return { delaySeconds: account.recovery?.delaySeconds ?? 172800, pending: account.recovery?.pending ?? null, ...(frozenUntil ? { frozenUntilIso: new Date(frozenUntil).toISOString() } : {}) };
      // The phone stops a waiting move (lib.rs cancel_recovery): with no laptop, or one that already said yes, at once;
      // with a laptop that hasn't, it waits 24 hours (half the delay if shorter), and the laptop can say yes to stop it now.
      case "recovery.cancel": {
        const move = pendingMove();
        if (!move) throw securityProblems.recoveryNone();
        if (!move.needsSecondDevice) {
          endMove();
          return signed();
        }
        // Re-audit 7 (R7-2): never a move the laptop said yes to, and one stop per move.
        if (move.approved) throw securityProblems.recoveryStopApproved();
        if (stopAsked) throw securityProblems.recoveryStopAsked();
        const seconds = Math.min(86400, Math.floor((account.recovery?.delaySeconds ?? 172800) / 2));
        const h = placeHold({ realSeconds: seconds, needsSecondDevice: false, why: "change" }, "Stop the move to a new device");
        h.lines = [`This device asks this only once. It stops in ${waitWords(seconds)}, or at once if your laptop says yes. Your laptop can also refuse the move itself.`];
        heldChanges.set(h.id, { method: "recovery.stop", p: {} });
        stopAsked = true;
        setMove({ ...move, stopAtIso: h.readyAtIso }, frozenUntil);
        return { status: "waiting", txHash: "sample-tx", explorerUrl: NO_EXPLORER, id: h.id, readyAtIso: h.readyAtIso, needsSecondDevice: false } satisfies TxOutcome;
      }
      // The new device's finish (lib.rs finish_recovery): after the delay with the laptop's yes, or after the fallback.
      case "recovery.finish": {
        const move = pendingMove();
        if (!move) throw securityProblems.recoveryStopped();
        const at = move.canFinishAtIso ?? move.readyAtIso;
        if (Date.parse(at) > Date.now()) throw securityProblems.recoveryWaiting(at);
        setMove(null, 0);
        return account;
      }
      // The web demo's Skip ahead on the new device: the move's next wait ends now (the delay; or, without the laptop's yes
      // once the delay is over, the words-only fallback). The real core has no such call.
      case "recovery.skip": {
        const move = pendingMove();
        if (!move || !rules) throw securityProblems.recoveryNone();
        const now = iso(0);
        const delayOver = Date.parse(move.readyAtIso) <= Date.now();
        const next: RecoveryPending = move.needsSecondDevice && !move.approved
          ? delayOver ? { ...move, fallbackAtIso: now, canFinishAtIso: now } : { ...move, readyAtIso: now }
          : { ...move, readyAtIso: now, canFinishAtIso: now };
        setMove(next, Date.parse(next.canFinishAtIso ?? next.readyAtIso));
        return { ok: true };
      }
      // This account's second devices (the core's account.secondDevices): the demo's laptop, counting fully.
      case "account.secondDevices": return account.keys.filter((k) => k.role === "second-device").map((k) => ({ handle: k.handle, kind: "laptop", needsRefill: false }));
      // ?demo's laptop (SecondDeviceCore's calls): the waiting move as its one request, and its yes or refusal.
      case "secondDevice.requests": {
        if (!hasLaptop()) return [];
        const move = pendingMove();
        // As SecondDeviceCore lists them: its own removal first, as a warning with no yes or no (R7-1); the move; the
        // phone's stop of it, which the laptop may confirm (no freeze, R7-4).
        const removal = held.filter((h) => heldChanges.get(h.id)?.method === "account.removeKey" && heldChanges.get(h.id)?.p.handle === LAPTOP_HANDLE).map((h) => ({
          id: h.id, kind: "RemoveThisDevice", title: "Your main device asked to remove this device", lines: [REMOVAL_WARNING], warning: REMOVAL_WARNING, readyAtIso: h.readyAtIso, needsSecondDevice: false, ready: false, change: true,
        }));
        const stops = held.filter((h) => heldChanges.get(h.id)?.method === "recovery.stop").map((h) => ({ id: h.id, kind: "CancelRecovery", title: "Stop a move to a new device", lines: h.lines, readyAtIso: h.readyAtIso, needsSecondDevice: false, ready: false, change: true }));
        return [{ accountId: account.accountId, requests: [...removal, ...(move && move.needsSecondDevice ? [moveRequest(move)] : []), ...stops] }];
      }
      case "secondDevice.answer": {
        // The phone's stop: the laptop's yes stops the move now, with no freeze (it vouched); its no lets the move go on.
        const stopAt = held.findIndex((h) => h.id === p.id && heldChanges.get(h.id)?.method === "recovery.stop");
        if (stopAt >= 0) {
          endHold(stopAt, p.approve === true ? "ran" : "declined", { txHash: "sample-tx", explorerUrl: NO_EXPLORER });
          const move = pendingMove();
          if (p.approve === true) setMove(null, 0);
          else if (move) setMove({ ...move, stopAtIso: undefined }, frozenUntil);
          return p.approve === true ? signed() : { status: "declined" };
        }
        const move = pendingMove();
        if (p.id !== "recovery" || !move || !move.needsSecondDevice) throw securityProblems.waitingGone();
        if (p.approve !== true) {
          // Re-audit 7 (R7-9): with the phone's stop waiting the laptop says which end: refuse and freeze payments (the
          // default, `freeze` absent or true), or co-sign the stop (`freeze: false`, two of three, no freeze).
          if (p.freeze === false && held.some((h) => heldChanges.get(h.id)?.method === "recovery.stop")) setMove(null, 0);
          else endMove();
          return { status: "declined" };
        }
        // The yes is bound to this move: it can finish after the delay; payments wait until then.
        setMove({ ...move, approved: true, canFinishAtIso: move.readyAtIso }, Date.parse(move.readyAtIso));
        return signed();
      }
      case "recovery.check": return { matches: !options.sampleWords || !Array.isArray(p.words) || (p.words as unknown[]).join(" ") === options.sampleWords(wordsRound).join(" ") };
      // New backup words (the core's recovery.renew): the next round's, the same until they're checked; none while some wait.
      case "recovery.renew": {
        const refused = renewRefusal();
        if (refused) throw refused;
        renewRound ??= wordsRound + 1;
        return { words: options.sampleWords!(renewRound) };
      }
      // Only after the sheet's yes (the person's own tap, NEEDS_YES), checked first (renewProblem): a change, held by the rules.
      case "recovery.renewConfirm": {
        const round = renewRound!;
        if (rules) return holdChange(method, { round }, "Replace your backup words");
        applyChange(method, { round });
        return signed();
      }
      case "tx.describe": return describe(p.request as TxRequest);
      // Pairing a second device. Held by protection like any signature (D17); a code that isn't a pairing code is the
      // core's own "That isn't the code ZeroFee shows" Problem.
      case "account.secondDevice.pair": {
        if (!isPairingCode(String(p.qr ?? p.publicKey ?? ""))) throw invalidPairingCode(p.kind);
        if (options.holdSeconds) return hold({ receiverId: account.accountId, actions: [], why: "Add a second device" } as unknown as TxRequest);
        // As on chain: a new key is a change, held for the change wait (the account is past its first day).
        if (rules) return holdChange(method, p, "Add a second device");
        if (!account.keys.some((k) => k.role === "second-device")) account.keys.push({ handle: LAPTOP_HANDLE, role: "second-device", kind: "development" });
        return signed();
      }
      // "Ask my laptop above $X", as the core cuts today's bands (docs/interfaces.md); through the protection sheet.
      case "account.secondDevice.setLimit": {
        const bands = limitBands(appBands, p.usd);
        if (!bands) throw invalidPairingCode(p.kind);
        if (options.holdSeconds) return hold({ receiverId: account.accountId, actions: [], why: "Ask my laptop for payments" } as unknown as TxRequest);
        if (rules) return holdChange(method, p, "Ask my laptop for payments");
        appBands = bands;
        protectionBands = demoBands(bands);
        return signed();
      }
      // A key's removal (the laptop's, here): a change, held for the change wait; the laptop sees it as a warning.
      case "account.removeKey": {
        if (!account.keys.some((k) => k.handle === p.handle)) throw securityProblems.keyNotFound();
        if (rules) return holdChange(method, p, "Remove a key from your account");
        if (p.handle === OLD_KEY_HANDLE) removedOld = true;
        account.keys = account.keys.filter((k) => k.handle !== p.handle);
        return signed();
      }
      // The rules the demo saved (in the core's shape), so Security shows "Protection by amount: On" after Save.
      case "account.protection.get": return { bands: protectionBands, usd: appBands.map((b) => ({ upToUsd: b.upToUsd, level: b.level, ...(b.level === "wait" || b.level === "both" ? { waitSeconds: Number(b.waitSeconds) > 0 ? Number(b.waitSeconds) : 86400 } : {}) })) };
      case "account.protection.set": {
        if (options.holdSeconds) return hold({ receiverId: account.accountId, actions: [], why: "Change your protection rules" } as unknown as TxRequest);
        // Tighter or looser, a change to the rules waits the change wait on chain (lib.rs set_protection: strictest + floor).
        if (rules) return holdChange(method, p, "Change your protection rules");
        protectionBands = demoBands(p.bands);
        appBands = Array.isArray(p.bands) ? (p.bands as Band[]) : [];
        return signed();
      }
      case "tx.request": return options.holdSeconds ? hold((p.request ?? {}) as TxRequest) : signed();
      case "account.waiting": return held.map((h) => ({
        ...h,
        ready: Date.parse(h.readyAtIso) <= Date.now(),
        ...(heldChanges.has(h.id) ? { change: true } : {}),
        // ?demo: the sample's laptop can answer it here (account.waiting.sampleDevice); the real core never says this.
        ...(rules && (h.needsSecondDevice || heldChanges.get(h.id)?.method === "recovery.stop") && account.keys.some((k) => k.role === "second-device") ? { sampleDevice: true } : {}),
        // the web demo: its wait can be skipped ahead (account.waiting.skip); the real core never says this.
        ...(rules && Date.parse(h.readyAtIso) > Date.now() ? { skip: true } : {}),
      }));
      case "account.waiting.status": {
        const id = String(p.id);
        if (held.some((h) => h.id === id)) return { state: "waiting" };
        const past = endedHolds.get(id);
        return past ? { state: past, txHash: "sample-tx", explorerUrl: NO_EXPLORER } : { state: "unknown" };
      }
      case "account.waiting.run": case "account.waiting.cancel": {
        const i = held.findIndex((h) => h.id === p.id);
        if (i < 0) throw notFound(String(p.id));
        if (method === "account.waiting.run" && Date.parse(held[i].readyAtIso) > Date.now()) throw notYet(held[i].readyAtIso);
        // As the contract's run: what needs the second device runs only once it said yes.
        if (method === "account.waiting.run" && held[i].needsSecondDevice) throw { code: "security.waiting.needs-device", whatHappened: "Your second device must say yes first.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        const out = signed();
        if (out.status !== "done") return out;
        endHold(i, method === "account.waiting.run" ? "ran" : "cancelled", out);
        return out;
      }
      // ?demo only (the sample's second device): the laptop's yes or no on a held request, as the contract's approve and
      // decline. A yes lets it run (at once if its wait is over); a no drops it. The real core has no such call: the
      // laptop answers on the laptop.
      // The web demo's Skip ahead: a held request's wait ends now (time in the demo runs as fast as the person wants).
      case "account.waiting.skip": {
        const h = held.find((x) => x.id === p.id);
        if (!h || !rules) throw notFound(String(p.id));
        h.readyAtIso = iso(0);
        return { ok: true };
      }
      case "account.waiting.sampleDevice": {
        const i = held.findIndex((h) => h.id === p.id);
        if (i < 0) throw notFound(String(p.id));
        const stop = heldChanges.get(held[i].id)?.method === "recovery.stop";
        if ((!held[i].needsSecondDevice && !stop) || !account.keys.some((k) => k.role === "second-device")) throw privateProblem("security.request.not-allowed", "This request doesn't need your second device.");
        const out = signed();
        if (out.status !== "done") return out;
        // The phone's stop of a move (release 6, R1): the laptop's yes stops it at once, with no freeze; its no lets the
        // move go on.
        if (stop) {
          endHold(i, p.approve === true ? "ran" : "declined", out);
          if (p.approve === true) setMove(null, 0);
          return p.approve === true ? out : { status: "declined" };
        }
        if (p.approve !== true) {
          endHold(i, "declined", out);
          return { status: "declined" };
        }
        // H43: as the real core says it (held.ts secondDeviceSaidYes): the laptop's yes shows until it goes.
        Object.assign(held[i], { needsSecondDevice: false, secondDeviceSaidYes: true });
        if (Date.parse(held[i].readyAtIso) <= Date.now()) endHold(i, "ran", out);
        return out;
      }
      // One wallet per chain (D55): each chain's wallet is `current`; every app that may use chain wallets lists them all.
      case "subwallet.list": return subwallets.filter((w) => !p.kind || w.kind === p.kind);
      // the core's check ahead of the tap (SubWallets.preflight): the sample has no chain to read; it signs nothing
      case "subwallet.preflight": return { ok: subwallets.some((w) => w.id === p.id && w.kind === "trade") };
      case "subwallet.create": {
        // Trade's float (core float.ts): one NEAR wallet, a 64-hex implicit account; asking again gives the same one.
        // As the core: Trade's and ZeroFee's own screens' only, never Browser's, an app's in Apps or Chat's.
        if (p.kind === "trade" && p.chain === "near") {
          if (p.app !== undefined && p.app !== "trade") throw linkProblem("security.request.not-allowed", "Only Trade can move Spending's money and start fast trading.");
          return floatWallet();
        }
        const trading = p.chain === "sol" || p.chain === "bsc" || p.chain === "hood";
        const name = p.chain === "hood" ? "Robinhood" : p.chain === "bsc" ? "BNB Chain" : p.chain === "sol" ? "Solana" : String(p.chain);
        // A chain's wallet ({ chain }, kind "chain" or none): its one current wallet, made once; asking again gives it.
        if (p.kind === undefined || p.kind === "chain") {
          const had = subwallets.find((x) => x.chain === p.chain && x.current === true);
          if (had) return had;
          const kind = trading ? "trade" : "browser";
          const w = { id: trading ? `sw-trade-${p.chain}` : `sw-browser-${p.chain}`, kind, chain: String(p.chain), address: SAMPLE_ADDRESS[String(p.chain)] ?? SAMPLE_ADDRESS.base, label: `${name} wallet`, current: true, ...(trading ? { slot: 0 } : {}) };
          subwallets.push(w);
          return w;
        }
        // Legacy trading wallets by slot (before D55): slot 0 is the chain's current one, any other an older one.
        if (p.kind === "trade" && trading) {
          const slot = p.slot === undefined ? 0 : Number(p.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw linkProblem("security.request.invalid", "Each network has Spending wallets 0 to 4.");
          const had = subwallets.find((x) => x.kind === "trade" && x.chain === p.chain && (x.slot ?? 0) === slot);
          if (had) return had;
          const w = { id: slot ? `sw-trade-${p.chain}-${slot}` : `sw-trade-${p.chain}`, kind: "trade", chain: String(p.chain), address: SAMPLE_ADDRESS[String(p.chain)] ?? SAMPLE_ADDRESS.base, label: `Trading · ${name}${slot ? ` ${slot + 1}` : ""}`, slot, current: slot === 0 };
          subwallets.push(w);
          return w;
        }
        // A site's own wallet (core site-wallets.ts): one per site and network, a made-up address of its own.
        if (p.kind === "site") {
          const s = siteWallet(p.siteId);
          if (!s || !s.chains.includes(String(p.chain))) throw linkProblem("security.request.invalid", "That site has no wallet on that network.");
          const had = subwallets.find((x) => x.kind === "site" && x.site === s.site && x.chain === p.chain);
          if (had) return had;
          const h = sha256(new TextEncoder().encode(`zerofee-sample-site:${s.site}:${p.chain}`));
          const address = p.chain === "sol" ? base58(h) : `0x${Array.from(h.slice(0, 20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
          const w = { id: `sw-site-${s.site}-${p.chain}`, kind: "site", site: s.site, chain: String(p.chain), address, label: `${s.name} wallet` };
          subwallets.push(w);
          // the copy review's A2-3 (8 Nov): a site's wallet made once the account is home (prepare.ts) holds the Sim's sample money, but
          // Home had read the wallets before it was made, so Hot said $172.54 while set-up counted it ($5,515.49): Home
          // reads its wallets again (home-reads.ts: the "spending" part re-reads spending.wallets), as it does after a move
          emit("ledger.balancesChanged", { parts: ["spending"] });
          return w;
        }
        // One per kind and chain (the card's wallet, the old apps wallet on Solana): asking again gives the same one.
        const had = subwallets.find((x) => x.kind === p.kind && x.chain === p.chain);
        if (had) return had;
        const older = p.kind === "browser" && p.chain === "sol";
        const w = { id: `sw-${p.kind}-${p.chain}`, kind: String(p.kind), chain: String(p.chain), address: older ? SAMPLE_SOL_SOCIAL : SAMPLE_ADDRESS[String(p.chain)] ?? SAMPLE_ADDRESS.base, label: `${p.kind} · ${p.chain}`, ...(p.kind === "browser" ? { current: !older } : {}) };
        subwallets.push(w);
        return w;
      }
      // Trade's float (core float.ts): its balance, moves and fee guard, from mock-float.ts. As the core (D55): a move out
      // that names no wallet goes to the chain's current one, made first if this account has none yet.
      case "subwallet.float.out":
        if (p.to === undefined && p.slot === undefined && (p.chain === "sol" || p.chain === "hood" || p.chain === "bsc") && !subwallets.some((w) => w.chain === p.chain && w.current === true)) {
          const name = p.chain === "hood" ? "Robinhood Chain" : p.chain === "bsc" ? "BNB Chain" : "Solana";
          subwallets.push({ id: `sw-trade-${p.chain}`, kind: "trade", chain: String(p.chain), address: SAMPLE_ADDRESS[String(p.chain)] ?? SAMPLE_ADDRESS.base, label: `${name} wallet`, slot: 0, current: true });
        }
        return float.answer(method, p);
      // Audit C1, as the core (subwallets.ts siteFor): the connected site's own wallet, made on first connect: a listed
      // site's fixed one, else one for exactly that host ("host:<host>"); never a shared chain wallet. The Browser's only.
      // Trade's door before the tap, as the core (subwallets.ts capCheck): the sample demo spends nothing, so the day is whole
      case "subwallet.cap.check": {
        const usd = typeof p.usd === "number" ? p.usd : Number(p.usd);
        return { asks: !(Number.isFinite(usd) && usd >= 0) || usd > 101 || usd > 500, leftTodayUsd: 500, perTapUsd: 100 };
      }
      case "subwallet.site.forHost": {
        if (p.app !== undefined && p.app !== "browser") throw linkProblem("security.request.not-allowed", "Only the Browser makes a site's own wallet.");
        const origin = (p.site as { origin?: unknown } | undefined)?.origin;
        const host = typeof origin === "string" ? /^https:\/\/([a-z0-9.-]+(?::\d{1,5})?)\/?$/.exec(origin)?.[1] : undefined;
        const listed = host ? SITE_WALLETS.find((x) => !x.agent && x.hosts.includes(host)) : undefined;
        const s = siteWallet(listed ? listed.site : host ? hostSite(host) : undefined);
        if (!s || !s.chains.includes(String(p.chain))) throw linkProblem("security.request.invalid", "site is { origin } of the https page that asked");
        const had = subwallets.find((x) => x.kind === "site" && x.site === s.site && x.chain === p.chain);
        if (had) return had;
        const h = sha256(new TextEncoder().encode(`zerofee-sample-site:${s.site}:${p.chain}`));
        const address = p.chain === "sol" ? base58(h) : `0x${Array.from(h.slice(0, 20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
        const w = { id: `sw-site-${listed ? s.site : `h${s.index.toString(36)}`}-${p.chain}`, kind: "site", site: s.site, chain: String(p.chain), address, label: `${s.name} wallet` };
        subwallets.push(w);
        return w;
      }
      // AgentZero's own window's sign-in wallet (the core's agentSiteFor): its pocket, on pump.fun and GMGN only
      case "subwallet.site.forAgent": {
        if (p.app !== undefined && p.app !== "browser") throw linkProblem("security.request.not-allowed", "Only the Browser asks for AgentZero's sign-in wallet.");
        const origin = (p.site as { origin?: unknown } | undefined)?.origin;
        if ((origin !== "https://pump.fun" && origin !== "https://gmgn.ai") || p.chain !== "sol") throw linkProblem("security.subwallet.refused", "AgentZero signs in only to pump.fun and gmgn.ai.");
        const had = subwallets.find((x) => x.kind === "site" && x.site === "agentzero" && x.chain === "sol");
        if (had) return had;
        const w = { id: "sw-site-agentzero-sol", kind: "site", site: "agentzero", chain: "sol", address: base58(sha256(new TextEncoder().encode("zerofee-sample-site:agentzero:sol"))), label: "AgentZero's pocket" };
        subwallets.push(w);
        return w;
      }
      // sign-ins signed with no sheet (the core's plain sign-in rule): none in the sample demo, which signs nothing real
      case "subwallet.site.signIns":
        return [];
      case "subwallet.site.moveBacks":
        if (p.app !== undefined && p.app !== "wallet" && p.app !== "social") throw securityProblems.requestNotAllowed("Only Home and Social Trading read your moves back.");
        return siteMoveBacks();
      // ST3, as the core (two dry quotes, nothing moved): the sample's own cost, 0.6 % and $0.06 of network fees, so a
      // small Add shows its fee line and a bigger one doesn't. Sample money only.
      // Home's Swap, as the core (dry quotes, nothing moved): the sample's own cost, 0.4 % and $0.30 of network fees for
      // each leg on to a chain's wallet, so a small swap shows its fee line and a bigger one doesn't. Sample money only.
      case "subwallet.float.swapCost": {
        if (p.app !== undefined && p.app !== "wallet") throw securityProblems.requestNotAllowed("Only Home's Swap asks this.");
        const usd = Number(p.usd);
        if (!(usd >= 2)) throw securityProblems.requestInvalid("usd is dollars as text, $2 or more");
        return simSwapCost(usd, p.from, p.to);
      }
      case "subwallet.site.addCost": {
        if (p.app !== undefined && p.app !== "wallet" && p.app !== "social") throw securityProblems.requestNotAllowed("Only Browser's money sheet asks this.");
        const usd = Number(p.usd);
        if (!(usd >= 2)) throw securityProblems.requestInvalid("usd is dollars as text, $2 or more");
        const cents = (x: number) => Math.round(x * 100) / 100;
        return { feeUsd: cents(usd * 0.006 + 0.06), legsUsd: [cents(usd * 0.001), cents(usd * 0.005 + 0.06)] };
      }
      case "subwallet.float.balance": case "subwallet.float.limits": case "subwallet.float.in":
      case "subwallet.float.home": case "subwallet.float.move": case "subwallet.float.moves": case "subwallet.float.addStatus": case "subwallet.float.swapQuote": case "subwallet.float.swap":
        // as the core: Trade's (and ZeroFee's own screens); Home's Swap in Wallet may swap and price a swap, nothing else
        // (and AgentZero a dry swap price, quote_dry: nothing moves)
        if (p.app !== undefined && p.app !== "trade" && !(p.app === "wallet" && (method === "subwallet.float.swap" || method === "subwallet.float.swapQuote" || method === "subwallet.float.balance" || method === "subwallet.float.move" || method === "subwallet.float.moves")) && !(p.app === "agent" && method === "subwallet.float.swapQuote")) throw securityProblems.requestNotAllowed("Only Trade can move Spending's money and start fast trading.");
        return float.answer(method, p);
      // D143 (core approval-policy.ts): a hot key's signature never asks, so it is never declined: signed, or refused
      case "subwallet.signTx": return { signedTx: String(p.tx ?? "") };
      case "subwallet.sign": return hotSent();
      case "subwallet.send": {
        // sample money: what left the sample wallet leaves its sample balance too
        const s = chatSend(p);
        if (s.w && !s.coin) walletNative.set(s.w.id, (walletNative.get(s.w.id) ?? 0n) - s.units);
        return hotSent();
      }
      case "subwallet.read": return { result: null };
      // A separate wallet's key (the core's subwallet.export, after its sheet): here a sample that no wallet app can read.
      case "subwallet.export": {
        const w = subwallets.find((x) => x.id === String(p.id));
        if (!w) throw { code: "security.subwallet.unknown", whatHappened: "That wallet isn't on this device.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        if (options.decline) return { declined: true };
        // as the core: marked before the key is shown (D56: nothing else changes)
        (w as { keyExported?: true }).keyExported = true;
        return { secretKey: SAMPLE_KEY };
      }
      // The core's rows (subwallets.ts balances): the chain's own coin, then ZeroFee's listed coins, all at 0 in the demo.
      case "subwallet.balances": {
        const w = subwallets.find((x) => x.id === p.id);
        if (!w) throw { code: "security.subwallet.unknown", whatHappened: "That wallet isn't on this device.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        if (w.chain === "sol") return [{ token: "native", symbol: "SOL", decimals: 9, amount: (float.native(w.id) + (walletNative.get(w.id) ?? 0n)).toString() }];
        const chain = w.chain as EvmWalletChain;
        // what the demo's own sends took from it (walletNative), as on Solana: the ETH on Robinhood row drops after a send
        return [{ token: "native", symbol: WALLET_NATIVE[chain], decimals: 18, amount: (float.native(w.id) + (walletNative.get(w.id) ?? 0n)).toString() }, ...(KNOWN_COINS[chain] ?? []).map((c) => ({ ...c, amount: "0" }))];
      }
      // A site's own wallet's coins (the core's site-coins.ts), in the demo: its network's coin, and on Solana a sample coin.
      // Sim's sample sites (SimSite.tsx): a buy or a sell of a sample coin in a site's own wallet, as a site's page asks
      // the real one, on sample money: within the one cap no sheet (D143's hot key), over it refused. Browser only.
      case "sim.site.trade": {
        if (p.app !== undefined && p.app !== "social" && p.app !== "browser") throw securityProblems.requestNotAllowed("Only the Browser trades on a sample site.");
        return simTrade(p.site, p.side, p.coin, p.usd);
      }
      case "subwallet.coins": {
        const w = subwallets.find((x) => x.id === p.id);
        if (!w) throw { code: "security.subwallet.unknown", whatHappened: "That wallet isn't on this device.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        if (w.kind !== "site") throw linkProblem("security.request.invalid", "coins are listed for a site's own wallet");
        const native = (float.native(w.id) + (walletNative.get(w.id) ?? 0n)).toString();
        const bought = [...(simHeld.get(w.id)?.entries() ?? [])].filter(([, c]) => c.amount > 0n).map(([token, c]) => ({ token, symbol: c.symbol, name: c.name, decimals: c.decimals, amount: c.amount.toString(), usd: Math.round((Number(c.amount) / 10 ** c.decimals) * c.priceUsd * 100) / 100 }));
        if (w.chain === "sol") return [{ token: "native", symbol: "SOL", decimals: 9, amount: native, usd: Math.round((Number(native) / 1e9) * solUsd() * 100) / 100 }, { token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, amount: "123456700000", usd: 2.47 }, ...bought];
        return [{ token: "native", symbol: WALLET_NATIVE[w.chain as EvmWalletChain] ?? "ETH", decimals: 18, amount: native, usd: null }];
      }
      // A site's message (D29 wallet mode): a sample 65-byte signature, base64; nothing real is signed. Typed data is
      // never signed for a site (D143: it could let the site move coins, and a hot key never asks), as in the core.
      case "subwallet.signMessage": return { signature: btoa(String.fromCharCode(...new Uint8Array(64).fill(0x5a), 27)), signedIn: true };
      case "subwallet.signTypedData": throw securityProblems.subwalletRefused("This site asked for an approval ZeroFee won't give without a check. Nothing was signed.");
      case "subwallet.session.start":
        if (p.perTxUsd !== undefined && !(Number(p.perTxUsd) > 0 && Number(p.perTxUsd) <= 100 && Number(p.totalUsd) >= Number(p.perTxUsd) && Number(p.totalUsd) <= 500)) {
          throw linkProblem("security.request.not-allowed", "Fast trading allows at most $100 a trade and $500 in all.");
        }
        return { endsAtIso: iso(Number(p.minutes ?? 15) * 60e3), ...(typeof p.firstTx === "string" ? { signedTx: p.firstTx } : {}) };
      case "subwallet.session.end": case "subwallet.session.endAll": return { ok: true };
      // Linking the browser extension (D16): the phone shows the code, the panel's QR comes back sealed to it. In the
      // demo, sealed "expired" and "wrong" show the two Problems.
      case "subwallet.linkStart": return { code: "7KQ2M-9XD4R", expiresAtIso: iso(5 * 60e3) };
      case "subwallet.import": {
        if (p.sealed === "expired") throw linkProblem("security.link.expired", "That code ran out.");
        if (p.sealed === "wrong") throw linkProblem("security.link.wrong", "That code doesn't match this device's.");
        const w = { id: "sw-extension-sol", kind: "extension", chain: "sol", address: SAMPLE_ADDRESS.sol, label: "Laptop · Solana" };
        if (!subwallets.some((x) => x.id === w.id)) subwallets.push(w);
        return [w];
      }
      case "ledger.chains": return CHAINS.map((c) => ({ ...c, coins: COINS[c.id] ?? (NATIVE[c.id] ? [NATIVE[c.id]] : []) }));
      case "ledger.depositAddress": {
        // Wallet's shape (S3, 25 Oct): no token = the chain's own coin; EVM chains share one address; memo chains say so.
        const chain = String(p.chain ?? "near");
        const c = CHAINS.find((x) => x.id === chain) ?? CHAINS[0];
        // like the real catalogue (H02): coins are asked for by asset id; a symbol such as "SOL" is a coin it doesn't know.
        // NEAR's own coin on NEAR is "near", as Wallet's ledger names it (catalogue.ts NATIVE_NEAR; J3 C1: Chat's request
        // for NEAR was refused here, on the judges' demo). The Problem names the coin and the network in words, never ids.
        if (!mockReceives(c.id, p.token)) throw { code: "ledger.token.unsupported", whatHappened: "ZeroFee can't take that coin on that network.", money: { state: "not-involved" }, next: { kind: "open", label: "Choose another coin", screen: "receive" }, more: `${coinWords(p.token)} on ${c.name}` } satisfies Problem;
        const address = c.id === "near" ? account.accountId : SAMPLE_ADDRESS[c.id] ?? account.accountId;
        const memo = MEMO[c.id];
        // sample: a made-up address (SAMPLE_ADDRESS, the Sim's dotless "zf-account"), unusable on its chain on purpose; Chat
        // posts a Sim request to it as it is (sd-chat crawl, 5 Nov, a). The real ledger never says so.
        return {
          address, chain: c.id, token: p.token ?? NATIVE[c.id] ?? null, minAmount: depositMinimum(c, p.token), qr: address, sample: true,
          ...(memo ? { memo } : {}),
          note: memo ? `Send only on ${c.name}, and always include the memo.` : `Send only on ${c.name}.`,
        };
      }
      // Kept as Wallet's, like the real ledger: Pay's Receive (D29) opens where Wallet's was.
      case "ledger.receiveChain": {
        if (p.chain === undefined) return { chain: store.get("wallet.receive-chain") ?? null };
        const c = CHAINS.find((x) => x.id === p.chain);
        if (!c) throw { code: "ledger.chain.unsupported", whatHappened: "ZeroFee can't take coins from that network.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        store.set("wallet.receive-chain", c.id);
        return { chain: c.id };
      }
      // The Safe's swap in place (Native coins, feat/swap-inplace's shape): a quote at the price the page shows (priceUsd,
      // the live market's), NEAR Intents' fee 0.1 %; the swap is a job that lands in about 2 s and moves the Safe's rows.
      case "ledger.swapQuote": {
        const from = String(p.from ?? ""), to = String(p.to ?? ""), amountIn = String(p.amountIn ?? "");
        const buy = from === USDC_NEAR, coin = buy ? to : from;
        const row = balances.find((b) => b.tokenId === coin && b.held === "ledger");
        const rowPx = row && Number(row.amount) > 0 ? Number(row.usd) / Number(row.amount) : undefined;
        const px = Number(p.priceUsd) > 0 ? Number(p.priceUsd) : rowPx;
        const a = Number(amountIn);
        if (!(px && px > 0) || !(a > 0)) throw { code: "ledger.swap.noPrice", whatHappened: "No price came back. Nothing left your Safe.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } } as Problem;
        const pay = balances.find((b) => b.tokenId === from && b.held === "ledger");
        if (!pay || Number(pay.amount) + 1e-12 < a) throw { code: "ledger.balance.low", whatHappened: buy ? `Your Safe has $${Number(pay?.amount ?? 0).toFixed(2)} in USDC. Add money first.` : "Your Safe doesn't hold that much.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "OK" } } as Problem;
        const usdIn = buy ? a : a * px;
        const out = (buy ? a / px : a * px) * 0.999;
        const dec = (x: number) => String(Number(x >= 1 ? x.toFixed(6) : x.toPrecision(8)));
        const sym = String(p.symbol ?? row?.symbol ?? "coin");
        const q = { id: `sq-${++safeQuoteN}`, from, to, amountIn, amountOut: dec(out), minOut: dec(out * 0.99), feeUsd: (usdIn * 0.001).toFixed(4), etaSeconds: 2, expiresAtIso: iso(30_000), source: "safe" as const,
          inSymbol: buy ? "USDC" : sym, outSymbol: buy ? sym : "USDC", px, name: String(p.name ?? row?.name ?? sym) };
        safeQuotes.set(q.id, q);
        const { inSymbol: _i, outSymbol: _o, px: _p, name: _n, ...shown } = q;
        return shown;
      }
      case "ledger.swap": {
        const q = safeQuotes.get(String(p.quoteId ?? ""));
        if (!q || Date.parse(q.expiresAtIso) < Date.now()) throw { code: "ledger.swap.expired", whatHappened: "That price is too old. Nothing left your Safe. Tap again.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } } as Problem;
        safeQuotes.delete(q.id);
        const m: Record<string, unknown> = { id: `mv-swap-${movements.length + 1}`, kind: "swap", status: "moving", from: q.from, to: q.to, amount: q.amountIn, amountOut: q.amountOut, startedAtIso: iso(0), updatedAtIso: iso(0), etaSeconds: 2 };
        movements.unshift(m);
        const t0 = Date.now();
        const land = () => {
          const take = balances.find((b) => b.tokenId === q.from && b.held === "ledger");
          if (take) { const per = Number(take.amount) > 0 ? Number(take.usd) / Number(take.amount) : 0; const left = Math.max(0, Number(take.amount) - Number(q.amountIn)); take.amount = String(Number(left.toFixed(8))); take.usd = (left * (q.from === USDC_NEAR ? 1 : per)).toFixed(2); }
          const outPx = q.to === USDC_NEAR ? 1 : q.px;
          const give = balances.find((b) => b.tokenId === q.to && b.held === "ledger");
          if (give) { const n = Number(give.amount) + Number(q.amountOut); give.amount = String(Number(n.toFixed(8))); give.usd = (n * outPx).toFixed(2); }
          else balances.push({ ...balances[0]!, tokenId: q.to, symbol: q.outSymbol, name: q.name, icon: q.outSymbol.toLowerCase(), chain: "near", amount: q.amountOut, usd: (Number(q.amountOut) * outPx).toFixed(2), bridged: false, held: "ledger", listed: true });
          Object.assign(m, { status: "done", updatedAtIso: iso(0), settledMs: Date.now() - t0 });
          emit("ledger.movementUpdated", { movement: { ...m } });
          emit("ledger.balancesChanged", {});
        };
        setTimeout(land, options.latencyMs === 0 ? 0 : 1_800);
        return { ...m };
      }
      case "ledger.balances": return balances.map((b) => ({ ...b }));
      // Convert, as 1Click prices it: the two coins at the sample's own prices (ledger.tokens), less its 0.2 % fee; a coin
      // with no price is refused, never priced 1:1 (QA's Sim crawl, 5 Nov: a flat 0.98 of the amount in)
      case "ledger.quoteConvert": {
        const amountIn = String(p.amount ?? "1");
        const from = p.from === "near" ? "nep141:wrap.near" : String(p.from ?? ""), to = String(p.to ?? "");
        const pin = tokenPrice(from), pout = tokenPrice(to);
        if (!(pin > 0) || !(pout > 0) || !(Number(amountIn) > 0)) throw { code: "ledger.convert.noPrice", whatHappened: "No price came back. Nothing left your Safe.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } } satisfies Problem;
        const out = (Number(amountIn) * pin * (1 - CONVERT_FEE)) / pout;
        const dec = (x: number) => String(Number(x >= 1 ? x.toFixed(6) : x.toPrecision(8)));
        const qid = `q-${Date.now()}-${convertQuotes.size + 1}`;
        convertQuotes.set(qid, { amount: amountIn, from, to, out: dec(out) });
        return { id: qid, from: p.from, to: p.to, amountIn, amountOut: dec(out), minOut: dec(out * 0.99), feeNote: "Swap fee about 0.2%", expiresAtIso: iso(60e3) };
      }
      case "ledger.convert": {
        const q = convertQuotes.get(String(p.quoteId));
        const amount = q?.amount ?? "1";
        if (options.decline) return { ...move("convert", amount), status: "problem" };
        // when it lands (its settle), the coin paid leaves the Safe and the coin got comes in, at the quote's own figure
        if (q) convertQuotes.delete(String(p.quoteId));
        return move("convert", amount, { quoteId: p.quoteId, ...(q ? { from: q.from, to: q.to, amountOut: q.out } : {}) }, "done", { method, p });
      }
      // As Wallet's ledger (D55): the apps that share the chain wallets never send from the Safe into them in public;
      // Spending's Top up is their way in.
      case "ledger.withdraw": {
        if (["trade", "browser", "social", "chat"].includes(String(p.caller ?? ""))) throw { code: "ledger.caller.refused", whatHappened: "Moves into Spending go through Top up, so your Safe stays private.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        // Wallet's own send to one of the person's Solana wallets: Activity names it as the core does, never its address
        const own = subwallets.find((w) => (w.kind === "trade" || w.kind === "browser") && w.chain === "sol" && w.address === p.toAddress);
        return move("withdraw", String(p.amount ?? "0"), { to: own ? `your ${own.current === false ? "older " : ""}Solana wallet` : p.toAddress, from: p.tokenId, ...(own ? { toWallet: own.id } : {}) }, "done", { method, p });
      }
      case "ledger.activity": return activity().slice(0, Number(p.limit ?? 20));
      // The shapes of Wallet's ledger (packages/wallet/src/types.ts), which Pay codes against.
      case "ledger.tokens": return options.tokens ?? DEFAULT_TOKENS;
      // Home's Add from another chain (V4 step 6): sample money has no real address on any chain, so none is ever shown
      // (a made-up Bitcoin address in the demo could take someone's real money).
      case "subwallet.private.quoteIn":
        throw new ProblemError({ code: "security.subwallet.refused", whatHappened: "This is sample money, so there's no real address here. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } } as Problem);
      // Home's Add and Request (D127), as the core answers: a one-time address per key, here a made-up one that no wallet
      // on any chain takes (sampleAddAddress), marked sample; the core's own refusals, word for word.
      case "subwallet.add.quote": {
        const chain = String(p.chain ?? ""), to = p.to, key = p.key;
        if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) throw new ProblemError(securityProblems.requestInvalid("key is the sheet's own id for this address: 16 to 64 letters, digits, - or _"));
        if (to !== "wallet" && to !== "safe") throw new ProblemError(securityProblems.requestInvalid('to is "wallet" or "safe"'));
        if (!(chain in ADD_OPEN)) throw new ProblemError(securityProblems.requestInvalid("chain is sol, hood, near or bsc"));
        if (!ADD_OPEN[chain as AddChain]) throw new ProblemError(securityProblems.subwalletRefused(`${chain === "near" ? "NEAR" : "BNB Chain"} opens once ZeroFee has tested it with real money.`));
        const had = addAsks.get(key);
        // works once, as the core (review H1): a key whose address ran out is refused, and the sheet asks with a new one
        if (had && Date.parse(had.untilIso) <= Date.now()) throw new ProblemError({ ...securityProblems.subwalletRefused("That address was used or ran out. Here's a new one."), code: ADD_USED });
        if (had) return had;
        const sol = chain === "sol";
        const price = tokenPrice(sol ? "nep141:sol.omft.near" : "nep141:eth.omft.near");
        const decimals = sol ? 9 : 18;
        let usd: string | undefined;
        if (p.usd !== undefined) {
          if (typeof p.usd !== "string" || !/^\d{1,7}\.\d{2}$/.test(p.usd)) throw new ProblemError(securityProblems.requestInvalid("usd is dollars, as text with cents"));
          if (Number(p.usd) < ADD_LEAST_USD) throw new ProblemError(securityProblems.requestNotAllowed(`Ask for $${ADD_LEAST_USD} or more. Under that, most goes on fees.`));
          if (Number(p.usd) > REQUEST_MOST_USD) throw new ProblemError(securityProblems.subwalletRefused(`Ask for $${REQUEST_MOST_USD.toLocaleString("en-US")} or less at a time.`));
          usd = p.usd;
        }
        // the coin amount at the demo's price, as the core sizes it: at most COIN_SHOWN_DECIMALS places, up for an Add, down for a Request
        const units = (dollars: number, up: boolean) => (BigInt((up ? Math.ceil : Math.floor)((dollars / price) * 10 ** COIN_SHOWN_DECIMALS)) * 10n ** BigInt(decimals - COIN_SHOWN_DECIMALS)).toString();
        const amountIn = units(Number(usd ?? ADD_LEAST_USD), usd === undefined);
        const a: AddAddress = {
          key, chain: chain as AddChain, to, depositAddress: sampleAddAddress(chain, key), tokenId: sol ? "nep141:sol.omft.near" : "nep141:hood.omft.near", symbol: sol ? "SOL" : "ETH", decimals,
          amountIn, minAmountIn: ((BigInt(amountIn) * 99n) / 100n).toString(), untilIso: new Date(Date.now() + ADD_SHOWN_MS).toISOString(), etaSeconds: sol ? 20 : 30, ...(usd ? { usd } : {}), sample: true,
        };
        addAsks.set(key, a);
        return a;
      }
      // Nothing can land at a made-up address, so nothing is ever on its way.
      case "subwallet.add.onWay": return [];
      case "subwallet.add.watch": return [];
      case "subwallet.add.seen": return { seen: false };
      // B28 R6: every service is up in the demo (faults.ts injects one for the fault-injection suite and a dev build)
      case "ledger.services": return {};
      case "ledger.status": return [];
      case "ledger.quotePay": {
        const amountOut = String(p.amountOut ?? "0");
        const sameCoin = p.fromTokenId === p.toTokenId;
        const qid = `qp-${Date.now()}`;
        const feeUsd = sameCoin ? "0" : "0.0024";
        // Across two coins what leaves is the out-amount at the two coins' prices, in the coin that pays (QA gate, 3 Nov:
        // the old figure took 0.2457 SOL out as 0.2469 USDC in); no price, no quote.
        const priceOf = (t: unknown) => tokenPrice(t) || (/^USD[CT]$/.test(coinOf(t)) ? 1 : 0);
        const pFrom = priceOf(p.fromTokenId), pTo = priceOf(p.toTokenId);
        const priced = pFrom > 0 && pTo > 0;
        // a Hidden pay with no price is refused (never a made-up figure); a plain one keeps the sample's old guess
        if (!sameCoin && !priced && p.confidential === true) throw privateProblem("pay.route.none", "The swap service has no price for this. Nothing moved.");
        const inBase = sameCoin || !priced ? amountOut : ((Number(amountOut) * pTo) / pFrom).toFixed(6);
        // a Hidden pay is sample money at the sample price: what You pay showed is what leaves (no made-up slippage)
        const amountIn = sameCoin ? amountOut : p.confidential === true ? decimal(micro(inBase)) : plusBps(inBase, 50);
        payQuotes.set(qid, { amountOut, amountIn, fromTokenId: p.fromTokenId, toTokenId: p.toTokenId, to: p.to, feeUsd, ...(p.confidential === true ? { confidential: true } : {}) });
        return {
          id: qid,
          fromTokenId: p.fromTokenId,
          toTokenId: p.toTokenId,
          to: p.to, // echoed exactly: Pay refuses a quote that doesn't say who gets paid
          amountInExpected: sameCoin ? amountOut : plusBps(inBase, 20),
          amountIn,
          amountOut,
          feeUsd,
          feeNote: sameCoin ? "No fee: it stays in your Safe" : "Swap fee about 0.2%",
          etaSeconds: sameCoin ? 10 : 12,
          expiresAtIso: iso(60e3),
        };
      }
      case "ledger.pay": {
        // As the ledger records it: what left (the quote's coin and amount out), and the app's own label if it gave one.
        const q = payQuotes.get(String(p.quoteId));
        // the sheet said Hidden or not by the quote; the pay must say the same, or nothing moves (review L)
        if (q && !!q.confidential !== (p.confidential === true)) throw privateProblem("ledger.private.unavailable", "This price was for a different way to pay. Nothing was sent.");
        // D85 (B27): a pay from Private comes out of Private, never the Safe, as the real ledger's payPrivately does; too
        // little in Private is refused and nothing moves.
        if (p.confidential === true) {
          const row = q ? pocket.rows.find((r) => r.tokenId === q.fromTokenId) : undefined;
          // what the quote said leaves: the same amount for one coin, 0.5% over it across two (ledger.quotePay above)
          const need = q ? Number(q.amountIn ?? q.amountOut) : NaN;
          const had = Number(row?.amount ?? 0);
          if (!q || !row || !(need > 0) || had < need) throw privateProblem("ledger.private.unavailable", "Private doesn't have enough for this. Nothing was sent.");
          const left = Number((had - need).toFixed(6));
          Object.assign(row, { amount: String(left), ...(row.usd !== undefined ? { usd: (Number(row.usd) * (left / had)).toFixed(2) } : {}) });
          emit("ledger.balancesChanged", {});
          return move("pay", q.amountIn ?? q.amountOut, { id: `pay:sim-${movements.length + 1}`, quoteId: p.quoteId, from: q.fromTokenId, ...payee(q.to), private: true, debited: true, ...(typeof p.label === "string" ? { label: p.label } : {}) }, "done", { method, p });
        }
        // what left, in the coin that left (the quote's in-amount: the same as its out-amount for one coin), never the
        // out-amount of the coin it became; and who was paid, as the real ledger records both (payPrivately, execute)
        return move("pay", q ? q.amountIn ?? q.amountOut : "1", { quoteId: p.quoteId, ...(q ? { from: q.fromTokenId, ...payee(q.to) } : {}), ...(typeof p.label === "string" ? { label: p.label } : {}) }, "done", { method, p });
      }
      // A transfer-and-call carries its msg and memo, as the ledger's does, so the movement (and ledger.movementUpdated)
      // shows them. As on chain, the receiver answers the call: a sample receiver listening to "sample.transferCall" may
      // send it straight back (refund: true). Then the movement ends "refunded".
      case "ledger.transfer": {
        const amount = String(p.amount ?? "0");
        const call = p.msg !== undefined ? { to: String(p.toAccountId ?? ""), msg: String(p.msg), amount, tokenId: String(p.tokenId ?? ""), refund: false } : undefined;
        if (call) emit("sample.transferCall", call);
        return move("transfer", amount, { to: p.toAccountId, ...(typeof p.tokenId === "string" ? { from: p.tokenId } : {}), ...(p.memo !== undefined ? { memo: p.memo } : {}), ...(call ? { msg: call.msg } : {}) }, call?.refund ? "refunded" : "done", { method, p });
      }
      // A brand-new account's first NEAR (M7), as Wallet's ledger answers it: every sample network with its coins, and a
      // quote at the rate 1Click gave on 25 Oct (17.91 USDC for 3.9 NEAR), with 1Click's own time per network.
      case "ledger.startNetworks": {
        const tokens = options.tokens ?? DEFAULT_TOKENS;
        return CHAINS.map((c) => ({ id: c.id, name: c.name, icon: c.icon, coins: tokens.filter((t) => t.chain === c.id && t.assetId !== "nep141:wrap.near") })).filter((n) => n.coins.length > 0);
      }
      case "ledger.startQuote": {
        const from = (p.from ?? {}) as { chain?: string; assetId?: string };
        const token = (options.tokens ?? DEFAULT_TOKENS).find((t) => t.assetId === from.assetId && t.chain === from.chain);
        if (!/^[0-9a-f]{64}$/i.test(String(p.fundAddress ?? ""))) throw privateProblem("ledger.recipient.invalid", "That isn't a new account's address.");
        if (!token) throw privateProblem("ledger.token.unsupported", "ZeroFee can't start with that coin yet.");
        if (!String(p.refundTo ?? "").trim()) throw privateProblem("ledger.start.refund-needed", "Add the address you're sending from, so anything that goes wrong comes back to you.");
        const near = (Number(BigInt(String(p.needYocto ?? "0")) * 105n / 100n) / 1e24);
        const usd = near * 4.592;
        const amountIn = token.priceUsd ? (usd / Number(token.priceUsd)).toFixed(Math.min(6, token.decimals)) : usd.toFixed(2);
        return { depositAddress: SAMPLE_ADDRESS[token.chain] ?? SAMPLE_ADDRESS.base, amountIn, symbol: token.symbol, tokenId: token.assetId, chain: token.chain, nearOut: near.toString(), etaSeconds: token.chain === "btc" ? 805 : token.chain === "sol" ? 22 : 37, expiresIso: iso(3600e3), refundTo: String(p.refundTo).trim() };
      }
      // An app's own name for its own movement, changed afterwards (Pay's "Paid · Mt Pelerin told you: …").
      case "ledger.relabel": {
        const m = movements.find((x) => x.id === p.id);
        const label = typeof p.label === "string" ? p.label.trim().slice(0, 60) : "";
        if (!m || !label) throw privateProblem("ledger.movement.unknown", "That isn't in this app's Activity, so nothing changed.");
        Object.assign(m, { label, updatedAtIso: iso(0) });
        emit("ledger.movementUpdated", { movement: { ...m } });
        return { ...m };
      }
      // Private (D27), as Wallet's ledger answers it once Security's pocket is on main (packages/wallet/src/types.ts).
      // `fillOpen`: the Move route's fill switch, as the real ledger says it (Spending picks the coin by it)
      case "ledger.private": return { available: true, ready: pocket.ready, rows: pocket.rows.map((r) => ({ ...r })), defaultOn: pocket.defaultOn, fillOpen: options.safeFillOpen ?? SAFE_FILL_OPEN };
      case "ledger.privateDefault": {
        pocket.defaultOn = p.on === true;
        return { available: true, ready: pocket.ready, rows: pocket.rows.map((r) => ({ ...r })), defaultOn: pocket.defaultOn };
      }
      case "ledger.privateSetup": {
        if (!pocket.ready) subwallets.push({ id: "sw-private-near", kind: "private", chain: "near", address: SAMPLE_POCKET, label: "Private" });
        pocket.ready = true;
        return { available: true, ready: true, rows: pocket.rows.map((r) => ({ ...r })), defaultOn: pocket.defaultOn };
      }
      case "ledger.quoteToPrivate": {
        const row = balances.find((b) => b.tokenId === p.tokenId && b.held === "ledger" && b.chain === "near");
        if (!pocket.ready) throw privateProblem("ledger.private.unavailable", "Private isn't set up on this device yet. Nothing was sent.");
        if (!row) throw privateProblem("ledger.private.coin", "This coin can't go into Private yet. USDC, USDT and NEAR can.");
        const amount = String(p.amount ?? "0");
        const usd = Number(amount) * (Number(row.usd) / Number(row.amount));
        if (pocketUsd() + usd > 100) throw privateProblem("ledger.private.cap", `Up to $100 lives in Private. There's room for $${Math.max(0, 100 - pocketUsd()).toFixed(2)} more.`);
        const id = `pq-${Date.now()}`;
        privateQuotes.set(id, { amount, row });
        return { id, from: row.tokenId, to: "private", amountIn: amount, amountOut: amount, minOut: (Number(amount) * 0.99).toFixed(4), feeNote: "The swap fee is in this price. Anyone can see on the network that money moved in.", etaSeconds: 20, expiresAtIso: iso(30e3) };
      }
      // The Add (main → Trade's float), Wallet's call (its name to be confirmed with Wallet): dollars of USDC, paid from the
      // main balance after the sheet; the float has them once the movement lands.
      case "ledger.toTrading": {
        const amount = String(p.amount ?? "");
        const coin = addPaidWith(p.tokenId);
        if (!/^\d{1,9}(\.\d{1,6})?$/.test(amount) || !(Number(amount) > 0)) throw privateProblem("ledger.request.invalid", coin ? "amount is how much of the coin, as text" : "amount is dollars of USDC, as text");
        // Paid with another coin of the main balance (fd3620a): `amount` is that much of the coin, converted to USDC inside
        // the Add at the sample price. The coin leaves the main balance, the Trading balance gets the dollars it is worth.
        let payWith: PayWith | undefined;
        let usdc = amount;
        if (coin) {
          const row = balances.find((b) => b.tokenId === coin && b.held === heldAs(coin));
          // NEAR on the account is priced (and quoted) as wNEAR.
          const token = (options.tokens ?? DEFAULT_TOKENS).find((t) => t.assetId === (coin === "near" ? "nep141:wrap.near" : coin));
          const price = Number(token?.priceUsd ?? (row && Number(row.amount) > 0 && row.usd ? Number(row.usd) / Number(row.amount) : NaN));
          if (!row || !Number.isFinite(price) || price <= 0 || Number(row.amount) < Number(amount)) throw balanceLow(amount, coinOf(coin));
          usdc = fromMicro(BigInt(Math.floor(Number(amount) * price * 1e6)));
          payWith = { tokenId: coin, amount, price };
        }
        // As the core (float.ts FLOAT_MIN_USD): an Add worth under $2 would mostly go on fees, so it is refused.
        if (Number(usdc) < 2) throw { code: "security.request.not-allowed", whatHappened: "A move under $2 would mostly go on fees.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } } satisfies Problem;
        const m = move("trading", amount, { from: coin ?? USDC_NEAR, to: "trading" }, "done", { method, p });
        if (m.status !== "waiting") releaseToTrading(usdc, payWith);
        else { const hm = heldMoves.get((m.held as { id: string }).id); if (hm) { hm.toTrading = usdc; if (payWith) hm.payWith = payWith; } }
        // A swap inside the Add carries the swap service's own time estimate, as the core's quote does (sample: 20 s,
        // 1Click's estimate for the Safe's NEAR → USDC in Spending on a dry quote, 2 Nov).
        return coin && m.status !== "waiting" ? { ...m, etaSeconds: 20 } : m;
      }
      // Out of Private (Wallet's ledger.fromPrivate, the core's subwallet.private.home "all" per coin): no sheet, money
      // going home. Each coin leaves the pocket at once and lands in the main balance whole, as 1Click quotes a same-coin
      // confidential move (recorded 25 Oct: 1.000000 in, 1.000000 out); the core would accept as little as 98 %.
      case "ledger.fromPrivate": {
        if (!pocket.ready) throw privateProblem("ledger.private.unavailable", "Private isn't set up on this device yet. Nothing was sent.");
        // `upTo` (the sheet's own figures, per coin; the ledger's private-pay.ts): each coin at most that, one not shown not at all
        const upTo = p.upTo as Record<string, string> | undefined;
        const out = pocket.rows.filter((r) => (p.tokenId === undefined || r.tokenId === p.tokenId) && Number(r.amount) > 0 && (!upTo || Number(upTo[r.tokenId] ?? 0) > 0));
        const ms = out.map((r) => {
          const most = upTo ? Number(upTo[r.tokenId]) : Infinity;
          const part = most < Number(r.amount);
          const amount = part ? upTo![r.tokenId]! : r.amount;
          const usd = part ? (Number(r.usd ?? 0) * most) / Number(r.amount) : Number(r.usd ?? 0);
          if (part) { r.usd = (Number(r.usd ?? 0) - usd).toFixed(2); r.amount = String(Math.round((Number(r.amount) - most) * 1e6) / 1e6); }
          else pocket.rows.splice(pocket.rows.indexOf(r), 1);
          const m: Record<string, unknown> = { id: `mv-${movements.length + 1}`, kind: "private", status: "moving", amount, from: "private", to: r.tokenId, startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [] };
          movements.unshift(m);
          later({ kind: "settle", movementId: m.id as string, ends: "done", balances: true }, settle);
          later({ kind: "private.home", tokenId: r.tokenId, amount, usd: usd.toFixed(2) }, settle);
          return { ...m };
        });
        emit("ledger.balancesChanged", {});
        return ms;
      }
      case "ledger.toPrivate": {
        const q = privateQuotes.get(String(p.quoteId));
        if (!q) throw privateProblem("ledger.quote.expired", "This price ran out. Get a new one.");
        const m = move("private", q.amount, { from: q.row.tokenId, to: "private" }, "done", { method, p });
        privateQuotes.delete(String(p.quoteId));
        if (m.status !== "waiting") later({ kind: "private.land", amount: q.amount, rowIndex: balances.indexOf(q.row) }, settle);
        return m;
      }
      // Home's Send from a wallet (the ledger's hiddenFromRow, E3): sample money leaves the SOL or ETH (RH) wallet and is paid
      // privately to any chain's address. `amountIn` (the normal Send): exactly that leaves; `amountOut` (a request): that
      // arrives, and leg 1 brings it and 3 % more. The pocket is made by the Send itself (D128), as the real ledger does.
      // Send's fee before the tap (the ledger's two dry quotes): the Sim's sample figure, nothing kept
      case "ledger.sendFee":
        return sampleSendFee(p);
      case "ledger.hiddenFromRow": {
        if (p.app !== undefined && p.app !== "wallet") throw securityProblems.requestNotAllowed("Only your own Send pays from Private.");
        if (!pocket.ready) subwallets.push({ id: "sw-private-near", kind: "private", chain: "near", address: SAMPLE_POCKET, label: "Private" });
        pocket.ready = true;
        if (p.chain !== "sol" && p.chain !== "hood") throw securityProblems.subwalletChain();
        // a wallet's token (core hidden-coins.ts), as the real core: only a pinned one, sent as itself; the sample wallets'
        // tokens are Trade's own sample positions, so the demo records it and takes nothing from the wallet's own coin
        if (p.coin !== undefined) {
          const t = hiddenCoin(p.coin, p.chain);
          if (!t) throw securityProblems.subwalletRefused("Private can't take this yet. Nothing moved.");
          if (!(Number(p.amountIn) > 0)) throw securityProblems.requestInvalid("amount is the coin's decimal text");
          const payee = p.to as { address?: string; accountId?: string } | undefined;
          const m: Record<string, unknown> = { id: `hidden-row:sim-${movements.length + 1}`, kind: "pay", status: "moving", amount: String(p.amountIn), startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], from: String(p.coin), to: String(payee?.address ?? payee?.accountId ?? ""), private: true, debited: true };
          movements.unshift(m);
          later({ kind: "settle", movementId: m.id as string, ends: "done", balances: false }, settle);
          return { ...m };
        }
        const exactIn = p.amountIn !== undefined;
        const s = chatSend({ chain: p.chain, amount: String((exactIn ? p.amountIn : p.amountOut) ?? "") });
        const need = exactIn ? s.units : (s.units * 103n) / 100n;
        if (!s.w || s.units === 0n || s.held < need) throw securityProblems.notEnoughCoin(s.symbol);
        walletNative.set(s.w.id, (walletNative.get(s.w.id) ?? 0n) - need);
        const payee = p.to as { address?: string; accountId?: string } | undefined;
        const to = { address: payee?.address ?? payee?.accountId ?? "" };
        // the money leaves the row only (never the Safe: move() would take it from there), and lands for the payee; Activity
        // records what left the row, in the row's coin, as the real ledger's hiddenFromRow does (leg 1's in-amount)
        const m: Record<string, unknown> = { id: `hidden-row:sim-${movements.length + 1}`, kind: "pay", status: "moving", amount: unitsText(need, p.chain === "sol" ? 9 : 18), startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], from: `nep141:${p.chain}.omft.near`, to: String(to?.address ?? ""), private: true, debited: true };
        movements.unshift(m);
        later({ kind: "settle", movementId: m.id as string, ends: "done", balances: false }, settle);
        return { ...m };
      }
      // Move and a site's top-up paid from Private (the real ledger's private-move.ts): each leg one payment from Private
      // to the person's own wallet, credited there when it lands (a site's wallet too); Private short with the fill closed
      // is refused before anything; open, the Safe fills Private first (its sheet: asksFirst), the extra kept in Private
      case "ledger.moveFromPrivate": {
        if (p.app !== undefined && p.app !== "wallet" && p.app !== "trade") throw securityProblems.requestNotAllowed("Only your own Move pays from Private this way.");
        const parts = (Array.isArray(p.parts) ? p.parts : []) as { wallet?: unknown; usd?: unknown }[];
        const ws = parts.map((x) => (x?.wallet === "near" ? "near" as const : subwallets.find((w) => w.id === x?.wallet && w.kind !== "private" && ["sol", "hood", "bsc"].includes(w.chain))));
        if (!parts.length || parts.length > 4 || ws.some((w) => !w) || parts.some((x) => !(Number(x?.usd) > 0))) throw securityProblems.requestInvalid("parts are your own wallets, each with its dollars");
        const n = privateNeed(p);
        if ((n.fill > 0 && !(options.safeFillOpen ?? SAFE_FILL_OPEN)) || n.fill === Infinity) throw new ProblemError(privateShort(n.have, n.need));
        if (!pocket.ready) { subwallets.push({ id: "sw-private-near", kind: "private", chain: "near", address: SAMPLE_POCKET, label: "Private" }); pocket.ready = true; }
        // each part as the ledger pays it (core moveFills; the Sim's mirror, 7 Nov): the smallest first; Private's own share
        // (a "pocket-send:" payment), and the part's own fill from the Safe (a "safe-send:" payment holding the fill's id),
        // the fill's extra kept in Private. Another coin than USDC (Private's NEAR): its row at its own price, the Safe's
        // NEAR Intents row (or NEAR on the account) filling it
        const usdc = n.tokenId === USDC_NEAR;
        const px = usdc ? 1 : tokenPrice(n.tokenId);
        let coinRow = pocket.rows.find((r) => r.tokenId === n.tokenId);
        const safe = usdc ? balances.find((b) => b.tokenId === USDC_NEAR && b.held === "ledger") : safeFillRow(n.raw, n.tokenId);
        if (!coinRow) { coinRow = { ...(usdc ? BALANCES[0]! : safe ?? BALANCES[0]!), tokenId: n.tokenId, amount: "0", usd: "0", held: "private" }; pocket.rows.push(coinRow); }
        const row = coinRow;
        const per = !usdc && Number(row.amount) > 0 && Number(row.usd) > 0 ? Number(row.usd) / Number(row.amount) : px;
        const units = (usd: number) => (usdc ? usd.toFixed(2) : String(Number((usd / per).toFixed(6))));
        const addRow = (usd: number) => {
          if (usdc) { const micro = toMicro(row.amount) + toMicro(usd.toFixed(6)); Object.assign(row, { amount: fromMicro(micro < 0n ? 0n : micro), usd: fromMicro((micro < 0n ? 0n : micro) - ((micro < 0n ? 0n : micro) % 10_000n)) }); return; }
          const amt = Math.max(0, Number(row.amount) + usd / per);
          Object.assign(row, { amount: String(Number(amt.toFixed(9))), usd: Math.max(0, Number(row.usd ?? 0) + usd).toFixed(2) });
        };
        const stopAt = movesStopAt.get(p);
        const pay = (usd: number, w: (typeof ws)[number], i: number, kind: "safe-send" | "pocket-send") => {
          const m: Record<string, unknown> = { id: `${kind}:sim-${movements.length + 1}`, kind: "pay", status: "moving", amount: units(usd), from: n.tokenId, to: w === "near" ? "your NEAR wallet" : w!.address,
            private: true, debited: true, startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], ...(typeof p.job === "string" ? { job: p.job, part: i, partWallet: String(parts[i]!.wallet) } : {}) };
          movements.unshift(m);
          later({ kind: "private.pay", movementId: m.id as string, wallet: w === "near" ? "near" : w!.id, usd }, kind === "safe-send" ? settle * 2 : settle);
          return m.id as string;
        };
        const out: { wallet: string; usd: number; ids: string[]; stopped?: string }[] = parts.map((x) => ({ wallet: String(x.wallet), usd: Math.round(Number(x.usd) * 100) / 100, ids: [] }));
        const order = [...n.fills].sort((a, b) => a.at - b.at);
        // Private's own payments first (no Safe sheet), the smallest first
        for (const f of order) if (f.fromPrivate > 0) { addRow(-f.fromPrivate); out[f.part]!.ids.push(pay(f.fromPrivate, ws[f.part]!, f.part, "pocket-send")); }
        // then the ONE fill for every part left (the audit's ruling, 7 Nov): one Safe sheet; a No there leaves those parts not started
        const via = order.filter((f) => f.rest > 0);
        if (via.length && stopAt !== undefined) for (const f of via) out[f.part]!.stopped = "Didn't start. It's still in Private and your Safe.";
        else if (via.length && n.fill > 0) {
          const fillUnits = n.fill / px;
          if (!safe || Number(safe.amount) + 1e-9 < fillUnits) throw usdc ? balanceLow(n.fill.toFixed(2), "USDC") : balanceLow(String(Math.ceil(fillUnits * 1e4) / 1e4), safe?.symbol ?? "NEAR");
          if (usdc) moveMainUsdc(-toMicro(n.fill.toFixed(6)));
          else { const left = Math.max(0, Number((Number(safe.amount) - fillUnits).toFixed(9))); Object.assign(safe, { amount: String(left), usd: (left * px).toFixed(2) }); }
          const fm: Record<string, unknown> = { id: `mv-${movements.length + 1}`, kind: "private", status: "moving", amount: usdc ? n.fill.toFixed(2) : String(Number(fillUnits.toFixed(6))), from: n.tokenId, to: "private", startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], ...(typeof p.job === "string" ? { job: p.job, part: via[0]!.part, partWallet: String(parts[via[0]!.part]!.wallet) } : {}) };
          // with the part its id goes with (7 Nov): the status read (privateMoveStatus) keeps only movements with a part, so
          // the fill stays the Move's, never a second Activity row
          movements.unshift(fm);
          later({ kind: "settle", movementId: fm.id as string, ends: "done", balances: true }, settle);
          // what the one fill brings over every part stays in Private
          addRow(n.fill - via.reduce((t, f) => t + f.rest, 0));
          // each part's payment out of the one fill; the fill's id goes with the first, so Activity folds it into the Move's row
          via.forEach((f, k) => { out[f.part]!.ids.push(pay(f.rest, ws[f.part]!, f.part, "safe-send"), ...(k === 0 ? [fm.id as string] : [])); });
        } else for (const f of via) addRow(-f.rest);
        emit("ledger.balancesChanged", {});
        return { parts: out };
      }
      case "ledger.privateMoveStatus": {
        const mine = movements.filter((m) => typeof p.job === "string" && m.job === p.job && typeof m.part === "number");
        if (!mine.length) return null;
        const n = Math.max(...mine.map((m) => m.part as number)) + 1;
        // each part's own wallet, as the real ledger keeps it (private-move.ts): the Sim's site top-up was renamed "your SOL
        // wallet" and its Home job never ended once a status read blanked it (Sim crawl, 5 Nov)
        return { parts: Array.from({ length: n }, (_, i) => ({ wallet: String(mine.find((m) => m.part === i)?.partWallet ?? ""), usd: 0, moves: mine.filter((m) => m.part === i).map((m) => ({ id: String(m.id), status: String(m.status) })) })) };
      }
      // Home's Send from the Safe (E4) as the real ledger is (safe-send.ts): what Private holds of that coin goes straight
      // out; Private short and `fill` (Send asks with it, the fill's switch on), the Safe fills Private by a whole step and
      // NEAR Confidential pays the WHOLE Send from there: one sheet, one payout, the extra kept in Private (`kept`), the band
      // deciding as on chain (over it: waiting). Without `fill`, more says the most, before any sheet. Never a demo-only
      // flow (D125). Answers Movement[], one per part, as the real ledger does.
      case "ledger.sendFromSafe": {
        if (p.app !== undefined && p.app !== "wallet") throw securityProblems.requestNotAllowed("Only your own Send sends from your Safe this way.");
        const id = p.tokenId === "near" ? "nep141:wrap.near" : String(p.tokenId ?? "");
        const row = pocket.rows.find((r) => r.tokenId === id);
        const held = Number(row?.amount ?? 0), asked = Number(p.amount);
        const filled = fillCase(p);
        if (filled) return sendFill(p, filled);
        if (!row || !(held > 0)) throw privateProblem("ledger.private.unavailable", "Private isn't set up on this phone yet. Nothing was sent.");
        if (!(asked > 0)) throw privateProblem("ledger.amount.invalid", "Type an amount above zero.");
        if (asked > held) throw { code: "ledger.safe-send.most", whatHappened: `Up to ${fourPlacesText(`${row.amount} ${row.symbol}`)} can go now. The rest stays in your Safe.`, money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Change the amount" } } as Problem;
        const payee = p.to as { address?: string; accountId?: string } | undefined;
        // it leaves the private balance only, once (a web test: a $25 send took 25 USDC here and 25 more from the
        // Safe's own row when it settled, 1,385.60 -> 1,335.60): `debited`, and the row's dollars follow its coins
        const m: Record<string, unknown> = { id: `pocket-send:sim-${movements.length + 1}`, kind: "pay", status: "moving", amount: String(p.amount), startedAtIso: iso(0), updatedAtIso: iso(0), explorerUrls: [], from: id, to: String(payee?.address ?? payee?.accountId ?? ""), private: true, debited: true };
        if (id === USDC_NEAR) {
          const micro = toMicro(row.amount) - toMicro(String(p.amount));
          Object.assign(row, { amount: fromMicro(micro), usd: fromMicro(micro - (micro % 10_000n)) });
        } else {
          const left = Number((held - asked).toFixed(9));
          Object.assign(row, { amount: String(left), ...(row.usd !== undefined && row.usd !== null ? { usd: (Math.floor(Number(row.usd) * (left / held) * 100) / 100).toFixed(2) } : {}) });
        }
        movements.unshift(m);
        emit("ledger.balancesChanged", {});
        later({ kind: "settle", movementId: m.id as string, ends: "done", balances: false }, settle);
        return [{ ...m }];
      }
      case "ledger.recipientInfo": return { exists: true, hasLedgerBalance: true, code: null };
      // ZeroFee Chat's names and messages: answered in call() (chatKeys, the core's own chat-keys.ts), never here.
      // Pay's card step (D21): one sample address answers as a Gnosis Pay card account; everything else isn't one.
      case "card.check": {
        const addr = String(p.address ?? "").toLowerCase();
        if (p.product !== "gnosis-pay") return { isCard: false, why: "ZeroFee can check only Gnosis Pay cards for now." };
        return addr === SAMPLE_CARD.toLowerCase() ? { isCard: true } : { isCard: false, why: "This address isn't set up as a Gnosis Pay card account." };
      }
      // The card's EURe (the core reads it from the coin on two nodes): the sample card holds some; any other address none.
      case "card.balance": {
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(p.address ?? ""))) throw { ...securityProblems.requestInvalid("address is an address on Gnosis Chain (0x and 40 more letters and digits)"), money: { state: "not-involved" } };
        return { amount: String(p.address).toLowerCase() === SAMPLE_CARD.toLowerCase() ? "248.5" : "0", symbol: "EURe", readAtIso: iso(0) };
      }
      case "device.store.get": return { value: store.get(`${p.app}.${p.key}`) ?? null };
      case "device.store.set": {
        if (p.value === null) store.delete(`${p.app}.${p.key}`);
        else store.set(`${p.app}.${p.key}`, String(p.value));
        return { ok: true };
      }
      case "device.openUrl":
        awaitingReturn = String(p.app ?? p.caller ?? "wallet");
        return { ok: true };
      // A tap the person feels: nothing to feel in the demo.
      case "device.haptic":
        if (!["success", "tap", "warning"].includes(String(p.kind))) throw { code: "shell.device.refused", whatHappened: "That isn't a buzz ZeroFee knows. Use success, tap or warning.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } as Problem;
        return { ok: true };
      default: throw unknown(method);
    }
  };

  // ?demo&keep (options.persist): everything above that a reload would lose, as plain JSON. Pending approval sheets
  // aren't kept (their method hasn't run, so nothing moved), nor which app opened a partner's page.
  const snapshot = () => ({
    v: MOCK_STATE_VERSION,
    savedAt: Date.now(),
    store: [...store],
    protectionBands,
    appBands,
    keys: account.keys,
    subwallets,
    movements,
    received,
    createCalls,
    held,
    endedHolds: [...endedHolds],
    heldMoves: [...heldMoves].map(([id, h]) => [id, { movementId: h.m.id as string, ends: h.ends, ...(h.toTrading !== undefined ? { toTrading: h.toTrading } : {}), ...(h.payWith ? { payWith: h.payWith } : {}) }] as const),
    pocket,
    balances,
    payQuotes: [...payQuotes],
    privateQuotes: [...privateQuotes].map(([id, q]) => [id, { amount: q.amount, rowIndex: balances.indexOf(q.row) }] as const),
    sheetCount,
    jobSeq,
    jobs: [...jobs.values()].map((j) => j.job),
    float: float.snapshot(),
    spent,
    frozenUntil,
    heldChanges: [...heldChanges],
    wordsRound,
    renewRound,
    changeRows,
    recovery: account.recovery,
    delayFixed,
    // the apps wallet's sample SOL (what an Add moved into it): kept with the rest, or a reload loses it while the main
    // balance stays down (grade 1 Nov, item 1)
    walletNative: [...walletNative].map(([id, v]) => [id, v.toString()] as const),
    // a site wallet's Take outs (QA, 5 Nov: the Take out's row was gone after a reload)
    backs: backs.map((b) => ({ ...b })),
    chatSeed: [...chatSample].map((x) => x.toString(16).padStart(2, "0")).join(""),
    chatNames,
    // QA (5 Nov): a reload turned AgentZero off (its wallet back to "Off") while its job ran on
    agent: { rules: agentRules, lastLimit: agentLastLimit, heldUsd: agentHeldUsd, receiptHead, receipts: agentReceipts, paidCount: agentPaidCount, askAbove: agentAskAbove },
    simHeld: [...simHeld].map(([id, m]) => [id, [...m].map(([t, c]) => [t, { ...c, amount: c.amount.toString() }] as const)] as const),
  });
  type Snapshot = ReturnType<typeof snapshot>;
  const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  /** Back to a saved state: timed steps re-armed for what's left, any already due run now (oldest first), each once. */
  const apply = (raw: Snapshot) => {
    const x = copy(raw);
    for (const j of jobs.values()) timers.clear(j.timer);
    jobs.clear();
    store.clear();
    for (const [k, v] of x.store) store.set(k, v);
    protectionBands = x.protectionBands;
    appBands = x.appBands;
    // ?oldkey's classical key stays shown on a kept sample account too (until Remove takes it off this page)
    account.keys = options.oldKey ? [...x.keys, ...OLD_KEYS.filter((o) => !x.keys.some((k) => k.handle === o.handle) && !(removedOld && o.handle === OLD_KEY_HANDLE))] : x.keys;
    subwallets.splice(0, subwallets.length, ...x.subwallets);
    movements.splice(0, movements.length, ...x.movements);
    // a state saved before the Received rows keeps the ones made now
    if (Array.isArray(x.received)) received.splice(0, received.length, ...x.received);
    createCalls = x.createCalls;
    held.splice(0, held.length, ...x.held);
    endedHolds.clear();
    for (const [k, v] of x.endedHolds) endedHolds.set(k, v);
    heldMoves.clear();
    for (const [id, h] of x.heldMoves) {
      const m = movements.find((mv) => mv.id === h.movementId);
      if (m) heldMoves.set(id, { m, ends: h.ends, ...(h.toTrading !== undefined ? { toTrading: h.toTrading } : {}), ...(h.payWith ? { payWith: h.payWith } : {}) });
    }
    Object.assign(pocket, x.pocket);
    balances.splice(0, balances.length, ...x.balances);
    payQuotes.clear();
    for (const [k, v] of x.payQuotes) payQuotes.set(k, v);
    privateQuotes.clear();
    for (const [k, v] of x.privateQuotes) if (balances[v.rowIndex]) privateQuotes.set(k, { amount: v.amount, row: balances[v.rowIndex] });
    sheetCount = x.sheetCount;
    jobSeq = x.jobSeq;
    for (const job of x.jobs) arm(job);
    float.restore(x.float);
    spent = x.spent ?? [];
    frozenUntil = x.frozenUntil ?? 0;
    heldChanges.clear();
    for (const [k, v] of x.heldChanges ?? []) heldChanges.set(k, v);
    wordsRound = Number(x.wordsRound) > 0 ? Number(x.wordsRound) : 0;
    changeRows = Array.isArray(x.changeRows) ? x.changeRows : [];
    renewRound = Number(x.renewRound) > 0 ? Number(x.renewRound) : null;
    if (x.recovery) account.recovery = x.recovery;
    delayFixed = x.delayFixed === true;
    walletNative.clear();
    // a site wallet that bought holds less than its seeded SOL: its count goes below 0 (a reload once dropped it: money made)
    for (const [id, v] of x.walletNative ?? []) if (/^-?\d+$/.test(String(v))) walletNative.set(id, BigInt(v));
    backs.splice(0, backs.length, ...(x.backs ?? []));
    if (typeof x.chatSeed === "string" && /^[0-9a-f]{64}$/.test(x.chatSeed)) chatSample.set(x.chatSeed.match(/../g)!.map((h) => parseInt(h, 16)));
    chatNames = typeof x.chatNames === "string" ? x.chatNames : null;
    if (x.agent) {
      agentRules = x.agent.rules ?? null;
      agentLastLimit = typeof x.agent.lastLimit === "number" ? x.agent.lastLimit : agentRules?.limitUsd ?? null;
      // a sample kept before its wallet held money: what it may still spend comes out of the Safe now, once
      if (typeof x.agent.heldUsd === "number") agentHeldUsd = x.agent.heldUsd;
      else if (agentRules) agentLimitMoves(0, agentLimitFits(0, Math.max(0, agentRules.limitUsd - agentRules.paid.reduce((t: number, y: { usd: number }) => t + y.usd, 0))));
      receiptHead = x.agent.receiptHead ?? null;
      agentReceipts.splice(0, agentReceipts.length, ...(x.agent.receipts ?? []));
      agentPaidCount = Number(x.agent.paidCount) || 0;
      agentAskAbove = typeof x.agent.askAbove === "number" ? x.agent.askAbove : null;
    }
    simHeld.clear();
    for (const [id, coins] of x.simHeld ?? []) simHeld.set(id, new Map(coins.map(([t, c]) => [t, { ...c, amount: /^\d+$/.test(String(c.amount)) ? BigInt(c.amount) : 0n }])));
    // What fell due while the page was away runs now, oldest first, the bridge's steps and the float's moves in one line.
    const now = Date.now();
    const due = [
      ...x.jobs.filter((j) => j.dueAt <= now).map((j) => ({ dueAt: j.dueAt, order: 0, n: j.id, run: () => runJob(j.id) })),
      ...float.pendingDue().filter((p) => p.dueAt <= now).map((p) => ({ dueAt: p.dueAt, order: 1, n: 0, run: () => float.land(p.id) })),
    ].sort((a, b) => a.dueAt - b.dueAt || a.order - b.order || a.n - b.n);
    for (const d of due) d.run();
  };
  const persist = options.persist;
  const key = persist?.key ?? MOCK_STATE_KEY;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let restoring = false;
  function flush() {
    if (!persist || restoring) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
      persist.storage.setItem(key, JSON.stringify(snapshot()));
    } catch {
      // Storage full or blocked: the demo carries on, it just won't survive a reload.
    }
  }
  /** Something changed: save within 150 ms (one save for a burst of calls). */
  function changed() {
    if (!persist || restoring || saveTimer !== undefined) return;
    saveTimer = setTimeout(flush, 150);
  }
  if (persist) {
    let raw: string | null = null;
    try {
      raw = persist.storage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      const fresh = snapshot();
      try {
        const saved = JSON.parse(raw) as Snapshot;
        if (saved?.v !== MOCK_STATE_VERSION) throw new Error(`saved version ${String(saved?.v)}, this demo is ${MOCK_STATE_VERSION}`);
        restoring = true;
        apply(saved);
      } catch (e) {
        restoring = true;
        apply(fresh);
        if (!warnedFresh) console.warn(`[demo&keep] The saved demo couldn't be read, so it starts fresh (${(e as Error).message}).`);
        warnedFresh = true;
      } finally {
        restoring = false;
      }
      flush();
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("pagehide", flush);
  }

  return {
    flush,
    sampleWordsNow: () => options.sampleWords?.(wordsRound) ?? null,
    freeze(untilIso, pending = null) {
      frozenUntil = untilIso ? Date.parse(untilIso) : 0;
      // the account says it too (account.state, recovery.status), so every screen agrees with the banner
      account.recovery = { delaySeconds: account.recovery?.delaySeconds ?? 172800, pending: untilIso ? pending : null };
      changed();
      emit("recovery.changed", { pending: account.recovery.pending });
    },
    startRecovery({ laptop = true } = {}) {
      if (laptop && !hasLaptop()) account.keys.push({ handle: LAPTOP_HANDLE, role: "second-device", kind: "development" });
      const delay = account.recovery?.delaySeconds ?? 172800;
      const readyAtIso = iso(delay * 1000);
      const fallbackAtIso = iso(fallbackWaitSeconds() * 1000);
      // The laptop here counts fully (it has been on the account for the floor): the move needs its yes.
      const pending: RecoveryPending = hasLaptop()
        ? { readyAtIso, needsSecondDevice: true, approved: false, fallbackAtIso, canFinishAtIso: fallbackAtIso }
        : { readyAtIso, needsSecondDevice: false, approved: false, fallbackAtIso, canFinishAtIso: readyAtIso };
      setMove(pending, Date.parse(pending.canFinishAtIso!));
      return pending;
    },
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      await new Promise((r) => setTimeout(r, latency));
      const forced = options.fail?.[method];
      if (forced) return { problem: forced };
      // ZeroFee Chat (D55, J3 part 2): its keys and names as the core answers them (Chat only), and its NEAR reads.
      if (method.startsWith("nostr.") || NEAR_READS.has(method) || (method === "ledger.recipientInfo" && options.nearReads && !sampleName(String(params.accountId ?? "")))) {
        try {
          if (method.startsWith("nostr.")) {
            if (params.app !== "chat") return { problem: securityProblems.methodUnknown(method) };
            return { ok: (await chatKeys.call(method, params)) as T };
          }
          return { ok: (await nearRead(method, params)) as T };
        } catch (e) {
          if (e instanceof ProblemError) return { problem: e.problem };
          return { problem: method.startsWith("ledger.") ? securityProblems.nodesUnreachable() : unknown(method) };
        } finally {
          flush();
        }
      }
      const refused = refusedFirst(method, params) ?? (method === "subwallet.send" ? chatSendRefused(params) : null);
      if (refused) return { problem: refused };
      // A NEAR coin bought or sold inside Spending (TN2): the core's own sheet in S1's words, or the Trade session it
      // starts with the first one ("Buy $25.00 of QTC, and trade fast for 30 minutes"), as the core's floatSwap
      if (method === "subwallet.float.swap") {
        try {
          if (params.app !== undefined && params.app !== "trade" && params.app !== "wallet") throw securityProblems.requestNotAllowed("Only Trade and Home's Swap can swap inside Spending.");
          return { ok: (await swapAsked(params)) as T };
        } catch (e) {
          return { problem: (e as Problem).code ? (e as Problem) : unknown(method) };
        } finally {
          flush();
        }
      }
      if (method === "subwallet.site.moveBackAll") {
        try {
          return { ok: (await siteMoveBackAll(params)) as T };
        } catch (e) {
          return { problem: (e as Problem).code ? (e as Problem) : e instanceof ProblemError ? e.problem : unknown(method) };
        } finally {
          flush();
        }
      }
      if (method === "account.agent.askAbove") {
        try {
          return { ok: (await askAboveCall(params)) as T };
        } catch (e) {
          return { problem: (e as Problem).code ? (e as Problem) : e instanceof ProblemError ? e.problem : unknown(method) };
        }
      }
      if (method === "subwallet.site.moveBack") {
        try {
          return { ok: (await siteMoveBack(params)) as T };
        } catch (e) {
          return { problem: (e as Problem).code ? (e as Problem) : e instanceof ProblemError ? e.problem : unknown(method) };
        } finally {
          flush();
        }
      }
      // mainnetRules: what the protection will do is known before the sheet, as the core asks the contract first. A
      // payment at a partner's price can't wait (its price lasts a minute): refused, nothing signed (dev-signer.ts).
      const willHold = holdFor(method, params);
      if (willHold && willHold.why !== "change" && usdOfRequest(method, params)?.quoted) return { problem: securityProblems.quoteCantWait() };
      // a Send from the Safe through the fill: its whole fill counts on the band; over it, the copy review's refusal before the sheet
      // the audit's ruling (5 Nov), as the core's dev-signer: a fill whose payout coin can't be named stops before the sheet
      if (method === "ledger.sendFromSafe" && fillCase(params) && fillGets(params, 1) === null) return { problem: securityProblems.sendCoinUnknown() };
      if (method === "ledger.sendFromSafe" && sendFillHeld(params)) return { problem: sendOverLimit() };
      // The sheet comes first, as in the core: a "no" signs nothing and the method never runs. A request the protection
      // will hold says so on it, with the real wait.
      const sheetWords = (): PlainWords => {
        const w = wordsFor(method, params);
        return willHold ? { ...w, lines: [...w.lines, ...holdLines(willHold)] } : w;
      };
      // New words: three checked before the sheet, as the core checks before it signs; a wrong word asks nothing.
      if (method === "recovery.renewConfirm") {
        const wrong = renewProblem(params);
        if (wrong) return { problem: wrong };
      }
      // New words: what refuses them is said before the check is asked, as the core; a no shows no words.
      if (method === "recovery.renew") {
        const refused = renewRefusal();
        if (refused) return { problem: refused };
      }
      // separate steps (TxRequest.apart), as the core's dev-signer: ZeroFee's own Safe screens only, at most four, never split
      if (method === "tx.request" && (params.request as TxRequest | undefined)?.apart) {
        const r = params.request as TxRequest;
        if (!["wallet", "trade"].includes(String(r.from))) return { problem: securityProblems.stepsNotAllowed() };
        if (1 + (r.then?.length ?? 0) > 4) return { problem: securityProblems.requestInvalid("A request can chain at most four receivers.") };
      }
      // as the core (dev-signer.ts onAsked, the audit's MUST, 7 Nov): a job's sheet about to show says approval.asked with the job's
      // key (the ledger's `job`, a request's TxRequest.job), and job.signed names it, so the Sim and the phone take one path
      const jobKey = jobKeyOf(method, params);
      const asked = () => { if (jobKey) emit("approval.asked", { jobKey }); };
      const signedSaid = () => emit("job.signed", jobKey ? { jobKey } : {});
      if (method === "ledger.moveFromPrivate" && asksFirst(method, params)) {
        // as the ledger (private-move.ts, safe-send.ts fillMove; the audit's ruling, 7 Nov): ONE Safe sheet for the whole Move, after
        // Private's own payments; a No where Private paid nothing signs nothing; else the fill's parts don't start
        const fills = privateNeed(params).fills;
        const words = wordsFor(method, params);
        asked();
        if (!(await ask(willHold ? { ...words, lines: [...words.lines, ...holdLines(willHold)] } : words))) {
          if (!fills.some((x) => x.fromPrivate > 0)) return { problem: signatureDeclined() };
          params = { ...params }; movesStopAt.set(params, 0);
        } else if (words.amount && words.tap !== true) signedSaid();
      } else if (asksFirst(method, params)) {
        const words = sheetWords();
        asked();
        if (!(await ask(words))) {
          if (method === "recovery.renew") return { problem: securityProblems.renewDeclined() };
          return method.startsWith("ledger.") ? { problem: signatureDeclined() } : { ok: { status: "declined" } as T };
        }
        // as the core (dev-signer.ts onSigned, 6 Nov): the Safe's money signed on its one sheet, before anything is
        // sent, says job.signed, and the shell makes the job then ("Job created.")
        if (words.amount && words.tap !== true) signedSaid();
      }
      try {
        return { ok: answer(method, params) as T };
      } catch (e) {
        // a ProblemError carries its problem (e2e walk, 3 Nov: Hidden's "sample money, no real address" and AgentZero's
        // limits came out as "This isn't available yet", and Add then blamed 1Click)
        return { problem: e instanceof ProblemError ? e.problem : (e as Problem).code ? (e as Problem) : unknown(method) };
      } finally {
        // saved the moment it answers, never 150 ms later: a reload right after a held change can't lose it (grade 1
        // Nov, item 10)
        flush();
      }
    },
    on<T>(event: string, handler: (payload: T) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(handler as (payload: unknown) => void);
    },
    emit,
  };
}

/** The Sim's AgentZero sheet's headline (copy review, 7 Nov: "Turn on AgentZero" never said the amount): what it adds, "Add $25.00
 *  to AgentZero's wallet", the new limit less the one in force. Adding nothing (a list change): the old words. */
export function agentSheetTitle(method: string, limitUsd: number, wasUsd: number): string {
  const add = Math.round((limitUsd - (method === "account.agent.set" ? 0 : wasUsd)) * 100) / 100;
  if (Number.isFinite(add) && add > 0.004) return `Add $${add.toFixed(2)} to AgentZero's wallet`;
  return method === "account.agent.set" ? "Turn on AgentZero" : "Add money to AgentZero's wallet";
}
