// Move and a site's top-up paid from Private (the product's HARD RULE: every money move confidential, NEAR Confidential).
// Each leg is ONE payment from Private straight to the person's own wallet (its SOL, ETH (RH) or BNB address, the NEAR
// wallet's private balance, a site's SOL wallet): one confidential hop, never the public Safe → NEAR wallet leg
// (ledger.toTrading). Every payment is safe-send.ts's own (sendFromSafe: the pocket's NEP-413, one tap under the caps),
// never a second copy. Private short: with the fill closed (VITE_SAFE_FILL_OPEN off, private-route.ts) the whole Move
// is refused before anything is saved or signed; open, the short leg's job fills Private from the Safe first (the
// Safe's own sheet, Face ID), and its payout goes only once 1Click says the fill landed with enough (send-job.ts).
// Loaded with its first use, never in Home's first load; the ledger hands over what it needs.
import { ProblemError } from "@zerofee/core/problem";
import type { Bridge } from "@zerofee/core/bridge";
import { privateShort } from "@zerofee/core/private-route";
import { fromUnits, toUnits } from "./amount.ts";
import type { Catalogue } from "./catalogue.ts";
import type { SafeSendRoute } from "./safe-send.ts";
import type { Movement, Payee } from "./types.ts";
import { walletProblems } from "./wallet-problems.ts";

type Caller = string;
/** One leg: a wallet of the person's own by its id ("near": the NEAR wallet's private balance), its dollars, and the
 *  coin's own amount when the Safe pays with another coin than USDC. */
export interface PrivatePart { wallet: string; usd: number; amount?: string }
export interface PrivateMoveDeps {
  core: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  catalogue: () => Promise<Catalogue>;
  sends: () => Promise<{ sendFromSafe: (p: Record<string, unknown>, caller: Caller, route?: SafeSendRoute) => Promise<Movement[]>; pocketShare: (coin: string) => Promise<bigint> }>;
  originAsset: (tokenId: string) => string;
  /** The Move route's fill switch (VITE_SAFE_FILL_OPEN), read once by the ledger. */
  fillOpen: boolean;
  usdc: string;
  stored: (key: string) => Promise<string | null | undefined>;
  store: (key: string, value: string) => Promise<unknown>;
  /** One write to the kept list at a time (the ledger's serially). */
  serially: <T>(job: () => Promise<T>) => Promise<T>;
  loadMovements: () => Promise<Movement[]>;
  /** Sends a restart left on their way are followed again (the ledger's resumeSends). */
  resume: () => Promise<void>;
  now: () => number;
  notForChild: () => Promise<void>;
  /** The apps Spending asks for (ledger.ts SPENDING_FOR): Trade names one, so the Safe's sheet (a fill) is that app's (D146). */
  spendingFor: ReadonlySet<string>;
  /** The person's chain wallets as Trade sees them (subwallet.list as "trade": its own and the sites'). Wallet's own list
   *  holds only Private, so a Move's "trade-sol-…" wallet was never found there (QA's proof lap, 5 Nov). */
  trade: () => Pick<Bridge, "call">;
}
/** A Move's payments by its job's key, kept on this device as each is made, so a page closed mid-job finds them again.
 *  `paying`: its legs are still being made; `fillAt`: when the Safe last filled Private for it (the sweep's hold). */
type Kept = Record<string, { at: number; parts: { wallet: string; usd: number; ids: string[]; stopped?: string; minOut?: string }[]; paying?: true; fillAt?: number }>;
const KEY = "private-moves";
/** After a fill, Private's extra (the step's rounding) stays this long: never swept home to the Safe (QA's
 *  MUST: a sweep right after would put Safe −$20 … Safe +$10 side by side on public NEAR, pointing at the $9.95). */
export const FILL_HOLD_MS = 86_400_000;
/** A Move whose legs are still being made, past this, is a page that closed mid-way: it holds the sweep no longer. */
const PAYING_MS = 10 * 60_000;

/** Where an unreadable record was first seen: the sweep waits 24 h from then (QA's SHOULD: fail closed). */
const BAD_KEY = "private-moves-unread";

/** Whether the ledger's sweep home (M5, ledger.ts sweepHome) waits: the payment that just ended is a Move's or a site
 *  top-up's (their end never sweeps), a Move is still being paid, or the Safe filled Private in the last 24 h. A record
 *  that can't be read holds it 24 h from the first read that found it so (it may have held a fill), then lets it go. */
