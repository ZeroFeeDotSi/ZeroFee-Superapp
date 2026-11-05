// D119 perps: the core's `perps.*` methods. Landing 3: the network is the build's PERPS_NETWORK (testnet by default; the
// the go for mainnet, 3 Nov), money moves in and out through Trading (1Click, float-moves.ts toPerps/fromPerps), and
// every phone proves the trading key safe on Hyperliquid itself before its first order (selfCheck). Loaded only when Trade's Perps tab asks
// (demo-core.ts imports this file on the first perps call), so none of it is in Home's first load.
//
// - The account on Hyperliquid is the person's own EVM key from their words on its OWN path (perpsMainKey below), never a
//   row's key: a row's address is public on its chain, and reusing it would link the perps account to it (D111). It
//   signs, on a Face ID sheet, only the approval of a trading key and its revoke (signApproveAgent: testnet only).
// - Orders, closes, TP/SL and leverage are signed by the trading key (agent.ts), each checked first against Hyperliquid's
//   own rules for its market (rules.ts). Nothing here signs a withdrawal or a transfer.
// - The only host is the network's own Hyperliquid API (HL_TESTNET.api or HL_MAINNET.api).
// - Every refusal names Hyperliquid and says where the money is (on Hyperliquid; "test money" on the test network).
import { evmAddress } from "../evm.ts";
import { HOT_ROOT, bip32Secp256k1 } from "../hot-keys.ts";
import { ProblemError, type Problem } from "../problem.ts";
import { securityProblems } from "../security-problems.ts";
import type { PlainWords } from "../signer.ts";
import type { Vault } from "../vault.ts";
import { AGENT_DAYS, HL_NETS, PerpsAgent, approveAgentAction, revokeAgentAction, signApproveAgent, type HlNet, type HlNetName } from "./agent.ts";
import { HL_TYPES, signDigest, userSignedDigest, type HlSignature } from "./hl-sign.ts";
import type { FloatMove } from "../float-moves.ts";
import { MIN_ORDER_USD, leverageRefusal, roundPrice, roundSize, type HlMarket } from "./rules.ts";

/** The network this build's perps run on (product decision, 3 Nov: mainnet is built; testnet stays the default until it's set). */
export const PERPS_NETWORK: HlNetName = "testnet";
export const PERPS_NET: HlNet = HL_NETS[PERPS_NETWORK];
/** Where the money is, on every perps line. */
export const whereOn = (net: HlNet) => (net.testnet ? "on Hyperliquid (test money)" : "on Hyperliquid");
export const PERPS_WHERE = whereOn(PERPS_NET);
/** Hyperliquid's own least deposit (Bridge2 docs: "The minimum deposit amount is 5 USDC"), and ours for a move in. */
export const PERPS_MIN_IN_USD = 5;
/** The one token a Take out sends on HyperCore (spotSend): USDC, by Hyperliquid's own token id. */
export const HL_USDC_TOKEN = "USDC:0x6d1e7cde53ba9467b783cb7c530ce054";
/** Said when the on-phone proof fails (product decision, 3 Nov: the proof is the product's, every phone, before the first order). */
export const NOT_SAFE_LINE = "Perps can't start safely on this phone. Nothing moved.";
/** How far through the price a market order may fill (Hyperliquid has no market type: an Ioc limit this far away). */
export const MARKET_SLIPPAGE = 0.05;
/** How far past its trigger a take profit or stop loss may fill (the market close it becomes). */
export const TRIGGER_SLIPPAGE = 0.1;
/** The core answers perps.* only when this is on (review L4): off, as Trade's PERPS_ON, until the testnet proof
 *  passes, step d included (the revoke stops the old agent: review M2), so no build's core answers perps for any app
 *  before then. Turned on together with PERPS_ON. */
export const PERPS_CORE_ON = false;
const OFF_PENDING = "perps-off-pending.v1";

