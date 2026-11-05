// The ledger service: the ledger.* methods in docs/interfaces.md, answered from NEAR Intents (intents.near, mainnet).
//
// It runs outside the trusted core, behind the same bridge (routeBridge(core, { ledger })). It holds no key: anything
// that needs a signature goes to the core as tx.request, from the Wallet app.
//   balances       intents.near's mt_tokens_for_owner + mt_batch_balance_of, plus coins sent straight to the NEAR
//                  account (D14), every read pinned to one final block that two nodes agree on (core/chain.ts)
//   deposits       the deposit bridge's address per network, minimums from its table, and the first address ever shown
//                  for a network kept on the device: if the bridge later answers with another one, nothing is shown
//   sending        the same coin out (send.ts): withdraw, transfer, and Pay's same-coin quotePay/pay. Every number is
//                  read again just before signing; a bridge withdraw is followed until it lands on the far chain. A
//                  transfer with a `msg` (mt_transfer_call) is read back from its receipts
//                  (receipts.ts): kept, sent straight back ("refunded"), or partly kept
//   converting     convert.ts: a dry 1Click quote to show, a fresh one at convert, paid by a route the test dust proof
//                  opened (CONVERT_ROUTES), followed until 1Click delivers or refunds
//   held           a request the account's protection holds comes back "waiting" (D17): kept as such, never as done
//   activity       this device's own movements (device.store) plus the deposits the bridge has seen
//   private        D27: a small separate wallet (Security's pocket, subwallet kind "private", capped at $100) that money
//                  moves into through a confidential 1Click quote (quoted through the quote server, which holds the
//                  partner key); the move in shows on chain, what follows doesn't. Shown only once this phone can use it
//   start          M7: a brand-new account's first NEAR, bought with any coin 1Click quotes, before the account exists
//                  (a public quote; nothing signed; the person sends from their own wallet)
//   callers        every call carries the app that asked (forApps stamps `caller`): the ledger signs as that app, so
//                  the sheet's hint names it. Wallet and Pay may send anywhere; any other app only withdraws or pays
//                  to its own kind of wallet (Trade's trading wallets, Extension's laptop wallet). Every app may read.
//                  Movements carry their caller; another app never sees their labels
//   coins, chains  1Click's list, and the bridge's table only where a path uses it (catalogue.ts; B28: a dead bridge never
//                  holds a balance, a Send on NEAR or a move to Spending). Both kept on the device, plus the app's own
//                  snapshot, so a first paint never waits on a network answer; what moves money is always read now
//   services       which outside service is failing (ledger.services, B28 R6): the relay's minute check and what this
//                  ledger saw fail, so a sheet says it before the tap
// The account must be on mainnet: a testnet name credited on mainnet could be claimed by whoever owns that name there.
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { APP_STORE_NAME } from "@zerofee/core/app-store";
import { FUND_EVERY_CHAIN } from "@zerofee/core/fund-every-chain";
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { SAFE_SEND_FILL_OPEN } from "@zerofee/core/safe-send-fill-open";
import { everyAligned } from "@zerofee/core/aligned";
import { codeOf, proxySafe, proxyTokens, type Block, type Chain as Near, type ChainAccount, type ShownReads } from "@zerofee/core/chain";
import { INTENTS, nep141Contract } from "@zerofee/core/intents";
import { ACCOUNT_POLICY } from "@zerofee/core/known-contracts";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import type { AccountInfo, PlainWords, Requester, TxOutcome, TxRequest } from "@zerofee/core/signer";
import type { ActivityItem } from "@zerofee/core/activity";
import { securityProblems } from "@zerofee/core/security-problems";
import { closedSince } from "@zerofee/core/money-closed";
import { READS } from "@zerofee/core/read-deadline";
import type { DaoRole, NearProfile } from "@zerofee/core/chat-reads";
/** ZeroFee Chat's NEAR reads, loaded when Chat first asks (never in Home's first load: apps/web speed-budget.test.ts). */
const chatReads = () => import("@zerofee/core/chat-reads");
/** Money that came in (Activity's lasting "Received" rows, the Safe watch): loads with its first use. */
const receivedCode = () => import("./received.ts");
import { fromUnits, toUnits, usdOf } from "./amount.ts";
import { BridgeRefused, QuoteRefused, createApis, type Apis, type QuoteRequest, type BridgeAddress, type BridgeDeposit, type BridgeToken } from "./apis.ts";
import type { Fault, Service, ServiceHealth, ServiceStatus } from "@zerofee/core/services";
import { Catalogue, NATIVE_NEAR, NEAR_DECIMALS, WRAPPED_NEAR, routeOf } from "./catalogue.ts";
import { CONVERT_ROUTES, convertRequest, fundingSteps, originAsset, routeFor, type ConvertRoute, type Routes } from "./convert.ts";
import { WRAP_STORAGE_YOCTO } from "./moves.ts";
import { createReadCall, type ReadCall, type CallResult } from "./receipts.ts";
import { ACCOUNT_ID, planSend, type SendPlan } from "./send.ts";
import { EVM_CHAINS, validAddress, validReceiveAddress } from "./addresses.ts";
import { PRIVATE_KIND, type Balance, type DepositAddress, type Movement, type PayQuote, type Payee, type PrivatePocket, type Quote, type RecipientInfo, type StartNetwork, type StartQuote } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";
import { quoteDeadline } from "@zerofee/core/quote-deadline";

/** A move out of Private as the core keeps it (subwallet.private.home / move). */
interface PocketMove {
  id: string;
  status: "pending" | "done" | "failed" | "refunded";
}
const pocketStatus = (m: PocketMove): Movement["status"] => (m.status === "done" ? "done" : m.status === "refunded" ? "refunded" : m.status === "failed" ? "problem" : "moving");

/** Coins a NEAR wallet may send straight to the account (D14); they count in the balance and move in when used. */
export const ACCOUNT_COINS = [WRAPPED_NEAR, "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:usdt.tether-token.near"];
/** NEAR takes a transaction's prepaid gas from the account up front at 1e9 yocto a gas unit (nearcore protocol 86: ten
 *  times today's 1e8 gas price; measured on the pinned sandbox 1 Nov: 50 Tgas took 0.0509 NEAR, 100 Tgas 0.1009, 200
 *  Tgas 0.2009) and refunds what wasn't burnt a block later. While it's out the account's storage must still be covered,
 *  or the payment fails (LackBalanceForState): a Send of "all" with only 0.05 NEAR kept failed that way, 0.0013 short. */
export const UPFRONT_YOCTO_PER_GAS = 1_000_000_000n;
/** The account contract's own execute() on top of the steps' gas (the core's EXECUTE_GAS): every payment goes through it. */
const EXECUTE_GAS = 50_000_000_000_000n;
/** A chain's link (the core's CHAIN_LINK_GAS), and one transaction's most (300 Tgas). */
const CHAIN_LINK_GAS = 15_000_000_000_000n;
const MAX_TX_GAS = 300_000_000_000_000n;
/** On top of the prepaid gas: the transaction's own conversion fee (~0.0009 NEAR) and the contract's record of the
 *  payment (its 24-hour row, ~40 bytes at 1e19 a byte), with room to spare. */
const FEE_SLACK_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
/** The most the steps take from the account up front in one transaction (all of them chained in one: the most it could be). */
export function upfrontYocto(steps: Pick<TxRequest, "actions" | "then">[]): bigint {
  const groups = steps.flatMap((s) => [s.actions, ...(s.then ?? []).map((t) => t.actions)]);
  const inner = groups.reduce((n, actions) => n + actions.reduce((g, a) => g + (a.kind === "call" ? BigInt(a.gas) : 0n), 0n), 0n);
  const gas = inner + (groups.length > 1 ? BigInt(groups.length) * CHAIN_LINK_GAS : 0n) + EXECUTE_GAS;
  return (gas > MAX_TX_GAS ? MAX_TX_GAS : gas) * UPFRONT_YOCTO_PER_GAS + FEE_SLACK_YOCTO;
}
/** NEAR kept on the account for network fees, never counted as spendable: what a plain Send of NEAR takes up front (its
 *  50 Tgas, 0.05 NEAR, and the slack), so "Send all" always goes. 0.06 NEAR. */
export const FEE_RESERVE_YOCTO = upfrontYocto([{ actions: [{ kind: "transfer", yocto: "0" }] }]);
const YOCTO_PER_BYTE = 10_000_000_000_000_000_000n; // NEAR's storage price: 1e19 yocto per byte
const CATALOGUE_TTL_MS = 5 * 60_000;
/** B28 R3: how long a first paint waits for a live coin list before it paints from the one kept on this device. */
const FIRST_PAINT_MS = 1_500;
/** A coin list whose service failed is asked again only after this long (reads meanwhile paint from what is kept). */
const FAILED_AGAIN_MS = 15_000;
/** Where the device keeps the last good coin list and bridge table (device.store, Wallet's own). */
const COINS_KEY = "coins-kept";
const BRIDGE_KEY = "bridge-kept";
/** B28 R6: the relay's service check is asked at most this often (it pings each service once a minute itself), and a
 *  service this ledger saw fail counts as failing for this long unless it answers well again. */
const HEALTH_MS = 60_000;
const FAILING_MS = 2 * 60_000;
/** M5: a pocket coin worth less than this stays (1Click can't move dust home; it isn't asked again on every start). */
const SWEEP_LEAST_USD = 1;
/**
 * Audit H1 (fix #3) with the send review's M5: what each Send's leg 1 brings over its payment (the inflow grid) stays in
 * the private balance, shown there, and pays the next Send from there (one leg). So the pocket is swept home to the Safe
 * only once it holds this much or more, D27's own bound on what rests under the pocket's single key: a sweep right after
 * every Send would pair the rest with the Send by time, and leave nothing for the next one.
 */
const POCKET_REST_USD = 100;
/** The Apis calls that are NEAR Intents' bridge's (the rest are 1Click's, through the relay when they name it). */
const BRIDGE_CALLS = new Set(["supportedTokens", "depositAddress", "recentDeposits", "withdrawalStatus"]);
/**
 * Review L7: services this phone reaches only THROUGH the relay. The relay's own check of them and this phone's failure
 * through it are one vantage, never two independent sources, so they are never "both" (an outage that holds a button):
 * a relay egress fault must not read "1Click is down. Send waits."
 */
const ONE_VANTAGE = new Set<Service>(["oneclick", "relay"]);
/**
 * `o` as it was, with each method's good answer (a promise that resolved) told to `ok` by name and arguments. Bug 8:
 * how the ledger hears that a service answered, whichever read it was. The method runs on `o` itself (its own fields).
 */
export function watched<T extends object>(o: T, ok: (method: string, args: unknown[]) => void): T {
  return new Proxy(o, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const out = v.apply(target, args);
        if (out && typeof (out as Promise<unknown>).then === "function") (out as Promise<unknown>).then(() => ok(String(key), args), () => undefined);
        return out;
      };
    },
  });
}
/** The longest the coin list waits for the core's NEAR price before it keeps its own (H1, H6). */
const NEAR_PRICE_WAIT_MS = 3_000;
/** How long the balance poll keeps the account it reads for before asking the core again. */
const POLL_ACCOUNT_MS = 5 * 60_000;
const QUOTE_TTL_MS = 60_000;
/** A plain NEAR send's plan, guessed before anything is read, to read its words ahead (H6): no coin list, any balance. */
const EMPTY_CATALOGUE = new Catalogue([], []);
const MANY_YOCTO = 10n ** 40n;
/** How long the ledger keeps the core's "ready" account.state for its own sends (H6). */
const READY_STATE_MS = 5 * 60_000;
/** A Pay quote on NEAR itself (no bridge) is the ledger's own plan, never a partner's price or a bridge's fee: pay()
 *  reads everything again and refuses a plan that now takes more than the quote said (amountIn). So it lasts ten
 *  minutes, and a review left open a minute doesn't cost a whole second read of the sheet's words before its sheet
 *  (grade 02h, H6: Send all's sheet 2.97 s at 4x CPU). A bridged one keeps QUOTE_TTL_MS. */
const NEAR_QUOTE_TTL_MS = 10 * 60_000;
const PAGE = 100;
const KEEP_MOVEMENTS = 200;
const BRIDGE_SLOW_MS = 30 * 60_000;
const CONVERT_QUOTE_TTL_MS = 30_000;
const CONVERT_STUCK_MS = 10 * 60_000;
const READ_TRIES = 30;
/** Unlisted coins whose own name is read; any more just show as unnamed. */
const UNLISTED_NAMED = 20;
/**
 * The read budget (2 Nov: FastNear and Intear answered 429 and real-money runs failed with nodes.unreachable). A balance
 * read for a screen (ledger.balances, ledger.activity) keeps the account it is for this long: whose account this is and
 * on which network don't change from one second to the next, and asking the core again each time read the whole
 * account (keys, recovery: ten reads on two nodes) before the balance. Sends and conversions still ask the core.
 */
const SHOWN_ACCOUNT_MS = 60_000;
/** D134: a screen's balance read waits at most this long for the live coin list and the core's NEAR price (its amounts
 *  come in ~300 ms, first answer; the list takes ~600 ms cold). Later than that it paints from the list kept on this
 *  device, and the live one, when it lands, says ledger.balancesChanged (keptList), so the dollars follow at once. */
const SHOWN_PAINT_MS = 800;
/** A coin sent straight to the account (D14) that this account has never held is read again only this often (a first
 *  coin shows within two minutes); one it has held is read every time. */
const UNHELD_RECHECK_MS = 2 * 60_000;
/** Once Receive has shown the NEAR address, every such coin is read every time for this long (it may be on its way). */
const EXPECTED_MS = 30 * 60_000;
/** Where the device keeps what the balance read last found (balancesSeen). */
const SEEN_KEY = "balances-seen";

// The Add (ledger.toTrading): USDC on NEAR, the float's one coin (core float-moves.ts FLOAT_USDC), from the main balance.
export const TRADING_USDC = ACCOUNT_COINS[1];
export const TRADING_DECIMALS = 6;
/** A trading movement's `to`, as MockBridge names it. */
export const TRADING_TO = "trading";
/** The Add's quote is good for 30 minutes (Security, 27 Oct); a later deadline from the core is still cut to this. */
export const ADD_QUOTE_MS = 30 * 60_000;
/** The core's answer to subwallet.private.quoteIn: the move into Private, quoted by the core itself (docs/interfaces.md). */
export interface PrivateInQuote {
  depositAddress: string;
  amountIn: string;
  minAmountOut: string;
  deadlineIso: string;
}
/** The core's answer to subwallet.float.quoteAdd (docs/interfaces.md). */
export interface AddQuote {
  /** The swap service's own time estimate in seconds, from its quote: display only ("about 20 s"). */
  etaSeconds?: number;
  depositAddress: string;
  amountIn: string;
  minAmountOut: string;
  deadlineIso: string;
}
/**
 * The quote, before the sheet: the one deposit address 1Click gives (64 hex), exactly the USDC asked for (anything
 * else is security.quote.mismatch, as the core would say after Face ID was asked), and a deadline still to come
 * (ledger.quote.expired past it). The core already read it back as the float's own, confidentially.
 */
export function checkAddQuote(q: AddQuote, wanted: bigint, at: number): AddQuote & { deadlineMs: number } {
  const ok = q && typeof q.depositAddress === "string" && /^[0-9a-f]{64}$/.test(q.depositAddress) && typeof q.amountIn === "string" && /^\d+$/.test(q.amountIn) && typeof q.minAmountOut === "string" && /^\d+$/.test(q.minAmountOut);
  if (!ok || BigInt(q.amountIn) !== wanted) throw new ProblemError(securityProblems.quoteMismatch());
  const given = typeof q.deadlineIso === "string" ? Date.parse(q.deadlineIso) : NaN;
  if (!Number.isFinite(given) || given <= at) throw new ProblemError(walletProblems.quoteExpired());
  return { ...q, deadlineMs: Math.min(given, at + ADD_QUOTE_MS) };
}
const NO_CODE = "11111111111111111111111111111111";
/**
 * What a private move in may be at most, in dollars (D132: $10,000; D27's $100 went with D128). The locks: this check on
 * each move in (by the coin's price), the quote relay's own limit on every real quote, the core signing a pocket payment only in 1Click's exact recorded
 * shape, and the core's own tally before it quotes a move in (what the pocket holds, recent moves in, and this one).
 */
const PRIVATE_CAP_USD = 10_000;
/** Security F2 / D34: the card wallet (subwallet kind "pay", Gnosis) holds at most this many dollars, at the catalogue's price. */
const CARD_CAP_USD = 250;

/** Where a far-chain transaction can be looked at, for the networks with an explorer people know. */
const EXPLORERS: Record<string, string> = {
  sol: "https://solscan.io/tx/", eth: "https://etherscan.io/tx/", base: "https://basescan.org/tx/", arb: "https://arbiscan.io/tx/",
  op: "https://optimistic.etherscan.io/tx/", pol: "https://polygonscan.com/tx/", bsc: "https://bscscan.com/tx/",
  btc: "https://mempool.space/tx/", tron: "https://tronscan.org/#/transaction/", xrp: "https://livenet.xrpl.org/transactions/",
};

/** An app that may call the ledger; the shell's own calls (no caller) count as Wallet's. */
export type Caller = Exclude<Requester, "security">;
/** D146: the apps Spending's engine may sign a Top up for (core spending.ts CALLERS, Trade's own aside). */
const SPENDING_FOR: ReadonlySet<string> = new Set(["wallet", "browser", "social", "chat", "agent"]);
const CALLERS: readonly Caller[] = ["wallet", "pay", "trade", "extension", "browser", "social", "agent", "earn", "chat"];
/**
 * Who may move money, by where it goes; every app may read (tokens, chains, balances, activity, recipientInfo,
 * depositAddress). Wallet and Pay may send anywhere. Any other app may withdraw or pay only to a wallet of its own
 * kind (subwallet.list): Trade funds its trading wallets, BNB through 1Click too. A transfer goes to a ledger balance
 * and a conversion into the person's own, never to an app's wallet, so those are Wallet's and Pay's only.
 */
