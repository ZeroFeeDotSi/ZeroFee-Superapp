// Every screen of the app, openable directly with sample data: http://127.0.0.1:5180/?screens
// For reviewing the design without creating a testnet account each time. The shell sends nothing to any chain here
// (apps get a MockBridge); the full app at "/" is the real thing.
import { appsFor, mvpOn, publicApps } from "../shown-apps.ts";
import { PUBLIC_BUILD } from "../mode.ts";
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { createMockBridge, PUBLIC_SAMPLE_ACCOUNT_ID, SAMPLE_ACCOUNT_ID, type MockToken } from "@zerofee/shell-api/MockBridge.ts";
import { faultFromQuery, faultedBridge } from "@zerofee/shell-api/faults.ts";
import { relaySockets } from "@zerofee/chat/relay-sockets.ts";
import { localRelay } from "@zerofee/chat/local-relay.ts";
import { keepSampleWallets, SAMPLE_OPENING } from "@zerofee/trade/demo-engine.ts";
import { simSiteHeld } from "./sim-sites.ts";
import { DEMO_STATE_KEY, DEMO_WALLETS_KEY, demoAccountId, demoKeep, type DemoKeep } from "./demo-start.ts";
import type { AccountInfo, PlainWords } from "@zerofee/core/signer";
import { ownAccountCall } from "@zerofee/core/known-contracts";
import { solCoinLeaving, solCoinRows, solNamedCoin, solWords, type SolDecoded } from "@zerofee/core/sol/decode";
import { Unnamed } from "@zerofee/core/format";
import MAINNET_BANDS from "../../../../contracts/account-policy/tests/fixtures/h01-bands.json";
import { forApps, routeBridge, type Bridge, type BridgeResult } from "@zerofee/core/bridge";
import { RpcChain } from "@zerofee/core/chain";
import { createEarnReader } from "@zerofee/earn/reader.ts";
import { createTradeReader } from "@zerofee/trade/reader.ts";
import { hostSpending } from "@zerofee/trade/spending-host.ts";
import { PutAwaySheet } from "@zerofee/wallet/app/screens/Spending.tsx";
import { WaitingView } from "../shell/WaitingView.tsx";
import type { SpendingStatus } from "@zerofee/core/spending";
import type { Problem } from "@zerofee/core/problem";
import { CoinIcon } from "@zerofee/design/CoinIcon.tsx";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Title } from "../screens/Title.tsx";
import { BankOpen, Check, MakeKey, RenewDone, Welcome, Words, Working } from "../screens/Onboarding.tsx";
import { PushedFrame, useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { endedWords } from "@zerofee/shell-api/waiting-outcome.ts";
import { Terms } from "../screens/Terms.tsx";
import { RecoveryWaiting, RestoreWords, WasThisYou } from "../screens/Recovery.tsx";
import { LaptopRequestList, type LaptopRequest } from "../laptop/RecoveryRequest.tsx";
import { ProblemView } from "../shell/ProblemView.tsx";
import { ApprovalSheetView } from "../shell/ApprovalSheetView.tsx";
import { SettingsPanel } from "../shell/SettingsPanel.tsx";
import { AppHost, type HostedApp } from "../shell/AppHost.tsx";
import { FreezeBanner } from "../shell/FreezeBanner.tsx";
import { AccountThread } from "../shell/AccountThread.tsx";
import { readProtection, useKnown } from "../apps/security/known.ts";
import { iosHost } from "../host/ios.ts";
const SafeHealth = lazy(() => import("../shell/SafeHealth.tsx").then((m) => ({ default: m.SafeHealth })));
// Dead ends row 21: a failed AgentZero turn, each cause by name (fail-line.ts); lazy, so ?demo's first load is unchanged
// Never in the public build (deploy-app.sh: no AgentZero code there): the flag is inlined, so the import is dropped.
const FailedTurns = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" ? () => null : lazy(() => Promise.all([import("../agentzero/AgentZeroChat.tsx"), import("../agentzero/fail-line.ts")]).then(([c, f]) => ({
  default: () => {
    const cause = (e: unknown, online = true) => f.failLine(e, online);
    const status = (s: number, message = "x") => Object.assign(new Error(message), { status: s });
    const lines = [cause(status(529)), cause(new TypeError("Failed to fetch"), false), cause(status(401)), cause(status(400, "Your credit balance is too low"))];
    const messages = lines.flatMap((line, i) => [{ id: `u${i}`, role: "user" as const, parts: [{ type: "text" as const, text: "What did I spend this week?" }], done: true }, { id: `a${i}`, role: "assistant" as const, parts: [{ type: "fault" as const, line }], done: true }]);
    return <c.AgentZeroChat chat={{ messages, running: false, send: noop, stop: noop }} />;
  },
})));
const HEALTH_RULES = { read: readProtection, use: () => useKnown().protection };
import { Rearm } from "../apps/security/Rearm.tsx";
import { VAULT_LIMIT_USD } from "../vault-gate.ts";
import { securityProblems } from "@zerofee/core/security-problems";
import { GuardianSide } from "../apps/security/GuardianSide.tsx";
import { freezeNotice, freezeNoticeItem } from "../shell/freeze.ts";
import { AccountActivity, LaptopFlow, SecurityPlace, SecurityRows, SecurityWaiting, type SecurityActions } from "../apps/security/SecurityApp.tsx";
import { hostApps } from "../shell/home-apps.tsx";
import type { AppId } from "@zerofee/shell-api/app-module.ts";
import { APPS } from "../apps.ts";
import { withSitesPrepared } from "@zerofee/browser/social/prepare.ts";
import "./screens.css";

export { WORDS } from "./words.ts";
import { WORDS, sampleWords } from "./words.ts";
import { primeHome } from "@zerofee/wallet/app/home-cache.ts";
/** The public ?demo's account: a neutral name (no network word), and the mainnet rules the real app has (robot 6, 14). */
/** `?demo` on this computer: each browser its own sample account name (J3 C1: two demo windows are two people in Chat, and
 *  one pays the other's request; with one shared name the payment was "That's your own account"). */