export async function sweepHeld(raw: string | null | undefined, ended: string | undefined, now: number, kv: Pick<PrivateMoveDeps, "stored" | "store">): Promise<boolean> {
  let all: Kept;
  try {
    all = JSON.parse(raw ?? "{}") as Kept;
    if (!all || typeof all !== "object" || Array.isArray(all)) throw new Error("not a record");
  } catch {
    const seen = Number((await kv.stored(BAD_KEY)) ?? NaN);
    if (!Number.isFinite(seen)) { await kv.store(BAD_KEY, String(now)); return true; }
    return now - seen < FILL_HOLD_MS;
  }
  if (await kv.stored(BAD_KEY)) await kv.store(BAD_KEY, "");
  return Object.values(all).some((r) => (ended !== undefined && r.parts?.some((p) => p.ids?.includes(ended))) || (r.paying === true && now - r.at < PAYING_MS) || (typeof r.fillAt === "number" && now - r.fillAt < FILL_HOLD_MS));
}
const filled = (ids: readonly string[]) => ids.some((id) => id.startsWith("safe-send:"));
const JOB = /^[A-Za-z0-9_-]{16,64}$/;
const KEEP_MS = 3 * 86_400_000;
const FLOAT_CHAINS = new Set(["sol", "hood", "bsc"]);

