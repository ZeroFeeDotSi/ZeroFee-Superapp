// The "Add money to start" walk (/?screens&walk=fund, never in the public build): the REAL core (DemoCore) and the real
// screens (FundingShell, FundFlow, FundBar), on a fake mainnet (packages/core/src/testing/fake-chain.ts) with 1Click
// stubbed: its quotes signed with the tests' key (the core takes that key only here and in tests), its statuses set
// by the walk through window.__fund. So every tick on screen is the core's own reading of a status or of the chain.
// Nothing leaves this page: no network, no money.
import { useEffect, useState } from "react";
import { DemoCore } from "@zerofee/core/demo-core";
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { SoftwareKey } from "@zerofee/core/device-key";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { MemoryVault } from "@zerofee/core/vault";
import { signedQuote, TEST_QUOTE_KEY } from "@zerofee/core/quote-test-key";
import { toBase58 } from "@fastnear/utils";
import { ACCOUNT_POLICY } from "@zerofee/core/known-contracts";
import { AppHost, type HostedApp } from "../shell/AppHost.tsx";
import { ProblemView } from "../shell/ProblemView.tsx";
import { Check, Words } from "../screens/Onboarding.tsx";
import { FundingShell } from "../screens/FundingShell.tsx";
import { FundFlow, FundThread, useFundStatus } from "../screens/FundStart.tsx";

/** The walk's Home: the one thread while the funding is on record (Job 1), as Home shows it. */
function WalkThread({ bridge, onOpen, onGone }: { bridge: Bridge; onOpen: () => void; onGone: () => void }) {
  const [v, , , gone] = useFundStatus(bridge, true);
  if (gone) queueMicrotask(onGone);
  return v && !gone ? <FundThread v={v} onOpen={onOpen} /> : null;
}
import { ModeMark } from "../shell/ModeMark.tsx";
import policyUrl from "../../../../contracts/account-policy/release/account_policy.wasm?url";

// The fake chain is the tests' (node): the few Buffer calls it makes, for this page only.
const WalkBuffer = {
  from(v: unknown, enc?: string): Uint8Array {
    const b = typeof v === "string" ? (enc === "base64" ? Uint8Array.from(atob(v), (c) => c.charCodeAt(0)) : new TextEncoder().encode(v)) : new Uint8Array(v as ArrayLike<number>);
    return Object.assign(b, { toString: (e?: string) => (e === "base64" ? btoa(String.fromCharCode(...b)) : new TextDecoder().decode(b)) });
  },
};
(globalThis as unknown as { Buffer?: unknown }).Buffer ??= WalkBuffer;
const chain = new FakeChain("mainnet");
chain.fund("near", SoftwareKey.generate().publicKey, 0n);
// As on mainnet since 1 Nov: the account's rules are published by hash, so a new account stores no copy of them.
chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
const vault = new MemoryVault();
/** Deposit address → the signed quote 1Click gave for it (so a status carries the same signed terms). */
const quotes = new Map<string, Record<string, unknown>>();
const statuses = new Map<string, { status: string; swapDetails?: Record<string, string> }>();
let funding: { fundAddress: string; needYocto: string } | null = null;
let clockShift = 0;
const realNow = Date.now;
Date.now = () => realNow() + clockShift;
let breakOpen = false;
let coinsSlowMs = 0;
const sampleAddress = (chainId: string, n: number) =>
  chainId === "sol" ? ["7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"][n % 2] : ["0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE", "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"][n % 2];
let made = 0;
// The walk's "the network is down" for the opening: the next transaction sent fails, once.
const send = chain.send.bind(chain) as (...a: unknown[]) => ReturnType<FakeChain["send"]>;
(chain as unknown as { send: (...a: unknown[]) => unknown }).send = async (...a: unknown[]) => {
  if (breakOpen) {
    breakOpen = false;
    throw new Error("node down");
  }
  return send(...a).catch((e: unknown) => {
    console.warn("walk chain refused:", e);
    throw e;
  });
};