const OWN_SAMPLE_ID = !PUBLIC_BUILD && new URLSearchParams(location.search).has("demo") ? demoAccountId() : null;
// The judges' path (Job 1): `npm run dev` → /?demo behaves as the public demo does: sample money moves (Top up, Put away,
// Send), never "This is a test account" for a sample action. Both are the mainnet rules over sample money.
const DEMO_ACCOUNT = { accountId: PUBLIC_BUILD ? PUBLIC_SAMPLE_ACCOUNT_ID : OWN_SAMPLE_ID ?? SAMPLE_ACCOUNT_ID, network: "mainnet" } as const;
export const ACCOUNT: AccountInfo = {
  accountId: DEMO_ACCOUNT.accountId, // the MockBridge's: ?demo's Security and Wallet show one name
  // Security says the account's rules from this: the mainnet ones the demo's MockBridge enforces (mainnetRules).
  network: "mainnet",
  keys: [
    // The web demo is the iPhone app, simulated: its key is the phone's, in the secure chip.
    { handle: "ml-dsa-65-hash:H62q59Xk3vT8pLmN2wQr7sYzA1bC4dE6fGh8iJkivyM", role: "device", kind: PUBLIC_BUILD ? "secure-chip" : "development", current: true },
    { handle: "ml-dsa-65-hash:FxFFvgR2mK9pQ3sT6uV8wX1yZ4aB7cD9eF2gHhZX8", role: "recovery", kind: "recovery-words" },
  ],
  // Release 7: the default recovery wait, 48 hours (a change then waits 3 days; the words alone, 7 days).
  recovery: { delaySeconds: 172800, pending: null },
};
const WITH_OLD_PHONE: AccountInfo = { ...ACCOUNT, keys: [...ACCOUNT.keys, { handle: "ml-dsa-65-hash:EvhGiqP3rS5tU7vW9xY2zA4bC6dE8fG1hJ3kxKtP", role: "device", kind: "development" }] };
const PENDING: AccountInfo = { ...ACCOUNT, recovery: { delaySeconds: 172800, pending: { readyAtIso: new Date(Date.now() + 1.9 * 86400e3).toISOString() } } };
/** Release 7's move with a second device of age: it needs the laptop's yes (after 48 hours), or the words-only fallback. */
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();
const MOVE = { readyAtIso: inDays(1.9), needsSecondDevice: true, approved: false, fallbackAtIso: inDays(6.9), canFinishAtIso: inDays(6.9) };
const MOVE_YES = { ...MOVE, approved: true, canFinishAtIso: MOVE.readyAtIso };
const PENDING_7: AccountInfo = { ...ACCOUNT, recovery: { delaySeconds: 172800, pending: MOVE } };
const SETUP_CHOICES = [{ seconds: 172800, default: true }, { seconds: 259200, default: false }, { seconds: 604800, default: false }, { seconds: 1209600, default: false }, { seconds: 2592000, default: false }];
/** Set-up's one screen as a first visit sees it: the key, the recovery wait's line (Change works) and the terms. */
function MakeKeySample({ back, terms }: { back: () => void; terms: boolean }) {
  const [seconds, setSeconds] = useState(172800);
  return <MakeKey terms={terms} wait={{ choices: SETUP_CHOICES, seconds, onChange: setSeconds }} onBack={back} onContinue={noop} />;
}
const laptopReq = (over: Partial<LaptopRequest>): LaptopRequest => ({ accountId: ACCOUNT.accountId, id: "recovery", kind: "Recovery", title: "A move to a new phone", lines: ["Without a yes, the backup words alone can finish it after 7 days."], readyAtIso: MOVE.readyAtIso, needsSecondDevice: true, ...over });
const STOP_REQ: LaptopRequest = { accountId: ACCOUNT.accountId, id: "9", kind: "CancelRecovery", title: "Stop a move to a new phone", lines: [], readyAtIso: inDays(1) };
const REMOVAL_REQ: LaptopRequest = { accountId: ACCOUNT.accountId, id: "8", kind: "RemoveThisDevice", title: "Your phone asked to remove this device", lines: [], warning: "Your phone asked to remove this device. If that wasn't you, start a recovery from your 24 words on a new phone.", readyAtIso: inDays(2.9) };
const LaptopShows = ({ requests }: { requests: LaptopRequest[] }) => (
  <div className="zf-screen zf-pad"><div className="zf-label" style={{ marginTop: 60 }}>Waiting for your yes</div><LaptopRequestList requests={requests} busy={null} onAnswer={noop} /></div>
);
const SEND_WORDS: PlainWords = {
  title: "Send 2,000 USDC to 0xAB12…9F3C on Base",
  lines: [`From ${SAMPLE_ACCOUNT_ID} on NEAR testnet. Fee: at most 0.001 NEAR.`],
  warnings: [{ kind: "first-time-recipient", text: "You've never sent to this address before." }],
  effect: [{ token: "USDC", before: "10,400", after: "8,400" }],
  hint: "Wallet says: rent for November",
};
// The longest sheet the core can produce: a 12-step contract call with an unbroken argument line and six effects. It
// must scroll inside the sheet with Approve / Not now always on the floor, and nothing may run off the edge at 393×852.
const LONG_WORDS: PlainWords = {
  title: "Set up your legacy: 3 heirs, a 180-day quiet time, then a 30-day claim delay on 4 coins",
  lines: [
    `Call legacy_setup on ${SAMPLE_ACCOUNT_ID} on NEAR testnet.`,
    "Heir 1: alice-the-eldest-daughter-of-the-house.testnet gets 50%.",
    "Heir 2: bob-the-middle-son-who-lives-abroad.testnet gets 30%.",
    "Heir 3: carol-the-youngest-still-at-school.testnet gets 20%.",
    "Quiet time: 180 days without you checking in before anyone can claim.",
    "Claim delay: 30 days after a claim, during which this phone can cancel it.",
    "Coins: USDC, USDT, NEAR, wNEAR.",
    "With: {\"heirs\":[{\"account_id\":\"alice-the-eldest-daughter-of-the-house.testnet\",\"share_pct\":50},{\"account_id\":\"bob-the-middle-son-who-lives-abroad.testnet\",\"share_pct\":30},{\"account_id\":\"carol-the-youngest-still-at-school.testnet\",\"share_pct\":20}],\"quiet_seconds\":\"15552000\",\"claim_delay_seconds\":\"2592000\",\"tokens\":[\"usdc.fakes.testnet\",\"usdt.fakes.testnet\",\"near\",\"wrap.testnet\"]}",
    "Deposit: 0.1 NEAR (storage, returned if unused).",
    "This takes your strictest protection level, because it changes who can take your money.",
    "Fee: at most 0.001 NEAR.",
  ],
  warnings: [
    { kind: "first-time-recipient", text: "You've never named alice-the-eldest-daughter-of-the-house.testnet before." },
    { kind: "unknown-contract", text: "0x9f3c4b1c9e07d2a8e5f6c7d8b9a0e1f2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8 is a contract ZeroFee doesn't know." },
  ],
  effect: [
    { token: "USDC", before: "10,400", after: "10,400" },
    { token: "USDT", before: "2,050.12", after: "2,050.12" },
    { token: "NEAR", before: "812.4411", after: "812.3391" },
    { token: "wNEAR", before: "40", after: "40" },
    { token: "ETH (Base)", before: "1.2", after: "1.2" },
    { token: "BTC", before: "0.0412", after: "0.0412" },
  ],
  hint: "Legacy says: what mum set up",
  protection: { level: "both", waitSeconds: 172800, text: "It waits 2 days and needs your second device." },
};
const PROBLEM: Problem = {
  code: "security.send.unconfirmed",
  whatHappened: "We sent it, but the network hasn't confirmed it yet.",
  money: { state: "on-the-way", where: "on the NEAR network (~30 s)" },
  next: { kind: "wait", label: "Wait a moment" },
};
const ACTIVITY = [
  { atIso: new Date(Date.now() - 2 * 60e3).toISOString(), title: "Changed your protection", by: "This phone", ok: true },
  { atIso: new Date(Date.now() - 3 * 60e3).toISOString(), title: "Sent through your account's rules", by: "This phone", ok: true, partly: true },
  { atIso: new Date(Date.now() - 4 * 60e3).toISOString(), title: "Removed a key, so it can't sign for you any more", by: "This phone", ok: true },
  { atIso: new Date(Date.now() - 3600e3).toISOString(), title: "Moved the account to a new device", by: "Your backup words", ok: true },
  { atIso: new Date(Date.now() - 2 * 3600e3).toISOString(), title: "Added your backup words", by: "This phone", ok: true },
  { atIso: new Date(Date.now() - 2 * 3600e3).toISOString(), title: "Set up your account", lines: ["Gave this device its key", "Installed the recovery rules", "Removed the one-time setup key"], by: "The one-time setup key", ok: true },
];

