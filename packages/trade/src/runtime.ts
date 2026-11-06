// One market and one trade service per bridge, made the same way for the Trade app and for Trade's read-only reader
// (reader.ts). The engines: Solana's own (sol/chain.ts) and the EVM one for real trading wallets; the sample engine and the
// recorded market for the shell's sample wallets (?demo), so nothing real is ever touched there.
import { every as restEvery } from "@zerofee/shell-api/rest.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { sessionRefusal } from "@zerofee/core/solana";
import { createDemoEngine, isSampleAddress } from "./demo-engine.ts";
import { createMarket } from "./market/index.ts";
import { createSwitchMarket } from "./market/switch.ts";
import type { NearRpc } from "./market/near.ts";
import type { NearEngineDeps } from "./near/engine.ts";
import type { ChainEngine } from "./types.ts";
import { browserWs } from "./market/hub.ts";
import type { Market } from "./market/types.ts";
import { createTradeService, type TradeService } from "./service.ts";
import { createSolChain } from "./sol/chain.ts";
import { jitoSender } from "./sol/jito.ts";
import { relaySender } from "./sol/relay-send.ts";
import { createSolRpc } from "./sol/rpc.ts";
import { createSolScreen, type BuyRefusal } from "./sol/screen.ts";
import { createEvmEngine } from "./evm/engine.ts";
import { createEvmRpc } from "./evm/rpc.ts";
import type { ChainId } from "./types.ts";
import { TradeError } from "./errors.ts";
import { ProblemError } from "@zerofee/core/problem";
import { bridgeWallets, createCoreFloat } from "./float-core.ts";
import { SAMPLE_PACE, type PrivacyRules } from "./float.ts";
import { proven } from "./float-view.ts";

/**
 * Chains Trade offers: each can be funded and traded (no "coming soon" rows, D13). BNB Chain: sending BNB from another
 * wallet always, and from the balance when it holds BNB (a same-coin pay); USDC into BNB joins once Wallet opens converts.
 */
export const OFFERED: ChainId[] = (["sol", "hood", "bsc"] as ChainId[]).filter(proven);
export const CHAIN_NAME: Record<ChainId, string> = { sol: "Solana", bsc: "BNB Chain", hood: "Robinhood Chain", near: "NEAR" };
/** Chains whose coins Trade lists and opens (Discover, search, Home's trending): the trading chains, and NEAR (TN1), whose
 *  coins trade inside Spending's private balance rather than from a wallet of their own. */
export const LISTED: ChainId[] = [...OFFERED, "near"];
/** The chains whose coins Trade's market buys and sells: the trading chains. Not NEAR (gates grade, 5 Nov: the old
 *  NEAR flag, a dead "open soon", is gone). A NEAR coin has one switch, NATIVE_COINS (shell-api release.ts): on, its page
 *  is the Safe's own, trading with NEAR Intents (app/requests.ts nearCoinNative); off, its page here shows its chart and
 *  facts, and says plainly that Trade doesn't buy or sell it (NEAR_NOT_TRADED). Rhea trades from the NEAR coin wallet
 *  (near/route.ts, built) are a different path: they wait for their real-money proof, behind this list and the core's own
 *  NEAR_GATE (near-gate.ts). */
export const MARKET: ChainId[] = LISTED.filter((c) => c !== "near");
/** A coin page on a chain not in MARKET, in place of Buy, and AgentZero's refusal for one (the Copywriter, 5 Nov). */
export const NEAR_NOT_TRADED = "Trade doesn't buy or sell NEAR coins.";

/** NEAR's node reader, loaded the first time a NEAR coin's own contract is read (never in Home's first load). */
function lazyNearRpc(): NearRpc {
  let rpc: Promise<NearRpc> | undefined;
  return async (method, params) => (await (rpc ??= import("./market/near.ts").then((m) => m.createNearRpc())))(method, params);
}

/** NEAR's trade engines, loaded the first time a NEAR coin is quoted or held (never in Home's first load): a coin with a
 *  Rhea pool trades on Rhea from the NEAR coin wallet (near/rhea.ts, product decision, 3 Nov), any other inside Spending through
 *  1Click (near/engine.ts); near/route.ts picks. */