const SENDS_ANYWHERE: readonly Caller[] = ["wallet", "pay"];
/** The apps that share the chain wallets (D55): no public send from the Safe into them (ownWallet). Chat (app id "chat") too. */
const CHAIN_APPS = ["trade", "browser", "social", "chat"] as const;
const MOVES: Record<string, readonly Caller[]> = {
  "ledger.transfer": ["wallet", "pay"],
  "ledger.quoteConvert": ["wallet", "pay"],
  "ledger.convert": ["wallet", "pay"],
  "ledger.privateSetup": ["wallet"],
  "ledger.privateDefault": ["wallet"],
  "ledger.quoteToPrivate": ["wallet"],
  "ledger.toPrivate": ["wallet"],
  "ledger.fromPrivate": ["wallet"],
  "ledger.oldWordsMove": ["wallet"],
  "ledger.toTrading": ["wallet", "trade"],
  "ledger.addSent": ["trade"],
  "ledger.hiddenFromRow": ["wallet"],
  "ledger.sendFee": ["wallet"],
  "ledger.sendFromSafe": ["wallet"],
  // Move and a site's top-up from Private (private-move.ts): only to the person's own wallets, so Trade asks it for Spending
  "ledger.moveFromPrivate": ["wallet", "trade"],
  // Swap in place (product decision, 5 Nov, intents-swap.ts): Home's Swap, and Trade's native coins (the HOME-SAFE-HOT spec)
  "ledger.swapQuote": ["wallet", "trade"],
  "ledger.swap": ["wallet", "trade"],
};
/** ZeroFee Chat's NEAR reads (J3 part 2): Chat's only. */
const CHAT_READS = new Set(["ledger.accountKey", "ledger.daoPolicy", "ledger.nearProfile", "ledger.daosOf"]);
/** Calls that take `confidential: true` but can't pay from Private yet: refused, never sent in public. (quotePay and pay can.) */
const PAYS_PRIVATELY = new Set(["ledger.transfer", "ledger.quoteConvert", "ledger.convert"]);
const NAMES: Record<Caller, string> = { wallet: "Wallet", pay: "Pay", trade: "Trade", extension: "Extension", browser: "Browser", social: APP_STORE_NAME, agent: "Agent", earn: "Earn", chat: "ZeroFee Chat" };

export interface LedgerDeps {
  /**
   * The core as each app sees it, forApps(core, caller): requests are signed as the app that asked, so the sheet's
   * hint names it. Storage, account.state and the hold events always go through Wallet's own ("wallet").
   */
  bridgeFor?: (caller: Caller) => Bridge;
  /** One bridge for every caller, for tests and tools. */
  bridge?: Bridge;
  /** NEAR mainnet, every read on two nodes at one block (core's RpcChain). */
  chain: Near;
  apis?: Apis;
  now?: () => number;
  /** How often balances are read again while someone listens for ledger.balancesChanged. */
  pollMs?: number;
  /** How often a bridge withdraw or a conversion is checked until it lands. */
  trackMs?: number;
  /** Which conversion routes are open (tests open them; the app uses CONVERT_ROUTES). */
  routes?: Routes;
  /**
   * The quote relay for Private (D27, apps/quotes): its base URL, the same one the core pins; calls go to <base>/v0/….
   * It relays to 1Click with the partner key, which never lives in the app. None: no Private.
   */
  privateQuotes?: string;
  /** What a sent request really did, from its receipts on two nodes (receipts.ts). */
  readCall?: ReadCall;
  /**
   * NEAR testnet, two nodes (core's RpcChain): a test account's own NEAR, shown as test NEAR worth $0 (grade 1 Nov: the
   * hub said $0.00 and "Can't read this right now" over 9.99 test NEAR). Everything else stays mainnet only.
   */
  testChain?: Near;
  /** The Move route's Safe → Private fill (safe-fill-open.ts, VITE_SAFE_FILL_OPEN): tests set it; the app reads the build's. */
  safeFillOpen?: boolean;
}