/** A stand-in bridge for the Security app: activity comes back with sample rows; held requests are the demo
 * MockBridge's (so a hold made in any app shows on Security's Overview and its Waiting screen); every other call is
 * "not in this preview". */
const SAMPLE_WALLETS = [
  { id: "sw-trade-sol", kind: "trade", chain: "sol", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", label: "Spending wallet on Solana", slot: 0, inWords: true },
  { id: "sw-private", kind: "private", chain: "near", address: "a1".repeat(32), label: "Private pocket", inWords: true },
  { id: "sw-browser-eth", kind: "browser", chain: "eth", address: "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", label: "Apps wallet", oldWords: true },
  { id: "sw-pay-gnosis", kind: "pay", chain: "gnosis", address: "0x8617E340B3D01FA5F11F306F4090FD50E238070D", label: "Card wallet" },
];

/** Being someone's guardian: one payment of theirs waiting for your yes (answered ones leave the list). */
const guardianWaiting = [{ accountId: "kim.near", id: "3", title: "Send 900 USDC to bob.near", lines: ["From kim.near on NEAR. Fee: at most 0.001 NEAR."] }];
const guardianAnswered = new Set<string>();
/** A mainnet protection change in the core's own words: every coin the rule counts (phone test, 2 Nov, Exhibit A
 *  of UI-SIMPLICITY-RULES), from the bands the core writes (the contract test's fixture). */
const MAINNET_CHANGE = ownAccountCall("set_protection", { bands: MAINNET_BANDS }, 4.28)!;
const CHANGE_WORDS: PlainWords = { title: MAINNET_CHANGE.title, lines: [...MAINNET_CHANGE.lines, "It waits 1 hour. You, or your backup words, can stop it.", "From kim.near. Fee: at most about $0.03 (0.007 NEAR)."], ...(MAINNET_CHANGE.details ? { details: MAINNET_CHANGE.details } : {}), warnings: [], effect: [{ token: "NEAR", before: "7.0573", after: "7.0503" }] };
/** The new device's "Start moving your account" sheet in the core's own words: two lines, the rest one tap down. */
const START_MOVE = ownAccountCall("start_recovery", { new_key: "AA==" })!;
const START_MOVE_WORDS: PlainWords = { title: START_MOVE.title, lines: [...START_MOVE.lines, "From kim.near. Fee: at most about $0.03 (0.007 NEAR)."], ...(START_MOVE.details ? { details: START_MOVE.details } : {}), warnings: [], effect: [{ token: "NEAR", before: "7.0584", after: "7.0317" }], testNetwork: true };
/** A site's Solana request from the Apps wallet, said by the core's own solWords and coin rows: 10 USDC and a coin
 *  ZeroFee can't name leave; the test run's rows name USDC and say the other as one (its mint and figures one tap down). */
const SOL_SAMPLE = { wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", odd: "8JVZpqUZfQMEc8kMduTS9SkVxP9v8rgunJNcV4qNYGYZ", to: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1" };
const SOL_DECODED: SolDecoded = {
  feePayer: SOL_SAMPLE.wallet, signers: 1, programs: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], unknownPrograms: [], swaps: [], transfers: [], closes: [], closedTo: [],
  tokenMoves: [{ kind: "transfer", account: "Fh3kRbvx4nHmW5Lq3oTtGq8yY8nDgB1rfQf3dFjH4sQe", to: SOL_SAMPLE.to, amount: "10000000", mint: SOL_SAMPLE.usdc }, { kind: "transfer", account: "3pGq2eQ6vC5kQ9yH7mN4sT8uW2xZ1aB6cD9eF3gH5jK7", to: SOL_SAMPLE.to, amount: "4906542056074766", mint: SOL_SAMPLE.odd }],
  stakeHandovers: [], unreadTokenSteps: 0, routeAccounts: [], routePrograms: [], unreadSteps: [], networkFeeLamports: "5000",
};
const SOL_WORDS: PlainWords = (() => {
  const unnamed = new Unnamed();
  const w = solWords(SOL_DECODED, solNamedCoin, unnamed);
  const changed = [{ mint: SOL_SAMPLE.usdc, before: 12_500_000n, after: 2_500_000n }, { mint: SOL_SAMPLE.odd, before: 4_906_542_056_074_766n, after: 1_000n }];
  const rows = solCoinRows(changed, unnamed);
  const warnings = solCoinLeaving(changed, unnamed).map((text) => ({ kind: "effect-unknown" as const, text }));
  return unnamed.withDetails({ title: w.title, lines: [...w.lines, "Asked by jup.ag", "From your Apps wallet 7xKX…sAsU"], warnings, effect: [{ token: "SOL", before: "1.2", after: "1.199995" }, ...rows] });
})();
/** A protection change the account holds for 2 minutes (the Waiting screen of a held change). */
const changeBridge: Bridge = {
  async call<T>(method: string): Promise<BridgeResult<T>> {
    if (method === "account.waiting") return { ok: [{ id: "c1", title: MAINNET_CHANGE.title, lines: MAINNET_CHANGE.lines, ...(MAINNET_CHANGE.details ? { details: MAINNET_CHANGE.details } : {}), readyAtIso: new Date(Date.now() + 114e3).toISOString(), needsSecondDevice: false, ready: false, change: true }] as T };
    if (method === "account.secondDevices") return { ok: [] as T };
    return { ok: { state: "waiting" } as T };
  },
  on: () => () => {},
};
export const sampleBridge: Bridge = {
  async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
    if (method === "account.activity") return { ok: ACTIVITY as T };
    if (method.startsWith("account.waiting")) return demoBridge.call<T>(method, params);
    // Pairing: the demo's own check, so a mistyped code shows what it says (grade 1 Nov c, P14).
    if (method === "account.secondDevice.pair") return demoBridge.call<T>(method, params);
    // Security's separate wallets: one of each place a key comes back from.
    if (method === "subwallet.list") return { ok: SAMPLE_WALLETS as T };
    // No second device yet, and $5,875 in the main balance: the status line and the laptop card show.
    if (method === "account.secondDevices") return { ok: [] as T };
    if (method === "ledger.balances") return { ok: [{ usd: "5875.22" }] as T };
    // What Security's page reads to draw itself (its protection, the account's state, this device's own notes, the key's
    // proof): the demo's sample answers, read only, so every Security and Home entry here is the real screen, never "This
    // isn't available yet" (UI-SIMPLICITY round 2: eight entries couldn't be graded).
    if (method === "account.protection.get" || method === "account.state" || method === "device.store.get") return demoBridge.call<T>(method, params);
    // The key card as the iPhone shows it: the chip's key, on the account on both nodes (the gallery is the phone's look).
    if (method === "account.keyProof") return { ok: { kind: "secure-chip", fingerprint: "H62q59…ivyM", chipFingerprint: "H62q59…ivyM", chipHeld: true, madeAtIso: new Date(Date.now() - 86400e3).toISOString(), nodes: [{ node: "rpc.mainnet.fastnear.com", found: true }, { node: "free.rpc.fastnear.com", found: true }], matches: true } as T };
    // The account's rules are this build's own: no update card.
    if (method === "account.rules") return { ok: { release: 9, current: 9 } as T };
    // Being someone's guardian: guarding kim.near, one payment waiting for a yes.
    if (method === "guardian.code") return { ok: { code: `ZFL1:${"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".repeat(98).slice(0, 3123)}A`, fingerprint: "K7Q2 M9XA", accounts: params?.empty ? [] : ["kim.near"] } as T };
    if (method === "guardian.requests") return { ok: guardianWaiting.filter((r) => !guardianAnswered.has(r.id)) as T };
    // Your yes or no on the person you guard's request: it leaves your list (their account runs or drops it).
    if (method === "guardian.answer") {
      guardianAnswered.add(String(params?.id));
      return { ok: (params?.approve === true ? { status: "done", txHash: "", explorerUrl: "" } : { status: "declined" }) as T };
    }
    // The web demo reaches this too (Security's activity and guardian calls): the product's calm words, never the gallery's.
    return { problem: { code: "gallery.preview", whatHappened: "This isn't available yet. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "nothing", label: "Go back" } } };
  },
  on: (event, handler) => demoBridge.on(event, handler),
};

type Entry = { group: string; name: string; render: (back: () => void, open: (p: Problem) => void) => ReactNode };

export const noop = () => {};
export const actions = (back: () => void, open: (p: Problem) => void): SecurityActions => ({ bridge: sampleBridge, onProblem: open, onRemoveKey: noop, onStopRecovery: noop, onCheckWords: noop, onNewWords: noop, onChanged: noop, onWaiting: noop });
/** The apps' side of ?demo and ?screens: one shared MockBridge (sample ledger, trading wallets, device storage), seen
 * by each app through forApps exactly as the real core is, so an app can't reach approval.* or another app's storage. */
// `?demo&hold=20`: the account's protection holds every signature for that many seconds, to walk the Waiting screen.
const HOLD = Number(new URLSearchParams(location.search).get("hold") ?? 0);
// `?demo&bnbclosed`: float moves to BNB Chain are refused as the real core refuses them until BNB passes its own test.
// The public build has no developer switches.
/** The recorded market's coin prices (packages/trade recorded-data.ts, 25 Oct 2026; a test keeps these equal), so the float's dollars agree with what the engines show. */
export const RECORDED_COIN_USD = { sol: 101.67, bsc: 744.17, hood: 2347.2 } as const;
// `?demo&keep`: the sample state lives in this tab's sessionStorage, so a reload mid-move carries on where it was (plain
// `?demo` starts fresh every load, as before).
const KEEP = new URLSearchParams(location.search).has("demo") && new URLSearchParams(location.search).has("keep");
const keepStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};
const KEEP_STORAGE = KEEP ? keepStorage() : null;
/** The web demo (the public site, and plain `?demo`): the session is kept in this browser (localStorage, every access
 *  guarded), so a reload carries on with the sends, held payments, waiting changes and balances it had (grade 30 Oct,
 *  item 7). Start over (Settings) forgets it. `?screens` keeps nothing: it is a still picture. */