function lazyNearEngine(d: NearEngineDeps): ChainEngine {
  let made: Promise<ChainEngine> | undefined;
  // each door hands its call to the engines once they're loaded (Home's JS budget: kept small here)
  const later = <K extends "prepare" | "settle" | "followMove" | "holdings" | "send" | "status" | "fill">(k: K) => (async (...a: unknown[]) => ((await (made ??= import("./near/route.ts").then((m) => m.nearEngines(d))))[k] as (...x: unknown[]) => unknown)(...a)) as unknown as NonNullable<ChainEngine[K]>;
  return { chain: "near", owner: d.owner, prepare: later("prepare"), settle: later("settle"), followMove: later("followMove"), holdings: later("holdings"), send: later("send"), status: later("status"), fill: later("fill"), txHash: () => { throw new Error(); }, poolChanged: () => {} };
}

export interface TradeRuntime {
  svc: TradeService; market: Market;
  /** One balance (TRADE-FLOAT.md): the Trading balance, the chains' wallets and the background moves. `start` runs the
   *  planner while Trade is on screen and unlocked, and returns the stop; `traded` is told about every trade that lands. */
  float: ReturnType<typeof createCoreFloat>;
  /** ?demo: the shell's sample wallets and the recorded market (a pasted address works only for the recorded coins). */
  sample: Promise<boolean>;
  /** The coins Buy would refuse, with why, so a list never offers one (Solana mints; other chains' refusals come at Buy). */
  refused(chain: ChainId, coins: string[]): Promise<Map<string, BuyRefusal>>;
  /** After `refused` answered: true only when the chain's own read (two nodes, sol/screen.ts) found the coin clean. Display
   *  only (the coin page's Freeze row); every Buy path reads the mint again. */
  mintClean?(chain: ChainId, coin: string): boolean;
}

/** A ?demo flag from the page's address (?demo&float=empty), nothing under node. */
const demoFlag = (k: string): string | null => (typeof location === "undefined" ? null : new URLSearchParams(location.search).get(k));