export function createLedgerService(d: LedgerDeps): Bridge {
  if (d.chain.network !== "mainnet") throw new Error("the ledger reads NEAR Intents, which runs on mainnet only");
  const bridgeFor = d.bridgeFor ?? (() => d.bridge!);
  if (!d.bridgeFor && !d.bridge) throw new Error("the ledger needs bridgeFor (or one bridge)");
  /** Wallet's own: its storage, the account, the hold events. */
  const own = bridgeFor("wallet");
  // Bug 8 (3 Nov): a service's hold (FAILING_MS) ends with ANY good answer from it, never only a balance read.
  // NEAR's: any read of its nodes here. 1Click's, the bridge's and the relay's: any of their answers.
  d = { ...d, chain: watched(d.chain, () => answered("near")) };
  const apis = watched(d.apis ?? createApis(), (method, args) => {
    if (method === "health") return void answered("relay");
    if (BRIDGE_CALLS.has(method)) return void answered("bridge");
    answered("oneclick");
    const via = method === "generateIntent" || method === "submitIntent" ? args[0] : method === "submitDeposit" ? args[3] : args[1];
    if (typeof via === "string" && via) answered("relay");
  });
  const readCall = d.readCall ?? createReadCall();
  /** Where Private's 1Click calls go: the relay's /v0, as 1Click's own paths. */
  const relayed = d.privateQuotes ? `${d.privateQuotes.replace(/\/+$/, "")}/v0` : undefined;
  const now = d.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  /** Review L5: counts every change this ledger makes or tells (a move, an event): a screen's read never joins one that
   *  began before it, here or at the nodes (chain.ts shownFresh). */
  let changes = 0;
  const changed = () => {
    changes++;
    d.chain.shownFresh?.();
  };
  const emit = (event: string, payload: unknown) => {
    changed();
    listeners.get(event)?.forEach((h) => h(payload));
  };
  const quotes = new Map<string, PayQuote>();
  /** Each quote's one approval, as planned when quoted: pay() asks the core to read its words at once (below). */
  const quoteAsks = new Map<string, TxRequest>();
  /**
   * The services this ledger saw fail lately (B28 R6), by name, cleared by their next good answer: with the relay's own
   * check (servicesNow), what a sheet says before the tap ("NEAR Intents' bridge is down. Add waits until it's back.").
   */
  const failing = new Map<Service, { fault: Fault; at: number; since: number }>();
  /** A service seen failing now: `since` stays from its first failure while it keeps failing the same way. */
  const fail = (s: Service, fault: Fault) => {
    const was = failing.get(s);
    failing.set(s, { fault, at: now(), since: was && was.fault === fault ? was.since : now() });
  };
  /** The service answered well: its hold ends now (bug 8: a refresh was the only thing that cleared it). */
  const answered = (s: Service) => void failing.delete(s);
  /** Which services each method last failed with: that method's next good answer is theirs, so it ends their hold. */
  const failedBy = new Map<string, Set<Service>>();
  const saw = <T>(service: Service, p: Promise<T>): Promise<T> => {
    p.then(() => failing.delete(service), (e: unknown) => {
      const pr = e instanceof ProblemError ? e.problem : null;
      if (pr?.service) fail(pr.service, pr.fault ?? "down");
    });
    return p;
  };

  /**
   * B28 R2 + R3: 1Click's coins and the bridge's table are two lists, each kept apart: a dead bridge never holds a
   * balance, a Send on NEAR or a move to Spending, which never use it. Each list is read live (kept CATALOGUE_TTL_MS),
   * and its last good answer is kept on this device; the app also ships one (catalogue-snapshot.ts). `any` paints from
   * what it knew last when the service is slow or down; `live` is for what moves money and must be read now.
   */
  const keptList = <T>(service: Service, key: string, ask: () => Promise<T[]>, bundled: () => Promise<T[]>, same: (a: T, b: T) => boolean, id: (r: T) => string) => {
    let fresh: { at: number; value: Promise<T[]> } | null = null;
    let last: T[] | null = null;
    const live = (): Promise<T[]> => {
      if (!fresh || now() - fresh.at > CATALOGUE_TTL_MS) {
        const value = saw(service, ask());
        const mine = { at: now(), value };
        fresh = mine;
        value.then((rows) => {
          const changed = last !== null && last !== rows;
          last = rows;
          void store(key, JSON.stringify(rows)).catch(() => undefined);
          // a screen that painted from a kept list reads the live one now (its prices and coins)
          if (changed && servedKept) emit("ledger.balancesChanged", { parts: ["safe"] });
          servedKept = false;
        }, () => {
          // a service that failed is asked again after FAILED_AGAIN_MS, not on every read meanwhile (review, Low)
          if (fresh === mine) fresh = { at: now() - CATALOGUE_TTL_MS + FAILED_AGAIN_MS, value };
        });
      }
      return fresh.value;
    };
    let servedKept = false;
    const kept = async (): Promise<T[]> => {
      if (last) return last;
      try {
        const v = JSON.parse((await stored(key)) ?? "null");
        // Security review H2: the device's copy is only as good as what the app shipped. A row the snapshot doesn't have,
        // or has otherwise (another decimals, chain or id), is dropped: a written-over copy can't change what is signed.
        if (Array.isArray(v) && v.length > 0) {
          const shipped = new Map((await bundled()).map((r) => [id(r), r]));
          const trusted = (v as T[]).filter((r) => r && typeof r === "object" && shipped.has(id(r)) && same(r, shipped.get(id(r))!));
          if (trusted.length > 0) return (last = trusted);
        }
      } catch {
        // a damaged copy is no copy
      }
      return (last = await bundled());
    };
    /** The live list, or (slow past FIRST_PAINT_MS, or failed) the one this device last kept, else the app's own. */
    const any = async (paintMs = FIRST_PAINT_MS): Promise<{ rows: T[]; live: boolean }> => {
      const asked = live();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const slow = new Promise<"slow">((r) => (timer = setTimeout(r, paintMs, "slow")));
      const first = await Promise.race([asked.then((rows) => ({ rows }), () => "failed" as const), slow]).finally(() => clearTimeout(timer));
      if (typeof first === "object") return { rows: first.rows, live: true };
      servedKept = true;
      return { rows: await kept(), live: false };
    };
    return { live, any, kept };
  };
  const snapshot = () => import("./catalogue-snapshot.ts");
  const coinList = keptList("oneclick", COINS_KEY, () => apis.tokens(), async () => (await snapshot()).SNAPSHOT_TOKENS,
    (a, b) => a.decimals === b.decimals && a.blockchain === b.blockchain && a.symbol === b.symbol && (a.contractAddress ?? null) === (b.contractAddress ?? null), (r) => String(r.assetId));
  const bridgeList = keptList("bridge", BRIDGE_KEY, () => apis.supportedTokens(), async () => (await snapshot()).SNAPSHOT_BRIDGE,
    (a, b) => a.min_deposit_amount === b.min_deposit_amount && a.min_withdrawal_amount === b.min_withdrawal_amount && a.withdrawal_fee === b.withdrawal_fee, (r) => `${r.intents_token_id} ${r.defuse_asset_identifier}`);
  /** One Catalogue per pair of lists and price state (the poll reads it every tick). */
  const built = new WeakMap<object, WeakMap<object, [Catalogue?, Catalogue?]>>();
  const NO_ROWS: BridgeToken[] = [];

  /**
   * The coin list a path needs, and no more (B28 R2). `bridge`: the bridge's table too, "any" (Receive's list of networks:
   * the table last read here, kept on the device, or the app's own; the bridge itself is never asked for it, so Welcome and
   * set-up never call the bridge) or "live" (a deposit address, a send to another chain: its minimums and fees read now).
   * `live`: prices read now (a cap in dollars); never a kept price for a check that lets money move.
   */
  const listed = async (o: { live?: boolean; bridge?: "any" | "live"; paintMs?: number } = {}): Promise<Catalogue> => {
    const [coins, rows] = await Promise.all([
      o.live ? coinList.live().then((r) => ({ rows: r, live: true })) : coinList.any(o.paintMs),
      o.bridge === "live" ? bridgeList.live() : o.bridge === "any" ? bridgeList.kept() : Promise.resolve(NO_ROWS),
    ]);
    const byRows = built.get(coins.rows) ?? new WeakMap<object, [Catalogue?, Catalogue?]>();
    built.set(coins.rows, byRows);
    const pair = byRows.get(rows) ?? [];
    byRows.set(rows, pair);
    const at = coins.live ? 1 : 0;
    if (!pair[at]) {
      // the coins a Safe read may name at the relay's proxy (review L1): listed coins only
      proxyTokens(coins.rows.map((r) => String(r.assetId)));
      const cat = new Catalogue(coins.rows, rows);
      cat.pricesLive = coins.live;
      pair[at] = cat;
    }
    return pair[at]!;
  };

  const core = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const r = await own.call<T>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };

  /**
   * The coin list with NEAR at the core's one price snapshot (grade 02h, H1: Wallet $30.40, Send's review $30.41 and the
   * sheet $30.34 for one 7.1049 NEAR). The core keeps the snapshot a minute and prices its sheets with it, so every
   * balance, the coin list Send's review reads (ledger.tokens) and the sheet say the same dollars for the same amount.
   * Asked beside the list, never after it. A core that has no price (or doesn't answer) leaves the list's own.
   */
  const catalogue = async (o: { live?: boolean; bridge?: "any" | "live"; paintMs?: number } = {}): Promise<Catalogue> => {
    // At most NEAR_PRICE_WAIT_MS for the core's answer: a slow price read never holds a balance or a Send (speed, H6).
    const price = core<{ usd: number | null }>("account.nearPrice").then((r) => r?.usd ?? null, () => null);
    const [cat, near] = await Promise.all([listed(o), Promise.race([price, new Promise<null>((r) => { const t = setTimeout(r, o.paintMs ?? NEAR_PRICE_WAIT_MS, null); void price.finally(() => clearTimeout(t)); })])]);
    return cat.withPrice(WRAPPED_NEAR, near);
  };

  /** The test network's nodes when `account` lives there and this ledger has them; null for a mainnet account. */
  const testOf = (account?: AccountInfo | null): Near | null =>
    d.testChain && account && account.network === d.testChain.network && account.network !== "mainnet" ? d.testChain : null;

  /** This device's account, on mainnet (or, with `test`, on the test network this ledger reads). `ready` also requires
   *  the backup words to be confirmed (Security's rule). */
  let readyState: { at: number; state: { stage: string; account?: AccountInfo } } | null = null;
  const myAccount = async (ready: boolean, test = false): Promise<AccountInfo> => {
    // A "ready" answer is kept READY_STATE_MS (speed, grade 02h, H6: account.state reads the account, its keys and its
    // recovery on two nodes, a whole round trip before every quote and every pay). Only "ready" is kept: any other stage
    // is asked again. The core checks the key and the account again before any sheet, so nothing is signed on it.
    const kept = readyState && now() - readyState.at < READY_STATE_MS ? readyState.state : null;
    const { stage, account } = kept ?? (await core<{ stage: string; account?: AccountInfo }>("account.state"));
    if (!kept && stage === "ready" && account) readyState = { at: now(), state: { stage, account } };
    if (stage === "none" || !account) throw new ProblemError(securityProblems.accountNone());
    if (account.network !== "mainnet" && !(test && testOf(account))) throw new ProblemError(walletProblems.testAccount());
    if (ready && stage === "needs-backup") throw new ProblemError(securityProblems.backupNeeded());
    if (ready && stage !== "ready") throw new ProblemError(securityProblems.notReady());
    return account;
  };

  /** NEAR on the account that can be spent: storage and the fee reserve left out. With `steps`, what those steps can
   *  take: a request carrying more gas than a plain Send keeps its own up-front gas back instead. */
  const spendable = (a: ChainAccount | null, steps?: Pick<TxRequest, "actions" | "then">[]): bigint => {
    if (!a) return 0n;
    const own = steps ? upfrontYocto(steps) : 0n;
    const free = a.balanceYocto - a.storageBytes * YOCTO_PER_BYTE - (own > FEE_RESERVE_YOCTO ? own : FEE_RESERVE_YOCTO);
    return free > 0n ? free : 0n;
  };

  /** The reads a balance takes: on two nodes at one agreed block, or a screen's (D134: first answer, never for money). */
  const pinned = (block: Block): ShownReads => ({ account: (id) => d.chain.account(id, block), view: (c, m, a) => d.chain.view(c, m, a, block) });

  /** Every coin the account holds inside intents.near, page by page. */
  const ledgerTokenIds = async (accountId: string, reads: ShownReads): Promise<string[]> => {
    const ids: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await reads.view(INTENTS.account, "mt_tokens_for_owner", { account_id: accountId, from_index: String(from), limit: PAGE });
      if (!Array.isArray(page)) throw new Error("mt_tokens_for_owner gave no list");
      for (const t of page) if (typeof t?.token_id === "string") ids.push(t.token_id);
      if (page.length < PAGE) return ids;
    }
  };

  const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);

  /**
   * A test account: its own NEAR on testnet, named so. Never a ledger row. Valued at NEAR's own price as a sample, the
   * one price Protection's limits and the sheets use too (grade 02f, F3/E3: $0.00 here, $4.25 in Protection for one
   * coin). Wallet's test line says so once (test-note.ts). No price read: no dollar figure, never a made-up $0.
   */
  async function testBalances(accountId: string): Promise<Balance[]> {
    const t = d.testChain!;
    const [account, cat] = await Promise.all([t.commonBlock().then((b) => t.account(accountId, b)), catalogue().catch(() => null)]);
    const near = spendable(account);
    if (near <= 0n) return [];
    const amount = fromUnits(near, NEAR_DECIMALS);
    const usd = usdOf(amount, cat?.coin(WRAPPED_NEAR)?.priceUsd, true);
    return [{ tokenId: NATIVE_NEAR, symbol: "NEAR", name: "Test NEAR", icon: "near", chain: "near", amount, ...(usd !== undefined ? { usd } : {}), bridged: false, held: "account", listed: true, test: true }];
  }

  /** `shown: true` (D134): for a screen only (Home, the total): first answer from any node. Without it, two nodes agree at
   *  one block, as every check that decides money needs (Spending's Top up, the vault gate, Pay, Trade's funding). */
  const balances = (p: Record<string, unknown> = {}): Promise<Balance[]> => balancesOf(undefined, p.shown === true);

  /**
   * D134, item 4: whose Safe a screen shows, from the core's own vault (account.id: no network), so the balance read
   * starts at unlock beside account.state, never after it. A core without account.id: the account a screen's read is for.
   */
  let quick: { at: number; account: Promise<AccountInfo> } | null = null;
  const quickAccount = async (): Promise<AccountInfo> => {
    if (!quick || now() - quick.at >= SHOWN_ACCOUNT_MS) {
      const at = now();
      const account = own.call<{ accountId: string; network: AccountInfo["network"] } | null>("account.id").then((r) => {
        const a = "ok" in r ? r.ok : null;
        return a && typeof a.accountId === "string" && a.accountId ? ({ accountId: a.accountId, network: a.network, keys: [], recovery: null } as AccountInfo) : shownAccount(true);
      });
      const mine = { at, account };
      quick = mine;
      account.catch(() => quick === mine && (quick = null));
    }
    const account = await quick.account;
    if (account.network !== "mainnet" && !testOf(account)) throw new ProblemError(walletProblems.testAccount());
    // D139: the Safe's own reads (and only its) may use the relay's FastNEAR proxy (core chain.ts safeOnly)
    if (account.network === "mainnet") proxySafe(account.accountId);
    return account;
  };

  /** The account a screen's read is for (SHOWN_ACCOUNT_MS): one ask of the core shared by every read in that time. */
  let shown: { at: number; account: Promise<AccountInfo> } | null = null;
  const shownAccount = async (test: boolean): Promise<AccountInfo> => {
    if (!shown || now() - shown.at >= SHOWN_ACCOUNT_MS) {
      const at = now();
      const account = core<{ stage: string; account?: AccountInfo }>("account.state").then(({ stage, account }) => {
        if (stage === "none" || !account) throw new ProblemError(securityProblems.accountNone());
        // A "ready" answer serves this ledger's own sends for a moment too (myAccount, H6).
        if (stage === "ready" && (!readyState || readyState.at < at)) readyState = { at, state: { stage, account } };
        return account;
      });
      const mine = { at, account };
      shown = mine;
      account.catch(() => shown === mine && (shown = null));
    }
    const account = await shown.account;
    if (account.network !== "mainnet" && !(test && testOf(account))) throw new ProblemError(walletProblems.testAccount());
    return account;
  };

  /**
   * What the balance read last found for this account, kept on the device: the coins it holds inside intents.near (the
   * next read asks their amounts beside the list, one round trip, not two) and the coins straight on the account it has
   * ever held (only those are read every time; see UNHELD_RECHECK_MS). Another account's, or none: nothing is assumed.
   */
  type Seen = { accountId: string; ledger: string[]; account: string[] };
  let seenKept: Seen | null = null;
  const balancesSeen = async (accountId: string): Promise<Seen> => {
    if (seenKept?.accountId !== accountId) {
      let v: Partial<Seen> | null = null;
      try {
        v = JSON.parse((await stored(SEEN_KEY)) ?? "null");
      } catch {
        v = null;
      }
      const list = (x: unknown) => (Array.isArray(x) ? x.filter((t): t is string => typeof t === "string") : []);
      seenKept = v?.accountId === accountId ? { accountId, ledger: list(v.ledger), account: list(v.account).filter((t) => ACCOUNT_COINS.includes(t)) } : { accountId, ledger: [], account: [] };
    }
    return seenKept;
  };
  const keepSeen = (next: Seen) => {
    const was = seenKept;
    seenKept = next;
    if (was && was.accountId === next.accountId && was.ledger.join() === next.ledger.join() && was.account.join() === next.account.join()) return;
    void store(SEEN_KEY, JSON.stringify(next)).catch(() => undefined);
  };
  /** When the coins straight on the account that it never held were last read, per account (this page's life). */
  const unheldReadAt = new Map<string, number>();
  const shownUnheldAt = new Map<string, number>();
  /** Receive showed the NEAR address: until then every coin straight on the account is read each time. */
  let expectedUntil = 0;
  /** ft_metadata of coins 1Click doesn't list, as two nodes answered it: a coin's name and decimals never change. */
  const agreedMetadata = new Map<string, Promise<{ symbol: string; decimals: number } | null>>();
  /** A screen's (first answer) names are kept apart from the two nodes' (D134): a figure only one node gave never stands
   *  in for an agreed one. */
  const shownMetadata = new Map<string, Promise<{ symbol: string; decimals: number } | null>>();
  const metadataOf = (contract: string, reads: ShownReads, shown: boolean) => {
    const metadata = shown ? shownMetadata : agreedMetadata;
    let m = metadata.get(contract);
    if (!m) {
      const asked = reads.view(contract, "ft_metadata", {}).then(cleanMetadata);
      metadata.set(contract, asked);
      // A read that failed is no answer: asked again next time.
      asked.catch(() => metadata.get(contract) === asked && metadata.delete(contract));
      m = asked;
    }
    return m.catch(() => null);
  };

  /** `known`: the account as the poll last read it (grade 01c, P12: every 20 s tick read the whole account state again,
   *  keys and all, before its balance). Without it, the account a screen's read is for (shownAccount). */
  async function balancesOf(known?: AccountInfo, shown = false): Promise<Balance[]> {
    if (known && known.network !== "mainnet" && !testOf(known)) throw new ProblemError(walletProblems.testAccount());
    const me = known ?? (await (shown ? quickAccount() : shownAccount(true)));
    if (testOf(me)) return testBalances(me.accountId);
    // D134: a screen's read takes the first node to answer (no agreed head first, no second node). One per account at a
    // time: Home's parts and the poll share it.
    const fast = shown ? d.chain.shown?.() : undefined;
    if (fast) {
      const key = `${me.accountId} shown ${changes}`;
      const had = reading.get(key);
      const rows = had?.rows ?? readBalances(me.accountId, catalogue({ paintMs: SHOWN_PAINT_MS }), fast, true).then((r) => agreedOrLater(me.accountId, r, fast));
      if (!had) {
        const mine = { hash: "shown", rows };
        reading.set(key, mine);
        void rows.catch(() => undefined).finally(() => reading.get(key) === mine && reading.delete(key));
      }
      return (await rows).map((r) => ({ ...r }));
    }
    const [cat, block] = await Promise.all([catalogue(), d.chain.commonBlock()]);
    // One read per account per agreed block at a time: every caller while it is under way (Home's parts, Spending's Top
    // up, the poll) gets the same rows, from the same reads on the same two nodes. Once read, the next caller reads again
    // (at the same block NodePace still has each answer: nothing goes to the nodes).
    const had = reading.get(me.accountId);
    // each new read of the Safe goes past the Safe watch once (money others sent straight to it: received.ts): an agreed
    // read only, never one node's word (a screen's read is never watched)
    const rows = had?.hash === block.hash ? had.rows : readBalances(me.accountId, Promise.resolve(cat), pinned(block), false).then((r) => (watchSafe(me.accountId, r), r.map((x) => ({ ...x, agreed: true as const }))));
    if (had?.rows !== rows) {
      const mine = { hash: block.hash, rows };
      reading.set(me.accountId, mine);
      void rows.catch(() => undefined).finally(() => reading.get(me.accountId) === mine && reading.delete(me.accountId));
    }
    return (await rows).map((r) => ({ ...r }));
  }
  const reading = new Map<string, { hash: string; rows: Promise<Balance[]> }>();
  /** The Safe watch, one read after another (received.ts safeWatch); never in the way of the read itself. */
  let safeWatching: Promise<unknown> = Promise.resolve();
  const watchSafe = (accountId: string, rows: Balance[]) => {
    safeWatching = safeWatching.then(() => receivedCode()).then((m) => m.safeWatch(receivedDeps, accountId, rows)).catch(() => undefined);
  };
  /**
   * Product decision, 3 Nov: one node's answer may only make a figure go up or confirm it. A screen's rows are marked `agreed` only
   * when THIS read was confirmed: a second operator gave each of its reads the same answer (review M1: rows that matched
   * the last confirmed ones were marked agreed while the second operator now said less). A confirmation still under way
   * says how it ended: `ledger.balancesAgreed` (Home settles it on two nodes at one block) or `ledger.balancesUnconfirmed`.
   * `toldAgreed` only keeps the same confirmed rows from being announced twice.
   */
  const toldAgreed = new Map<string, string>();
  const rowsKey = (rows: Balance[]) => JSON.stringify(rows.map(({ tokenId, amount, held }) => [tokenId, amount, held]));
  const agreedOrLater = async (accountId: string, rows: Balance[], reads: ShownReads): Promise<Balance[]> => {
    const key = rowsKey(rows);
    const confirm = reads.agreed ? reads.agreed().catch(() => false) : Promise.resolve(false);
    // already settled (its reads shared from a moment ago): said now; else when it is
    const now = await Promise.race([confirm, new Promise<null>((r) => setTimeout(r, 0, null))]);
    const told = (ok: boolean) => {
      if (!ok) return emit("ledger.balancesUnconfirmed", { parts: ["safe"] });
      if (toldAgreed.get(accountId) === key) return;
      toldAgreed.set(accountId, key);
      emit("ledger.balancesAgreed", { parts: ["safe"] });
    };
    if (now === null) {
      void confirm.then(told);
      return rows;
    }
    told(now);
    return now ? rows.map((r) => ({ ...r, agreed: true as const })) : rows;
  };

  /**
   * Every coin the account holds, at one block on two nodes: inside intents.near (its list, and every amount in one
   * mt_batch_balance_of), its own NEAR, and the coins sent straight to it. The amounts of the coins last seen are asked
   * beside the list; a list that changed is asked again for exactly what it lists. A coin straight on the account that it
   * has never held is read at most every UNHELD_RECHECK_MS (on the first read of the page, then again): it can't hold one
   * without a first transfer, and that first one shows within the recheck (at once while Receive's address is fresh).
   */
  async function readBalances(accountId: string, catP: Promise<Catalogue>, reads: ShownReads, shown: boolean): Promise<Balance[]> {
    void catP.catch(() => undefined);
    const seen = await balancesSeen(accountId);
    const listP = ledgerTokenIds(accountId, reads);
    const batch = (ids: string[]) => (ids.length ? reads.view(INTENTS.account, "mt_batch_balance_of", { account_id: accountId, token_ids: ids }) : Promise.resolve([]));
    const guessP = batch(seen.ledger);
    void guessP.catch(() => undefined);
    // One node's word (a screen's read) never spares a read that decides money: the screen keeps its own recheck clock, so a
    // node that said "none" can't make the next agreed read skip a coin the account holds.
    const readAt = shown ? shownUnheldAt : unheldReadAt;
    const recheck = now() - (readAt.get(accountId) ?? -Infinity) >= UNHELD_RECHECK_MS || now() < expectedUntil;
    const coins = ACCOUNT_COINS.filter((id) => recheck || seen.account.includes(id));
    const othersP = Promise.all([reads.account(accountId), Promise.all(coins.map((id) => reads.view(nep141Contract(id)!, "ft_balance_of", { account_id: accountId })))]);
    void othersP.catch(() => undefined);
    const held = await listP;
    const amounts = held.join() === seen.ledger.join() ? await guessP : await batch(held);
    const [account, read] = await othersP;
    const cat = await catP;
    if (!Array.isArray(amounts) || amounts.length !== held.length) throw new Error("mt_batch_balance_of gave a different count");
    const onAccount = ACCOUNT_COINS.map((id) => (coins.includes(id) ? read[coins.indexOf(id)] : "0"));
    if (recheck) readAt.set(accountId, now());
    keepSeen({ accountId, ledger: held, account: ACCOUNT_COINS.filter((id, i) => seen.account.includes(id) || (units(onAccount[i]) ?? 0n) > 0n) });

    const rows: Balance[] = [];
    let named = 0;
    const add = async (tokenId: string, raw: bigint, where: Balance["held"]) => {
      if (raw <= 0n) return;
      const coin = cat.coin(tokenId);
      if (coin) {
        const amount = fromUnits(raw, coin.decimals);
        rows.push({ tokenId, symbol: coin.symbol, name: coin.name ?? coin.symbol, icon: coin.icon ?? coin.symbol.toLowerCase(), chain: coin.chain, amount, usd: usdOf(amount, coin.priceUsd, true), bridged: coin.bridged, held: where, listed: true, ...(cat.priceLive(tokenId) ? {} : { priceKept: true as const }) });
        return;
      }
      // A coin 1Click doesn't list: named only by its own contract (read on two nodes), never priced, never a logo.
      // Anyone can send any coin, so one that won't answer is just unnamed, and only the first few are asked at all.
      const contract = nep141Contract(tokenId);
      const meta = contract && named++ < UNLISTED_NAMED ? await metadataOf(contract, reads, shown) : null;
      rows.push({
        tokenId,
        symbol: meta?.symbol ?? "?",
        name: "An unnamed coin",
        icon: "",
        chain: "near",
        amount: fromUnits(raw, meta?.decimals ?? 0),
        bridged: routeOf(tokenId) !== "near",
        held: where,
        listed: false,
      });
    };
    const ledgerRows = held.map((tokenId, i) => {
      const raw = units(amounts[i]);
      if (raw === null) throw new Error(`mt_batch_balance_of gave ${JSON.stringify(amounts[i])}`);
      return add(tokenId, raw, "ledger");
    });
    const near = spendable(account);
    if (near > 0n) {
      const amount = fromUnits(near, NEAR_DECIMALS);
      rows.push({ tokenId: NATIVE_NEAR, symbol: "NEAR", name: "NEAR", icon: "near", chain: "near", amount, usd: usdOf(amount, cat.coin(WRAPPED_NEAR)?.priceUsd, true), bridged: false, held: "account", listed: true, ...(cat.priceLive(WRAPPED_NEAR) ? {} : { priceKept: true as const }) });
    }
    await Promise.all([...ledgerRows, ...ACCOUNT_COINS.map((id, i) => add(id, units(onAccount[i]) ?? 0n, "account"))]);
    return rows.sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0) || a.symbol.localeCompare(b.symbol));
  }

  async function depositAddress(p: Record<string, unknown>): Promise<DepositAddress> {
    // A test account (grade 1 Nov, D7: Add money dead-ended on an error): its own NEAR address, for test NEAR only.
    // Every other network stays refused (NEAR Intents is mainnet only).
    if (d.testChain && String(p.chain ?? "near") === "near" && (!p.token || p.token === NATIVE_NEAR)) {
      const { stage, account } = await core<{ stage: string; account?: AccountInfo }>("account.state");
      if (account && account.network === d.testChain.network && account.network !== "mainnet") {
        if (stage !== "ready") throw new ProblemError(stage === "needs-backup" ? securityProblems.backupNeeded() : securityProblems.notReady());
        return { address: account.accountId, chain: "near", token: NATIVE_NEAR, minAmount: "0", qr: account.accountId, note: "Test NEAR only. Never send real coins here." };
      }
    }
    const { accountId } = await myAccount(true);
    // NEAR's address is the account itself: no bridge. Any other network's is the bridge's, with its minimums read now.
    const cat = await catalogue(p.chain === "near" || p.chain === undefined ? {} : { bridge: "live" });
    const net = cat.network(String(p.chain ?? ""));
    if (!net) throw new ProblemError(walletProblems.chainUnsupported(String(p.chain ?? "")));
    const asked = typeof p.token === "string" && p.token ? p.token : undefined;

    if (!net.bridgeChain) {
      // NEAR: coins go to the account itself, by name (D14).
      const token = asked ?? NATIVE_NEAR;
      const coin = cat.coin(token);
      if (token !== NATIVE_NEAR && !(coin?.chain === "near" && coin.route === "near")) throw new ProblemError(walletProblems.tokenUnsupported(coin?.symbol, "NEAR"));
      // Any NEAR coin may come to this address now: each is read every time for a while, held before or not.
      expectedUntil = now() + EXPECTED_MS;
      return { address: accountId, chain: net.id, token, minAmount: "0", qr: accountId, note: "Send from any NEAR wallet or exchange." };
    }

    const coin = cat.coin(asked ?? net.nativeTokenId);
    if (!coin?.bridge || coin.chain !== net.id) throw new ProblemError(walletProblems.tokenUnsupported(coin?.symbol, net.name));
    let found: BridgeAddress;
    try {
      found = await askAddress(accountId, net.bridgeChain);
    } catch (e) {
      if (e instanceof BridgeRefused) throw new ProblemError(walletProblems.chainUnsupported(`${net.name}: ${e.message}`));
      throw e;
    }
    // What the bridge answered is checked before it is kept or shown (audit W-4): for the network asked about, a real
    // address on it (its checksum where it has one), and a plain memo when there is one.
    const memoOk = found.memo === undefined || /^[A-Za-z0-9_-]{1,64}$/.test(found.memo);
    if (found.chain !== net.bridgeChain || !validReceiveAddress(net.id, found.address) || !memoOk) throw new ProblemError(walletProblems.depositAddressInvalid(net.name));
    await pin(`deposit-address:${accountId}:${net.bridgeChain}`, found, net.name);
    return {
      address: found.address,
      ...(found.memo ? { memo: found.memo } : {}),
      chain: net.id,
      token: coin.assetId,
      minAmount: fromUnits(coin.bridge.minDeposit, coin.decimals),
      qr: found.address,
      note: found.memo ? `Send only on ${net.name}, and always include the memo.` : `Send only on ${net.name}.`,
    };
  }

  /** Simple mode first; networks that need a memo (Stellar) say so, and are asked again in memo mode. */
  const askAddress = async (accountId: string, bridgeChain: string): Promise<BridgeAddress> => {
    try {
      return await apis.depositAddress(accountId, bridgeChain, "SIMPLE");
    } catch (e) {
      if (e instanceof BridgeRefused && /memo/i.test(e.message)) return apis.depositAddress(accountId, bridgeChain, "MEMO");
      throw e;
    }
  };

  /** Small data kept on this device only (device.store). Null when there is no storage here. */
  const stored = async (key: string): Promise<string | null | undefined> => {
    const r = await own.call<{ value: string | null }>("device.store.get", { key });
    return "problem" in r ? undefined : r.ok.value;
  };
  const store = (key: string, value: string) => own.call("device.store.set", { key, value });
  /** Lists kept on the device change one at a time: two updates read together would otherwise lose one. */
  let writing: Promise<unknown> = Promise.resolve();
  const serially = <T>(job: () => Promise<T>): Promise<T> => {
    const next = writing.then(job);
    writing = next.catch(() => {});
    return next;
  };

  /**
   * The first address shown for a network is kept on the device; a different one later is never shown. Without device
   * storage (or when it won't keep the address) nothing is shown either: an address that can't be checked later is never
   * shown now (audit W-4: fails closed).
   */
  const pin = async (key: string, found: BridgeAddress, chainName: string) => {
    const seen = await stored(key);
    if (seen === undefined) throw new ProblemError(walletProblems.depositUnchecked());
    const shown = JSON.stringify({ address: found.address, memo: found.memo ?? null });
    if (seen === null) {
      const kept = await store(key, shown);
      if ("problem" in kept) throw new ProblemError(walletProblems.depositUnchecked());
      return;
    }
    if (seen !== shown) throw new ProblemError(walletProblems.addressChanged(chainName));
  };

  async function recipientInfo(p: Record<string, unknown>): Promise<RecipientInfo> {
    const accountId = String(p.accountId ?? "").trim();
    if (!ACCOUNT_ID.test(accountId)) throw new ProblemError(walletProblems.recipientInvalid());
    // A test account's receiver lives on the test network: asking mainnet said "no account called guest-book.testnet"
    // (grade 01c, P2). There is no NEAR Intents there, so no ledger balance either.
    const test = d.testChain ? testOf((await core<{ account?: AccountInfo }>("account.state")).account) : null;
    if (test) {
      const found = await test.account(accountId, await test.commonBlock());
      const code = codeOf(found);
      return { exists: found !== null, hasLedgerBalance: false, code: code && code !== NO_CODE ? code : null };
    }
    const block = await d.chain.commonBlock();
    const [account, tokens] = await Promise.all([
      d.chain.account(accountId, block),
      d.chain.view(INTENTS.account, "mt_tokens_for_owner", { account_id: accountId, limit: 1 }, block),
    ]);
    const code = codeOf(account);
    return { exists: account !== null, hasLedgerBalance: Array.isArray(tokens) && tokens.length > 0, code: code && code !== NO_CODE ? code : null };
  }

  // ZeroFee Chat's NEAR reads (J3 part 2, core chat-reads.ts): reads only, two nodes at one block, each on the network
  // the name lives on (a `.testnet` name on the test network, when this ledger reads it). Nothing here signs.
  const chainFor = (accountId: string): Near | null => (!accountId.endsWith(".testnet") ? d.chain : d.testChain ?? null);
  /** Each Chat read once per 5 minutes per question, one in flight at a time (diff review M-A). */
  const chatKept = new Map<string, { at: number; answer: Promise<unknown> }>();
  const keptRead = <T,>(key: string, read: () => Promise<T>): Promise<T> => {
    const had = chatKept.get(key);
    if (had && now() - had.at < 5 * 60_000) return had.answer as Promise<T>;
    const answer = read();
    chatKept.set(key, { at: now(), answer });
    if (chatKept.size > 500) chatKept.delete(chatKept.keys().next().value!);
    answer.catch(() => chatKept.delete(key));
    return answer;
  };
  const nameArg = (p: Record<string, unknown>, key: string): string => {
    const v = String(p[key] ?? "").trim();
    if (!ACCOUNT_ID.test(v)) throw new ProblemError(walletProblems.recipientInvalid());
    return v;
  };
  /** Is this key on the account now, able to sign for it (a Chat name counts only while it is)? null: can't say. */
  async function accountKey(p: Record<string, unknown>): Promise<{ onAccount: boolean | null }> {
    const accountId = nameArg(p, "accountId");
    const chain = chainFor(accountId);
    if (!chain || typeof p.publicKey !== "string") return { onAccount: null };
    const key = p.publicKey;
    return { onAccount: await keptRead(`key|${accountId}|${key}`, async () => (await chatReads()).keyOnAccount(chain, accountId, key)).catch(() => null) };
  }
  async function daoPolicyRead(p: Record<string, unknown>): Promise<{ policy: { roles: DaoRole[]; capped: boolean } | null }> {
    const dao = nameArg(p, "dao");
    const chain = chainFor(dao);
    if (!chain) throw new ProblemError(walletProblems.nodesDisagree());
    return { policy: await keptRead(`dao|${dao}`, async () => (await chatReads()).daoPolicy(chain, dao)) };
  }
  async function profileRead(p: Record<string, unknown>): Promise<NearProfile> {
    const accountId = nameArg(p, "accountId");
    const chain = chainFor(accountId);
    return chain ? keptRead(`profile|${accountId}`, async () => (await chatReads()).nearProfile(chain, accountId)).catch(() => ({})) : {};
  }
  async function daosRead(p: Record<string, unknown>): Promise<{ daos: { dao: string; roles: string[] }[] }> {
    const accountId = nameArg(p, "accountId");
    const chain = chainFor(accountId);
    const opened = Array.isArray(p.opened) ? p.opened.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
    return { daos: chain ? await keptRead(`daos|${accountId}|${[...opened].sort().join(",")}`, async () => (await chatReads()).daosOf(chain, accountId, opened)) : [] };
  }

  // Sending the same coin out.

  /** Read everything a send needs at one block on two nodes, then plan it (send.ts). Nothing is signed here. */
  async function prepare(tokenId: string, amount: string, to: Payee, memo: string | undefined, why: (symbol: string) => string, msg?: string, warmFor?: Caller): Promise<{ plan: SendPlan; accountId: string; cat: Catalogue; canChain: boolean }> {
    const me = await myAccount(true, true);
    const { accountId } = me;
    // A test account sends its own test NEAR to a NEAR account (NEAR, or its listed coin wNEAR, which planSend pays as
    // plain NEAR), read and planned on its own network (grade 01c, P2); nothing else exists there (no NEAR Intents, no
    // wrap.near, no bridges), so nothing else is read there either.
    const test = testOf(me);
    if (test && ((tokenId !== NATIVE_NEAR && tokenId !== WRAPPED_NEAR) || to.kind !== "chain" || to.chain !== "near")) throw new ProblemError(walletProblems.testAccount());
    const chain = test ?? d.chain;
    // Speed (grade 02h, H6): a plain NEAR send's one approval doesn't depend on what is read below (only whether it
    // fits): the core is asked to read its words now (tx.describe, reads only), so its reads go out beside this ledger's,
    // at the same agreed block, and the sheet's own read of them finds them shared. Only when `warmFor` says who asks.
    if (warmFor && (tokenId === NATIVE_NEAR || tokenId === WRAPPED_NEAR) && to.kind === "chain" && to.chain === "near" && ACCOUNT_ID.test(to.address.trim())) {
      try {
        const guess = planSend({ cat: EMPTY_CATALOGUE, me: accountId, tokenId: NATIVE_NEAR, amount, to, memo, msg, nearSpendable: MANY_YOCTO, held: { ledger: 0n, account: MANY_YOCTO }, why: why("NEAR") });
        if (guess.steps.length === 1) void bridgeFor(warmFor).call("tx.describe", { request: guess.steps[0] }).catch(() => undefined);
      } catch {
        // Nothing to read ahead: the plan below says why.
      }
    }
    // A send to another chain goes through the bridge, at its fee and minimum read now; on NEAR the bridge isn't asked.
    const [cat, block] = await Promise.all([catalogue(to.kind === "chain" && to.chain !== "near" ? { bridge: "live" } : {}), chain.commonBlock()]);
    const contract = nep141Contract(tokenId);
    const [account, inLedger, onAccount] = await Promise.all([
      chain.account(accountId, block),
      tokenId === NATIVE_NEAR || test ? Promise.resolve("0") : chain.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: tokenId }, block),
      contract && ACCOUNT_COINS.includes(tokenId) && !test ? chain.view(contract, "ft_balance_of", { account_id: accountId }, block) : Promise.resolve("0"),
    ]);
    const nearSpendable = spendable(account);
    let storage: { registered: boolean; yocto: string } | undefined;
    if (to.kind === "chain" && to.chain === "near" && contract && tokenId !== WRAPPED_NEAR && ACCOUNT_ID.test(to.address.trim())) {
      const [balance, bounds] = await Promise.all([
        chain.view(contract, "storage_balance_of", { account_id: to.address.trim() }, block),
        chain.view(contract, "storage_balance_bounds", {}, block),
      ]);
      const min = (bounds as { min?: unknown } | null)?.min;
      storage = { registered: balance !== null, yocto: typeof min === "string" && /^\d+$/.test(min) ? min : WRAP_STORAGE_YOCTO };
    }
    const symbol = tokenId === NATIVE_NEAR ? "NEAR" : cat.coin(tokenId)?.symbol ?? "coins";
    const planned = planSend({
      cat, me: accountId, tokenId, amount, to, memo, msg, storage, nearSpendable,
      held: { ledger: units(inLedger) ?? 0n, account: tokenId === NATIVE_NEAR ? nearSpendable : units(onAccount) ?? 0n },
      why: why(symbol),
    });
    // Test NEAR is valued at NEAR's own price, the one sample price Wallet, Protection and the sheets use (grade 02f, E3).
    const plan = planned;
    // NEAR from the account: what leaves it must leave room for the request's own gas while it's out (a wrap carries
    // more than a plain Send), or the chain refuses it after the sheet.
    if (tokenId === NATIVE_NEAR && plan.leaves > spendable(account, plan.steps)) throw new ProblemError(walletProblems.balanceLow(fromUnits(plan.leaves, NEAR_DECIMALS), "NEAR"));
    // The account contract's current version runs several receivers under one approval (execute_many).
    return { plan, accountId, cat, canChain: account?.codeHash === ACCOUNT_POLICY.codeHashBase58 };
  }

  /** One approval for the whole plan where the account can chain steps (D14); otherwise one approval per step. */
  const approvals = (steps: TxRequest[], canChain: boolean): TxRequest[] =>
    canChain && steps.length > 1 && steps.length <= 4
      ? [{ ...steps[steps.length - 1], receiverId: steps[0].receiverId, actions: steps[0].actions, then: steps.slice(1).map(({ receiverId, actions }) => ({ receiverId, actions })) }]
      : steps;

  /** Ask the core to sign each step in turn; a "no" or a Problem stops it. The movement is kept on the device. */
  async function execute(plan: SendPlan, kind: Movement["kind"], label: string | undefined, cat: Catalogue, canChain: boolean, me: string, caller: Caller, since?: number): Promise<Movement> {
    const signed = await signAll(approvals(plan.steps, canChain), caller, since);
    const at = iso();
    const movement: Movement = {
      id: `${kind}:${signed.txHash}`,
      kind,
      status: signed.hold ? "waiting" : "moving",
      from: plan.tokenId,
      to: plan.to,
      amount: fromUnits(plan.arrives, plan.decimals),
      startedAtIso: at,
      updatedAtIso: at,
      explorerUrls: signed.explorerUrls,
      ...(label ? { label } : {}),
      ...(signed.hold ? { held: signed.hold } : {}),
      caller,
    };
    const f: Follow = {
      signer: me,
      to: plan.to,
      next: plan.viaBridge ? { kind: "bridge", chain: cat.coin(plan.tokenId)?.chain ?? "" } : { kind: "none" },
      ...(plan.call ? { call: { arrives: plan.arrives.toString(), decimals: plan.decimals, symbol: plan.symbol } } : {}),
      ...(signed.unsent ? { unsent: signed.unsent } : {}),
    };
    if (!signed.hold) return landed(movement, signed.txHash, f);
    await remember(movement);
    await followLater(movement.id, f);
    return movement;
  }

  // A sent request is done when the core says so (it reads every receipt: a later step that failed is
  // security.send.partly), then followed on: the bridge, or 1Click. A transfer_call is read back from its receipts
  // (receipts.ts) for what the receiver kept: all, none (it came straight back), or part.
  // "job": a Send from the Safe (safe-send.ts) follows it itself, from its saved job: once it ran it is "moving", never done
  type Next = { kind: "none" } | { kind: "bridge"; chain: string } | { kind: "quote"; depositAddress: string; sender: string; via?: string } | { kind: "job" };
  interface Follow {
    signer: string;
    /** Where it went, as a person reads it. */
    to: string;
    next: Next;
    /** A transfer_call (msg): what the receiver kept decides how it ended. */
    call?: { arrives: string; decimals: number; symbol: string };
    /** Approvals never asked because an earlier one was held (an account that can't chain them): it can't be done. */
    unsent?: number;
  }
  /** Null while two nodes can't show it yet, or disagree: asked again later. */
  const readBack = (txHash: string, f: Follow): Promise<CallResult | null> => readCall(txHash, f.signer).catch(() => null);
  /** How the request ended, or null while that can't be seen (a transfer_call must show what its receiver kept). */
  const ending = (m: Movement, r: CallResult | null, f: Follow): Movement | null => {
    if (!r) return null;
    const at = { updatedAtIso: iso(), problem: undefined };
    if (r.kind === "failed") return { ...m, ...at, status: "problem", problem: walletProblems.sendFailed() };
    if (!f.call) return { ...m, ...at, status: f.next.kind === "none" ? "done" : "moving" };
    if (r.kind !== "kept") return null;
    if (r.units >= BigInt(f.call.arrives)) return { ...m, ...at, status: "done" };
    if (r.units === 0n) return { ...m, ...at, status: "refunded" };
    return { ...m, ...at, status: "problem", problem: walletProblems.transferPartReturned(fromUnits(r.units, f.call.decimals), f.call.symbol, f.to) };
  };
  /** Follow on once the request really ran: a bridge withdraw to the far chain, a conversion on 1Click. */
  const onward = async (m: Movement, txHash: string, f: Follow) => {
    if (m.status !== "moving") return;
    if (f.next.kind === "bridge") track(m, txHash, f.next.chain);
    if (f.next.kind === "quote") {
      // A hint to 1Click itself only (audit P-4): the relay has no deposit/submit route, so through it the call was dead.
      if (!f.next.via) await apis.submitDeposit(txHash, f.next.depositAddress, f.next.sender);
      trackQuote(m, f.next.depositAddress, f.next.via);
    }
  };
  /** Keep a sent request as it ended; a transfer_call is read back first (it's final by the time the core answers). */
  async function landed(m: Movement, txHash: string, f: Follow): Promise<Movement> {
    const ended = ending(m, f.call ? await readBack(txHash, f) : { kind: "ran" }, f);
    const now = ended ?? { ...m, status: "moving" as const };
    await remember(now);
    emit("ledger.balancesChanged", {});
    if (ended) await onward(ended, txHash, f);
    else readAgain(now, txHash, f);
    return now;
  }
  /** Ask again until the receipts show it; after READ_TRIES it says it can't see, and the balance tells. */
  const readAgain = (m: Movement, txHash: string, f: Follow, tries = 0) => {
    const timer = setTimeout(async () => {
      const ended = ending(m, await readBack(txHash, f), f);
      if (!ended && tries + 1 < READ_TRIES) return readAgain(m, txHash, f, tries + 1);
      await remember(ended ?? { ...m, updatedAtIso: iso(), status: "problem", problem: walletProblems.sendUnread(f.to) });
      emit("ledger.balancesChanged", {});
      if (ended) await onward(ended, txHash, f);
    }, d.trackMs ?? 10_000);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  // A held request (D17) is followed once it ends: how to follow each one is kept on the device by movement id.
  const FOLLOW = "held-follow";
  const follows = async (): Promise<Record<string, Follow>> => {
    try {
      return JSON.parse((await stored(FOLLOW)) ?? "{}");
    } catch {
      return {};
    }
  };
  const followLater = (movementId: string, f: Follow) => serially(async () => store(FOLLOW, JSON.stringify({ ...(await follows()), [movementId]: f })));

  /** A hold ended: sent (then followed like any other), cancelled, declined by the second device, or unknown. */
  async function settle(holdId: string, state: string, txHash?: string, explorerUrl?: string): Promise<void> {
    if (state === "waiting") return;
    const m = (await loadMovements()).find((x) => x.status === "waiting" && x.held?.id === holdId);
    if (!m) return;
    const f = await serially(async () => {
      const all = await follows();
      const found = all[m.id];
      delete all[m.id];
      await store(FOLLOW, JSON.stringify(all));
      return found;
    });
    const { held: _ended, ...rest } = m;
    const base: Movement = { ...rest, status: "moving", updatedAtIso: iso(), explorerUrls: explorerUrl ? [...m.explorerUrls, explorerUrl] : m.explorerUrls };
    if (state !== "ran" || !txHash) {
      const problem = state === "cancelled" ? walletProblems.holdCancelled() : state === "declined" ? walletProblems.holdDeclined() : walletProblems.holdUnknown();
      return remember({ ...base, status: "problem", problem });
    }
    // Kept before this version (no `next`): nothing to follow it with, so the balance tells.
    if (!f?.next) return remember({ ...base, status: "problem", problem: walletProblems.holdUnknown() });
    if (f.unsent) return remember({ ...base, status: "problem", problem: walletProblems.holdPartSent() });
    await landed(base, txHash, f);
  }
  own.on<{ id: string; ended: string; txHash?: string; explorerUrl?: string }>("account.waiting.ended", (e) => void settle(e.id, e.ended, e.txHash, e.explorerUrl).catch(() => {}));

  /**
   * Ask the core to sign each approval in turn. A "no" or a Problem stops it (and nothing after it is asked). A request
   * the account's protection holds stops it too, as "waiting": nothing has moved, and nothing after it is sent (D17).
   */
  async function signAll(requests: TxRequest[], caller: Caller, since?: number): Promise<{ txHash: string; explorerUrls: string[]; hold?: Movement["held"]; unsent?: number }> {
    // the money sheet that asked was closed while this got ready (phone test, 3 Nov): no Approve, no Face ID, as a
    // No; checked before the first request only, so nothing ever stops half-way once one is signed
    if (since !== undefined && closedSince(since)) throw new ProblemError(walletProblems.declined());
    const explorerUrls: string[] = [];
    let txHash = "";
    for (const request of requests) {
      const r = await bridgeFor(caller).call<TxOutcome>("tx.request", { request });
      if ("problem" in r) throw new ProblemError(r.problem);
      const outcome = r.ok;
      if (outcome.status === "declined") throw new ProblemError(walletProblems.declined());
      if (outcome.status === "problem") throw new ProblemError(outcome.problem);
      explorerUrls.push(outcome.explorerUrl);
      txHash = outcome.txHash;
      if (outcome.status === "waiting") return { txHash, explorerUrls, hold: { id: outcome.id, readyAtIso: outcome.readyAtIso, needsSecondDevice: outcome.needsSecondDevice }, unsent: requests.length - 1 - requests.indexOf(request) };
    }
    return { txHash, explorerUrls };
  }

  // Converting.

  const routes = d.routes ?? CONVERT_ROUTES;
  const convertQuotes = new Map<string, { quote: Quote; route: ConvertRoute; units: bigint; minOutUnits: bigint }>();

  /** Read what a conversion needs at one block on two nodes, and pick the route the coin can take from where it sits. */
  async function convertPlan(from: string, to: string, amount: string, ready: boolean) {
    const { accountId } = await myAccount(ready);
    if (!routes.intents && !routes.nearOrigin) throw new ProblemError(walletProblems.quoteUnavailable("Converting isn't open yet."));
    const [cat, block] = await Promise.all([catalogue(), d.chain.commonBlock()]);
    const native = from === NATIVE_NEAR;
    const fromCoin = native ? cat.coin(WRAPPED_NEAR) : cat.coin(from);
    const toCoin = cat.coin(to);
    if (!fromCoin || !toCoin || originAsset(from) === to) throw new ProblemError(walletProblems.quoteUnavailable("ZeroFee can't convert those two coins."));
    const amountUnits = toUnits(amount, fromCoin.decimals);
    if (amountUnits === null || amountUnits <= 0n) throw new ProblemError(walletProblems.amountInvalid());
    const contract = nep141Contract(originAsset(from));
    const [account, inLedger, onAccount] = await Promise.all([
      d.chain.account(accountId, block),
      native ? Promise.resolve("0") : d.chain.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: from }, block),
      !native && contract && ACCOUNT_COINS.includes(from) ? d.chain.view(contract, "ft_balance_of", { account_id: accountId }, block) : Promise.resolve("0"),
    ]);
    const held = { ledger: units(inLedger) ?? 0n, account: native ? spendable(account) : units(onAccount) ?? 0n };
    const route = routeFor({ tokenId: from, coin: native ? undefined : fromCoin, held, units: amountUnits, routes });
    if (!route) {
      if (held.ledger < amountUnits && held.account < amountUnits) throw new ProblemError(walletProblems.balanceLow(amount, native ? "NEAR" : fromCoin.symbol));
      throw new ProblemError(walletProblems.quoteUnavailable("ZeroFee can't convert this coin yet."));
    }
    return { accountId, cat, block, fromCoin, toCoin, units: amountUnits, route, contract, canChain: account?.codeHash === ACCOUNT_POLICY.codeHashBase58 };
  }

  const ask1Click = async (request: ReturnType<typeof convertRequest>) => {
    try {
      return await apis.quote(request);
    } catch (e) {
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
  };

  async function quoteConvert(p: Record<string, unknown>): Promise<Quote> {
    const from = text(p.from), to = text(p.to), amount = text(p.amount);
    const plan = await convertPlan(from, to, amount, false);
    const r = await ask1Click(convertRequest(plan.route, { from, to, units: plan.units, me: plan.accountId, dry: true, deadlineIso: quoteDeadline(now(), 10 * 60_000) }));
    const inUsd = Number(r.quote.amountInUsd ?? NaN), outUsd = Number(r.quote.amountOutUsd ?? NaN);
    const feeUsd = Number.isFinite(inUsd) && Number.isFinite(outUsd) ? Math.max(0, inUsd - outUsd) : undefined;
    const pct = feeUsd !== undefined && inUsd > 0 ? (feeUsd / inUsd) * 100 : undefined;
    const quote: Quote = {
      id: `cq-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      amountIn: amount,
      amountOut: fromUnits(r.quote.amountOut, plan.toCoin.decimals),
      minOut: fromUnits(r.quote.minAmountOut, plan.toCoin.decimals),
      ...(feeUsd !== undefined ? { feeUsd: feeUsd.toFixed(2) } : {}),
      feeNote: feeUsd !== undefined && pct !== undefined ? `Fees about $${feeUsd.toFixed(2)} (${pct.toFixed(2)}%), all in this price.` : "The swap fee is in this price.",
      ...(typeof r.quote.timeEstimate === "number" ? { etaSeconds: r.quote.timeEstimate } : {}),
      expiresAtIso: new Date(now() + CONVERT_QUOTE_TTL_MS).toISOString(),
    };
    convertQuotes.set(quote.id, { quote, route: plan.route, units: plan.units, minOutUnits: BigInt(r.quote.minAmountOut) });
    return quote;
  }

  async function convert(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    const since = Date.now();
    const held = convertQuotes.get(text(p.quoteId));
    if (!held || Date.parse(held.quote.expiresAtIso) < now()) throw new ProblemError(walletProblems.quoteExpired());
    const { quote } = held;
    const plan = await convertPlan(quote.from, quote.to, quote.amountIn, true);
    // The shown price was a dry quote: a real one now, refused if it promises less than what was shown.
    const r = await ask1Click(convertRequest(plan.route, { from: quote.from, to: quote.to, units: plan.units, me: plan.accountId, dry: false, deadlineIso: quoteDeadline(now(), 10 * 60_000) }));
    const depositAddress = r.quote.depositAddress;
    if (!depositAddress || BigInt(r.quote.minAmountOut) < held.minOutUnits || BigInt(r.quote.amountIn) !== plan.units) throw new ProblemError(walletProblems.quoteExpired());
    convertQuotes.delete(quote.id);
    let registered = true;
    let storageYocto = WRAP_STORAGE_YOCTO;
    if (plan.route !== "intents" && plan.contract) {
      const [balance, bounds] = await Promise.all([
        d.chain.view(plan.contract, "storage_balance_of", { account_id: depositAddress }, plan.block),
        d.chain.view(plan.contract, "storage_balance_bounds", {}, plan.block),
      ]);
      registered = balance !== null;
      const min = (bounds as { min?: unknown } | null)?.min;
      if (typeof min === "string" && /^\d+$/.test(min)) storageYocto = min;
    }
    const why = `Convert ${quote.amountIn} ${quote.from === NATIVE_NEAR ? "NEAR" : plan.fromCoin.symbol} to ${plan.toCoin.symbol}`;
    const steps = fundingSteps(plan.route, { tokenId: quote.from, units: plan.units, depositAddress, registered, storageYocto, me: plan.accountId, why });
    const signed = await signAll(approvals(steps, plan.canChain), caller, since);
    const at = iso();
    const movement: Movement = {
      id: `convert:${signed.txHash}`,
      kind: "convert",
      status: signed.hold ? "waiting" : "moving",
      from: quote.from,
      to: quote.to,
      amount: quote.amountIn,
      startedAtIso: at,
      updatedAtIso: at,
      explorerUrls: signed.explorerUrls,
      ...(signed.hold ? { held: signed.hold } : {}),
      // its page's Fee (Activity, product decision, 3 Nov): the swap's own estimate, as the sheet showed it
      ...(quote.feeUsd !== undefined ? { feeUsd: quote.feeUsd } : {}),
      caller,
    };
    const sender = plan.route === "near-ledger" ? INTENTS.account : plan.accountId;
    // 1Click is told about the deposit only once its receipts show it really ran.
    const f: Follow = { signer: plan.accountId, to: "1Click", next: { kind: "quote", depositAddress, sender }, ...(signed.unsent ? { unsent: signed.unsent } : {}) };
    if (!signed.hold) return landed(movement, signed.txHash, f);
    await remember(movement);
    await followLater(movement.id, f);
    return movement;
  }

  /** A swap in place that ended on 1Click's status: what arrived as 1Click settled it, in the coin's units, or nothing. */
  const swapGot = async (m: Movement, raw: unknown): Promise<Partial<Movement>> => {
    if (typeof raw !== "string" || !/^\d{1,40}$/.test(raw) || !m.to) return {};
    const c = (await catalogue().catch(() => null))?.coin(m.to);
    return c ? { amountOut: fromUnits(raw, c.decimals) } : {};
  };
  /** Movements whose quote this page follows now: a reload starts each again once (finding 18, resumeQuotes). */
  const tracking = new Set<string>();
  /** Follow a conversion on 1Click until it delivers, refunds or fails; past ten minutes untouched, it says so. */
  const trackQuote = (m: Movement, depositAddress: string, via?: string) => {
    if (tracking.has(m.id)) return;
    tracking.add(m.id);
    let stuckSaid = false;
    const timer = setInterval(async () => {
      // a Safe swap's own tag (intents-swap.ts): only with it does the status say what arrived
      const s = await apis.status(depositAddress, via, m.statusTag).catch(() => null);
      const status = s?.status ?? "";
      const end = (patch: Partial<Movement>) => {
        clearInterval(timer);
        tracking.delete(m.id);
        void remember({ ...m, ...patch, updatedAtIso: iso() }).then(() => emit("ledger.balancesChanged", {}));
      };
      if (status === "SUCCESS") return end({ status: "done", problem: undefined, ...(m.kind === "swap" ? await swapGot(m, s?.swapDetails?.amountOut) : {}) });
      if (status === "REFUNDED") return end({ status: "refunded", problem: undefined });
      // a Top up's refund goes to Spending's cash (the Add quote's refundTo), never the Safe's balance: its own words
      if (status === "FAILED") return end({ status: "problem", problem: m.kind === "trading" ? walletProblems.topUpFailed(m.depositAddress ?? depositAddress) : walletProblems.convertFailed() });
      if (!stuckSaid && (status === "PENDING_DEPOSIT" || status === "") && now() - Date.parse(m.startedAtIso) > CONVERT_STUCK_MS) {
        stuckSaid = true;
        await remember({ ...m, updatedAtIso: iso(), problem: walletProblems.convertStuck() });
      }
    }, d.trackMs ?? 10_000);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  const MOVEMENTS = "movements";
  const loadMovements = async (): Promise<Movement[]> => {
    try {
      return JSON.parse((await stored(MOVEMENTS)) ?? "[]");
    } catch {
      return [];
    }
  };
  /** A movement as `caller` may see it: another app's label (its own name for a payment) stays with that app. */
  const keptFrom = (m: Movement, caller: Caller): Movement => {
    const { statusTag: _tag, ...bare } = m;   // a Safe swap's status tag stays in the ledger
    if (caller === "wallet" || !bare.label || bare.caller === caller) return bare;
    const { label: _theirs, ...rest } = bare;
    return rest;
  };

  /** Keep (or update) one movement on the device, and tell anyone listening (the shell passes it on to its caller and Wallet). */
  const note = (m: Movement) =>
    serially(async () => {
      const list = (await loadMovements()).filter((x) => x.id !== m.id);
      await store(MOVEMENTS, JSON.stringify([m, ...list].slice(0, KEEP_MOVEMENTS)));
    });
  const remember = async (m: Movement) => {
    await note(m);
    const { statusTag: _tag, ...shown } = m;   // a Safe swap's status tag stays in the ledger
    emit("ledger.movementUpdated", { movement: shown });
  };
  /** What received.ts reads and writes: this phone's storage and moves, the account's record as last read, the core. */
  const receivedDeps = {
    stored, store, mine: loadMovements, core, now, emit: (m: Movement) => emit("ledger.movementUpdated", { movement: { ...m, caller: "wallet" } }),
    chainTimes: () => chainRows?.rows.map((r) => r.atIso) ?? null,
  };
  /** Take back a movement only noted on the device (security review L2: a Send's, written before its sheet; a No). */
  const forget = (id: string) => serially(async () => void (await store(MOVEMENTS, JSON.stringify((await loadMovements()).filter((x) => x.id !== id)))));

  /** Follow a bridge withdraw until the far chain has it; past half an hour it says so, and keeps following. */
  const track = (m: Movement, txHash: string, chain: string) => {
    let slowSaid = false;
    const timer = setInterval(async () => {
      const w = (await apis.withdrawalStatus(txHash).catch(() => []))[0];
      const farTx = w?.data?.transfer_tx_hash;
      if (w?.status === "COMPLETED") {
        clearInterval(timer);
        const done: Movement = { ...m, status: "done", updatedAtIso: iso(), problem: undefined, explorerUrls: [...m.explorerUrls, ...(typeof farTx === "string" && EXPLORERS[chain] ? [EXPLORERS[chain] + farTx] : [])] };
        await remember(done);
        return;
      }
      if (!slowSaid && now() - Date.parse(m.startedAtIso) > BRIDGE_SLOW_MS) {
        slowSaid = true;
        await remember({ ...m, updatedAtIso: iso(), problem: walletProblems.bridgeSlow(chain) });
      }
    }, d.trackMs ?? 10_000);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  const why = {
    withdraw: (amount: string, to: string) => (symbol: string) => `Send ${amount} ${symbol} to ${to}`,
    // Plain words: "inside NEAR Intents" means nothing to a person (the robot walk); the core's own title says the rest.
    transfer: (amount: string, to: string) => (symbol: string) => `Send ${amount} ${symbol} to ${to}`,
    pay: (amount: string, to: string) => (symbol: string) => `Pay ${amount} ${symbol} to ${to}`,
  };
  const payeeText = (to: Payee) => (to.kind === "ledger" ? to.accountId : to.address);
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  /**
   * An app's own words for a movement (Activity, and the hint under the sheet's decoded words): plain text, display
   * only, never a check. Control and direction-changing characters are refused, and so is more than 80 on a sheet
   * (`longest`; a rename afterwards, for Activity only, may be longer); kept to 60.
   */
  const label = (v: unknown, longest = 80) => {
    if (typeof v !== "string" || !v.trim()) return undefined;
    if (v.length > longest || /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(v)) throw new ProblemError(walletProblems.labelInvalid());
    return v.trim().slice(0, 60);
  };
  /**
   * The hint for an app's move into its own wallet: its label. The core names the app itself ("Trade says: Move $3.00 of
   * SOL …") under its own title ("Move about 0.4918 SOL to your Solana trading wallet").
   */
  const ownWords = (caller: Caller, named: string | undefined) => (named && !SENDS_ANYWHERE.includes(caller) ? () => named : undefined);

  /**
   * The card wallet's cap (Security F2 / D34): a move into the account's own kind "pay" wallet that would take what it
   * holds over $250 is refused here, before anything is read for a plan or signed. Priced from the catalogue, as the
   * Private cap is. What the wallet holds, or a price, can't be read: refused too (never a guess).
   */
  async function cardCap(to: Payee, tokenId: string, amount: string): Promise<void> {
    if (to.kind !== "chain") return;
    const listed = await own.call<{ id?: unknown; kind?: unknown; address?: unknown }[]>("subwallet.list", { kind: "pay" });
    const same = (a: string) => a.trim().toLowerCase() === to.address.trim().toLowerCase();
    const card = "ok" in listed && Array.isArray(listed.ok) ? listed.ok.find((w) => w?.kind === "pay" && typeof w.id === "string" && typeof w.address === "string" && same(w.address)) : undefined;
    if (!card) return;
    // a cap in dollars is checked at a price read now, never one kept on the device (B28)
    const cat = await catalogue({ live: true });
    const incoming = cat.coin(tokenId);
    const adding = incoming ? Number(usdOf(amount, incoming.priceUsd) ?? NaN) : NaN;
    const read = await own.call<{ token?: unknown; decimals?: unknown; amount?: unknown }[]>("subwallet.balances", { id: card.id });
    if (!Number.isFinite(adding) || !("ok" in read) || !Array.isArray(read.ok)) throw new ProblemError(walletProblems.quoteUnavailable("Gnosis or NEAR Intents didn't answer, so your card wallet isn't read. Nothing moved."));
    let held = 0;
    for (const row of read.ok) {
      const raw = typeof row?.amount === "string" && /^\d+$/.test(row.amount) ? BigInt(row.amount) : null;
      if (raw === null || typeof row.decimals !== "number") throw new ProblemError(walletProblems.quoteUnavailable("Gnosis didn't answer, so your card wallet isn't read. Nothing moved."));
      if (raw === 0n) continue;
      const token = String(row.token).toLowerCase();
      const coin = [...cat.tokens()].find((t) => t.chain === "gnosis" && (token === "native" ? t.contract === null && t.symbol.toUpperCase() === "XDAI" : t.contract?.toLowerCase() === token));
      const usd = coin ? Number(usdOf(fromUnits(raw, row.decimals), coin.priceUsd) ?? NaN) : NaN;
      if (!Number.isFinite(usd)) throw new ProblemError(walletProblems.quoteUnavailable("A coin in the card wallet has no price."));
      held += usd;
    }
    if (held + adding > CARD_CAP_USD + 1e-9) throw new ProblemError(walletProblems.cardCap(CARD_CAP_USD, held.toFixed(2), Math.max(0, CARD_CAP_USD - held).toFixed(2)));
  }

  async function withdraw(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    const since = Date.now();
    const to: Payee = { kind: "chain", chain: text(p.chain), address: text(p.toAddress), ...(text(p.memo) ? { memo: text(p.memo) } : {}) };
    const named = label(p.label);
    if (!SENDS_ANYWHERE.includes(caller)) await ownWallet(caller, to.address);
    await cardCap(to, text(p.tokenId), text(p.amount));
    const { plan, accountId, cat, canChain } = await prepare(text(p.tokenId), text(p.amount), to, undefined, ownWords(caller, named) ?? why.withdraw(text(p.amount), payeeText(to)), undefined, caller);
    return execute(plan, "withdraw", named, cat, canChain, accountId, caller, since);
  }

  async function transfer(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    const since = Date.now();
    const to: Payee = { kind: "ledger", accountId: text(p.toAccountId) };
    const memo = text(p.memo).slice(0, 256) || undefined;
    const named = label(p.label);
    // For the receiver to act on. Never cut short: a changed msg means something else.
    const msg = typeof p.msg === "string" ? p.msg : undefined;
    const { plan, accountId, cat, canChain } = await prepare(text(p.tokenId), text(p.amount), to, memo, why.transfer(text(p.amount), payeeText(to)), msg);
    return execute(plan, "transfer", named, cat, canChain, accountId, caller, since);
  }

  async function quotePay(p: Record<string, unknown>, caller: Caller): Promise<PayQuote> {
    const fromTokenId = text(p.fromTokenId);
    const toTokenId = text(p.toTokenId);
    const to = p.to as Payee;
    const amountOut = text(p.amountOut);
    if (p.confidential === true) {
      if (!to || (to.kind !== "chain" && to.kind !== "ledger")) throw new ProblemError(walletProblems.quoteUnavailable("no receiver"));
      if (!SENDS_ANYWHERE.includes(caller)) await ownWallet(caller, to.kind === "chain" ? to.address : "");
      return quotePayPrivately(fromTokenId, toTokenId, to, amountOut);
    }
    if (!to || (to.kind !== "chain" && to.kind !== "ledger")) throw new ProblemError(walletProblems.quoteUnavailable("no receiver"));
    if (!SENDS_ANYWHERE.includes(caller)) await ownWallet(caller, to.kind === "chain" ? to.address : "");
    await cardCap(to, fromTokenId, amountOut);
    // Paying in a different coin needs 1Click's route, which waits for the test mainnet proof.
    if (fromTokenId !== toTokenId) throw new ProblemError(walletProblems.quoteUnavailable("Paying in a different coin isn't open yet."));
    const { plan, accountId, cat, canChain } = await prepare(fromTokenId, amountOut, to, undefined, why.pay(amountOut, payeeText(to)), undefined, caller);
    const asks = approvals(plan.steps, canChain);
    const { protection, fee: feeMost, amount: amountSaid } = await protectionFor(asks, caller);
    const fee = fromUnits(plan.fee, plan.decimals);
    const chainName = to.kind === "chain" ? cat.network(to.chain)?.name ?? to.chain : "";
    const quote: PayQuote = {
      id: `pq-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      fromTokenId,
      toTokenId,
      to,
      amountIn: fromUnits(plan.leaves, plan.decimals),
      amountInExpected: fromUnits(plan.leaves, plan.decimals),
      amountOut,
      feeUsd: usdOf(fee, plan.priceUsd),
      feeNote: plan.viaBridge ? `${chainName}'s network fee: ${fee} ${plan.symbol}, taken on top.` : "Only NEAR's own network fee, paid in NEAR.",
      expiresAtIso: new Date(now() + (plan.viaBridge ? QUOTE_TTL_MS : NEAR_QUOTE_TTL_MS)).toISOString(),
      refundTo: accountId,
      ...(protection ? { protection } : {}),
      ...(feeMost ? { fee: feeMost } : {}),
      ...(amountSaid ? { amount: amountSaid } : {}),
    };
    quotes.set(quote.id, quote);
    if (asks.length === 1) quoteAsks.set(quote.id, asks[0]!);
    return quote;
  }

  /**
   * What the account's protection does with these approvals, in the sheet's own words (tx.describe, two nodes): the
   * strictest of them. A partner's price can't wait out a hold, so the core refuses it before the sheet: that reads as
   * "wait", never as Face ID. Anything else unreadable is left out.
   */
  async function protectionFor(requests: TxRequest[], caller: Caller): Promise<{ protection: PayQuote["protection"]; fee?: string; amount?: string }> {
    const found: NonNullable<PayQuote["protection"]>[] = [];
    const fees: string[] = [];
    const amounts: string[] = [];
    for (const request of requests) {
      const r = await bridgeFor(caller).call<PlainWords>("tx.describe", { request });
      if ("problem" in r && r.problem.code === "security.quote.cant-wait") return { protection: { level: "wait", waitSeconds: 0, text: r.problem.whatHappened } };
      if ("ok" in r && r.ok.protection) found.push(r.ok.protection);
      if ("ok" in r && typeof r.ok.fee === "string") fees.push(r.ok.fee);
      if ("ok" in r && typeof r.ok.amount === "string") amounts.push(r.ok.amount);
    }
    // One approval: its sheet's own fee line and amount, so Send's review says the same figures (grade 02f, F1; 02h, H1).
    // Several: none.
    const fee = requests.length === 1 && fees.length === 1 ? fees[0] : undefined;
    const amount = requests.length === 1 && amounts.length === 1 ? amounts[0] : undefined;
    if (found.length < requests.length) return { protection: found.find((p) => p.level !== "faceid"), fee, ...(amount ? { amount } : {}) };
    return { protection: found.find((p) => p.level !== "faceid") ?? found[0], fee, ...(amount ? { amount } : {}) };
  }

  async function pay(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    const since = Date.now();
    const named = label(p.label);
    const privately = privatePays.get(text(p.quoteId));
    // Asked to pay privately, with a quote that isn't Private's: refused, never paid from the main balance (D85).
    if (p.confidential === true && !privately) throw new ProblemError(walletProblems.privateUnavailable());
    if (privately) {
      if (Date.parse(privately.quote.expiresAtIso) < now()) throw new ProblemError(walletProblems.quoteExpired());
      if (!SENDS_ANYWHERE.includes(caller)) await ownWallet(caller, privately.quote.to.kind === "chain" ? privately.quote.to.address : "");
      return payPrivately(privately, named, caller);
    }
    const q = quotes.get(text(p.quoteId));
    if (!q || Date.parse(q.expiresAtIso) < now()) throw new ProblemError(walletProblems.quoteExpired());
    // Speed (grade 02h, H6: the Send sheet 1.2-3.2 s at 4x CPU, three round trips one after another): the core reads the
    // planned approval's words now (tx.describe: reads only, no sheet, nothing signed), beside this ledger's own reads
    // below, at the same agreed block. The sheet's request then finds those reads shared (NodePace) instead of asking
    // them after this check. What is sent is still only what the fresh plan below says, and the core reads it again.
    const ahead = quoteAsks.get(q.id);
    if (ahead) void bridgeFor(caller).call("tx.describe", { request: ahead }).catch(() => undefined);
    if (!SENDS_ANYWHERE.includes(caller)) await ownWallet(caller, q.to.kind === "chain" ? q.to.address : "");
    await cardCap(q.to, q.fromTokenId, q.amountOut);
    // Read everything again: the fee or the balance may have moved since the quote.
    const { plan, accountId, cat, canChain } = await prepare(q.fromTokenId, q.amountOut, q.to, undefined, ownWords(caller, named) ?? (caller === "wallet" ? why.transfer : why.pay)(q.amountOut, payeeText(q.to)));
    if (plan.leaves > (toUnits(q.amountIn, plan.decimals) ?? 0n)) throw new ProblemError(walletProblems.quoteExpired());
    quotes.delete(q.id);
    quoteAsks.delete(q.id);
    return execute(plan, "pay", named, cat, canChain, accountId, caller, since);
  }

  // Private (D27). The pocket is Security's: an ordinary key in the core, which asks before every payment. Up to $100:
  // checked here on each move in and by the quote relay on every real quote (PRIVATE_CAP_USD above).

  /** The pocket, as the core lists it for Wallet; null when there's none, or this core doesn't offer it. */
  const pocketOf = async (): Promise<{ id: string; address: string } | null> => {
    const r = await own.call<{ id?: unknown; kind?: unknown; address?: unknown }[]>("subwallet.list", { kind: PRIVATE_KIND });
    const w = "ok" in r && Array.isArray(r.ok) ? r.ok.find((x) => x?.kind === PRIVATE_KIND && typeof x.address === "string" && typeof x.id === "string") : undefined;
    return w ? { id: w.id as string, address: w.address as string } : null;
  };

  // Paying from Private (Pay's switch, `confidential: true`): a quote paid from the pocket's Confidential Intents
  // balance. 1Click builds the transfer (generate-intent), the core checks it and signs it with the pocket's key after
  // its own sheet (subwallet.privatePay, Wallet's: the pocket is Wallet's), and 1Click runs it (submit-intent). Every
  // 1Click call goes through the quote server.
  const privatePays = new Map<string, { quote: PayQuote; outUnits: bigint; maxInUnits: bigint; pocket: string }>();

  /** `outUnits`: exactly this much arrives (EXACT_OUTPUT). `inUnits` instead: exactly this much leaves the pocket
   *  (EXACT_INPUT, Home's Send: leg 2 pays exactly what leg 1 promises to bring, so none of the pocket's other money). */
  const privatePayRequest = (o: { fromTokenId: string; toTokenId: string; to: Payee; outUnits?: bigint; inUnits?: bigint; pocket: string; dry: boolean; deadlineMs?: number }) => ({
    dry: o.dry,
    swapType: o.inUnits !== undefined ? ("EXACT_INPUT" as const) : ("EXACT_OUTPUT" as const),
    slippageTolerance: 100,
    originAsset: o.fromTokenId,
    depositType: "CONFIDENTIAL_INTENTS" as const,
    destinationAsset: o.toTokenId,
    amount: (o.inUnits ?? o.outUnits ?? 0n).toString(),
    refundTo: o.pocket,
    refundType: "CONFIDENTIAL_INTENTS" as const,
    recipient: o.to.kind === "chain" ? o.to.address.trim() : o.to.accountId.trim(),
    recipientType: o.to.kind === "chain" ? ("DESTINATION_CHAIN" as const) : o.to.confidential ? ("CONFIDENTIAL_INTENTS" as const) : ("INTENTS" as const),
    // a Send's payment is signed before its first step lands, so its quote lives through that step (send-job.ts SEND_QUOTE_MS)
    deadline: quoteDeadline(now(), o.deadlineMs ?? 10 * 60_000),
    confidentiality: "basic" as const,
  });

  // Its code (private-pay.ts) loads with the first private quote, never in Home's first load (speed budget, 3 Nov).
  let privatePayCode: Promise<ReturnType<typeof import("./private-pay.ts").createPrivatePay>> | null = null;
  const privatePayer = () =>
    (privatePayCode ??= import("./private-pay.ts").then((m) => m.createPrivatePay({
      myAccount, pocketOf, privateQuotes: d.privateQuotes, catalogue: () => catalogue(), privatePayRequest, askPrivate, privatePays, core, apis, relayed, remember, emit, trackQuote, payeeText, iso, now, quoteTtlMs: CONVERT_QUOTE_TTL_MS,
    })));
  const quotePayPrivately = async (fromTokenId: string, toTokenId: string, to: Payee, amountOut: string): Promise<PayQuote> => (await privatePayer()).quotePayPrivately(fromTokenId, toTokenId, to, amountOut);
  const payPrivately = async (held: { quote: PayQuote; outUnits: bigint; maxInUnits: bigint; pocket: string }, label: string | undefined, caller: Caller): Promise<Movement> => (await privatePayer()).payPrivately(held, label, caller);

  // Home's Send (E3 from a wallet: hidden-row.ts; E4 from the Safe: safe-send.ts), each one saved job followed to its end
  // (send-job.ts). Their code loads with the first Send, or with Activity's first read when a Send is still saved on this
  // device (a restart), never in Home's first load.
  let jobsCode: Promise<import("./send-job.ts").SendJobs> | null = null;
  const sendJobs = () => (jobsCode ??= import("./send-job.ts").then((m) => m.createSendJobs({ apis, relayed, remember, note, forget, loadMovements, emit, stored, store, serially, iso, now, trackMs: d.trackMs, ended: (id) => void sweepHome(id) })));
  /** What both of Home's Send paths are handed, once. */
  // (b): whether a NEAR account is set up on a coin's own contract, read on the nodes before a Send to it is priced
  const registered = async (contract: string, accountId: string): Promise<boolean> => (await d.chain.view(contract, "storage_balance_of", { account_id: accountId }, await d.chain.commonBlock())) !== null;
  const sendDeps = () => ({ pocketOf, notForChild, core, privateQuotes: d.privateQuotes, catalogue: () => catalogue(), privatePayRequest, askPrivate, apis, relayed, remember, emit, iso, now, label, payeeText, text, jobs: sendJobs, registered });
  let hiddenRow: Promise<{ hiddenFromRow: (p: Record<string, unknown>, caller: Caller) => Promise<Movement>; sendFee: (p: Record<string, unknown>) => Promise<{ inUsd: string; outUsd: string } | null> }> | null = null;
  const hiddenRowCode = () => (hiddenRow ??= import("./hidden-row.ts").then((m) => m.createHiddenRow({ ...sendDeps(), myAccount, bridgeFor: bridgeFor as never })));
  async function hiddenFromRow(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    return (await hiddenRowCode()).hiddenFromRow(p, caller);
  }
  /** Send's fee before the tap (hidden-row.ts sendFee): two dry quotes, nothing signed or kept. */
  async function sendFee(p: Record<string, unknown>): Promise<{ inUsd: string; outUsd: string } | null> {
    return (await hiddenRowCode()).sendFee(p);
  }
  let safeSendCode: Promise<Awaited<ReturnType<typeof import("./safe-send.ts").createSafeSend>>> | null = null;
  const safeSends = () =>
    (safeSendCode ??= import("./safe-send.ts").then((m) => m.createSafeSend({
      ...sendDeps(), routeOpen: () => routes.nearOrigin === true, privatePlan, payIntoPocket: payIntoPocket as never, originAsset,
      followHeld: async (movementId, signer, unsent) => void (await followLater(movementId, { signer, to: "your private balance", next: { kind: "job" }, ...(unsent ? { unsent } : {}) })),
    })));
  /** The payee is one of the person's own wallets, as the core lists them (never one the replaced backup words open): the
   *  only payee a Send's fill may still pay while SAFE_SEND_FILL_OPEN is shut. A list that can't be read: not own. */
  const ownPayee = async (to: unknown): Promise<boolean> => {
    const t = (to && typeof to === "object" ? to : {}) as { kind?: unknown; chain?: unknown; address?: unknown; accountId?: unknown };
    const r = await bridgeFor("trade").call<{ kind: string; chain: string; address?: string; oldWords?: boolean }[]>("subwallet.list", {}).catch(() => null);
    if (!r || !("ok" in r) || !Array.isArray(r.ok)) return false;
    const same = (a: unknown, b: string) => typeof a === "string" && a.trim().toLowerCase() === b.toLowerCase();
    return r.ok.some((w) => !w.oldWords && w.kind !== "private" && typeof w.address === "string" && (t.kind === "ledger" ? w.chain === "near" && same(t.accountId, w.address) : t.kind === "chain" && w.chain === t.chain && same(t.address, w.address)));
  };
  /** The Move route's fill switch, once (VITE_SAFE_FILL_OPEN): handed to that route only, never route B for everyone. */
  const fillOpen = d.safeFillOpen ?? SAFE_FILL_OPEN;
  /** `fill: true` (Home's Send "Safe coins out", the Move route): the Safe's part may fill Private first, only while the
   *  switch is on; every other call, as before (route B closed: the Safe's part refused before any sheet). */
  async function sendFromSafe(p: Record<string, unknown>, caller: Caller): Promise<Movement[]> {
    // QA's MUST (5 Nov): the fill's one sheet says "Move $X to Private" and never names an outside payee, so a
    // Send's fill to anyone but the person's own wallets is refused here, before any price or sheet, by name, whatever
    // asks (an old link, AgentZero, a stale screen). A hard constant (core safe-send-fill-open.ts), never the build's
    // VITE_SAFE_FILL_OPEN; Move's own fill (private-move.ts) never comes this way. Dropped for the bound path only: the
    // constant open AND this build's fill switch on, where every outside payee's fill is safe-send.ts's sendFill (one
    // sheet naming the payee in full, the payout bound to the move in before the Safe signs); else refused, as before.
    if (p.fill === true && !(SAFE_SEND_FILL_OPEN && fillOpen) && !(await ownPayee(p.to))) throw new ProblemError(walletProblems.safeSendShut());
    const ms = await (await safeSends()).sendFromSafe(p, caller, { fillOpen: p.fill === true && fillOpen });
    if (p.fill === true && fillOpen) await (await privateMoves()).noteFill(ms);
    return ms;
  }
  // Move and a site's top-up from Private (private-move.ts): each leg one payment from Private to the person's own wallet
  let privateMoveCode: Promise<ReturnType<typeof import("./private-move.ts").createPrivateMove>> | null = null;
  const privateMoves = () => (privateMoveCode ??= import("./private-move.ts").then((m) => m.createPrivateMove({
    core, catalogue: () => catalogue(), sends: safeSends, originAsset, fillOpen, usdc: TRADING_USDC, stored, store, serially, loadMovements, resume: resumeSends, now, notForChild, spendingFor: SPENDING_FOR, trade: () => bridgeFor("trade"),
  })));
  const moveFromPrivate = async (p: Record<string, unknown>, caller: Caller): Promise<unknown> => (await privateMoves()).moveFromPrivate(p, caller);
  const privateMoveStatus = async (p: Record<string, unknown>): Promise<unknown> => (await privateMoves()).privateMoveStatus(p);
  /** The Sends' movement ids: a restart follows each saved job again, and one with no job is said as unknown (H1). */
  const SEND_IDS = ["hidden-row:", "safe-send:", "pocket-send:"];
  /** Once a run, from Activity: Sends a restart left on their way are followed again. */
  let sendsResumed = false;
  const resumeSends = async () => {
    if (sendsResumed) return;
    sendsResumed = true;
    const kept = await stored("send-jobs");
    const moving = (await loadMovements()).some((m) => m.status === "moving" && SEND_IDS.some((p) => m.id.startsWith(p)));
    if ((kept && kept !== "{}") || moving) await (await sendJobs()).resume(SEND_IDS);
  };
  /**
   * Security review M5 (D128: money never rests in the pocket). The pocket is one key from the backup words, with none of
   * the Safe's rules, so what it holds goes home to the Safe: after each Send ends and once a run, and only when no Send
   * still needs it (an open job). Home with no sheet (pocket-moves.ts: money going to the person's own account), each
   * coin worth at least SWEEP_LEAST_USD (dust that 1Click can't move stays, never retried on every start).
   */
  let sweeping = false;
  let sweptAtStart = false;
  const sweepHome = async (ended?: string): Promise<void> => {
    if (sweeping || !d.privateQuotes) return;
    sweeping = true;
    try {
      if (!(await pocketOf())) return;
      const open = (await stored("send-jobs")) ?? "{}";
      if (open !== "{}" && Object.keys(JSON.parse(open)).length > 0) return;
      // a Move's or a site top-up's end never sweeps, nor any sweep within 24 h of a fill (private-move.ts sweepHeld)
      const moves = await stored("private-moves");
      if (moves && moves !== "{}" && (await (await import("./private-move.ts")).sweepHeld(moves, ended, now(), { stored, store }))) return;
      const { rows } = await privatePocket();
      if (rows.reduce((n, r) => n + (Number(r.usd ?? 0) || 0), 0) < POCKET_REST_USD) return;
      for (const r of rows) if (Number(r.usd ?? 0) >= SWEEP_LEAST_USD) await fromPrivate({ tokenId: r.tokenId }, "wallet").catch(() => undefined);
    } catch {
      // a read that failed: the next Send's end, or the next start, sweeps again
    } finally {
      sweeping = false;
    }
  };

  /**
   * Whether this phone can use Private, and what's in it. Its balance lives in Confidential Intents, which only the
   * pocket's own key can read: the core reads it for Wallet (subwallet.private.balances). No quote server: Private
   * isn't shown at all (D13). A read that fails is a Problem, never an empty pocket.
   */
  type OldWords = { moving: number; left: number; unread?: true; coins: { kind: string; tokenId: string; amount: string; state: "moving" | "waiting" | "stuck" | "left" }[] };
  async function privatePocket(): Promise<PrivatePocket> {
    const defaultOn = (await stored(PRIVATE_DEFAULT)) === "on";
    if (!d.privateQuotes) return { available: false, ready: false, rows: [], defaultOn };
    const canAdd = routes.nearOrigin === true;
    if (!(await pocketOf())) return { available: true, ready: false, rows: [], defaultOn, canAdd, fillOpen };
    const [held, old] = await Promise.all([core<{ tokenId: string; amount: string }[]>("subwallet.private.balances"), core<OldWords>("subwallet.oldWords").catch(() => null)]);
    const cat = await catalogue();
    const toRow = ({ tokenId, amount }: { tokenId: string; amount: string }): Balance => {
      const coin = cat.coin(tokenId);
      const decimal = fromUnits(BigInt(amount), coin?.decimals ?? 0);
      return coin
        ? { tokenId, symbol: coin.symbol, name: coin.name ?? coin.symbol, icon: coin.icon ?? coin.symbol.toLowerCase(), chain: coin.chain, amount: decimal, usd: usdOf(decimal, coin.priceUsd, true), bridged: coin.bridged, held: "private", listed: true }
        : { tokenId, symbol: "?", name: "An unnamed coin", icon: "", chain: "near", amount: decimal, bridged: false, held: "private", listed: false };
    };
    const rows: Balance[] = held.map(toRow);
    // Security audit 4 Nov, finding 2: what replaced words still hold, counted (and shown) until it has moved.
    const oldWords = !old ? { rows: [], moving: false, stuck: false, left: false, unread: true as const } : old.coins.length || old.unread
      ? { rows: old.coins.map(toRow), moving: old.moving > 0, stuck: old.coins.some((c) => c.state === "stuck" || c.state === "waiting"), left: old.coins.some((c) => c.state === "left"), ...(old.unread ? { unread: true as const } : {}) }
      : undefined;
    return { available: true, ready: true, rows, defaultOn, canAdd, fillOpen, ...(oldWords ? { oldWords } : {}) };
  }

  /** The core's moves from replaced words into Private, as Activity rows: the ones on their way and the ones done (a
   *  refused or refunded try is asked again by the core, and the Private screen says what didn't move). */
  async function oldWordsRows(): Promise<Movement[]> {
    const r = await own.call<(PocketMove & { kind: "private" | "trade"; sent: { tokenId: string; amount: string }; startedAtIso: string; updatedAtIso: string })[]>("subwallet.oldWords.moves");
    if (!("ok" in r) || !Array.isArray(r.ok) || !r.ok.length) return [];
    const cat = await catalogue();
    return r.ok
      .filter((m) => (m.status === "done" || m.status === "pending") && /^\d+$/.test(m.sent.amount) && BigInt(m.sent.amount) > 0n)
      .map((m) => {
        const coin = cat.coin(m.sent.tokenId);
        const amount = fromUnits(BigInt(m.sent.amount), coin?.decimals ?? 0);
        const usd = coin ? usdOf(amount, coin.priceUsd, true) : undefined;
        // `into`: the new wallet it went to (an old NEAR wallet's coins go to the new NEAR wallet, never Private)
        return { id: `oldwords:${m.id}`, kind: "private", status: pocketStatus(m), from: "oldWords", to: m.sent.tokenId, amount, ...(m.kind === "trade" ? { into: "near" as const } : {}), ...(usd ? { usd } : {}), startedAtIso: m.startedAtIso, updatedAtIso: m.updatedAtIso, explorerUrls: [], caller: "wallet" };
      });
  }

  /** Try again for the money under replaced words: the core asks 1Click for each coin now (subwallet.oldWords.move). */
  async function oldWordsMove(): Promise<PrivatePocket> {
    await core("subwallet.oldWords.move");
    return privatePocket();
  }

  /**
   * Out of Private (money is never stuck): every coin in the pocket, or the one asked for, home to the same coin in the
   * main balance. The core moves it with the pocket's key, to the main account only (subwallet.private.home); each
   * coin is a movement, followed in Activity from the core's own record of it.
   */
  async function fromPrivate(p: Record<string, unknown>, caller: Caller): Promise<Movement[]> {
    await notForChild();
    if (!(await pocketOf()) || !d.privateQuotes) throw new ProblemError(walletProblems.privateUnavailable());
    const { rows } = await privatePocket();
    // its code (private-pay.ts) loads with its first use, never in Home's first load (speed budget, 3 Nov)
    return (await import("./private-pay.ts")).fromPrivate(p, caller, {
      rows, status: pocketStatus, remember, emit, iso,
      home: (tokenId, key) => bridgeFor(caller).call<PocketMove>("subwallet.private.home", { tokenId, amount: "all", key }),
    });
  }

  /** Whether Pay's Private switch starts on: the person's one choice, kept on this phone (D27, "easiest for people"). */
  async function privateDefault(p: Record<string, unknown>): Promise<PrivatePocket> {
    await store(PRIVATE_DEFAULT, p.on === true ? "on" : "off");
    return privatePocket();
  }

  /**
   * The network Receive last showed, for every app's Receive (D29: Pay shows Wallet's Receive in its tray). Kept under
   * Wallet's own key, so Pay's Receive opens where Wallet's did. With `chain`, remembers it (a network that receives).
   */
  async function receiveChain(p: Record<string, unknown>): Promise<{ chain: string | null }> {
    if (p.chain !== undefined) {
      const net = (await catalogue({ bridge: "any" })).network(String(p.chain));
      if (!net) throw new ProblemError(walletProblems.chainUnsupported(String(p.chain)));
      await store(RECEIVE_CHAIN, net.id);
      return { chain: net.id };
    }
    return { chain: (await stored(RECEIVE_CHAIN)) ?? null };
  }
  const RECEIVE_CHAIN = "receive-chain";

  /** A child's account has no Private (D30): the core refuses its pocket, and nothing here offers or moves into one. */
  const notForChild = async () => {
    if ((await core<{ kid?: boolean }>("account.state")).kid === true) throw new ProblemError(walletProblems.privateChild());
  };

  async function privateSetup(): Promise<PrivatePocket> {
    await notForChild();
    if (!d.privateQuotes) throw new ProblemError(walletProblems.privateUnavailable());
    await core("subwallet.create", { kind: PRIVATE_KIND, chain: "near" });
    return privatePocket();
  }

  const PRIVATE_DEFAULT = "private-default";
  const askPrivate = async (request: QuoteRequest) => {
    try {
      return await apis.quote(request, relayed);
    } catch (e) {
      // the quote relay's own limit on one quote: said as the relay's, by name (D128 keeps it; never "1Click gave no price")
      if (e instanceof QuoteRefused && e.code === "quotes.request.too-big") throw new ProblemError(walletProblems.relayLimit(e.message));
      // a payout to a NEAR account that 1Click didn't take (QA's lap, 5 Nov: a private Send to a 64-hex account
      // landed once, then 5 of 5 were refused; 1Click's own answer to that shape, read with dry quotes: "Quoting for this
      // pair is not available", from any coin): said as NEAR Intents', by name, never as a missing price
      if (e instanceof QuoteRefused && e.code === "quotes.upstream.refused" && request.recipientType === "DESTINATION_CHAIN" && (await catalogue().catch(() => null))?.coin(request.destinationAsset)?.chain === "near") {
        throw new ProblemError(walletProblems.nearPayoutClosed());
      }
      if (e instanceof QuoteRefused) throw new ProblemError(walletProblems.quoteUnavailable(e.message));
      throw e;
    }
  };

  // A Safe coin into the pocket (route B): its code (to-private.ts) loads with its first use, never in Home's first load.
  let toPrivateCode: Promise<ReturnType<typeof import("./to-private.ts").createToPrivate>> | null = null;
  const intoPocket = () =>
    (toPrivateCode ??= import("./to-private.ts").then((m) => m.createToPrivate({
      myAccount, pocketOf, privateQuotes: d.privateQuotes, routeOpen: () => routes.nearOrigin === true, catalogue, chain: d.chain, accountCoins: ACCOUNT_COINS, capUsd: PRIVATE_CAP_USD,
      spendable, notForChild, askPrivate, bridgeFor: bridgeFor as never, signAll: signAll as never, approvals, now, iso, quoteTtlMs: CONVERT_QUOTE_TTL_MS,
      finish: async (movement, signed, o) => {
        const f: Follow = { signer: o.signer, to: "your private balance", next: { kind: "quote", depositAddress: o.depositAddress, sender: o.sender, via: relayed }, ...(signed.unsent ? { unsent: signed.unsent } : {}) };
        if (!signed.hold) return landed(movement, signed.txHash, f);
        await remember(movement);
        await followLater(movement.id, f);
        return movement;
      },
    })));
  type ToPrivate = Awaited<ReturnType<typeof intoPocket>>;
  const privatePlan = async (...a: Parameters<ToPrivate["privatePlan"]>) => (await intoPocket()).privatePlan(...a);
  const payIntoPocket = async (...a: Parameters<ToPrivate["payIntoPocket"]>) => (await intoPocket()).payIntoPocket(...a);
  const quoteToPrivate = async (p: Record<string, unknown>): Promise<Quote> => (await intoPocket()).quoteToPrivate(p);
  const toPrivate = async (p: Record<string, unknown>, caller: Caller): Promise<Movement> => (await intoPocket()).toPrivate(p, caller);

  // Swap in place (intents-swap.ts): its code loads with its first use, never in Home's first load.
  let swapCode: Promise<ReturnType<typeof import("./intents-swap.ts").createIntentsSwap>> | null = null;
  const inPlace = () => (swapCode ??= import("./intents-swap.ts").then((m) => m.ledgerSwap({ chain: d.chain, catalogue, apis, relayed, bridgeFor, myAccount, now, iso, signAll, approvals, remember, trackQuote })));

  /**
   * The Add (TRADE-FLOAT §1 S7): dollars of USDC from the main balance into the Trading balance (Trade's float). The core
   * asks the pinned relay for the quote itself (subwallet.float.quoteAdd): recipient and refunds are the float,
   * confidentially, and the main account's name is never in it. It is paid like toPrivate's route B: one ft_withdraw
   * from intents.near of exactly amountIn to the quote's deposit address (storage first if the address has none),
   * through tx.request as the asking app. The main key's sheet reads the quote through the core ("Add 10 USDC to
   * Trading", what 1Click promises, a refund comes back to the trading balance; another amount or a refund elsewhere is
   * security.quote.mismatch before Face ID). Here the quote is refused before the sheet if it isn't exactly the one
   * asked for, or if its deadline has passed. Followed on 1Click like any other quote; a refund lands in the float.
   * NEAR on the account itself (tokenId "near") is quoted as wNEAR and paid like toPrivate's near-account route: one
   * transaction on wrap.near that wraps exactly amountIn and ft_transfers it to the deposit address (convert.ts).
   */
  async function toTrading(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    const since = Date.now();
    // D146: Spending's engine asks as Trade for every app (Home's Move and Top up, a site's Add); it names the app that
    // asked it (`for`), so the Safe's sheet is that app's and shows only while it is on screen. Only Trade's own call may
    // name another app, and only one Spending serves.
    const signer: Caller = caller === "trade" && typeof p.for === "string" && SPENDING_FOR.has(p.for) ? (p.for as Caller) : caller;
    const named = label(p.label);
    const amount = text(p.amount).trim();
    // Any coin in the main balance (a NEAR coin in NEAR Intents), or NEAR on the account itself ("near", balances' row
    // held "account"); not USDC, it's converted inside the Add (the core's quote takes exactly this much of it and
    // promises USDC to Trading). `amount` is in that coin.
    const tokenId = p.tokenId === undefined ? TRADING_USDC : text(p.tokenId);
    const native = tokenId === NATIVE_NEAR;
    if (!native && !/^nep141:[a-z0-9_.-]{2,64}$/.test(tokenId)) throw new ProblemError(walletProblems.quoteUnavailable("Only coins in your Safe can go to your NEAR wallet."));
    const { accountId } = await myAccount(true);
    const [cat, block] = await Promise.all([catalogue(), d.chain.commonBlock()]);
    // NEAR on the account is quoted and paid as wNEAR (1Click lists only that), wrapped in the paying transaction.
    const paid = originAsset(tokenId);
    const coin = cat.coin(paid);
    if (!coin || (tokenId === TRADING_USDC && coin.decimals !== TRADING_DECIMALS)) throw new ProblemError(walletProblems.quoteUnavailable(`The swap service doesn't take ${coin?.symbol ?? "that coin"} right now.`));
    const wanted = toUnits(amount, coin.decimals);
    if (wanted === null || wanted <= 0n) throw new ProblemError(walletProblems.amountInvalid());
    const [account, inLedger] = await Promise.all([d.chain.account(accountId, block), native ? Promise.resolve("0") : d.chain.view(INTENTS.account, "mt_balance_of", { account_id: accountId, token_id: tokenId }, block)]);
    // NEAR: the account's own balance, its storage and the room the wrap's own gas takes up front (110 Tgas: more than a
    // plain Send's, so a little less than balances shows), with its two storage deposits, as if neither were paid yet.
    const wrapAtMost = () => fundingSteps("near-account", { tokenId, units: wanted, depositAddress: accountId, registered: false, storageYocto: WRAP_STORAGE_YOCTO, me: accountId, why: "" });
    const has = native ? spendable(account, wrapAtMost()) : units(inLedger) ?? 0n;
    if (has < wanted) throw new ProblemError(walletProblems.balanceLow(amount, coin.symbol));
    // The quote is the core's (as the app that asked): under $2 it answers security.request.not-allowed, in its words.
    // the person's job (Move's key) is kept with the quote's deposit address before any sheet: a page closed while the
    // Safe signs finds its Add again by it (bug report, 5 Nov)
    const job = typeof p.job === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(p.job) ? p.job : undefined;
    const r = await bridgeFor(caller).call<AddQuote>("subwallet.float.quoteAdd", { amount: wanted.toString(), ...(tokenId === TRADING_USDC ? {} : { tokenId: paid }), ...(job ? { job } : {}) });
    if ("problem" in r) throw new ProblemError(r.problem);
    const q = checkAddQuote(r.ok, wanted, now());
    const contract = nep141Contract(paid)!;
    const [balance, bounds] = await Promise.all([d.chain.view(contract, "storage_balance_of", { account_id: q.depositAddress }, block), d.chain.view(contract, "storage_balance_bounds", {}, block)]);
    const min = (bounds as { min?: unknown } | null)?.min;
    const storageYocto = typeof min === "string" && /^\d+$/.test(min) ? min : WRAP_STORAGE_YOCTO;
    const why = `Move ${amount} ${coin.symbol} to your NEAR wallet`;
    // NEAR on the account: one transaction on wrap.near (storage, wrap, ft_transfer to the deposit address), one sheet.
    const route: ConvertRoute = native ? "near-account" : "near-ledger";
    // Home's Move: where it goes on from the NEAR wallet, the asking app's words on the sheet (never signed)
    const onward = typeof p.onward === "string" && p.onward.length <= 120 ? p.onward : undefined;
    const steps = fundingSteps(route, { tokenId, units: wanted, depositAddress: q.depositAddress, registered: balance !== null, storageYocto, me: accountId, why }).map((s, i, all) => (onward && i === all.length - 1 ? { ...s, onward } : s));
    const signed = await signAll(approvals(steps, account?.codeHash === ACCOUNT_POLICY.codeHashBase58), signer, since);
    const at = iso();
    const movement: Movement = {
      id: `trading:${signed.txHash}`,
      kind: "trading",
      status: signed.hold ? "waiting" : "moving",
      from: tokenId,
      to: TRADING_TO,
      amount,
      startedAtIso: at,
      updatedAtIso: at,
      explorerUrls: signed.explorerUrls,
      ...(named ? { label: named } : {}),
      ...(signed.hold ? { held: signed.hold } : {}),
      caller,
      depositAddress: q.depositAddress,
      ...(Number.isInteger(q.etaSeconds) && q.etaSeconds! > 0 && q.etaSeconds! <= 3600 ? { etaSeconds: q.etaSeconds } : {}),
    };
    const f: Follow = { signer: accountId, to: "your NEAR wallet", next: { kind: "quote", depositAddress: q.depositAddress, sender: native ? accountId : INTENTS.account, via: relayed }, ...(signed.unsent ? { unsent: signed.unsent } : {}) };
    if (!signed.hold) return landed(movement, signed.txHash, f);
    await remember(movement);
    await followLater(movement.id, f);
    return movement;
  }

  /** Did the Safe pay this Add's deposit address (add-sent.ts, loaded with its first ask: never in Home's first load)? */
  const addSent = (p: Record<string, unknown>) => import("./add-sent.ts").then((m) => m.addSent(p, { chain: d.chain, me: async () => (await myAccount(true)).accountId, contractOf: (t) => (t === NATIVE_NEAR ? undefined : nep141Contract(originAsset(t)) ?? undefined), usdc: TRADING_USDC, invalid: (why) => new ProblemError(securityProblems.requestInvalid(why)) }));

  /**
   * An app's own name for its own movement, changed afterwards (Pay: "Paid · Mt Pelerin told you: …" once the person says
   * the partner paid). Another app's movement, or one this phone doesn't know, is refused alike.
   */
  async function relabel(p: Record<string, unknown>, caller: Caller): Promise<Movement> {
    const named = label(p.label, Infinity);
    const m = (await loadMovements()).find((x) => x.id === text(p.id));
    if (!m || (m.caller ?? "wallet") !== caller || !named) throw new ProblemError(walletProblems.movementUnknown());
    const renamed = { ...m, label: named, updatedAtIso: iso() };
    await remember(renamed);
    return renamed;
  }

  /**
   * B28 R6: the services failing now, by name and how: the relay's own check (it pings each service once a minute,
   * apps/quotes /v0/health), and any this ledger saw fail in the last FAILING_MS. Never a Problem: a check that can't be
   * read says nothing, and the relay itself not answering is said as the relay failing.
   */
  let health: { at: number; value: Promise<ServiceStatus[]> } | null = null;
  /** B30: the failing services' rows of the status table (since when, their own words), for the banner and the lines. */
  async function status(): Promise<ServiceStatus[]> {
    if (relayed && (!health || now() - health.at > HEALTH_MS)) {
      const value = saw("relay", apis.health(relayed)).catch((): ServiceStatus[] => []);
      health = { at: now(), value };
    }
    const rows = new Map<Service, ServiceStatus>((health ? await health.value : []).map((r) => [r.service, { ...r, seen: "relay" as const }]));
    // what this phone saw fail itself wins over the relay's check (review M2). Bug 8 (MetaMask's 2026 rule): only when the
    // relay's check says so too is it an outage ("both"), the one state that holds a sheet's button; one source alone is
    // said as "didn't answer". Review M3: both must say the SAME thing; NEAR "slow" at the relay (one node unhealthy)
    // beside this phone's "down" is no outage, so the button stays on and the line never says "waits"
    for (const [s, f] of failing) {
      if (now() - f.at >= FAILING_MS) continue;
      const had = rows.get(s);
      const relayToo = !!had && had.state === f.fault && !ONE_VANTAGE.has(s);
      rows.set(s, { service: s, state: f.fault, since: had && had.state === f.fault && had.since ? had.since : new Date(f.since).toISOString(), seen: relayToo ? "both" : "device", ...(had?.note ? { note: had.note } : {}) });
    }
    return [...rows.values()].filter((r) => r.state !== "up");
  }
  async function services(): Promise<ServiceHealth> {
    return Object.fromEntries((await status()).map((r) => [r.service, r.state])) as ServiceHealth;
  }

  // A brand-new account's first NEAR (M7). It works before any account exists: no account, no key, no signature.

  async function startNetworks(): Promise<StartNetwork[]> {
    return (await catalogue()).startNetworks();
  }

  /** Its 1Click quote (start-quote.ts): the code loads with its first use, never in Home's first load (speed, 3 Nov). */
  async function startQuote(p: Record<string, unknown>): Promise<StartQuote> {
    return (await import("./start-quote.ts")).startQuote(p, { catalogue: () => catalogue(), ask1Click, now });
  }

  async function activity(p: Record<string, unknown>, caller: Caller): Promise<Movement[]> {
    // A test account's own moves show too (grade 01d Q1: a testnet Send said "PAID" and Activity "Nothing yet").
    const me = await shownAccount(true);
    const { accountId } = me;
    // Moves out of Private, from the core's own record of each (a restart never strands one as "moving").
    for (const m of await loadMovements()) {
      if (m.status !== "moving" || !m.id.startsWith("home:")) continue;
      const r = await own.call<PocketMove>("subwallet.private.move", { id: m.id.slice("home:".length) });
      if ("ok" in r && pocketStatus(r.ok) !== "moving") await remember({ ...m, status: pocketStatus(r.ok), updatedAtIso: iso() });
    }
    // Finding 18: a conversion or Top up still moving was followed by a page that is gone (its interval died with it):
    // followed again from its own deposit address, through the server its quote came from (a Top up's is the relay's)
    for (const m of await loadMovements()) {
      if (m.status !== "moving" || !m.depositAddress || !/^(trading|convert|swap):/.test(m.id)) continue;
      // a Top up's and a Safe's swap in place (intents-swap.ts) were quoted through the relay
      trackQuote(m, m.depositAddress, m.id.startsWith("convert:") ? undefined : relayed);
    }
    // B3 (sandbox hunt, 5 Nov): a NEAR wallet's swap in place has no deposit address of its own: followed by its move
    for (const m of await loadMovements()) {
      if (m.status === "moving" && m.kind === "swap" && m.source === "private") void inPlace().then((x) => x.resume(m), () => undefined);
    }
    // Home's Sends are saved jobs: a restart follows each again to its own end. One with no job left (an older version
    // kept its payment in memory) is "It may have gone", never "nothing was paid" (security review H1).
    await resumeSends().catch(() => undefined);
    // M5: once a run, what the pocket holds goes home to the Safe (no Send still needs it: sweepHome checks)
    if (!sweptAtStart) {
      sweptAtStart = true;
      void sweepHome();
    }
    // Holds that ended elsewhere (another device, the second device) are settled from the account's own history.
    for (const m of await loadMovements()) {
      if (m.status !== "waiting" || !m.held) continue;
      const r = await own.call<{ state: string; txHash?: string; explorerUrl?: string }>("account.waiting.status", { id: m.held.id });
      if ("ok" in r) await settle(m.held.id, r.ok.state, r.ok.txHash, r.ok.explorerUrl);
    }
    const mine = await loadMovements();
    // Security audit 4 Nov, finding 2: each move the core made from the old wallets into the new ones (one row each).
    const swept = await oldWordsRows().catch(() => [] as Movement[]);
    let deposits: Movement[] = [];
    // Deposits come from the mainnet bridge: a test account has none.
    if (!testOf(me)) try {
      const [cat, seen] = await Promise.all([catalogue({ bridge: "any" }), saw("bridge", apis.recentDeposits(accountId))]);
      const firstSeen: Record<string, string> = JSON.parse((await stored("deposits-seen")) ?? "{}");
      let changed = false;
      deposits = seen.map((dep) => {
        if (!firstSeen[dep.tx_hash]) {
          firstSeen[dep.tx_hash] = iso();
          changed = true;
        }
        return depositMovement(dep, cat, firstSeen[dep.tx_hash]);
      });
      if (changed) await store("deposits-seen", JSON.stringify(firstSeen));
    } catch {
      // The bridge didn't answer: this device's own movements still show.
    }
    // money that came in, for good: each Add once it ended, the NEAR that opened the account, money others sent to the Safe
    const cameIn = await receivedCode().then((m) => m.receivedRows(receivedDeps, deposits)).catch(() => [] as Movement[]);
    const limit = Number.isInteger(p.limit) && (p.limit as number) > 0 ? (p.limit as number) : 50;
    // The account's own record (Security's Activity, read from the chain), so Wallet and Security list the same rows and
    // a restore or another device never empties Wallet's (grade 02f, item 4). A row this device recorded keeps its own
    // words; the rest come from the record. Sends for Wallet and Pay (Send's recent people); every other step, Wallet's.
    const rows = await chainActivity();
    const ours = (r: ChainRow) => mine.some((m) => m.id.endsWith(r.txHash) || m.explorerUrls.some((u) => u.includes(r.txHash)));
    const fromChain = caller === "wallet" || caller === "pay" ? rows.filter((r) => !ours(r) && (caller === "wallet" || r.sent)).map(chainMovement) : [];
    return [...mine.map((m) => keptFrom(m, caller)), ...(caller === "wallet" ? swept : []), ...deposits, ...cameIn, ...fromChain].sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso)).slice(0, limit);
  }

  // The chain's record, kept between reads: Activity answers from the last read at once, reads again after 20 s in the
  // background, and tells Wallet once when the record changed (ledger.movementUpdated), never in a loop.
  let chainRows: { at: number; rows: ChainRow[] } | null = null;
  let chainReading: Promise<void> | null = null;
  let firstLate = false;
  const readChain = (): Promise<void> => (chainReading ??= (async () => {
    try {
      const r = await own.call<ChainRow[]>("account.activity", { limit: 50 });
      if (!("ok" in r) || !Array.isArray(r.ok)) return;
      const key = (rows: ChainRow[]) => rows.map((x) => `${x.txHash}:${x.ok}`).join();
      // A record that changed, or a first read that came after Activity had answered without it: Wallet reads again.
      const changed = chainRows ? key(chainRows.rows) !== key(r.ok) : firstLate && r.ok.length > 0;
      chainRows = { at: now(), rows: r.ok };
      firstLate = false;
      if (changed && r.ok[0]) emit("ledger.movementUpdated", { movement: { ...chainMovement(r.ok[0]), caller: "wallet" } });
    } catch {
      // Unread: the device's own rows still show.
    } finally {
      chainReading = null;
    }
  })());
  async function chainActivity(): Promise<ChainRow[]> {
    if (!chainRows) {
      await Promise.race([readChain(), new Promise((r) => setTimeout(r, 2500))]);
      if (!chainRows) firstLate = true;
    } else if (now() - chainRows.at > 20_000) void readChain();
    return chainRows?.rows ?? [];
  }

  /**
   * An app other than Wallet and Pay sends only to a wallet of its own kind, as the core lists them for that app. One
   * wallet per chain (D55): Trade, Browser, the apps in Apps and Chat share the chain wallets, which Spending fills only
   * through its confidential 1Click moves (Top up), so the Safe is never linked to them on chain: a public send from the
   * Safe to any of them is refused for those apps. Only the Extension keeps its own withdraw into its own wallet.
   */
  async function ownWallet(caller: Caller, address: string): Promise<void> {
    if ((CHAIN_APPS as readonly string[]).includes(caller)) throw new ProblemError(walletProblems.callerRefused("Moves into your NEAR wallet go through Move, so your Safe stays private."));
    const r = await bridgeFor(caller).call<{ kind?: unknown; address?: unknown }[]>("subwallet.list");
    const mine = "ok" in r && Array.isArray(r.ok) ? r.ok : [];
    const same = (a: string) => (/^0x/i.test(a) ? a.toLowerCase() === address.trim().toLowerCase() : a === address.trim());
    const kind = caller;
    if (!mine.some((w) => w?.kind === kind && typeof w.address === "string" && same(w.address))) {
      throw new ProblemError(walletProblems.callerRefused(`${NAMES[caller]} can send only to its own wallets.`));
    }
  }

  const methods: Record<string, (p: Record<string, unknown>, caller: Caller) => Promise<unknown>> = {
    "ledger.tokens": async () => (await catalogue()).tokens(),
    // A test account can take only test NEAR (grade 02e, E2: Bitcoin was offered, then Add closed with no word): no
    // network it can't serve is listed.
    "ledger.chains": async () => {
      const all = (await catalogue({ bridge: "any" })).chains();
      // Only a build with a test network asks the account (mainnet has none: no read, nothing to wait on, D134).
      return d.testChain && testOf((await core<{ account?: AccountInfo }>("account.state").catch(() => null))?.account) ? all.filter((c) => c.id === "near") : all;
    },
    "ledger.depositAddress": depositAddress,
    "ledger.receiveChain": receiveChain,
    "ledger.balances": balances,
    "ledger.recipientInfo": recipientInfo,
    "ledger.accountKey": accountKey,
    "ledger.daoPolicy": daoPolicyRead,
    "ledger.nearProfile": profileRead,
    "ledger.daosOf": daosRead,
    "ledger.withdraw": withdraw,
    "ledger.transfer": transfer,
    "ledger.quotePay": quotePay,
    "ledger.pay": pay,
    "ledger.activity": activity,
    "ledger.quoteConvert": quoteConvert,
    "ledger.convert": convert,
    "ledger.swapQuote": async (p, c) => (await inPlace()).swapQuote(p, c),
    "ledger.swap": async (p, c) => (await inPlace()).swap(p, c),
    "ledger.relabel": relabel,
    "ledger.startNetworks": startNetworks,
    "ledger.startQuote": startQuote,
    "ledger.private": privatePocket,
    "ledger.privateSetup": privateSetup,
    "ledger.privateDefault": privateDefault,
    "ledger.quoteToPrivate": quoteToPrivate,
    "ledger.toPrivate": toPrivate,
    "ledger.fromPrivate": fromPrivate,
    "ledger.oldWordsMove": oldWordsMove,
    "ledger.toTrading": toTrading,
    "ledger.addSent": addSent,
    "ledger.hiddenFromRow": hiddenFromRow,
    "ledger.sendFee": sendFee,
    "ledger.sendFromSafe": sendFromSafe,
    "ledger.moveFromPrivate": moveFromPrivate,
    "ledger.privateMoveStatus": privateMoveStatus,
    "ledger.services": services,
    "ledger.status": status,
  };

  // While anyone listens for ledger.balancesChanged, read the balances again now and then and say when they move.
  let poll: (() => void) | null = null;
  let last: string | null = null;
  /** The account the poll reads for, asked of the core again only every POLL_ACCOUNT_MS (it changes on a lock or a
   *  restore, and then a screen reads the balances itself). */
  let polled: { at: number; account: AccountInfo } | null = null;
  const pollAccount = async (): Promise<AccountInfo | null> => {
    if (polled && now() - polled.at < POLL_ACCOUNT_MS) return polled.account;
    const { account } = await core<{ stage: string; account?: AccountInfo }>("account.state");
    polled = account ? { at: now(), account } : null;
    return account ?? null;
  };
  const watch = () => {
    const wanted = (listeners.get("ledger.balancesChanged")?.size ?? 0) > 0;
    if (wanted && !poll) {
      // Every 30 s on the clock's beat, the same as the core's recovery watcher (speed, 2 Nov): both read at one final
      // block at the same moment, so the head and the account are asked once for both (42 reads a minute on Home before).
      poll = everyAligned(d.pollMs ?? 30_000, () => {
        // Nobody sees a hidden page: no reads for it (grade 01c, P12). Shown again, the next tick reads.
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        // a screen's read (D134): the poll only tells Home to look again; what moves money reads on two nodes itself
        pollAccount().then((me) => (me ? balancesOf(me, true) : Promise.reject(new Error("no account")))).then((rows) => {
          const seen = JSON.stringify(rows.map(({ tokenId, amount, held }) => [tokenId, amount, held]));
          if (last !== null && seen !== last) emit("ledger.balancesChanged", { parts: ["safe", "activity"] });
          last = seen;
        }, () => {});
      });
    }
    if (!wanted && poll) {
      poll();
      poll = null;
      last = null;
      polled = null;
    }
  };

  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const run = methods[method];
      if (!run) return { problem: walletProblems.methodUnknown(method) };
      // anything but a read may change the Safe: reads after it start fresh, and so do reads after it ends (review L5)
      const writes = !READS.has(method);
      if (writes) changed();
      // forApps stamps the asking app; the shell's own code has none, and is Wallet's.
      const caller = params.caller === undefined ? "wallet" : CALLERS.find((c) => c === params.caller);
      if (!caller) return { problem: walletProblems.callerRefused("This isn't an app ZeroFee knows.") };
      if (MOVES[method] && !MOVES[method].includes(caller)) return { problem: walletProblems.callerRefused(`${NAMES[caller]} can't send from your Safe. Wallet and Pay can.`) };
      // Chat's NEAR reads are Chat's alone (diff review M-A: any app driving them spends the nodes Send needs).
      if (CHAT_READS.has(method) && caller !== "chat") return { problem: walletProblems.callerRefused("Only ZeroFee Chat reads that.") };
      // Paying privately is paying from Private (D27), which the core's pocket signs: never quietly sent in public instead.
      if (params.confidential === true && PAYS_PRIVATELY.has(method)) return { problem: walletProblems.privateUnavailable() };
      try {
        const ok = (await run(params, caller)) as T;
        // NEAR answered a balance read: it isn't failing (B28 R6)
        if (method === "ledger.balances") answered("near");
        // what this method last failed with answered it now (bug 8: Hidden's read is 1Click's, so it ends 1Click's hold)
        failedBy.get(method)?.forEach(answered);
        failedBy.delete(method);
        return { ok };
      } catch (e) {
        const problem = asProblem(e);
        if (problem.service) {
          fail(problem.service, problem.fault ?? "down");
          failedBy.set(method, (failedBy.get(method) ?? new Set()).add(problem.service));
        }
        return { problem };
      } finally {
        if (writes) changed();
      }
    },
    on<T>(event: string, handler: (payload: T) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      listeners.set(event, set);
      watch();
      return () => {
        set.delete(handler as (payload: unknown) => void);
        watch();
      };
    },
  };
}