const IS_DEMO = PUBLIC_BUILD || new URLSearchParams(location.search).has("demo");
export const DEMO_KEEP: DemoKeep | null = IS_DEMO && !KEEP_STORAGE ? demoKeep() : null;
if (DEMO_KEEP) keepSampleWallets(DEMO_KEEP.storage, DEMO_WALLETS_KEY);
// One sample ledger (robot 7, 8): Trade's sample opening money lives in the mock's trading wallets, so Trade, All your
// wallets and a Take out all read the same balances (`?demo&float=empty` starts them with nothing, as before). The
// account contract's rules apply as on mainnet (robot 4, 5): big payments and every change wait, said with the real wait.
const FLOAT_EMPTY = new URLSearchParams(location.search).get("float") === "empty";
// latencyMs: each sample call answers in 60 ms, as a phone's own core does; the mock's default 250 ms stacked to seconds
// on screens that ask several times (grade 1 Nov, item 11: the apps wallet's Add and Take back, a buy).
// ZeroFee Chat's NEAR reads (J3 part 2), read-only on NEAR itself: a DAO's roles, whether a name exists, a name's key, a
// profile. The public build reads mainnet only (its CSP names no test network); `?demo` on this computer reads both.
const nearChains = new Map<string, RpcChain>();
const nearReads = (net: "mainnet" | "testnet"): RpcChain | undefined => {
  if (PUBLIC_BUILD && net !== "mainnet") return undefined;
  let c = nearChains.get(net);
  if (!c) nearChains.set(net, (c = new RpcChain(net)));
  return c;
};
// Sample money never reaches a public relay (decision, 3 Nov: the demo's split posted to a live city room): Chat on
// these pages posts to and reads from this page's own memory, set before Chat's code loads.
relaySockets.make = localRelay().make;
/** The demo starts with Hidden set up and holding money (QA, V4 Send): Pay → Approve → Paid on a demo walk. */
const HIDDEN_START = { usdc: "25", near: "2" };
export const demoBridge = createMockBridge({ latencyMs: 60, nearReads, tradeChains: ["sol", "hood", "bsc"],
  hiddenStart: HIDDEN_START, freshHistory: true, mainnetRules: {}, sampleLaptop: true, account: DEMO_ACCOUNT, sampleWords,
  ...(!PUBLIC_BUILD && new URLSearchParams(location.search).has("gmgnbnb") ? { sampleGmgnBnbUsd: 2.4 } : {}),
  // Security's Quantum-safe card, its other state (an old classical key left on the account), for screenshots
  ...(!PUBLIC_BUILD && new URLSearchParams(location.search).has("oldkey") ? { oldKey: true } : {}),
  // the Sim's sample sites (pump.fun, GMGN) start with sample SOL, so their first Buy works (sim-sites.ts)
  float: { priceUsd: (c) => RECORDED_COIN_USD[c], ...(FLOAT_EMPTY ? {} : { opening: SAMPLE_OPENING, held: simSiteHeld(RECORDED_COIN_USD.sol) }), ...(!PUBLIC_BUILD && new URLSearchParams(location.search).has("bnbclosed") ? { bnbClosed: true } : {}), ...(!PUBLIC_BUILD && new URLSearchParams(location.search).has("nearsol") ? { nearHeld: { "nep141:sol.omft.near": "150000000" } } : {}), ...(!PUBLIC_BUILD && new URLSearchParams(location.search).get("fault") === "1click" ? { nearCoin: () => undefined } : {}) },
  ...(HOLD > 0 ? { holdSeconds: HOLD } : {}),
  ...(KEEP_STORAGE ? { persist: { storage: KEEP_STORAGE } } : DEMO_KEEP ? { persist: { storage: DEMO_KEEP.storage, key: DEMO_STATE_KEY } } : {}) });