async function quoter(req: Record<string, any>) {
  const isSol = String(req.originAsset).startsWith("nep141:sol");
  const want = BigInt(req.swapType === "EXACT_OUTPUT" ? req.amount : (window as any).__fundWant ?? "0");
  if (req.swapType === "EXACT_OUTPUT") (window as any).__fundWant = req.amount;
  const priced = isSol ? "19060833" : String(req.originAsset).includes("usd") ? "1816882" : "788200000000000";
  const amountIn = req.swapType === "EXACT_OUTPUT" ? priced : req.amount;
  const min = ((BigInt(amountIn) * 99n) / 100n).toString();
  const quote: Record<string, unknown> = { amountIn, minAmountIn: min, amountInUsd: "1.82", amountOut: want.toString(), minAmountOut: ((want * 99n) / 100n).toString(), timeEstimate: 22, ...(req.dry ? {} : { depositAddress: sampleAddress(isSol ? "sol" : "evm", made++), deadline: new Date(Date.now() + 3 * 86_400_000).toISOString() }) };
  const signed = signedQuote({ quoteRequest: req, quote });
  if (!req.dry) quotes.set(String(quote.depositAddress), signed);
  return signed;
}

async function oneClick(depositAddress: string) {
  const q = quotes.get(depositAddress);
  if (!q) return null;
  const s = statuses.get(depositAddress) ?? { status: "PENDING_DEPOSIT" };
  return { status: s.status, quoteResponse: q, swapDetails: s.swapDetails ?? {} };
}

/** The coins' own networks, as the deposit watcher (J2) reads them: set by the walk (__fund.chain), nothing fetched. */
const held = new Map<string, bigint>();
const sol = { balance: async (a: string) => held.get(a) ?? 0n, tokenAccounts: async () => [] };
const evm = { tokenBalance: async () => 0n, account: async (_c: string, a: string) => [{ latest: 0, pending: 0, balance: held.get(a) ?? 0n }, { latest: 0, pending: 0, balance: held.get(a) ?? 0n }] };

function makeCore() {
  const core = new DemoCore({
    chain, vault, policyWasm: () => fetch(policyUrl).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    prices: async () => ({ near: 4.31 }), nativeUsd: async () => 4.31, sheetPrices: false, quoter, oneClick, quoteKey: TEST_QUOTE_KEY,
    watchIntervalMs: 60_000, indexRetryMs: 1, settleMs: 1, fundStatusEveryMs: 0,
    // the developers' walk holds the core itself (never in the public build), so its own calls are the shell's
    unstampedIsShell: true,
    sol: sol as unknown as NonNullable<ConstructorParameters<typeof DemoCore>[0]["sol"]>, evm: evm as unknown as NonNullable<ConstructorParameters<typeof DemoCore>[0]["evm"]>,
  });
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
  // __fund.slowCoins: the coins' read as slow as mainnet's can be (it asks the chain and NEAR's price first)
  const call = core.call.bind(core) as (m: string, p?: Record<string, unknown>) => Promise<unknown>;
  (core as unknown as { call: typeof call }).call = async (m, p) => {
    if (m === "account.fund.coins" && coinsSlowMs > 0) await new Promise((r) => setTimeout(r, coinsSlowMs));
    return call(m, p);
  };
  return core;
}