/**
 * The bridge as one app hears it: ledger.movementUpdated only for movements that app asked for (and deposits, which
 * belong to no app). Wallet hears them all. The shell wraps each app's bridge in this.
 */
export function ownMovements(bridge: Bridge, app: Caller): Bridge {
  return {
    call: (method, params) => bridge.call(method, params),
    on<T>(event: string, handler: (payload: T) => void) {
      if (event !== "ledger.movementUpdated" || app === "wallet") return bridge.on<T>(event, handler);
      return bridge.on<{ movement?: Movement }>(event, (p) => {
        const caller = p?.movement?.caller;
        if (caller === undefined || caller === app) handler(p as T);
      });
    },
  };
}

/** A row of the account's record on chain (core activity.ts ActivityItem), as the ledger reads it. */
type ChainRow = Pick<ActivityItem, "atIso" | "title" | "by" | "ok" | "txHash" | "explorerUrl" | "sent">;

/**
 * A row of the account's record as a movement (grade 02f, item 4): a NEAR send is a send ("Sent", to whom, how much: Send's
 * recent people read it too); any other step keeps the record's own words and the key that signed it.
 */
function chainMovement(r: ChainRow): Movement {
  const base = { id: `chain:${r.txHash}`, status: r.ok ? ("done" as const) : ("problem" as const), startedAtIso: r.atIso, updatedAtIso: r.atIso, explorerUrls: [r.explorerUrl], ...(r.by ? { by: r.by } : {}) };
  return r.sent ? { ...base, kind: "transfer", from: NATIVE_NEAR, to: r.sent.to, amount: r.sent.near, caller: "wallet" } : { ...base, kind: "account", amount: "0", label: r.title };
}

