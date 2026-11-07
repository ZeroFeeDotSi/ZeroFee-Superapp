// AgentZero's pocket day (D90 job 1, P3; D107): its rules, words and state, loaded only when AgentZero asks (Home's first
// load stays lean, as with agent-private.ts). SubWallets keeps the Stop count and hands the day a narrow PocketHost: the
// pocket's own wallet, its checks (solPrepare), its key, the sheet. Nothing here can reach another wallet.
import type { Chain } from "./chain.ts";
import { ProblemError } from "./problem.ts";
import { securityProblems } from "./security-problems.ts";
import type { PlainWords } from "./signer.ts";
import { signSolTx, solTransferTx, type SolChain } from "./solana.ts";
import { formatAmount } from "./format.ts";
import { base58, fromBase64 } from "./sol/bytes.ts";
import type { TxOutcome } from "./signer.ts";

export interface PocketDay {
  walletId: string;
  perTxUsd: number;
  totalUsd: number;
  spentUsd: number;
  endsAt: number;
  solUsd: number;
}

const refused = (why: string) => new ProblemError(securityProblems.subwalletRefused(why));
const until = (at: number) => new Date(at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export const NOT_MADE = "Your SOL wallet isn't made yet.";

/** The day's asked limits, or why not: above $0 and at most $5 a trade; at least that and at most $50 in all; 1 to 1,440 minutes. */
export function pocketLimits(perTxUsd: unknown, totalUsd: unknown, minutes: unknown): { p: number; t: number; m: number } {
  const p = Number(perTxUsd), t = Number(totalUsd), m = Number(minutes);
  if (!(p > 0 && p <= 5) || !(t >= p && t <= 50) || !Number.isInteger(m) || m < 1 || m > 24 * 60) {
    throw new ProblemError(securityProblems.requestInvalid("perTxUsd is above $0 and at most $5; totalUsd at least that and at most $50; minutes 1 to 1,440"));
  }
  return { p, t, m };
}

/** One day at a time (security review L1, and L-b after the sheet): a running day is never restarted or its count reset. */
export function noDayYet(day: PocketDay | null, now: number): void {
  if (day && now < day.endsAt) throw refused(`AgentZero can already trade until ${until(day.endsAt)}.`);
}

/** SOL's price for the day: a real one, or no day (L4). */
export function dayPrice(solUsd: unknown): number {
  if (typeof solUsd !== "number" || !Number.isFinite(solUsd) || !(solUsd > 0)) throw new ProblemError(securityProblems.partnerUnreachable("the price service"));
  return solUsd;
}

/** The Face ID sheet: the limits as they are, the fee room included (M2). */
export function pocketDayWords(p: number, t: number, feeRoomUsd: number, endsAt: number): PlainWords {
  return {
    title: "Let AgentZero trade today",
    lines: [`From your SOL wallet: up to $${p} a trade plus $${feeRoomUsd} of network fees, and $${t} in all with fees, until ${until(endsAt)}.`, "Only on known exchanges. It can't touch your Safe.", "Stop AgentZero any time."],
    warnings: [],
    effect: [],
  };
}

/** Stopped or paused while the Face ID was open (M3): the day doesn't start. */
export function stillOn(stopsNow: number, stopsBefore: number): void {
  if (stopsNow !== stopsBefore) throw refused("AgentZero was stopped. Its day didn't start.");
}

export const STOPPED_WHILE_SIGNING = "AgentZero didn't trade: it was stopped.";

/**
 * What one trade counts against the day, in dollars, or why it isn't covered (each rule a test). The pocket's own wallet
 * only; every step a known exchange's (`notCovered`: the Trade allow-list and solPrepare's checks); nothing sent anywhere
 * but the pocket itself; at most the day's dollars a trade (plus the fee room) and its total. SOL's price is the higher of
 * now and the day's own (M1). A sale counts only the SOL that leaves it: its proceeds come back into the pocket (L3).
 * The caller adds the result to the day at once, before signing.
 */
export function pocketCount(
  live: PocketDay | null,
  w: { id: string; address: string },
  prep: { value: bigint; out: bigint; notCovered: string | null; sim?: { lamportsBefore: bigint; tokens?: { mint: string; before: bigint; after: bigint }[] }; decoded: { transfers: { to: string }[]; closedTo: string[]; swaps: { side: string; coin?: string; inRaw?: string; minOutRaw?: string }[] } },
  solNow: number | null,
  feeRoomUsd: number,
): number {
  const no = (why: string) => refused(`AgentZero didn't trade: ${why}`);
  const { value, out, notCovered, decoded } = prep;
  if (!live || live.walletId !== w.id) throw no("its trading for today isn't approved. Open ZeroFee and approve today.");
  if (notCovered) throw no(`${notCovered.charAt(0).toLowerCase()}${notCovered.slice(1)}.`);
  if (decoded.transfers.some((t) => t.to !== w.address)) throw no("it would send money to an address, not trade.");
  if (decoded.closedTo.some((to) => to !== w.address)) throw no("it would close an account into someone else's.");
  if (solNow === null || !Number.isFinite(solNow) || !(solNow > 0)) throw no("SOL's price couldn't be read.");
  const price = Math.max(live.solUsd, solNow);
  const sale = decoded.swaps.length > 0 && decoded.swaps.every((x) => x.side === "sell");
  const usd = (Number(sale ? out : value) / 1e9) * price;
  if (!Number.isFinite(usd)) throw no("its amount couldn't be read.");
  if (usd > live.perTxUsd + feeRoomUsd) throw no(`$${usd.toFixed(2)} is more than $${live.perTxUsd} a trade.`);
  // The day stays open at its total: buys are refused by name, a sale (about nothing out) still brings coins back (L3).
  if (live.spentUsd + usd > live.totalUsd + 0.004) throw no(`today's $${live.totalUsd} is used up.`);
  return usd;
}

/** What the core lends its account.agent.pocket* doors. */
export interface PocketCore {
  wallets: {
    agentPocketId(): Promise<string | null>;
    list(): Promise<{ id: string; address: string }[]>;
    create(kind: unknown, chain: unknown, slot?: unknown, site?: unknown): Promise<{ id: string; address: string }>;
    agentPocketStart(perTxUsd: unknown, totalUsd: unknown, minutes: unknown, stops?: number, watch?: PocketWatch): Promise<{ endsAtIso: string } | { declined: true }>;
    agentPocketSign(txB64: unknown, charge?: (valueUsd: number, decoded: { swaps: { side: string; coin?: string }[] }) => void): Promise<{ signedTx: string }>;
    agentSolRow(): Promise<{ id: string; address: string }>;
    agentPocketEmpty(): Promise<unknown>;
    /** AgentZero's own wallet (agent-wallet.ts; each door refuses by name while AGENTZERO_WALLET is off). */
    agentKit?(): import("./agent-wallet.ts").RawKit;
  };
  chain: Chain;
  signer(): Promise<{ accountId: string }>;
  /** D103: on the web, the passkey's user check before anything loosens AgentZero (review M4). */
  strong(): Promise<void>;
  /** Paused or stopped on this phone, before NEAR may show it (second review, L-a). */
  stopped(): boolean;
  /** The Stop count read when the call came in. */
  stops: number;
  /** For "Ask me first" (account.agent.askAbove, kept on this device). */
  vault: { get(n: string): Promise<Uint8Array | null>; put(n: string, b: Uint8Array): Promise<void>; delete(n: string): Promise<void> };
  approve(w: PlainWords): Promise<boolean>;
  /** SOL's (and each row's coin's) dollar price, for AgentZero's acts (agent-act.ts). */
  price(chain: "sol" | "bsc" | "hood" | "near"): Promise<number | null>;
}

/**
 * The core's pocket doors (only the agent app and ZeroFee's own screens reach account.agent.*, forApps):
 * - account.agent.pocket: the SOL row's own wallet (D117), made now if it isn't yet (no money moves); `oldPocket` when a
 *   pocket from before exists (account.agent.pocketEmpty moves it to the SOL row on the core's sheet);
 * - account.agent.pocketSession: one day, only while AgentZero is on and not paused (M3), after D103's check (M4);
 * - account.agent.pocketSign: AgentZero's own trade, inside today's limits.
 */
export async function pocketCall(method: string, p: Record<string, unknown>, c: PocketCore): Promise<unknown> {
  if (method === "account.agent.act" || method === "account.agent.actScope") {
    const [k, w] = await Promise.all([import("./agent-act.ts"), import("./agent-wallet.ts")]);
    const raw = c.wallets.agentKit?.();
    return k.actCall(method, p, {
      wallet: !!raw && w.walletOn(raw), vault: c.vault, approve: (w) => c.approve(w), strong: c.strong, price: c.price, wallets: actWallets(c.wallets as never) as never, stops: () => (c.wallets as unknown as { agentPocketStopCount(): number }).agentPocketStopCount(), stopped: c.stopped });
  }
  // AgentZero's own wallet (AGENTZERO-WALLET.md §1-§2), one door: {} its address and balance; {do: "fill", from, amount,
  // key} Fund AgentZero; {do: "empty", key} Move all to my Safe; each of the two after D103's check and on the core's own
  // sheet. Off (AGENTZERO_WALLET), refused by name before anything is asked.
  if (method === "account.agent.wallet") {
    const k = await import("./agent-wallet.ts");
    const kit = c.wallets.agentKit?.();
    if (!kit || !k.walletOn(kit)) throw new ProblemError(securityProblems.requestNotAllowed(k.AGENTZERO_WALLET_OFF));
    // D152: AgentZero's wallet is a plain NEAR account, read and paid from on the core's own NEAR reads
    const raw = { ...kit, chain: c.chain };
    if (p.do === undefined) return k.walletDo(raw, "walletRead");
    // Each reply paid exactly (agent-pay.ts): no sheet, inside the reply and month caps; raising the cap asks for the check.
    if (p.do === "pay") return k.walletDo(raw, "walletPay", p, c.strong);
    // A fill's one-time ticket, asked by AgentZero's wallet screen on the person's own tap (D143).
    if (p.do === "ticket") return k.walletDo(raw, "walletTicket", p.amount);
    if (p.do !== "fill" && p.do !== "empty") throw new ProblemError(securityProblems.requestInvalid('do: "fill", "empty", "ticket" or "pay", or nothing to read'));
    await c.strong();
    return p.do === "fill" ? k.walletDo(raw, "walletFill", p.from, p.amount, p.key, p.ticket) : k.walletDo(raw, "walletEmpty", p.key);
  }
  if (method === "account.agent.askAbove") {
    const k = await import("./agent-private.ts");
    return p.set ? k.setAskAbove(p.usd, { vault: c.vault, approve: (w) => c.approve(w), strong: c.strong }) : { askAboveUsd: await k.readAskAbove(c.vault) };
  }
  if (method === "account.agent.pocketSign") {
    // An act's trade (D117) carries its ticket: the job is charged at the core's own value before the signature.
    if (p.ticket === undefined) {
      // No ticket (the copy job's own trades): "Ask me first" still holds on a buy, at the core's own value (second
      // review, Medium). A sale isn't a payment: it brings the money back, so coins can always be sold (P3's L3).
      const [{ readAskAbove }, { askFirstError }] = await Promise.all([import("./agent-private.ts"), import("./agent-act.ts")]);
      const ask = await readAskAbove(c.vault);
      return c.wallets.agentPocketSign(p.tx, ask === null ? undefined : (v, d) => {
        const buy = d.swaps.length > 0 && d.swaps.every((x) => x.side === "buy");
        if (buy && v > ask) throw askFirstError(ask);
      });
    }
    const id = String(p.ticket);
    const [k, { readAskAbove }] = await Promise.all([import("./agent-act.ts"), import("./agent-private.ts")]);
    const askNow = await readAskAbove(c.vault); // read now, so a lowered "Ask me first" holds for a ticket made before it
    return c.wallets.agentPocketSign(p.tx, (v, d) => k.ticketCharge(id, v, d, askNow));
  }
  // D117: AgentZero trades from the SOL row's own wallet; a pocket made before that only moves to the SOL row (the core's sheet).
  if (method === "account.agent.pocketEmpty") return c.wallets.agentPocketEmpty();
  if (method === "account.agent.pocket") {
    // L8: with AgentZero's own wallet on, its trading leg is its own (agent/sol), never the SOL wallet.
    const raw = c.wallets.agentKit?.();
    const w = raw ? await import("./agent-wallet.ts") : null;
    if (raw && w!.walletOn(raw)) {
      const leg = await w!.agentSolLeg(w!.agentKeyMaker(raw.o.vault), AGENT_LEG);
      return { id: leg.id, address: leg.address };
    }
    const old = await c.wallets.agentPocketId();
    return { ...(await c.wallets.agentSolRow()), ...(old ? { oldPocket: true } : {}) };
  }
  await pocketDayAllowed(c.chain, (await c.signer()).accountId, c.stopped());
  await c.strong();
  const accountId = (await c.signer()).accountId;
  const read = () => c.chain.commonBlock().then((b) => c.chain.view(accountId, "agent", {}, b)).then((v) => v as { paused?: boolean } | null, () => undefined);
  return c.wallets.agentPocketStart(p.perTxUsd, p.totalUsd, p.minutes, c.stops, { read });
}

/** The core's check before one day (M3): AgentZero on and not paused, read on NEAR now; no answer, no day. */
async function pocketDayAllowed(chain: Chain, accountId: string, stoppedHere: boolean): Promise<void> {
  if (stoppedHere) throw refused("AgentZero is paused. Resume it first.");
  const view = (await chain.view(accountId, "agent", {}, await chain.commonBlock()).catch(() => undefined)) as { paused?: boolean } | null | undefined;
  if (view === undefined) throw new ProblemError(securityProblems.partnerUnreachable("NEAR"));
  if (!view) throw refused("AgentZero is off. Turn it on first.");
  if (view.paused) throw refused("AgentZero is paused. Resume it first.");
}

type Prep = Parameters<typeof pocketCount>[2];
type Wallet = { id: string; address: string };

/** AgentZero's own Solana leg's id (L8): not a stored wallet's id, so nothing that reads the wallet list can reach it. */
export const AGENT_LEG = "agentzero-sol";

/**
 * The day's host on AgentZero's own leg (L8, AGENTZERO-WALLET.md §1): with its own wallet on, the day trades from agent/sol
 * (made from the words, its key per signature), never the SOL wallet; its checks are the same (solPrepare). Off, `h` as
 * SubWallets made it (the SOL wallet, D117).
 */
export function agentLegHost(h0: PocketHost, raw: import("./agent-wallet.ts").RawKit | undefined): PocketHost {
  if (!raw) return h0;
  const h: PocketHost = h0.coinUsd ? h0 : { ...h0, coinUsd: marketCoinUsd(raw.o as unknown as MarketKit, () => h0.priceNow()) };
  const leg = () => import("./agent-wallet.ts").then((w) => (w.walletOn(raw) ? w : null));
  // the leg's key maker, made once from the core's vault: the day's host is lent it, never the vault (SR2 L4)
  const keys = () => import("./agent-wallet.ts").then((w) => w.agentKeyMaker(raw.o.vault));
  return {
    ...h,
    pocketId: async () => ((await leg()) ? AGENT_LEG : h.pocketId()),
    wallet: async (id) => (id === AGENT_LEG ? (await import("./agent-wallet.ts")).agentSolLeg(await keys(), AGENT_LEG) : h.wallet(id)),
    ownLink: (w, to) => (w.id === AGENT_LEG ? Promise.resolve() : h.ownLink(w, to)),
    secret: async (w) => (w.id === AGENT_LEG ? (await keys())("sol") : h.secret(w)),
  };
}

/** The core's own reads the drawdown uses (SubWallets' options: marketPrice, the relay's GeckoTerminal read; and from
 *  Solana the mint's decimals and the coin's pump.fun curve or PumpSwap pool price). */
type MarketKit = { marketPrice?: (chain: "sol", coin: string) => Promise<number | null>; sol?: { mintDecimals?(mint: string): Promise<number | null>; poolPrice?(mint: string): Promise<number | null> } };
/** How long a coin's curve or pool price is kept (one read per coin per trade burst, never one per trade). */
export const POOL_PRICE_MS = 3_000;
/**
 * A coin's dollars per raw unit: the lower of the market's price and its pump.fun curve's (or PumpSwap pool's) price at
 * SOL's price now; one alone when the other is missing (a fresh coin the market doesn't price yet); null (counted as 0)
 * only when neither exists.
 */
export function marketCoinUsd(o: MarketKit, solUsd: () => Promise<number | null>): ((mint: string) => Promise<number | null>) | undefined {
  const market = o.marketPrice, sol = o.sol;
  const pool = sol?.poolPrice ? (m: string) => sol.poolPrice!(m) : null;
  if (!(market && sol?.mintDecimals) && !pool) return undefined;
  const kept = new Map<string, { at: number; v: Promise<number | null> }>();
  const onChain = (mint: string): Promise<number | null> => {
    const k = kept.get(mint);
    if (k && Date.now() - k.at < POOL_PRICE_MS) return k.v;
    const v = pool!(mint).catch(() => null);
    kept.set(mint, { at: Date.now(), v });
    return v;
  };
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const atMarket = async (mint: string): Promise<number | null> => {
    if (!market || !sol?.mintDecimals) return null;
    const [usd, decimals] = await Promise.all([market("sol", mint).catch(() => null), sol.mintDecimals(mint).catch(() => null)]);
    return ok(usd) && typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 30 ? usd / 10 ** decimals : null;
  };
  const atCurve = async (mint: string): Promise<number | null> => {
    if (!pool) return null;
    const [lamportsPerRaw, sUsd] = await Promise.all([onChain(mint), solUsd().catch(() => null)]);
    return ok(lamportsPerRaw) && ok(sUsd) ? (lamportsPerRaw / 1e9) * sUsd : null;
  };
  // Review: the market's price can be up to a minute old, so a coin that rugged seconds ago would keep it. Both are read
  // side by side and the LOWER one counts (fail-safe); one alone counts; neither is null (0).
  return async (mint) => {
    const got = (await Promise.all([atMarket(mint), atCurve(mint)])).filter(ok);
    return got.length ? Math.min(...got) : null;
  };
}

/** What SubWallets lends the day: only the pocket's own wallet and its checks, the price, the sheet, the Stop count. */
export interface PocketHost {
  pocketId(): Promise<string | null>;
  wallet(id: string): Promise<Wallet>;
  prepare(w: Wallet, txB64: string): Promise<Prep>;
  ownLink(w: Wallet, to: string[]): Promise<void>;
  priceNow(): Promise<number | null>;
  dayPrice(): Promise<number | null>;
  /** A coin's dollars per raw unit at the market (the drawdown's mark), null when unknown. Absent: every coin counts 0. */
  coinUsd?(mint: string): Promise<number | null>;
  secret(w: Wallet): Promise<Uint8Array>;
  approve(words: PlainWords): Promise<boolean>;
  ended(reason: string, line?: string): void;
  stops(): number;
  feeRoomUsd: number;
}

/** The account's agent state on NEAR: paused or not, null when AgentZero is off; undefined when NEAR didn't answer. */
export interface PocketWatch {
  read(): Promise<{ paused?: boolean } | null | undefined>;
  /** The timer (default setInterval); returns its cancel. Tests pass a fake one. */
  every?(ms: number, f: () => void): () => void;
}

export const WATCH_MS = 30_000;
/** Under this share of the day's peak, the day stops (FLOW-V5 §5 item 9). */
export const DRAWDOWN_FLOOR = 0.85;
export const DRAWDOWN_LINE = "Stopped. Your SOL wallet fell 15% today.";
export const PAUSED_ELSEWHERE_LINE = "AgentZero was paused from another device. The day ended.";

/** One pocket day at a time, in memory only (a restart ends it). */
export class PocketSession {
  private day: PocketDay | null = null;
  private readonly h: PocketHost;
  private unwatch: (() => void) | null = null;
  /**
   * The pocket's value for the drawdown freeze: its SOL (read by each trade's own two-node test run, before the trade) plus
   * the day's coins at the MARKET price, read at each trade (audit: valued at cost, a coin rugged to zero never tripped the
   * stop). A coin with no price counts as nothing (fail-safe). The peak is the day's highest such value.
   */
  private held = new Map<string, { raw: bigint; usd: number }>();
  private peakUsd = 0;
  constructor(h: PocketHost) {
    this.h = h;
  }

  /** One Face ID, then up to 24 h within its limits (D107). `stops`: the Stop count read before anything it waited on. */
  async start(perTxUsd: unknown, totalUsd: unknown, minutes: unknown, stops: number, watch?: PocketWatch): Promise<{ endsAtIso: string } | { declined: true }> {
    const id = await this.h.pocketId();
    if (!id) throw refused(NOT_MADE);
    const { p, t, m } = pocketLimits(perTxUsd, totalUsd, minutes);
    noDayYet(this.day, Date.now());
    const solUsd = dayPrice(await this.h.dayPrice().catch(() => null));
    const endsAt = Date.now() + m * 60_000;
    if (!(await this.h.approve(pocketDayWords(p, t, this.h.feeRoomUsd, endsAt)).catch(() => false))) return { declined: true };
    stillOn(this.h.stops(), stops);
    noDayYet(this.day, Date.now());
    this.day = { walletId: id, perTxUsd: p, totalUsd: t, spentUsd: 0, endsAt, solUsd };
    this.held = new Map();
    this.peakUsd = 0;
    if (watch) this.watch(watch);
    return { endsAtIso: new Date(endsAt).toISOString() };
  }

  /** AgentZero's own trade, no sheet: counted at once and before signing, or refused by name. */
  /** `charge`: a ticketed act's own job (agent-act ticketCharge), told the trade's value at the core's price and its swap,
   *  synchronously before the signature; it throws to refuse. */
  async sign(txB64: unknown, charge?: (valueUsd: number, decoded: Prep["decoded"]) => void): Promise<{ signedTx: string }> {
    if (typeof txB64 !== "string") throw new ProblemError(securityProblems.requestInvalid("tx must be base64"));
    const id = await this.h.pocketId();
    if (!id) throw refused(NOT_MADE);
    const w = await this.h.wallet(id);
    const price = this.h.priceNow();
    const marks = this.marks(); // the held coins' market prices, read beside the test run
    const prep = await this.h.prepare(w, txB64);
    await this.h.ownLink(w, prep.decoded.transfers.map((t) => t.to));
    const solNow = await price;
    const marked = await marks;
    // From here to the count, nothing waits: two trades can't both pass on the same total.
    if (this.day && Date.now() >= this.day.endsAt) this.end("time");
    const live = this.day;
    const usd = pocketCount(live, w, prep, solNow, this.h.feeRoomUsd); // refuses by name with no day
    this.drawdown(prep, solNow!, marked);
    if (charge) charge((Number(prep.value) / 1e9) * Math.max(live!.solUsd, solNow!), prep.decoded);
    live!.spentUsd += usd;
    this.hold(prep, usd);
    const stops = this.h.stops();
    const secret = await this.h.secret(w);
    try {
      // Stopped while the key was read (review L2): nothing leaves.
      if (this.h.stops() !== stops) throw refused(STOPPED_WHILE_SIGNING);
      return { signedTx: signSolTx(txB64, secret) };
    } finally {
      secret.fill(0); // a copy, made for this signature (SR2 L3)
    }
  }

  /** At once (Stop, pause, the job's end, its time, a drawdown, a pause seen on NEAR). */
  end(reason: string, line?: string): void {
    this.unwatch?.();
    this.unwatch = null;
    if (!this.day) return;
    this.day = null;
    this.h.ended(reason, line);
  }

  /** Under 85% of the day's peak value: the day ends like a Stop (selling back then needs the person), and this trade is refused. */
  private drawdown(prep: Prep, solUsd: number, marked: Map<string, number | null>): void {
    const lamports = prep.sim?.lamportsBefore;
    if (lamports === undefined) return;
    let coins = 0;
    for (const [mint, c] of this.held) {
      const per = marked.get(mint);
      if (typeof per === "number" && Number.isFinite(per) && per > 0) coins += Number(c.raw) * per; // no price: 0
    }
    const now = (Number(lamports) / 1e9) * solUsd + coins;
    if (now > this.peakUsd) this.peakUsd = now;
    if (this.peakUsd > 0 && now < this.peakUsd * DRAWDOWN_FLOOR) {
      this.end("drawdown", DRAWDOWN_LINE);
      throw refused(DRAWDOWN_LINE);
    }
  }

  /** Each held coin's dollars per raw unit at the market now (null: no price, counted as 0). Never throws. */
  private async marks(): Promise<Map<string, number | null>> {
    const mints = [...this.held].filter(([, c]) => c.raw > 0n).map(([m]) => m);
    const ask = this.h.coinUsd;
    const got = await Promise.all(mints.map((m) => (ask ? ask.call(this.h, m).catch(() => null) : Promise.resolve(null))));
    return new Map(mints.map((m, i) => [m, got[i] ?? null]));
  }

  /** The day's coins: a buy adds the coins its test run says the pocket gets (else its minimum) and its dollars; a sale
   *  takes off its share. */
  private hold(prep: Prep, usd: number): void {
    for (const s of prep.decoded.swaps) {
      if (!s.coin) continue;
      const c = this.held.get(s.coin) ?? { raw: 0n, usd: 0 };
      if (s.side === "buy") {
        const got = (prep.sim?.tokens ?? []).filter((t) => t.mint === s.coin && t.after > t.before).reduce((a, t) => a + (t.after - t.before), 0n);
        this.held.set(s.coin, { raw: c.raw + (got > 0n ? got : BigInt(s.minOutRaw ?? "0")), usd: c.usd + usd });
      } else if (c.raw > 0n) {
        const sold = BigInt(s.inRaw ?? "0");
        const left = sold >= c.raw ? 0n : c.raw - sold;
        this.held.set(s.coin, { raw: left, usd: left === 0n ? 0 : (c.usd * Number(left)) / Number(c.raw) });
      }
    }
  }

  /** While one day is open: NEAR's agent state every 30 s, never inside a trade. A pause or a Stop seen there ends the day. */
  private watch(w: PocketWatch): void {
    const every = w.every ?? ((ms, f) => {
      const t = setInterval(f, ms);
      (t as { unref?: () => void }).unref?.();
      return () => clearInterval(t);
    });
    this.unwatch = every(WATCH_MS, () => {
      void w.read().then(
        (v) => {
          // NEAR didn't answer: nothing is said, the day stays; the next read decides.
          if (v === undefined) return;
          if (v === null || v.paused) this.end("paused-elsewhere", PAUSED_ELSEWHERE_LINE);
        },
        () => undefined,
      );
    });
  }
}

/** F5: the act door's own handle on the wallets: each float move it starts is marked AgentZero's first (by its key). */
export function actWallets(w: Record<string, any>): Record<string, any> {
  const mark = (key: unknown) => (w as { markAgentMove?: (k: unknown) => void }).markAgentMove?.(key);
  return new Proxy(w, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (k === "floatOut" || k === "floatIn") return (chain: unknown, slot: unknown, amount: unknown, key: unknown, ...rest: unknown[]) => (mark(key), v.call(t, chain, slot, amount, key, ...rest));
      if (k === "floatHome") return (amount: unknown, key: unknown) => (mark(key), v.call(t, amount, key));
      if (k === "agentSwap") return (...a: unknown[]) => (mark(a[4]), v.call(t, ...a));
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/**
 * D117: an AgentZero pocket made before the SOL row took its place moves to the SOL row, on the core's own sheet, all of
 * it but the fee. Nothing else ever signs from the pocket (P1), and nothing ever fills it. SubWallets lends the two
 * addresses, the nodes, the sheet, the pocket's key and its confirm (subwallets.ts agentPocketEmpty).
 */
export async function pocketEmpty(k: {
  from: string;
  to: string;
  sol: SolChain;
  approve: (w: PlainWords) => Promise<boolean>;
  secret: () => Promise<Uint8Array>;
  confirmed: (seen: () => Promise<("ok" | "failed" | null | "unread")[]>, signature: string, explorerUrl: string) => Promise<TxOutcome>;
}): Promise<TxOutcome | { declined: true }> {
  // Solana by name when its nodes don't answer (Home's Send landing: "Solana didn't answer."), never a bare "nodes".
  const { balance, latestBlockhash, send, status } = k.sol;
  if (!balance || !latestBlockhash || !send || !status) throw new ProblemError(securityProblems.chainUnreachable("sol"));
  const held = await balance.call(k.sol, k.from).catch(() => {
    throw new ProblemError(securityProblems.chainUnreachable("sol"));
  });
  const units = held - 5_000n;
  if (units <= 0n) throw new ProblemError(securityProblems.subwalletRefused("AgentZero's pocket is empty."));
  const sheet: PlainWords = { title: "Move AgentZero's pocket to your SOL wallet", lines: [`${formatAmount(units, 9)} SOL moves to your SOL wallet.`, "AgentZero trades from your SOL wallet now."], warnings: [], effect: [] };
  if (!(await k.approve(sheet).catch(() => false))) return { declined: true };
  const blockhash = await latestBlockhash.call(k.sol).catch(() => {
    throw new ProblemError(securityProblems.chainUnreachable("sol"));
  });
  const signedTx = signSolTx(solTransferTx(k.from, k.to, units, blockhash), await k.secret());
  const signature = base58(fromBase64(signedTx).subarray(1, 65));
  const explorerUrl = `https://solscan.io/tx/${signature}`;
  if (!(await send.call(k.sol, signedTx).catch(() => false))) return { status: "problem", problem: securityProblems.subwalletNotSent("Solana") };
  return k.confirmed(() => status.call(k.sol, signature), signature, explorerUrl);
}