export const problemsFor = (net: HlNet) => {
  const money = { state: "safe", where: whereOn(net) } as const;
  return {
  unreachable: (): Problem => ({ code: "perps.hyperliquid.unreachable", whatHappened: "Hyperliquid didn't answer. Nothing was traded.", money, next: { kind: "retry", label: "Try again" } }),
  refused: (more?: string): Problem => ({ code: "perps.hyperliquid.refused", whatHappened: "Hyperliquid said no. Nothing was traded.", money, next: { kind: "nothing", label: "Go back" }, ...(more ? { more: `Hyperliquid said: ${more.slice(0, 200)}` } : {}) }),
  notOn: (): Problem => ({ code: "perps.off", whatHappened: "Perps on Hyperliquid aren't turned on on this phone.", money, next: { kind: "open", label: "Turn on perps", screen: "perps" } }),
  declined: (): Problem => ({ code: "perps.declined", whatHappened: "You said no, so nothing changed on Hyperliquid.", money, next: { kind: "nothing", label: "Go back" } }),
  input: (why: string): Problem => ({ code: "perps.order.refused", whatHappened: why, money, next: { kind: "fix-input", label: "Change it", field: "amount" } }),
  noPosition: (coin: string): Problem => ({ code: "perps.position.none", whatHappened: `You have no open ${coin} trade on Hyperliquid.`, money, next: { kind: "nothing", label: "Go back" } }),
  wordsMissing: (): Problem => ({ code: "perps.words.missing", whatHappened: "Perps on Hyperliquid need your backup words on this phone.", money, next: { kind: "open", label: "Open Security", screen: "security/overview" } }),
  offNotHeard: (): Problem => ({ code: "perps.off.unconfirmed", whatHappened: "The trading key is gone from this phone, but Hyperliquid didn't confirm it stopped.", money, next: { kind: "retry", label: "Try again" } }),
  notSafe: (): Problem => ({ code: "perps.selfcheck.failed", whatHappened: NOT_SAFE_LINE, money, next: { kind: "nothing", label: "Go back" } }),
  testMoney: (): Problem => ({ code: "perps.money.test-network", whatHappened: "Test money comes from Hyperliquid's own test faucet, never from your NEAR wallet.", money, next: { kind: "nothing", label: "Go back" } }),
  };
};
export const perpsProblems = problemsFor(PERPS_NET);
const fail = (p: Problem) => new ProblemError(p);

export interface PerpsDeps {
  vault: Vault;
  /** The approval sheet (Face ID). */
  approve(words: PlainWords): Promise<boolean>;
  /** The person's main EVM key, used inside the core only, zeroed after `use`; with its address. */
  withMainKey<T>(use: (secret: Uint8Array, address: `0x${string}`) => T): Promise<T>;
  /** The main address alone (no key). */
  mainAddress(): Promise<`0x${string}`>;
  fetch?: typeof fetch;
  now?: () => number;
  /** The network (default: the build's PERPS_NET). */
  net?: HlNet;
  /** Trading's two moves for Perps (float-moves.ts), lent by the core; absent: no money in or out here. */
  money?: {
    toPerps(units: string, key: string, recipient: `0x${string}`): Promise<FloatMove | { declined: true }>;
    fromPerps(units: string, key: string, pay: (depositAddress: string, amountIn: string) => Promise<void>): Promise<FloatMove | { declined: true }>;
  };
}

/**
 * The Hyperliquid account's key path, from the hot root of the words (hot-keys.ts: BIP-39 with ZeroFee's passphrase, then
 * BIP-32): m/44'/60'/86'/0/0. hot-keys.ts gives every EVM wallet the account index 16·kind + chain, at most 16·4 + 5 = 69
 * (main-key.test.ts checks the address against every one), so 86 is no wallet's: the perps account links to no row.
 * A restore of the words brings it back.
 */
export const PERPS_PATH = [{ index: 44, hardened: true }, { index: 60, hardened: true }, { index: 86, hardened: true }, { index: 0, hardened: false }, { index: 0, hardened: false }] as const;
/** The main key's two uses for perps, made from the vault's hot root each time and zeroed after. No words on this phone:
 *  no perps account (never a random key a restore couldn't bring back). */
export function perpsMainKey(vault: Vault): Pick<PerpsDeps, "withMainKey" | "mainAddress"> {
  const withMainKey: PerpsDeps["withMainKey"] = async (use) => {
    const root = await vault.get(HOT_ROOT);
    if (!root) throw fail(perpsProblems.wordsMissing());
    let secret: Uint8Array;
    try {
      secret = bip32Secp256k1(root, PERPS_PATH);
    } finally {
      root.fill(0);
    }
    try {
      return use(secret, evmAddress(secret) as `0x${string}`);
    } finally {
      secret.fill(0);
    }
  };
  return { withMainKey, mainAddress: () => withMainKey((_, a) => a) };
}

export interface PerpsPosition { coin: string; side: "long" | "short"; size: string; valueUsd: number; entryPx: number; pnlUsd: number; pnlPct: number; liqPx: number | null; leverage: number; marginUsd: number }
/** `spotUsd`: USDC that arrived on Hyperliquid and isn't in trading yet (perps.useArrived moves it in). `testNetwork`: the
 *  build's network is Hyperliquid's test one. */
export interface PerpsState { on: boolean; untilMs?: number; offPending?: true; balanceUsd: number | null; freeUsd: number | null; spotUsd?: number | null; testNetwork: boolean; positions: PerpsPosition[] }
export interface PerpsMarket { coin: string; price: number; maxLeverage: number }
export interface OrderAsk { coin: string; side: "long" | "short"; usd: number; leverage: number; kind: "market" | "limit"; limitPx?: number; tp?: number; sl?: number }

