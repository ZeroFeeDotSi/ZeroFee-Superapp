// AUDIT helper (test code only): a model of the core's float in dollars, for the planner property test and PoCs.
import { ProblemError } from "@zerofee/core/problem";
import type { FloatChain } from "../../float-view.ts";

export const PX: Record<FloatChain, number> = { sol: 150, hood: 3000, bsc: 600 };
export const DEC: Record<FloatChain, number> = { sol: 9, hood: 18, bsc: 18 };
export const CHAINS: FloatChain[] = ["sol", "hood", "bsc"];
export const FEE = 0.02;
export const LAND_MS = 30_000;

export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const problem = (code: string) => new ProblemError({ code, whatHappened: code, money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "OK" } } as never);

export interface MMove { id: string; key: string; kind: "out" | "in" | "home"; chain?: FloatChain; wallet?: string; usd: number; arrive: number; landAt: number; status: "pending" | "done" }

/** The core's float as a ledger in dollars: what Trade may and may not ask of it. */
export function model(clock: { t: number }) {
  const m = {
    float: 0, main: 0, fees: 0, added: 0,
    wallets: new Map<string, { chain: FloatChain; slot: number; usd: number; coins: number }>(),
    moves: new Map<string, MMove>(),
    refusals: [] as { code: string; kind: string; usd: number; float: number; at: number }[],
    outWhileLeaving: 0,
    leavingSince: undefined as number | undefined,
  };
  for (const c of CHAINS) m.wallets.set(`${c}:0`, { chain: c, slot: 0, usd: 0, coins: 0 });
  const land = (mv: MMove) => {
    if (mv.status !== "pending" || clock.t < mv.landAt) return;
    mv.status = "done";
    if (mv.kind === "out") m.wallets.get(mv.wallet!)!.usd += mv.arrive;
    else if (mv.kind === "in") m.float += mv.arrive;
    else { m.main += mv.arrive; m.leavingSince = undefined; }
  };
  const wire = (mv: MMove) => ({ id: mv.id, kind: mv.kind, status: mv.status, expected: { tokenId: "x", amount: String(Math.floor(mv.arrive * 1e6)) } });
  /** As the core (D55): a wallet by id (to / from), a legacy slot, or the chain's current one (slot 0 here). */
  const keyOf = (p: any): string => p.to ?? p.from ?? `${p.chain}:${p.slot ?? 0}`;
  const usdOf = (c: FloatChain, raw: string) => (Number(BigInt(raw) / 10n ** BigInt(DEC[c] - 9)) / 1e9) * PX[c];
  async function call(method: string, p: any): Promise<any> {
    for (const mv of m.moves.values()) land(mv);
    switch (method) {
      case "subwallet.float.balance": return { usd: Math.round(m.float * 100) / 100, asOfIso: new Date(clock.t).toISOString() };
      case "subwallet.float.limits": return { movesLeftToday: 1000 };
      case "subwallet.create": {
        if (p.chain === "near") return { id: "float" };
        const k = `${p.chain}:${p.slot ?? 0}`;
        if (!m.wallets.has(k)) m.wallets.set(k, { chain: p.chain, slot: p.slot ?? 0, usd: 0, coins: 0 });
        return { id: k };
      }
      case "ledger.toTrading": { const usd = Number(p.amount); m.float += usd; m.added += usd; return { id: `add-${clock.t}-${Math.random()}`, status: "done" }; }
      case "ledger.activity": return [];
      case "subwallet.float.move": { const mv = m.moves.get(p.id); if (!mv) throw problem("security.float.move-unknown"); land(mv); return wire(mv); }
      case "subwallet.float.out": case "subwallet.float.in": case "subwallet.float.home": {
        const kind = method.split(".").at(-1) as MMove["kind"];
        const had = [...m.moves.values()].find((x) => x.key === p.key);
        if (had) return wire(had);
        let usd: number;
        if (kind === "home") usd = p.amount === "all" ? m.float : Number(p.amount) / 1e6;
        else if (kind === "in" && p.amount === "all") usd = Math.max(0, m.wallets.get(keyOf(p))!.usd - 0.01);
        else usd = usdOf(p.chain, p.amount);
        if (!(usd >= 2)) { m.refusals.push({ code: "security.request.not-allowed", kind, usd, float: m.float, at: clock.t }); throw problem("security.request.not-allowed"); }
        if (kind === "out") {
          if (m.leavingSince !== undefined) m.outWhileLeaving++;
          const cost = usd * (1 + FEE);
          if (cost > m.float + 1e-9) { m.refusals.push({ code: "security.float.short", kind, usd, float: m.float, at: clock.t }); throw problem("security.float.short"); }
          m.float -= cost; m.fees += cost - usd;
          const mv: MMove = { id: `fm-${p.key}`, key: p.key, kind, chain: p.chain, wallet: keyOf(p), usd, arrive: usd, landAt: clock.t + LAND_MS, status: "pending" };
          m.moves.set(mv.id, mv); return wire(mv);
        }
        if (kind === "in") {
          const w = m.wallets.get(keyOf(p))!;
          if (usd > w.usd + 1e-9) { m.refusals.push({ code: "security.subwallet.not-sent", kind, usd, float: w.usd, at: clock.t }); throw problem("security.subwallet.not-sent"); }
          w.usd -= usd; m.fees += usd * FEE;
          const mv: MMove = { id: `fm-${p.key}`, key: p.key, kind, chain: p.chain, wallet: keyOf(p), usd, arrive: usd * (1 - FEE), landAt: clock.t + LAND_MS, status: "pending" };
          m.moves.set(mv.id, mv); return wire(mv);
        }
        if (usd > m.float + 1e-9) { m.refusals.push({ code: "security.float.short", kind, usd, float: m.float, at: clock.t }); m.leavingSince = undefined; throw problem("security.float.short"); }
        m.float -= usd; m.fees += usd * FEE;
        const mv: MMove = { id: `fm-${p.key}`, key: p.key, kind, usd, arrive: usd * (1 - FEE), landAt: clock.t + LAND_MS, status: "pending" };
        m.moves.set(mv.id, mv); return wire(mv);
      }
    }
    throw new Error(`model: ${method}`);
  }
  const wallets = async () => {
    for (const mv of m.moves.values()) land(mv);
    return [...m.wallets].map(([id, w]) => ({ id, chain: w.chain, current: w.slot === 0, nativeUsd: Math.round(w.usd * 100) / 100, coinsUsd: w.coins }));
  };
  const total = () => m.float + [...m.wallets.values()].reduce((n, w) => n + w.usd, 0) + [...m.moves.values()].filter((x) => x.status === "pending" && x.kind !== "home").reduce((n, x) => n + x.arrive, 0);
  return { m, call, wallets, total };
}