// Earn's read-only reader (earn.positions) sits in front of the mock as it sits in front of the core, so Wallet's
// balance can count sample staked NEAR here too. Apps see the routed bridge; the shell keeps the mock (it emits).
/** ?demo's Spending (D52): the one engine, on the demo Trade app's own bridge, started by Demo's AppHost. */
export const demoSpending = hostSpending(() => appBridges.get("trade")!, () => forApps(demoBridge, "trade"));
const routedShell: Bridge = routeBridge(demoBridge, { earn: createEarnReader(forApps(demoBridge, "earn")), trade: createTradeReader(forApps(demoBridge, "trade")), spending: demoSpending });
/** B28 proof: a dead service injected (?fault=bridge:521), never in the public build. */
const injected = PUBLIC_BUILD ? null : faultFromQuery(location.search);
/** The shell as the apps see it (Spending routed): Settings reads the sites' own wallets from it (Sites). */
export const demoShell: Bridge = injected ? faultedBridge(routedShell, injected) : routedShell;
const appBridges = new Map(APPS.map((m) => [m.id, forApps(demoShell, m.id)]));
// D134, as the real app (App.tsx): Home's kept copy is read now, so Home's first render has it
if (IS_DEMO) void primeHome(appBridges.get("wallet")!);
/** Once the sample account is home: Spending's engine, then Social Trading's site wallets (as the real app). */
export const demoStartHome = withSitesPrepared(demoSpending.start, () => appBridges.get("social")!);
/** Wallet's own bridge (Spending routed in), for set-up's "Your sample money is in": the same total Home opens on. */
export const demoWalletBridge: Bridge = appBridges.get("wallet")!;
/** A new account's Safe of one coin (NEAR only): the gallery's still picture of Wallet's row with one coin. */
const ONE_COIN_SHELL: Bridge = {
  call: <T,>(method: string, params?: Record<string, unknown>) => (method === "ledger.balances"
    ? demoShell.call<T>(method, params).then((r) => ("ok" in r ? { ok: (r.ok as unknown as { symbol: string; held: string }[]).filter((b) => b.symbol === "NEAR" && b.held === "ledger") as unknown as T } : r))
    : demoShell.call<T>(method, params)),
  on: (event, handler) => demoShell.on(event, handler),
};
/** ?demo's Activity: what AgentZero did in this demo (its receipts, release 10, newest first), and nothing from before the
 *  account existed (3 Nov e2e walk, 143): never the gallery's sample rows ("Removed a key", "Changed your protection"). */