/** The walk's handles (tools/fund/walk.mjs): what 1Click and the chain do next. */
const latest = () => [...quotes.keys()].at(-1)!;
(window as any).__fund = {
  status(status: string, details: Record<string, string> = {}) {
    statuses.set(latest(), { status, swapDetails: details });
  },
  /** The coin lands at the latest deposit address on its own network (J2's watcher sees it before 1Click says anything). */
  chain(units: string) {
    held.set(latest(), BigInt(units));
  },
  /** The NEAR lands at the account's setup address: what it needs, plus `extra` NEAR. */
  arrive(extra = 0) {
    if (!funding) return;
    if (!chain.accounts.has(funding.fundAddress)) chain.fund(funding.fundAddress, `ed25519:${toBase58(Uint8Array.from(funding.fundAddress.match(/../g)!.map((h) => parseInt(h, 16))))}`, 0n);
    chain.accounts.get(funding.fundAddress)!.balance = BigInt(funding.needYocto) + BigInt(Math.round(extra * 1000)) * 10n ** 21n;
  },
  /** O-2b: what the Safe holds in NEAR after the opening (Wallet's NEAR row), and whether 1Click refuses the win. */
  safe(near: number) {
    safeNear = near;
  },
  winFail(on = true) {
    winFail = on;
  },
  breakOpen() {
    breakOpen = true;
  },
  slowCoins(ms: number) {
    coinsSlowMs = ms;
  },
  later(minutes: number) {
    clockShift += minutes * 60_000;
  },
};

/** Wallet's side of the first win (O-2b), as its ledger answers: Hidden's wallet, the Safe's NEAR row (set by the walk,
 *  __fund.safe), the price, the move, then its record reading done (or, with __fund.winFail, 1Click's refusal). */