export function createPrivateMove(x: PrivateMoveDeps) {
  const kept = async (): Promise<Kept> => {
    try { return JSON.parse((await x.stored(KEY)) ?? "{}") as Kept; } catch { return {}; }
  };
  const keep = (job: string, rec: Kept[string]): Promise<void> => x.serially(async () => {
    const all = await kept();
    for (const [k, v] of Object.entries(all)) if (x.now() - v.at > KEEP_MS) delete all[k];
    all[job] = rec;
    await x.store(KEY, JSON.stringify(all));
  });

  /** A Send's own fill (ledger.sendFromSafe with `fill`): its extra stays in Private the same 24 h. */
  const noteFill = async (ms: readonly Movement[]): Promise<void> => {
    const ids = ms.map((m) => m.id);
    if (filled(ids)) await keep(`send-${ids[0]}`, { at: x.now(), parts: [{ wallet: "send", usd: 0, ids }], fillAt: x.now() });
  };

  const drop = (job: string): Promise<void> => x.serially(async () => {
    const all = await kept();
    delete all[job];
    await x.store(KEY, JSON.stringify(all));
  });

  /** Each wallet as the core lists it, as the payee a payment from Private pays: only the person's own. */
  async function payees(parts: readonly PrivatePart[]): Promise<{ to: Payee; toTokenId?: string }[]> {
    const r = await x.trade().call<{ id: string; kind: string; chain: string; address?: string; oldWords?: boolean }[]>("subwallet.list", {});
    if ("problem" in r) throw new ProblemError(r.problem);
    // never a wallet the replaced backup words open (security audit 4 Nov, finding 2; QA's MUST on 97b7cdd8c):
    // after new words the new float is listed after the old one, and a stale or resumed id can still name an old one
    const list = r.ok.filter((w) => !w.oldWords);
    return parts.map((p) => {
      if (p.wallet === "near") {
        const float = list.find((w) => w.kind === "trade" && w.chain === "near" && typeof w.address === "string");
        if (!float) throw new ProblemError(walletProblems.recipientInvalid());
        return { to: { kind: "ledger", accountId: float.address!, confidential: true }, toTokenId: x.usdc };
      }
      const w = list.find((v) => v.id === p.wallet);
      if (!w || w.kind === "private" || !FLOAT_CHAINS.has(w.chain) || typeof w.address !== "string") throw new ProblemError(walletProblems.recipientInvalid());
      return { to: { kind: "chain", chain: w.chain, address: w.address } };
    });
  }

  /**
   * `p`: { parts: PrivatePart[] (1 to 4), tokenId? (the Safe's coin that fills Private when it is short; USDC by
   * default), label?, job? (the Move's key: its payments are kept under it), whole? (a site's top-up: a short leg is
   * filled whole, one fill and one exit) }. Answers each part's movements in the
   * order asked; a part that stopped after an earlier one went says why (`stopped`), the ones before it still go.
   */
  async function moveFromPrivate(p: Record<string, unknown>, asker: Caller): Promise<{ parts: { wallet: string; usd: number; ids: string[]; stopped?: string; minOut?: string }[] }> {
    await x.notForChild();
    // D146, as toTrading: Spending's engine asks as Trade for the app that asked it
    const caller: Caller = asker === "trade" && typeof p.for === "string" && x.spendingFor.has(p.for) ? p.for : asker;
    const raw = Array.isArray(p.parts) ? (p.parts as unknown[]) : [];
    const parts: PrivatePart[] = raw.map((r) => r as PrivatePart).filter((r) => r && typeof r.wallet === "string" && Number.isFinite(r.usd) && r.usd > 0 && (r.amount === undefined || /^\d{1,12}(\.\d{1,18})?$/.test(String(r.amount))));
    if (!parts.length || parts.length !== raw.length || parts.length > 4) throw new ProblemError(walletProblems.amountInvalid());
    const tokenId = typeof p.tokenId === "string" && p.tokenId ? p.tokenId : x.usdc;
    const job = typeof p.job === "string" && JOB.test(p.job) ? p.job : undefined;
    const label = typeof p.label === "string" ? p.label.slice(0, 120) : undefined;
    // a site's top-up (QA): Private short, one fill of the whole then one exit, never Private's part beside it
    const whole = p.whole === true;
    const [cat, s, to] = await Promise.all([x.catalogue(), x.sends(), payees(parts)]);
    const coin = cat.coin(x.originAsset(tokenId));
    if (!coin) throw new ProblemError(walletProblems.quoteUnavailable("That coin isn't listed."));
    const amountOf = (r: PrivatePart) => r.amount ?? r.usd.toFixed(2);
    const units = parts.map((r) => toUnits(amountOf(r), coin.decimals) ?? 0n);
    if (units.some((u) => u <= 0n)) throw new ProblemError(walletProblems.amountInvalid());
    const need = units.reduce((n, u) => n + u, 0n);
    // a dollar coin at $1 each, as every sheet says it; any other at its price
    const px = /^USD[CT]$/i.test(coin.symbol) || !(Number(coin.priceUsd) > 0) ? 1 : Number(coin.priceUsd);
    const usdOf = (u: bigint) => Number(fromUnits(u, coin.decimals)) * px;
    const short = (have: bigint, needed: bigint) => privateShort(usdOf(have), usdOf(needed));
    // Private short and the fill closed: the whole Move is refused here, before anything is kept or signed
    const share = await s.pocketShare(x.originAsset(tokenId));
    if (share < need && !x.fillOpen) throw new ProblemError(short(share, need));
    // the smallest legs first: Private pays them whole, and only the last can need the Safe's fill
    const order = parts.map((_, i) => i).sort((a, b) => (units[a]! < units[b]! ? -1 : units[a]! > units[b]! ? 1 : 0));
    const out = parts.map((r) => ({ wallet: r.wallet, usd: r.usd, ids: [] as string[] } as { wallet: string; usd: number; ids: string[]; stopped?: string; minOut?: string }));
    const at = x.now();
    // kept even with no job key: its payments' ends never sweep, and a fill holds the sweep (sweepHeld)
    const key = job ?? `pm-${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let fillAt: number | undefined;
    await keep(key, { at, parts: out, paying: true });
    for (const i of order) {
      try {
        const ms = await s.sendFromSafe({ tokenId, amount: amountOf(parts[i]!), to: to[i]!.to, ...(to[i]!.toTokenId ? { toTokenId: to[i]!.toTokenId } : {}), ...(label ? { label } : {}) }, caller, { fillOpen: x.fillOpen, short, ownWallet: true, ...(whole ? { whole } : {}) });
        out[i]!.ids = ms.map((m) => m.id);
        // what the wallet is promised, at least (audit, 5 Nov): its tick waits for a read that shows it
        const least = ms.reduce((n, m) => (m.minOut && /^\d{1,40}$/.test(m.minOut) ? n + BigInt(m.minOut) : n), 0n);
        if (least > 0n) out[i]!.minOut = least.toString();
        if (filled(out[i]!.ids)) fillAt = x.now();
      } catch (e) {
        // nothing went yet: the Problem as it is (the Move's job says it; nothing moved)
        if (!out.some((r) => r.ids.length)) { await drop(key); throw e; }
        out[i]!.stopped = e instanceof ProblemError ? e.problem.whatHappened : "It didn't go.";
      }
      await keep(key, { at, parts: out, paying: true, ...(fillAt ? { fillAt } : {}) });
    }
    await keep(key, { at, parts: out, ...(fillAt ? { fillAt } : {}) });
    return { parts: out };
  }

  /** A Move's payments by its key, each with its movement's status now (a restart's Sends followed again first). Null:
   *  none kept (it never reached a payment). */
  async function privateMoveStatus(p: Record<string, unknown>): Promise<{ parts: { wallet: string; usd: number; stopped?: string; moves: { id: string; status: string; problem?: string }[] }[] } | null> {
    const job = typeof p.job === "string" && JOB.test(p.job) ? p.job : undefined;
    const rec = job ? (await kept())[job] : undefined;
    if (!rec) return null;
    await x.resume().catch(() => undefined);
    const ms = await x.loadMovements();
    return { parts: rec.parts.map((r) => ({ wallet: r.wallet, usd: r.usd, ...(r.stopped ? { stopped: r.stopped } : {}), moves: r.ids.map((id) => { const m = ms.find((v) => v.id === id); return { id, status: m?.status ?? "moving", ...(m?.problem ? { problem: m.problem.code } : {}) }; }) })) };
  }

  return { moveFromPrivate, privateMoveStatus, noteFill };
}