async function demoActivity<T>(params?: Record<string, unknown>): Promise<BridgeResult<T>> {
  const mine = await demoBridge.call<{ txHash?: string }[]>("account.activity", params);
  // the Sim's own: AgentZero's payments and the changes that ran on the account (never the gallery's sample rows)
  const agent = "ok" in mine && Array.isArray(mine.ok) ? mine.ok.filter((r) => /^sample-(agent|change)/.test(String(r.txHash ?? ""))) : [];
  return { ok: agent as T };
}

/** ?demo's guardian: a brand-new account guards no one yet (3 Nov e2e walk, 14: it already guarded kim.near, with "Send 900
 *  USDC to bob.near" waiting and "1 waiting" on Devices): its own code to show, nothing waiting. ?screens keeps kim.near. */
function demoGuardian<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
  if (method === "guardian.requests") return Promise.resolve({ ok: [] as T });
  return sampleBridge.call<T>(method, { ...params, empty: true });
}

/** ?demo's Security: the sample activity rows, and everything else through the demo MockBridge, so Save reaches the
 *  approval sheet with sample words (the gallery's ?screens keeps sampleBridge: a still picture, nothing sent). */
export const demoSecurityBridge: Bridge = {
  // Security's activity rows and being someone's guardian (guardian.*) come from the sample; everything else is the
  // demo's MockBridge, which the rest of the app shares.
  call: <T,>(method: string, params?: Record<string, unknown>) => (method === "account.activity" ? demoActivity<T>(params) : method.startsWith("guardian.") ? demoGuardian<T>(method, params) : demoBridge.call<T>(method, params)),
  on: (event, handler) => demoBridge.on(event, handler),
};

/** `more`: ?demo's own Security actions (Check my words, Get new words, a sample recovery and its stop), walked on the
 *  real screens with sample words. */
export const hosted = (account: AccountInfo, back: () => void, open: (p: Problem) => void, onWaiting: SecurityActions["onWaiting"] = noop, securityBridge: Bridge = sampleBridge, more: Partial<SecurityActions> = {}, menu: () => void = noop): HostedApp[] => {
  // Security is inside Home (Job 1): its rows, its places and the account's own history, on the Security bridge.
  const acts: SecurityActions = { ...actions(back, open), bridge: securityBridge, onWaiting, ...more };
  return hostApps(PUBLIC_BUILD ? publicApps(APPS, true) : appsFor(APPS, mvpOn(location.search)), (id) => appBridges.get(id as AppId)!, {
    rows: (go) => <SecurityRows account={account} bridge={securityBridge} open={go} />,
    // Home's "Waiting for you" (as App.tsx): a held change, new words too, is a row with its time left, never only in Security
    waiting: () => <SecurityWaiting bridge={securityBridge} />,
    place: (place, step, onBack) => <SecurityPlace account={account} actions={acts} place={place} step={step} onBack={onBack} />,
    accountActivity: () => <AccountActivity bridge={securityBridge} />,
    thread: (go) => <AccountThread account={account} bridge={securityBridge} onOpen={(step) => (step === "protected" ? go.place("protection") : step === "device" ? go.place("devices") : step === "words" ? acts.onCheckWords() : go.addMoney())} />,
    // S-2: the Safe's health check, the same lines and fixes as the app's (App.tsx)
    health: (go) => <Suspense fallback={null}><SafeHealth account={account} bridge={securityBridge} rules={HEALTH_RULES} phone={iosHost()} go={{ ...go, checkWords: () => acts.onCheckWords(), settings: () => menu() }} /></Suspense>,
  });
};