let restAt = 0;
let safeNear = 0;
let winFail = false;
let hiddenMade = false;
const wallet: Bridge = {
  call: async <T,>(method: string): Promise<any> => {
    if (method === "ledger.private") return { ok: { available: true, ready: hiddenMade, rows: [], defaultOn: false, canAdd: true } };
    if (method === "ledger.privateSetup") {
      hiddenMade = true;
      return { ok: { available: true, ready: true, rows: [], defaultOn: false } };
    }
    if (method === "ledger.balances") return { ok: safeNear > 0 ? [{ tokenId: "near", symbol: "NEAR", name: "NEAR", icon: "near", chain: "near", amount: String(safeNear), usd: (safeNear * 4.31).toFixed(2), bridged: false, held: "account", listed: true }] : [] };
    if (method === "ledger.quoteToPrivate") {
      if (winFail) return { problem: { code: "ledger.private.quote", whatHappened: "NEAR Intents didn't give a safe price. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" } } };
      return { ok: { id: "pq-walk" } };
    }
    if (method === "ledger.toPrivate") {
      restAt = Date.now();
      return { ok: { id: "private:walk", status: "moving" } };
    }
    if (method === "ledger.activity") return { ok: [{ id: "private:walk", status: Date.now() - restAt > 3000 ? "done" : "moving" }] as T };
    return { problem: { code: "walk.unknown", whatHappened: "Not in this walk.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } };
  },
  on: () => () => {},
};

const APPS = [
  { id: "wallet" as const, name: "Wallet", line: "" },
  { id: "trade" as const, name: "Trade", line: "" },
  { id: "pay" as const, name: "Pay", line: "" },
];

type View = { k: "boot" } | { k: "funding"; away: boolean } | { k: "words"; words: string[]; first?: boolean } | { k: "wordsCheck"; words: string[] } | { k: "home" } | { k: "check" } | { k: "problem"; problem: Problem };

/** With mainnet's own chip on top, as the phone shows it: the walk checks nothing sits under it. */
export function FundWalk({ homeApps }: { homeApps?: () => HostedApp[] }) {
  return <><FundWalkScreens homeApps={homeApps} /><ModeMark mode="real" /></>;
}

function FundWalkScreens({ homeApps }: { homeApps?: () => HostedApp[] }) {
  const [core, setCore] = useState<DemoCore>(() => makeCore());
  const [view, setView] = useState<View>({ k: "boot" });
  const [fundOn, setFundOn] = useState(true);
  // The walk's restart: a new core on the same vault and chain, as when the phone kills and reopens the app.
  useEffect(() => {
    (window as any).__fund.create = () => core.call("account.create");
    // O-2a's walk: the coins shown while the words are still due (as a screen bug would), so the core's refusal shows.
    (window as any).__fund.skipWords = () => setView({ k: "funding", away: false });
    (window as any).__fund.restart = () => {
      core.close();
      setCore(makeCore());
      setView({ k: "boot" });
    };
  }, [core]);

  async function route() {
    const state = await core.call<{ stage: string }>("account.state");
    const stage = "ok" in state ? state.ok.stage : "none";
    if (stage === "none") {
      const made = await core.call<{ fundAddress: string; needYocto: string }>("account.create");
      if ("ok" in made) funding = made.ok;
      return route();
    }
    // Words first (J2), as App.tsx routes: the core's wordsDue, before any money.
    if (stage === "needs-funding" && "ok" in state && (state.ok as { wordsDue?: boolean }).wordsDue) return words(true);
    if (stage === "needs-funding") {
      const s = await core.call<{ away: boolean; deposit?: unknown }>("account.fund.status");
      return setView({ k: "funding", away: "ok" in s && s.ok.away && !!s.ok.deposit });
    }
    if (stage === "needs-backup") return words();
    setView({ k: "home" });
  }
  useEffect(() => {
    if (view.k === "boot") void route();
  }, [view.k, core]);

  async function words(first = false) {
    const w = await core.call<{ words: string[] }>("recovery.words");
    if ("ok" in w) setView({ k: "words", words: w.ok.words, first });
  }
  /** The check of three, words first (J2): the real Check screen; then the money. The walk taps the right words. */
  async function checked(w: string[], positions: number[], picked: string[]) {
    const r = await core.call("recovery.confirm", { positions, words: picked });
    if ("problem" in r) return setView({ k: "problem", problem: r.problem });
    (window as any).__fund.words = null;
    setView({ k: "boot" });
    void w;
  }
  async function wordsDone(w: string[]) {
    const r = await core.call("recovery.confirm", { positions: [3, 11, 20], words: [w[2], w[10], w[19]] });
    if ("problem" in r) return setView({ k: "problem", problem: r.problem });
    setView({ k: "home" });
  }

  const shell = APPS.map((a) => ({ ...a, bridge: core as Bridge }));
  switch (view.k) {
    case "boot":
      return null;
    case "funding":
      return <FundingShell key={String(view.away)} bridge={core} wallet={wallet} apps={shell} away={view.away} everyMs={1000} onWords={() => void words()} onReroute={() => setView({ k: "boot" })} onProblem={(problem) => setView({ k: "problem", problem })} />;
    case "words":
      // The fake chain's throwaway words, handed to the walk so it can tap the right ones (never the real app's).
      (window as any).__fund.words = view.words;
      return view.first
        ? <Words words={view.words} onDone={() => setView({ k: "wordsCheck", words: view.words })} />
        : <Words words={view.words} onDone={() => void wordsDone(view.words)} />;
    case "wordsCheck":
      return <Check words={view.words} onBack={() => setView({ k: "words", words: view.words, first: true })} onDone={(pos, picked) => void checked(view.words, pos, picked)} />;
    case "check":
      return <FundFlow bridge={core} wallet={wallet} everyMs={1000} onAway={() => setView({ k: "home" })} onWords={() => setView({ k: "home" })} onDone={() => { setFundOn(false); setView({ k: "home" }); }} onWordsFirst={() => setView({ k: "boot" })} onProblem={(problem) => setView({ k: "problem", problem })} />;
    case "home": {
      const apps = homeApps?.() ?? shell.map((a) => ({ ...a, render: () => <div className="zf-screen"><header className="af-top"><span className="zf-label">{a.name}</span></header><div className="fs-opening"><p className="zf-small">Sample screen for the walk</p></div></div> }));
      return <AppHost apps={apps} onMenu={() => {}} shellBridge={core} start={{ id: "wallet" }} notice={fundOn ? <WalkThread bridge={core} onOpen={() => setView({ k: "check" })} onGone={() => setFundOn(false)} /> : null} />;
    }
    case "problem":
      return <ProblemView problem={view.problem} onNext={() => setView({ k: "boot" })} />;
  }
}