/** The build's market relay (VITE_ZEROFEE_RELAY), read where a bundler set it; nothing under node. */
const buildRelay = (): string | undefined => (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_RELAY;

export function createTradeRuntime(bridge: Bridge): TradeRuntime {
  // the market reads GeckoTerminal and, read-only, the chains themselves; ?demo trades nothing on a chain and reads no node.
  // The lists read the coins' Solana mints (reads only) to leave out what Buy refuses, and a real Solana wallet's engine
  // checks the mint itself before any trade
  const solRpc = createSolRpc();
  // send speed A2a: a signed Solana trade also goes to Jito's public block engine (the same bytes, no tip)
  const jito = jitoSender();
  // send speed A1: and through the build's relay to its paid node, when the build names a relay (else the nodes alone)
  const relaySend = relaySender(buildRelay());
  // ?demo (the shell's sample wallets): the market answers from recordings, never the network, so a demo never meets a
  // shared connection's rate limit (market/recorded.ts, loaded only then). Everywhere else, the live client.
  const sample = bridge.call<{ address: string }[]>("subwallet.list", {}).then((r) => !("problem" in r) && r.ok.some((w) => isSampleAddress(w.address)), () => false);
  const market = createSwitchMarket(sample.then(async (yes) => {
    // the build's market relay (apps/quotes; VITE_ZEROFEE_RELAY, a public address): the GeckoTerminal key stays on it
    // the chain is read beside it (read-only), so a coin pasted minutes after its launch is found before the market data lists it
    // D157: the Chrome extension has no Sim at all: always the live market (read inline, so the recorded one doesn't ship)
    if (!yes || ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_TARGET === "extension" && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_EXTENSION_CHECK !== "1")) {
      const evm = { bsc: createEvmRpc({ chain: "bsc" }), hood: createEvmRpc({ chain: "hood" }) };
      // the open coin's live price over the chains' sockets (WS_HOSTS only; polling behind them, and wherever a CSP refuses wss:)
      const ws = browserWs();
      return createMarket({ relay: buildRelay(), solRpc: (m, p) => solRpc.call(m, p), evmRpc: (chain, m, p) => evm[chain].call(m, p), nearRpc: lazyNearRpc(), ...(ws ? { ws } : {}) });
    }
    const [{ createRecordedFetch, withFault }, { RECORDED }, { withSamples, sampleChecks, sampleLiveTrades }] = await Promise.all([import("./market/recorded.ts"), import("./market/recorded-data.ts"), import("./market/demo-samples.ts")]);
    // the two sample coins nobody can sell back (BNB, Robinhood) are in its data, and their checks come from a sample chain
    // logos as on mainnet: through the build's relay, the only image host the page's CSP allows (the recorded data's own
    // image urls are on hosts it refuses); no relay in the build: none, and the shell draws each coin's monogram
    // ?demo&fault=gt429|rhea (the fault suite, TN5): a market source failing as the real ones did
    const m = createMarket({ fetch: withFault(createRecordedFetch(withSamples(RECORDED)), demoFlag("fault")), logoRelay: buildRelay(), storage: null, budget: { calls: 1e9, perMs: 60_000 }, burst: { calls: 1e9, perMs: 10_000 }, screenWaitMs: 0 });
    // and sample swaps landing on an open coin's page (no chain feed in sample data), around its price
    // recorded: true, so no screen calls these prices live (they are the 25 Oct recordings, never ticked to look live)
    return { ...m, recorded: true, checks: sampleChecks, liveTrades: sampleLiveTrades((c, a) => m.coin(c as never, a).then((d) => d.priceUsd)) };
  }));
  // what a dollar amount is turned into the chain's coin at (audit MKT-1): the sizing price; none to be had is the plain
  // "Coin prices are busy right now · Try again", never a trade sized in an old or unchecked one
  const sizingUsd = (chain: ChainId) => market.sizingUsd(chain).catch((e: unknown) => { throw new TradeError("unavailable", `No checked price for ${chain}: ${(e as Error)?.message ?? e}`, "prices"); });
  const callCore = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => { const r = await bridge.call<T>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const svc = createTradeService({
    bridge, chains: OFFERED,
    // NEAR coins are paid for with Spending's own dollars (USDC): one USDC is a dollar
    nativeUsd: (chain) => (chain === "near" ? Promise.resolve(1) : sizingUsd(chain)),
    // what a screen shows and a record keeps when the checked price can't be had: the market's display price, never $0
    displayUsd: (chain) => (chain === "near" ? Promise.resolve(1) : market.nativeUsd(chain)),
    meta: (chain, coin) => market.meta(chain, coin),
    // the core's own rule for a Solana session (the shell's sample wallets sign sample bytes, which only MockBridge sees)
    sessionRule: { sol: (tx, wallet) => (isSampleAddress(wallet) ? null : sessionRefusal(tx, wallet)) },
    engineFor: (chain, owner) => {
      // NEAR coins trade inside Spending itself (TN2): the core's swap, the same in ?demo (MockBridge's) and on a phone
      if (chain === "near") return lazyNearEngine({ owner, call: callCore, meta: (coin) => market.meta("near", coin), pools: (coin) => market.coin("near", coin).then((c) => c.pools) });
      if (isSampleAddress(owner)) return createDemoEngine({ chain, owner, nativeUsd: () => market.nativeUsd(chain), meta: (coin) => market.coin(chain, coin).catch(() => market.meta(chain, coin)), moved: () => movedInto(chain, owner), empty: demoFlag("float") === "empty", noGas: demoFlag("gas") === "none", seeded: true });
      if (chain === "sol") return createSolChain({ rpc: solRpc, owner, solUsd: () => sizingUsd("sol"), meta: (mint) => market.meta("sol", mint), alsoSend: jito, ...(relaySend ? { relaySend } : {}) });
      return createEvmEngine({ chain, owner, nativeUsd: () => sizingUsd(chain), meta: (coin) => market.meta(chain, coin) });
    },
  });
  // ?demo: what MockBridge's float moved into a sample wallet (its subwallet.balances), added to the sample's own money. By
  // chain too: Robinhood's and BNB's sample wallets share one EVM address, and BNB's engine mustn't read Robinhood's money
  async function movedInto(chain: ChainId, owner: string): Promise<bigint> {
    const list = await bridge.call<{ id: string; chain: string; address: string }[]>("subwallet.list", { kind: "trade" });
    const w = "ok" in list ? list.ok.find((x) => x.chain === chain && x.address.toLowerCase() === owner.toLowerCase()) : undefined;
    if (!w) return 0n;
    const rows = await bridge.call<{ token: string; amount: string }[]>("subwallet.balances", { id: w.id });
    return BigInt(("ok" in rows ? rows.ok.find((r) => r.token === "native")?.amount : undefined) ?? "0");
  }
  const screen = createSolScreen(solRpc);
  const refused = (chain: ChainId, coins: string[]) => (chain === "sol" && coins.length ? screen(coins) : Promise.resolve(new Map<string, BuyRefusal>()));
  // the float on the core (MockBridge's in ?demo): its calls, the chains' wallets, and its own small state on the device
  const call = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => { const r = await bridge.call<T>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  // ?demo's moves wait seconds, not minutes (sample data: no chain, nobody to hide from); a real account keeps PRIVATE, and
  // so does ?demo&pace=private (the robot's gas route: the sheet must meet an empty wallet before the planner's top-up)
  let pace: PrivacyRules | undefined;
  void sample.then((yes) => { if (yes && demoFlag("pace") !== "private") pace = SAMPLE_PACE; }, () => undefined);
  const float = createCoreFloat({
    // the float's chains are the ones Trade offers (OFFERED: the proven ones; the test runner alone adds BNB Chain for
    // its $1 test, tools/mainnet --open-bnb, beside the core's own gate)
    offered: (c) => (OFFERED as string[]).includes(c),
    // the product's HARD RULE: a Move and a site's Add pay from Private (NEAR Confidential), never the Safe's public leg
    fromPrivate: true,
    call, on: (e, h) => bridge.on(e, h), nativeUsd: (c) => market.nativeUsd(c), rules: () => pace,
    // ?demo: the sample wallets as Trade's engines see them (their own money plus what the float moved in); else the core's.
    // One wallet per chain (D55): the current one, and any older ones; each wallet's coins on the wallet that holds them
    wallets: async () => {
      const [ws, ps] = await Promise.all([
        (await sample)
          // each chain's sample wallet (its current one) as the engines see them, and any older one as the core lists it;
          // what the core can move is only what the float moved in (the sample's own money is shown, never moved)
          ? Promise.all([svc.wallets(), bridgeWallets(call, (c) => market.nativeUsd(c))]).then(([all, core]) => [
            ...all.filter((w) => w.id && w.address && (OFFERED as string[]).includes(w.chain)).map((w) => {
              const mine = core.find((x) => x.id === w.id);
              return { id: w.id!, chain: w.chain as "sol" | "hood" | "bsc", current: true, address: w.address!, nativeUsd: w.nativeUsd, ...(/^\d{1,40}$/.test(w.native) ? { nativeRaw: w.native } : {}), coinsUsd: 0, movableUsd: mine?.nativeUsd ?? 0, ...(mine?.keyExported ? { keyExported: true } : {}) };
            }),
            ...core.filter((x) => (OFFERED as string[]).includes(x.chain) && !all.some((w) => w.id === x.id)).map((x) => ({ ...x, current: false })),
          ])
          : bridgeWallets(call, (c) => market.nativeUsd(c)),
        svc.coinsByWallet().catch(() => []),
      ]);
      // ?demo&oldwords=sol: that chain's sample wallet as one made from replaced backup words (the robot's route)
      const ow = (await sample) ? demoFlag("oldwords") : null;
      if (ow) for (const w of ws as { chain: string; current: boolean; oldWords?: boolean }[]) if (w.chain === ow && w.current) w.oldWords = true;
      // each wallet's own coins (an older wallet may still hold some: its gas top-up goes to it, so its sale can go)
      for (const w of ws) w.coinsUsd = ps.find((x) => x.wallet === w.id)?.coinsUsd ?? 0;
      return ws;
    },
    get: async (key) => { const { value } = await call<{ value: string | null }>("device.store.get", { key }).catch(() => ({ value: null })); return value ? JSON.parse(value) : undefined; },
    set: (key, v) => call("device.store.set", { key, value: JSON.stringify(v) }).then(() => undefined),
    now: Date.now, every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
    // heat (perf engineer, 3 Nov): the planner's 120 s round is an idle read on the shell's one scheduler
    idleEvery: (fn, ms) => restEvery(ms, fn),
  });
  const mintClean = (chain: ChainId, coin: string) => chain === "sol" && screen.clean(coin);
  return { svc, market, refused, mintClean, float, sample };
}

/** One runtime per bridge: Trade's screen leaves when another app comes on screen and mounts again on return, and it finds the
 *  same market, caches and trading sessions waiting (a fresh one would read everything again). */
const BY_BRIDGE = new WeakMap<Bridge, TradeRuntime>();
export function runtimeFor(bridge: Bridge): TradeRuntime {
  return BY_BRIDGE.get(bridge) ?? BY_BRIDGE.set(bridge, createTradeRuntime(bridge)).get(bridge)!;
}

// The Trade app's own runtime, once it has opened: the reader asks it, so Wallet's "In trading" is the very number the
// app shows (in ?demo the sample trades live in the app's engines; on a phone, one cache and one budget).
let app: TradeRuntime | undefined;
export const setAppRuntime = (rt: TradeRuntime): TradeRuntime => (app = rt);
export const appRuntime = (): TradeRuntime | undefined => app;