const ENTRIES: Entry[] = [
  { group: "Start", name: "Title · loading", render: () => <Title /> },
  { group: "Start", name: "Welcome", render: () => <Welcome onCreate={noop} onRestore={noop} /> },
  { group: "Design", name: "Coin logos (bundled, else a monogram)", render: () => (
    <div className="zf-screen zf-pad" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, alignContent: "start", paddingTop: 80 }}>
      {["usdc", "usdt", "eth", "btc", "sol", "bnb", "xrp", "trx", "xlm", "pol", "bsc", "stellar", "near", "base", "hood", "eure"].map((k) => (
        <div key={k} style={{ display: "grid", justifyItems: "center", gap: 6 }}><CoinIcon symbol={k} icon={k} size={40} /><span className="zf-small">{k}</span></div>
      ))}
    </div>
  ) },
  { group: "Create your bank", name: "Make your key · the terms and the recovery wait (48 hours · Change) on one screen", render: (back) => <MakeKeySample back={back} terms /> },
  { group: "Create your bank", name: "Make your key · terms already agreed", render: (back) => <MakeKeySample back={back} terms={false} /> },
  { group: "Create your bank", name: "Terms · one tap (bringing an account back)", render: (back) => <Terms onBack={back} onAgree={back} /> },
  { group: "Create your bank", name: "Opening (loading)", render: () => <Working text="Opening your account…" /> },
  { group: "Create your bank", name: "Backup words", render: () => <Words words={WORDS} onDone={noop} /> },
  { group: "Security", name: "Add a guardian (someone you trust)", render: (back, open) => <LaptopFlow kind="guardian" actions={actions(back, open)} onDone={back} /> },
  { group: "Security", name: "Be someone's guardian · your code", render: (back, open) => <GuardianSide bridge={{ ...sampleBridge, call: (m, p) => sampleBridge.call(m, { ...p, empty: true }) }} onBack={back} onProblem={open} /> },
  { group: "Security", name: "Be someone's guardian · a payment waiting for your yes", render: (back, open) => <GuardianSide bridge={sampleBridge} onBack={back} onProblem={open} /> },
  { group: "Security", name: "New backup words · write them down", render: (back) => <Words renew words={WORDS} onBack={back} onDone={back} /> },
  { group: "Security", name: "New backup words · check three", render: (back) => <Check renew words={WORDS} onBack={back} onDone={back} /> },
  { group: "Security", name: "New backup words · on their way (24 h)", render: (back) => <RenewDone waitingUntilIso={new Date(Date.now() + 86400e3).toISOString()} onDone={back} /> },
  { group: "Security", name: "New backup words · in", render: (back) => <RenewDone onDone={back} /> },
  // Dead ends row 8: a move that didn't go is named, the money's place said, and Try again offered
  { group: "Security", name: "New backup words · a move didn't go (Try again)", render: (back) => <RenewDone moved="Moving your private money to your Safe. Your NEAR wallet's money didn't move. It's still under your old words." stuck onMove={noop} onDone={back} /> },
  { group: "Security", name: "New backup words · nothing needed moving", render: (back) => <RenewDone moved="Nothing here needed moving. Wallet's Details shows any others." onMove={noop} onDone={back} /> },
  { group: "Security", name: "AgentZero · turns that failed, each cause by name", render: () => <Suspense fallback={null}><FailedTurns /></Suspense> },
  { group: "Create your bank", name: "Quick check", render: (back) => <Check words={WORDS} onBack={back} onDone={noop} /> },
  { group: "The app", name: "Waiting · a protection change (says nothing changes once)", render: (back) => <WaitingView bridge={changeBridge} held={{ id: "c1", readyAtIso: new Date(Date.now() + 114e3).toISOString(), needsSecondDevice: false }} onClose={back} /> },
  { group: "The app", name: "Put away · nothing in Spending (says why, no grey button)", render: (back) => <div className="zf-screen"><Working text="" /><PutAwaySheet status={{ loaded: true, totalUsd: "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "500.00", ready: true, networks: [] } as unknown as SpendingStatus} onClose={back} onDone={() => back()} onOpen={noop} /></div> },
  { group: "Create your bank", name: "Approval sheet", render: () => <div className="zf-screen"><Working text="" /><ApprovalSheetView words={SEND_WORDS} onAnswer={noop} /></div> },
  { group: "Create your bank", name: "Approval sheet · long (12 lines, 6 effects, scrolls)", render: () => <div className="zf-screen"><Working text="" /><ApprovalSheetView words={LONG_WORDS} onAnswer={noop} /></div> },
  { group: "Create your bank", name: "Approval sheet · change your protection on mainnet (every coin counts)", render: () => <div className="zf-screen"><Working text="" /><ApprovalSheetView words={CHANGE_WORDS} onAnswer={noop} /></div> },
  { group: "Create your bank", name: "Approval sheet · start moving your account to this device (summary first)", render: () => <div className="zf-screen"><Working text="" /><ApprovalSheetView words={START_MOVE_WORDS} onAnswer={noop} /></div> },
  { group: "Create your bank", name: "Approval sheet · a Solana request: USDC and a coin ZeroFee can't name", render: () => <div className="zf-screen"><Working text="" /><ApprovalSheetView words={SOL_WORDS} onAnswer={noop} /></div> },
  { group: "Create your bank", name: "Your bank is open", render: () => <BankOpen accountId={ACCOUNT.accountId} onEnter={noop} onLaptop={noop} /> },
  { group: "The app", name: "All apps (the app bar, or a swipe from anywhere)", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open)} onMenu={noop} shellBridge={demoBridge} /> },
  { group: "The app", name: "Home · a move to a new phone waits for the laptop's yes (account rules version 7)", render: (back, open) => <AppHost apps={hosted(PENDING_7, back, open)} onMenu={noop} shellBridge={demoBridge} notice={(() => { const f = freezeNotice({ pending: MOVE, frozenUntilIso: MOVE.canFinishAtIso })!; return freezeNoticeItem(f, <FreezeBanner notice={f} onCancel={back} onNewWords={back} bare />); })()} /> },
  { group: "The app", name: "Home · a recovery was started, payments wait (no second device)", render: (back, open) => <AppHost apps={hosted(PENDING, back, open)} onMenu={noop} shellBridge={demoBridge} notice={(() => { const f = freezeNotice({ pending: PENDING.recovery!.pending, frozenUntilIso: PENDING.recovery!.pending!.readyAtIso })!; return freezeNoticeItem(f, <FreezeBanner notice={f} onCancel={back} bare />); })()} /> },
  { group: "Security", name: "Face ID changed · turn approvals back on", render: (back) => <div className="zf-screen zf-pad"><Rearm bridge={sampleBridge} onProblem={back} onMoving={back} startOpen /></div> },
  { group: "Every problem", name: "Add money past $5,000 · add a second device first", render: (back) => <ProblemView problem={securityProblems.vaultNeedsSecondDevice(VAULT_LIMIT_USD)} onNext={back} onOpen={back} onNext2={back} /> },
  { group: "The app", name: "Home · a recovery was stopped, payments wait 3 days", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open)} onMenu={noop} shellBridge={demoBridge} notice={(() => { const f = freezeNotice({ pending: null, frozenUntilIso: new Date(Date.now() + 3 * 86400e3).toISOString() })!; return freezeNoticeItem(f, <FreezeBanner notice={f} onCancel={back} bare />); })()} /> },
  { group: "The app", name: "The tray (every app; hold and drag one, the top four are the bottom row)", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open)} onMenu={noop} shellBridge={demoBridge} startWithTray /> },
  { group: "The app", name: "Settings (top-left)", render: (back, open) => <><AppHost apps={hosted(ACCOUNT, back, open)} onMenu={noop} shellBridge={demoBridge} /><SettingsPanel accountId={ACCOUNT.accountId} onClose={back} /></> },
  { group: "Wallet", name: "Home: Safe and Spending (Balance)", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open)} onMenu={noop} shellBridge={demoBridge} start={{ id: "wallet" }} /> },
  { group: "Wallet", name: "Home · a Safe of one coin (NEAR): its row still leads with dollars", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open).map((x) => (x.id.startsWith("site:") ? x : { ...x, bridge: forApps(ONE_COIN_SHELL, x.id as AppId) }))} onMenu={noop} shellBridge={demoBridge} start={{ id: "wallet" }} /> },
  { group: "Wallet", name: "Details: every wallet, its address and its key", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open)} onMenu={noop} shellBridge={demoBridge} start={{ id: "wallet", tab: "details" }} /> },
  { group: "Security", name: "Another phone can still sign (Devices)", render: (back, open) => <AppHost apps={hosted(WITH_OLD_PHONE, back, open)} onMenu={noop} shellBridge={demoBridge} start={{ id: "security", tab: "devices" }} /> },
  { group: "Security", name: "A new phone is waiting (Recovery)", render: (back, open) => <AppHost apps={hosted(PENDING, back, open)} onMenu={noop} shellBridge={demoBridge} start={{ id: "security", tab: "recovery" }} /> },
  { group: "Bring back my account", name: "Your 24 words", render: (back) => <RestoreWords onBack={back} onSubmit={noop} /> },
  { group: "Bring back my account", name: "Waiting for your second device (countdown, the 7-day fallback)", render: () => <RecoveryWaiting pending={MOVE} delaySeconds={172800} onFinish={noop} /> },
  { group: "Bring back my account", name: "Your second device said yes (countdown)", render: () => <RecoveryWaiting pending={MOVE_YES} delaySeconds={172800} onFinish={noop} /> },
  { group: "Bring back my account", name: "Ready: Finish", render: () => <RecoveryWaiting pending={{ ...MOVE_YES, readyAtIso: inDays(-0.01), canFinishAtIso: inDays(-0.01) }} delaySeconds={172800} onFinish={noop} /> },
  { group: "Bring back my account", name: "On its way (no second device)", render: () => <RecoveryWaiting pending={PENDING.recovery!.pending!} delaySeconds={172800} onFinish={noop} /> },
  { group: "Bring back my account", name: "Was this you? (old phone, with a laptop)", render: (back) => <WasThisYou pending={MOVE} onStop={back} onItsMe={back} /> },
  { group: "Bring back my account", name: "Was this you? (old phone, no second device)", render: (back) => <WasThisYou pending={PENDING.recovery!.pending!} onStop={back} onItsMe={back} /> },
  { group: "On the laptop", name: "A move to a new phone: Approve or Refuse", render: () => <LaptopShows requests={[laptopReq({})]} /> },
  { group: "On the laptop", name: "A move it already said yes to: Refuse is left", render: () => <LaptopShows requests={[laptopReq({ needsSecondDevice: false, lines: ["This device already said yes. A no still ends the move."] })]} /> },
  { group: "On the laptop", name: "The phone asked to stop the move: refuse and freeze, or confirm the stop (no freeze)", render: () => <LaptopShows requests={[laptopReq({}), STOP_REQ]} /> },
  { group: "On the laptop", name: "The phone asked to remove this laptop (a warning)", render: () => <LaptopShows requests={[REMOVAL_REQ]} /> },
  { group: "Bring back my account", name: "Check my words", render: (back) => <RestoreWords purpose="check" onBack={back} onSubmit={noop} /> },
  { group: "Every problem", name: "Problem screen", render: (back) => <ProblemView problem={PROBLEM} onNext={back} /> },
  { group: "Every problem", name: "That request isn't waiting any more (See Activity)", render: (back) => <ProblemView problem={endedWords({ state: "unknown" })} onNext={back} onOpen={back} /> },
  { group: "Every problem", name: "That request isn't waiting any more · in the app (See Activity opens Activity)", render: (back, open) => <AppHost apps={hosted(ACCOUNT, back, open).map((a) => a.id === "wallet" ? { ...a, render: () => <>{a.render()}<ShowsOnce problem={endedWords({ state: "unknown" })} /></> } : a)} onMenu={noop} shellBridge={demoBridge} start={{ id: "wallet" }} /> },
];