/** A positive amount as Hyperliquid's decimal text, rounded DOWN to `dp` places (never more than there is). */
const floorTo = (n: number, dp: number): string => {
  const f = Math.floor(n * 10 ** dp) / 10 ** dp;
  return f.toFixed(dp).replace(/\.?0+$/, "");
};
/** Whole micro-dollars as Hyperliquid's decimal text, exactly ("8", "0.000001"). */
const micro = (n: number): string => {
  const t = String(n).padStart(7, "0");
  return `${t.slice(0, -6)}.${t.slice(-6)}`.replace(/\.?0+$/, "");
};
/** 8-decimal units (HyperCore USDC) as Hyperliquid's decimal text, exactly. */
const units8 = (u: string): string => {
  const s = u.padStart(9, "0");
  return `${s.slice(0, -8)}.${s.slice(-8)}`.replace(/\.?0+$/, "");
};
const num = (v: unknown): number => (typeof v === "string" || typeof v === "number" ? Number(v) : NaN);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export class PerpsService {
  private readonly d: PerpsDeps;
  private readonly agent: PerpsAgent;
  private readonly now: () => number;
  private readonly fetch: typeof fetch;
  private readonly net: HlNet;
  private readonly p: ReturnType<typeof problemsFor>;
  private lastNonce = 0;
  constructor(d: PerpsDeps) {
    this.d = d;
    this.now = d.now ?? Date.now;
    this.fetch = d.fetch ?? ((...a) => globalThis.fetch(...a));
    this.net = d.net ?? PERPS_NET;
    this.p = problemsFor(this.net);
    this.agent = new PerpsAgent(d.vault, this.now, this.net);
  }

  async call(method: string, p: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "perps.state": return this.state();
      case "perps.markets": return this.markets();
      case "perps.setup": return this.setup();
      case "perps.order": return this.order(p as unknown as OrderAsk);
      case "perps.close": return this.close(String(p.coin ?? ""));
      case "perps.closeAll": return this.closeAll();
      case "perps.off": return this.off();
      case "perps.fund": return this.fund(p.usd, p.key);
      case "perps.useArrived": return this.useArrived();
      case "perps.takeOut": return this.takeOut(p.usd, p.key);
      default: throw fail(this.p.refused());
    }
  }

  // ── The network's Hyperliquid API (the one host) ────────────────────────────────────────────────────────────────
  private async post(path: "/info" | "/exchange", body: unknown): Promise<any> {
    let r: Response;
    try {
      r = await this.fetch(`${this.net.api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw fail(this.p.unreachable());
    }
    const text = await r.text().catch(() => "");
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }
    if (!r.ok || json === undefined) throw fail(r.status >= 500 || json === undefined ? this.p.unreachable() : this.p.refused(text));
    return json;
  }
  private info = (body: Record<string, unknown>) => this.post("/info", body);
  /** An exchange action's answer: ok, or Hyperliquid's own words as a refusal (in `more`). Per-order errors too. */
  private async exchange(action: Record<string, unknown>, nonce: number, signature: HlSignature): Promise<any> {
    const r = await this.post("/exchange", { action, nonce, signature });
    if (r?.status !== "ok") throw fail(this.p.refused(typeof r?.response === "string" ? r.response : undefined));
    const statuses: any[] = r.response?.data?.statuses ?? [];
    const bad = statuses.find((s) => s && typeof s.error === "string");
    if (bad) throw fail(this.p.refused(bad.error));
    return r.response;
  }
  /** Hyperliquid's nonce: the time in ms, never the same twice. */
  private nonce(): number {
    this.lastNonce = Math.max(this.now(), this.lastNonce + 1);
    return this.lastNonce;
  }

  private async universe(): Promise<HlMarket[]> {
    const m = await this.info({ type: "meta" });
    const u = Array.isArray(m?.universe) ? m.universe : null;
    if (!u) throw fail(this.p.unreachable());
    // a market whose rules don't read as whole numbers is treated as not listed (review L6: NaN passes every check)
    return u.map((x: any) => {
      const szDecimals = Number(x?.szDecimals), maxLeverage = Number(x?.maxLeverage);
      const sane = Number.isInteger(szDecimals) && szDecimals >= 0 && szDecimals <= 6 && Number.isInteger(maxLeverage) && maxLeverage >= 1;
      return { name: String(x?.name ?? ""), szDecimals, maxLeverage, ...(x?.isDelisted || !sane ? { isDelisted: true } : {}), ...(x?.onlyIsolated ? { onlyIsolated: true } : {}) };
    });
  }
  private async mids(): Promise<Record<string, number>> {
    const m = await this.info({ type: "allMids" });
    if (!m || typeof m !== "object") throw fail(this.p.unreachable());
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, num(v)]).filter(([, v]) => Number.isFinite(v) && (v as number) > 0));
  }

  // ── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async markets(): Promise<PerpsMarket[]> {
    const [u, mids] = await Promise.all([this.universe(), this.mids()]);
    return u.filter((m) => !m.isDelisted && mids[m.name] !== undefined).map((m) => ({ coin: m.name, price: mids[m.name]!, maxLeverage: m.maxLeverage }));
  }

  async state(): Promise<PerpsState> {
    const agent = await this.agent.current();
    const on = !!agent && this.now() < agent.validUntilMs;
    const offPending = (await this.d.vault.get(OFF_PENDING))?.length ? { offPending: true as const } : {};
    const user = await this.d.mainAddress();
    const [s, spot] = await Promise.all([this.info({ type: "clearinghouseState", user }), this.info({ type: "spotClearinghouseState", user }).catch(() => null)]);
    const spotUsd = this.spotUsdc(spot);
    const balance = num(s?.marginSummary?.accountValue);
    const free = num(s?.withdrawable);
    const positions: PerpsPosition[] = (Array.isArray(s?.assetPositions) ? s.assetPositions : []).map((a: any) => a?.position).filter((x: any) => x && num(x.szi) !== 0).map((x: any) => {
      const szi = num(x.szi);
      const liq = num(x.liquidationPx);
      return { coin: String(x.coin), side: szi > 0 ? "long" : "short", size: String(x.szi).replace(/^-/, ""), valueUsd: num(x.positionValue), entryPx: num(x.entryPx), pnlUsd: num(x.unrealizedPnl), pnlPct: num(x.returnOnEquity) * 100, liqPx: Number.isFinite(liq) && liq > 0 ? liq : null, leverage: num(x.leverage?.value), marginUsd: num(x.marginUsed) };
    });
    return { on, ...(agent && on ? { untilMs: agent.validUntilMs } : {}), ...offPending, balanceUsd: Number.isFinite(balance) ? balance : null, freeUsd: Number.isFinite(free) ? free : null, spotUsd, testNetwork: this.net.testnet, positions };
  }

  /** USDC free on HyperCore's spot side (where a move in lands): its total less what's held; null if unread. */
  private spotUsdc(spot: any): number | null {
    const b = Array.isArray(spot?.balances) ? spot.balances.find((x: any) => x?.coin === "USDC") : undefined;
    if (!spot || !Array.isArray(spot?.balances)) return null;
    if (!b) return 0;
    const free = num(b.total) - (Number.isFinite(num(b.hold)) ? num(b.hold) : 0);
    return Number.isFinite(free) && free > 0 ? free : 0;
  }

  // ── Turn on / off (the main key, on a sheet) ────────────────────────────────────────────────────────────────────
  async setup(): Promise<PerpsState> {
    const had = await this.agent.current();
    if (had && this.now() < had.validUntilMs - 86_400_000) return this.state();
    // the sheet first (review L8): a "no" leaves the agent this phone already has
    const until = new Date(this.now() + AGENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const words: PlainWords = {
      title: "Turn on perps on Hyperliquid",
      lines: [`A trading key on this phone opens and closes your trades on Hyperliquid${this.net.testnet ? "'s test network" : ""}.`, "It can't take money out. Only you can.", `It stops by itself on ${until}. You can turn it off any time.`],
      warnings: [], effect: [], ...(this.net.testnet ? { testNetwork: true as const } : {}),
    };
    if (!(await this.d.approve(words).catch(() => false))) throw fail(this.p.declined());
    const made = await this.agent.make(AGENT_DAYS);
    const nonce = this.nonce();
    const action = approveAgentAction(made.address, made.validUntilMs, nonce, this.net);
    const signature = await this.d.withMainKey((secret) => signApproveAgent(action, secret, this.net));
    try {
      await this.exchange(action, nonce, signature);
    } catch (e) {
      // Money review L7 (noted, not built): Hyperliquid may refuse approveAgent on an account with no deposit yet, so a
      // first mainnet setup fails until money is put in. Its refusal shows as perps.hyperliquid.refused with Hyperliquid's
      // own words under More; saying "Put money in first, then turn on perps." needs matching those words here, not a
      // one-line change to the Problem. Put money in works with perps off (fund needs no trading key).
      await this.agent.forget(); // an agent Hyperliquid didn't take is no agent
      throw e;
    }
    // Product decision, 3 Nov ("we are building this for users, not me"): the proof testnet-proof.ts ran by hand runs on every
    // phone, on the network in use, before the first order. Any failure revokes the agent and says so.
    if (!(await this.selfCheck(made.address).catch(() => false))) {
      await this.revokeQuietly();
      throw fail(this.p.notSafe());
    }
    await this.d.vault.delete(OFF_PENDING);
    return this.state();
  }

  /**
   * The on-phone proof (product decision, 3 Nov), on the network in use, right after the approval and before any order:
   *  (a) Hyperliquid lists the new agent for this account (info extraAgents);
   *  (b) Hyperliquid ACCEPTS the agent's signature: its cancel of an order that doesn't exist answers "ok" (with the
   *      cancel's own error), so the account really trades through this key.
   * True only if both hold. A third step, "the agent's withdraw3 is refused", was dropped (money review M2, 3 Nov): a
   * user-signed action carries no account of its own, so Hyperliquid reads its signer (the agent's own address, an empty
   * account) as the one withdrawing; its refusal says nothing about the person's account, and no answer text can prove
   * it. What keeps money in is ours: the agent never signs a user-signed action (agent.ts signTrade's refusal, tested).
   */
  private async selfCheck(agentAddress: `0x${string}`): Promise<boolean> {
    const user = await this.d.mainAddress();
    const agents = await this.info({ type: "extraAgents", user });
    if (!Array.isArray(agents) || !agents.some((a: any) => typeof a?.address === "string" && a.address.toLowerCase() === agentAddress)) return false;
    const cancel = { type: "cancel", cancels: [{ a: 0, o: 1 }] };
    const n1 = this.nonce();
    const c = await this.post("/exchange", { action: cancel, nonce: n1, signature: await this.agent.signTrade(cancel, n1) });
    return c?.status === "ok";
  }

  /** The agent revoked on Hyperliquid (the same approval-under-our-name as Turn off) and gone from this phone; no sheet:
   *  the person's yes to turn on was the yes, and this undoes it. A revoke that isn't heard is kept as waiting. */
  private async revokeQuietly(): Promise<void> {
    const nonce = this.nonce();
    const action = revokeAgentAction(nonce, this.net);
    try {
      const signature = await this.d.withMainKey((secret) => signApproveAgent(action, secret, this.net));
      await this.exchange(action, nonce, signature);
      await this.d.vault.delete(OFF_PENDING);
    } catch {
      await this.d.vault.put(OFF_PENDING, new Uint8Array([1]));
    } finally {
      await this.agent.forget();
    }
  }

  /**
   * Turn perps off: the trading key is revoked ON HYPERLIQUID (revokeAgentAction: an approval under the same name
   * replaces it) and deleted from this phone. The key goes from the phone whatever Hyperliquid answers; if Hyperliquid
   * didn't confirm, the off is kept as waiting and the next off tries the revoke again (it needs the main key, not the
   * old trading key).
   */
  async off(): Promise<PerpsState> {
    const words: PlainWords = {
      title: "Turn off perps on Hyperliquid",
      lines: ["The trading key on this phone stops working on Hyperliquid.", "Your open trades stay open, and your money stays on Hyperliquid."],
      warnings: [], effect: [], ...(this.net.testnet ? { testNetwork: true as const } : {}),
    };
    if (!(await this.d.approve(words).catch(() => false))) throw fail(this.p.declined());
    const nonce = this.nonce();
    const action = revokeAgentAction(nonce, this.net);
    try {
      const signature = await this.d.withMainKey((secret) => signApproveAgent(action, secret, this.net));
      await this.exchange(action, nonce, signature);
    } catch (e) {
      await this.agent.forget();
      const said = e instanceof ProblemError ? e.problem.more : undefined;
      // Hyperliquid answered "no" to a revoke that was already waiting (an account it doesn't know, so no agent to
      // stop): the off stops waiting, with Hyperliquid's words (review L7); not answering keeps it waiting
      const answeredNo = e instanceof ProblemError && e.problem.code === "perps.hyperliquid.refused";
      if (answeredNo && (await this.d.vault.get(OFF_PENDING))?.length) {
        await this.d.vault.delete(OFF_PENDING);
        throw fail({ ...this.p.refused(), ...(said ? { more: said } : {}) });
      }
      await this.d.vault.put(OFF_PENDING, new Uint8Array([1]));
      throw fail({ ...this.p.offNotHeard(), ...(said ? { more: said } : {}) });
    }
    await this.agent.forget();
    await this.d.vault.delete(OFF_PENDING);
    return this.state();
  }

  // ── Money in and out (Trading ↔ Perps, through 1Click; mainnet only) ───────────────────────────────────────────
  /** Dollars the person typed, checked: a plain amount of at least the least, in whole cents. */
  private dollars(v: unknown, least: number): number {
    const usd = typeof v === "number" ? v : NaN;
    if (!(Number.isFinite(usd) && usd > 0 && Math.round(usd * 100) / 100 === usd)) throw fail(this.p.input("Type how many dollars."));
    if (usd < least) throw fail(this.p.input(`Hyperliquid's least is $${least}. Use a little more.`));
    if (usd > 100_000) throw fail(this.p.input("That's more than Perps takes at once."));
    return usd;
  }
  /** The one key rule Trading's moves use (float-moves.ts again: 16 to 64 of A-Z a-z 0-9 - _; review L3). */
  private moveKey(key: unknown): string {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) throw fail(this.p.input("Try again."));
    return key;
  }

  /**
   * Put money in: Trading's USDC → USDC on Hyperliquid at the person's OWN Perps address (made here from the words; the app
   * never names it), on one Face ID sheet, through 1Click (float-moves.ts toPerps checks the quote). It lands on
   * Hyperliquid's spot side; perps.useArrived moves it into trading.
   */
  async fund(v: unknown, k: unknown): Promise<FloatMove | { declined: true }> {
    if (this.net.testnet) throw fail(this.p.testMoney());
    if (!this.d.money) throw fail(this.p.refused());
    const usd = this.dollars(v, PERPS_MIN_IN_USD);
    const key = this.moveKey(k);
    const words: PlainWords = { title: `Put ${usd.toFixed(2)} dollars into Perps`, lines: [`About $${usd.toFixed(2)} goes from your NEAR wallet to your own Perps account on Hyperliquid.`, "Only your key can take it out."], warnings: [], effect: [] };
    if (!(await this.d.approve(words).catch(() => false))) throw fail(this.p.declined());
    return this.d.money.toPerps(String(Math.round(usd * 1e6)), key, await this.d.mainAddress());
  }

  /** What arrived on the spot side goes into trading: the main key signs usdClassTransfer (toPerp) on a Face ID sheet. */
  async useArrived(): Promise<PerpsState> {
    const user = await this.d.mainAddress();
    const spot = this.spotUsdc(await this.info({ type: "spotClearinghouseState", user }));
    if (!spot) return this.state();
    const amount = floorTo(spot, 6);
    const words: PlainWords = { title: "Use it for trades", lines: [`$${amount} that arrived on Hyperliquid becomes ready for trades there.`], warnings: [], effect: [] };
    if (!(await this.d.approve(words).catch(() => false))) throw fail(this.p.declined());
    await this.mainUserAction({ type: "usdClassTransfer", amount, toPerp: true }, "usdClassTransfer");
    return this.state();
  }

  /**
   * Take out: USDC on Hyperliquid → Trading, on one Face ID sheet. Inside the Trading move (float-perps.ts fromPerps: its
   * key's lock held, 1Click's quote already checked), and only then: what spot lacks moves from trading to spot
   * (usdClassTransfer, rounded UP to the micro-dollar so spot holds at least the amount, never more than trading has
   * free; money review M1, L3), then the main key sends exactly 1Click's amount to its deposit address (spotSend). Both
   * stay inside the person's own account until the spotSend; a refusal at either step moves nothing out of it.
   */
  async takeOut(v: unknown, k: unknown): Promise<FloatMove | { declined: true }> {
    if (this.net.testnet) throw fail(this.p.testMoney());
    if (!this.d.money) throw fail(this.p.refused());
    const usd = this.dollars(v, PERPS_MIN_IN_USD);
    const key = this.moveKey(k);
    const s = await this.state();
    const spot = s.spotUsd ?? 0, free = s.freeUsd ?? 0;
    if (usd > spot + free) throw fail(this.p.input(`You can take out up to $${(Math.floor((spot + free) * 100) / 100).toFixed(2)} now.`));
    const words: PlainWords = { title: `Take ${usd.toFixed(2)} dollars out of Perps`, lines: [`About $${usd.toFixed(2)} goes from your Perps account on Hyperliquid back to your NEAR wallet.`], warnings: [], effect: [] };
    if (!(await this.d.approve(words).catch(() => false))) throw fail(this.p.declined());
    const units = Math.round(usd * 1e8);
    return this.d.money.fromPerps(String(units), key, async (depositAddress, amountIn) => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(depositAddress) || !/^\d{1,20}$/.test(amountIn) || BigInt(amountIn) !== BigInt(units)) throw fail(this.p.refused());
      await this.toSpot(usd);
      try {
        await this.mainUserAction({ type: "spotSend", destination: depositAddress.toLowerCase(), token: HL_USDC_TOKEN, amount: units8(amountIn) }, "spotSend");
      } catch (e) {
        // only an unanswered spotSend may have gone: the Trading move then waits for 1Click's word (float-perps.ts)
        throw e instanceof ProblemError && e.problem.code === "perps.hyperliquid.unreachable" ? Object.assign(e, { maybeSent: true }) : e;
      }
    });
  }

  /** Spot holds at least `usd` afterwards: what it lacks, in whole micro-dollars rounded UP, moves from trading, never
   *  more than trading has free (read now). Nothing lacking: nothing signed (a retry after a part-done Take out). */
  private async toSpot(usd: number): Promise<void> {
    const user = await this.d.mainAddress();
    const [perp, spotRead] = await Promise.all([this.info({ type: "clearinghouseState", user }), this.info({ type: "spotClearinghouseState", user })]);
    const spot = this.spotUsdc(spotRead);
    const free = num(perp?.withdrawable);
    if (spot === null || !Number.isFinite(free)) throw fail(this.p.unreachable());
    const needMicro = Math.round(usd * 1e6) - Math.floor(spot * 1e6 + 1e-6);
    if (needMicro <= 0) return;
    if (needMicro > Math.floor(free * 1e6 + 1e-6)) throw fail(this.p.input(`You can take out up to $${(Math.floor((spot + free) * 100) / 100).toFixed(2)} now.`));
    await this.mainUserAction({ type: "usdClassTransfer", amount: micro(needMicro), toPerp: false }, "usdClassTransfer");
  }

  /** One user-signed action by the MAIN key, for this network, after the sheet: only a class transfer or a USDC spotSend. */
  private async mainUserAction(a: { type: "usdClassTransfer"; amount: string; toPerp: boolean } | { type: "spotSend"; destination: string; token: string; amount: string }, kind: "usdClassTransfer" | "spotSend"): Promise<void> {
    const nonce = this.nonce();
    const action = a.type === "usdClassTransfer"
      ? { type: a.type, hyperliquidChain: this.net.chain, signatureChainId: this.net.signatureChainId, amount: a.amount, toPerp: a.toPerp, nonce }
      : { type: a.type, hyperliquidChain: this.net.chain, signatureChainId: this.net.signatureChainId, destination: a.destination, token: a.token, amount: a.amount, time: nonce };
    if (a.type === "spotSend" && (a.token !== HL_USDC_TOKEN || !/^0x[0-9a-f]{40}$/.test(a.destination))) throw fail(this.p.refused());
    if (!/^\d+(\.\d{1,8})?$/.test(a.amount) || !(Number(a.amount) > 0)) throw fail(this.p.refused());
    const t = HL_TYPES[kind];
    const signature = await this.d.withMainKey((secret) => signDigest(userSignedDigest(action, t.primaryType, [...t.fields]), secret));
    await this.exchange(action, nonce, signature);
  }

  // ── Trades (the trading key) ────────────────────────────────────────────────────────────────────────────────────
  private async sign(action: Record<string, unknown> & { type: string }, u: HlMarket[]): Promise<unknown> {
    const nonce = this.nonce();
    const signature = await this.agent.signTrade(action, nonce, u).catch((e) => {
      if (e instanceof ProblemError && /aren't set up|run out/.test(e.problem.whatHappened)) throw fail(this.p.notOn());
      throw e;
    });
    return this.exchange(action, nonce, signature);
  }

  /** D145 (speed): the leverage Hyperliquid already holds for this account and market (info activeAssetData), read
   *  beside the market's rules and price; null when it can't be read or doesn't read cleanly (the order then sets it). */
  private async leverageHeld(coin: unknown): Promise<{ cross: boolean; value: number } | null> {
    if (typeof coin !== "string" || !coin) return null;
    try {
      const r = await this.info({ type: "activeAssetData", user: await this.d.mainAddress(), coin });
      const l = r?.leverage;
      return (l?.type === "cross" || l?.type === "isolated") && Number.isInteger(l.value) && l.value >= 1 ? { cross: l.type === "cross", value: l.value } : null;
    } catch {
      return null;
    }
  }

  async order(ask: OrderAsk): Promise<{ filled: boolean; line: string }> {
    const [u, mids, held] = await Promise.all([this.universe(), this.mids(), this.leverageHeld(ask?.coin)]);
    const a = u.findIndex((m) => m.name === ask?.coin && !m.isDelisted);
    if (a < 0) throw fail(this.p.input("Hyperliquid doesn't list that market."));
    const m = u[a]!;
    const mid = mids[m.name];
    if (!mid) throw fail(this.p.unreachable());
    if (ask.side !== "long" && ask.side !== "short") throw fail(this.p.input("Pick Long or Short."));
    const lev = leverageRefusal(ask.leverage, m);
    if (lev) throw fail(this.p.input(lev));
    if (!(typeof ask.usd === "number" && Number.isFinite(ask.usd) && ask.usd > 0)) throw fail(this.p.input("Type how many dollars to use."));
    const isBuy = ask.side === "long";
    const limit = ask.kind === "limit";
    if (limit && !(typeof ask.limitPx === "number" && ask.limitPx > 0)) throw fail(this.p.input("Type the price to trade at."));
    const ref = limit ? ask.limitPx! : mid;
    // sized so it is never more than asked (review M1): a short limit under the market fills at once at the market's
    // price, so it is sized at the higher of the two; a long fills at or under its limit, so its limit is the most
    const sizeAt = limit && !isBuy ? Math.max(ask.limitPx!, mid) : ref;
    const sz = roundSize((ask.usd * ask.leverage) / sizeAt, m);
    const px = roundPrice(limit ? ask.limitPx! : mid * (isBuy ? 1 + MARKET_SLIPPAGE : 1 - MARKET_SLIPPAGE), m);
    if (!(Number(sz) * Math.min(sizeAt, Number(px)) >= MIN_ORDER_USD)) throw fail(this.p.input(`Hyperliquid's smallest trade is $${MIN_ORDER_USD} (with leverage). Use a little more.`));
    // TP above and SL below the price for a long; the other way round for a short
    for (const [k, px] of [["tp", ask.tp], ["sl", ask.sl]] as const) {
      if (px === undefined) continue;
      if (!(typeof px === "number" && px > 0)) throw fail(this.p.input("Type a price for take profit and stop loss, or leave them empty."));
      const above = px > ref;
      if ((k === "tp") !== (isBuy ? above : !above)) throw fail(this.p.input(k === "tp" ? `Take profit must be ${isBuy ? "above" : "below"} ${usd(ref)}.` : `Stop loss must be ${isBuy ? "below" : "above"} ${usd(ref)}.`));
    }
    const orders: Record<string, unknown>[] = [{ a, b: isBuy, p: px, s: sz, r: false, t: { limit: { tif: limit ? "Gtc" : "Ioc" } } }];
    for (const [k, v] of [["tp", ask.tp], ["sl", ask.sl]] as const) {
      if (v === undefined) continue;
      const trig = roundPrice(v, m);
      // its limit 10 % past the trigger, so a jump past it still closes (review L10): a long's close sells, a short's buys
      const worst = roundPrice(v * (isBuy ? 1 - TRIGGER_SLIPPAGE : 1 + TRIGGER_SLIPPAGE), m);
      orders.push({ a, b: !isBuy, p: worst, s: sz, r: true, t: { trigger: { isMarket: true, triggerPx: trig, tpsl: k } } });
    }
    // leverage first (cross margin), within Hyperliquid's own limit for this market; D145: not when Hyperliquid already
    // holds exactly this leverage and margin type for the market (one round trip less before the order)
    const isCross = !m.onlyIsolated;
    if (!(held && held.cross === isCross && held.value === ask.leverage)) await this.sign({ type: "updateLeverage", asset: a, isCross, leverage: ask.leverage }, u);
    const r: any = await this.sign({ type: "order", orders, grouping: orders.length > 1 ? "normalTpsl" : "na" }, u);
    const first = r?.data?.statuses?.[0];
    const filled = !!first?.filled;
    const side = isBuy ? "Long" : "Short";
    return { filled, line: filled ? `${side} ${m.name} opened: ${usd(Number(sz) * num(first.filled.avgPx))} at ${ask.leverage}×.` : `${side} ${m.name} waits at ${usd(Number(px))}.` };
  }

  private closeOrder(pos: PerpsPosition, u: HlMarket[], mids: Record<string, number>) {
    const a = u.findIndex((m) => m.name === pos.coin);
    if (a < 0 || !mids[pos.coin]) throw fail(this.p.unreachable());
    const buy = pos.side === "short"; // a short closes by buying back
    return { a, b: buy, p: roundPrice(mids[pos.coin]! * (buy ? 1 + MARKET_SLIPPAGE : 1 - MARKET_SLIPPAGE), u[a]!), s: roundSize(Number(pos.size), u[a]!), r: true, t: { limit: { tif: "Ioc" } } };
  }

  async close(coin: string): Promise<{ line: string }> {
    const [s, u, mids] = await Promise.all([this.state(), this.universe(), this.mids()]);
    const pos = s.positions.find((p) => p.coin === coin);
    if (!pos) throw fail(this.p.noPosition(coin || "that"));
    await this.sign({ type: "order", orders: [this.closeOrder(pos, u, mids)], grouping: "na" }, u);
    return { line: `${coin} closed. ${pos.pnlUsd >= 0 ? `Made about ${usd(pos.pnlUsd)}` : `Lost about ${usd(-pos.pnlUsd)}`}.` };
  }

  async closeAll(): Promise<{ line: string }> {
    const [s, u, mids] = await Promise.all([this.state(), this.universe(), this.mids()]);
    if (!s.positions.length) return { line: "Nothing was open." };
    await this.sign({ type: "order", orders: s.positions.map((p) => this.closeOrder(p, u, mids)), grouping: "na" }, u);
    return { line: s.positions.length === 1 ? "Your trade is closed." : `All ${s.positions.length} trades are closed.` };
  }
}

/** One PerpsService per vault (the core's), made on the first perps call. */
const services = new WeakMap<Vault, PerpsService>();
/**
 * The core's perps.* entry (demo-core.ts dispatch, which imports this file on the first call): Trade's calls and ZeroFee's
 * own screens' only (forApps stamps `app`; any other app is refused before anything else), on a ready account.
 */
export async function perpsCall(core: { vault: Vault; approve: PerpsDeps["approve"]; ready(): Promise<unknown>; money?: PerpsDeps["money"] }, method: string, p: Record<string, unknown>, on: boolean = PERPS_CORE_ON): Promise<unknown> {
  if (!on || (p.app !== undefined && p.app !== "trade")) throw new ProblemError(securityProblems.methodUnknown(method));
  await core.ready();
  let s = services.get(core.vault);
  if (!s) services.set(core.vault, (s = new PerpsService({ vault: core.vault, approve: core.approve, ...perpsMainKey(core.vault), ...(core.money ? { money: core.money } : {}) })));
  return s.call(method, p);
}