/** A deposit the bridge has seen, as a movement. The bridge gives no time, so it's dated from when this device first saw it. */
function depositMovement(dep: BridgeDeposit, cat: Catalogue, seenIso: string): Movement {
  const coin = cat.coin(`nep141:${dep.near_token_id}`);
  const network = cat.networks.find((n) => n.bridgeChain === dep.chain);
  const status: Movement["status"] = dep.status === "PENDING" ? "moving" : dep.status === "FAILED" ? "problem" : "done";
  return {
    id: `deposit:${dep.tx_hash}`,
    kind: "deposit",
    status,
    from: network?.id ?? dep.chain,
    to: coin?.assetId ?? dep.near_token_id,
    amount: coin ? fromUnits(dep.amount, coin.decimals) : dep.amount,
    startedAtIso: seenIso,
    updatedAtIso: seenIso,
    explorerUrls: network && EXPLORERS[network.id] ? [EXPLORERS[network.id] + dep.tx_hash] : [],
    ...(status === "problem" ? { problem: walletProblems.depositFailed(network?.name ?? dep.chain, dep.tx_hash) } : {}),
  };
}

/** The core's two-node Problems, in the ledger's own words; anything unexpected never leaks as a raw error. */
export function asProblem(e: unknown): Problem {
  if (e instanceof ProblemError) {
    if (e.problem.code === "security.nodes.disagree") return walletProblems.nodesDisagree();
    if (e.problem.code === "security.nodes.unreachable") return walletProblems.nodesUnreachable(e.problem.fault ?? "down");
    return e.problem;
  }
  return walletProblems.unexpected(e instanceof Error ? e.message : String(e));
}

function cleanMetadata(m: any): { symbol: string; decimals: number } | null {
  const symbol = typeof m?.symbol === "string" ? m.symbol.replace(/[^\p{L}\p{N}.$_-]/gu, "").slice(0, 16) : "";
  const decimals = m?.decimals;
  return symbol && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? { symbol, decimals } : null;
}