/** Hands the shell one Problem as soon as it is on screen, as an app would after a failed call. */
function ShowsOnce({ problem }: { problem: Problem }) {
  const shell = useShell();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void shell.showProblem(problem);
  }, [shell, problem]);
  return null;
}

export function Screens() {
  const [open, setOpen] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const back = () => { setOpen(null); setProblem(null); };
  if (problem) return <><ProblemView problem={problem} onNext={() => setProblem(null)} /><Back onClick={back} /></>;
  if (open !== null) return <>{ENTRIES[open].render(back, setProblem)}<Back onClick={back} /></>;
  const groups = [...new Set(ENTRIES.map((e) => e.group))];
  return (
    <div className="zf-screen zf-pad gal">
      <div className="gal__head">
        <Mark size={44} mode="still" />
        <div className="zf-label" style={{ marginTop: 20 }}>ZeroFee · every screen</div>
        <p className="zf-small" style={{ marginTop: 8 }}>Sample data, nothing sent. The real app is at <a href="/">the start page</a>.</p>
      </div>
      <div className="gal__list">
        {groups.map((g) => (
          <section key={g}>
            <div className="zf-label gal__group">{g}</div>
            {ENTRIES.map((e, i) => e.group === g && (
              <button key={e.name} className="gal__item" onClick={() => setOpen(i)}><span>{e.name}</span><span aria-hidden="true">→</span></button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  // Doubles as the sample-data marker: always visible on every previewed screen.
  return <button className="gal__back" onClick={onClick}>Sample data · All screens</button>;
}
