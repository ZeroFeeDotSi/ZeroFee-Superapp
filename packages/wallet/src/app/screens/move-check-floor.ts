// Audit 10's A7 (8 Nov, QA 16's ruling): the Move page's floor said "Arrives in your SOL wallet · at least $51.67" and
// "Fees · at most $3.33" (the plan's bounds) while its Check sheet said "Your SOL wallet gets · about $54.50, at least
// $53.22" and "Fee · about $0.50": two answers for one Move. D137 keeps what arrives and the fee before the tap, so the
// floor now reads the plan the Check sheet prints: the core's own moveSheet over the same split (fillOf: the Safe's whole
// fill, Private's share, each wallet's part) and the same costs (subwallet.float.swapCost: 1Click's dry quotes in the
// core, the Sim's one cost in the Sim, as Swap's form reads them), its lines turned into the floor's rows. A cost not
// read (under $2, a dead read): null, and the floor keeps the plan's bounds, which Check's figures still meet.
import type { Leg, PageFill, Place } from "./move-split.ts";

type Row = { label: string; value: string };
/** The core's names for a Move's wallets (the Check sheet's own). */
const NAME: Partial<Record<Place, string>> = { sol: "your SOL wallet", hood: "your Robinhood wallet", near: "your NEAR wallet", bsc: "your BNB wallet", safe: "your Safe" };
const say = (c: bigint) => `$${(Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What arrives of `c` cents into `to`, as the Check's quotes give it: 1 % slippage under it (1Click's), USDC into the
 *  NEAR wallet whole. Null: the cost isn't read. */
async function legGot(c: bigint, to: Place, cost: (to: Place, usd: number) => Promise<number | null>): Promise<{ got: bigint; least: bigint } | null> {
  if (c <= 0n) return { got: 0n, least: 0n };
  const a = to === "near" ? Number(c) : await cost(to, Number(c) / 100).then((usd) => (usd === null || !Number.isFinite(usd) ? null : Math.round(usd * 100)));
  return a === null ? null : { got: BigInt(a), least: BigInt(Math.floor(a * 0.99)) };
}

/** The Check sheet's lines for this Move before the tap: the core's moveSheet over the page's split and the read costs. */
export async function checkLines(legs: readonly Leg[], f: PageFill | null, cost: (to: Place, usd: number) => Promise<number | null>): Promise<string[] | null> {
  if (!f?.parts?.length || !(f.fill > 0)) return null;
  const cents = (usd: number) => BigInt(Math.round(usd * 100));
  const parts = [];
  for (const p of f.parts) {
    const wallet = NAME[p.to];
    if (!wallet || p.to === "safe") return null;
    const priv = cents(p.fromPrivate), pay = cents(p.viaFill);
    const [a, b] = await Promise.all([legGot(priv, p.to, cost), legGot(pay, p.to, cost)]);
    if (!a || !b) return null;
    parts.push({ wallet, priv, pay, got: a.got + b.got, least: a.least + b.least });
  }
  const others = legs.filter((l) => l.from !== "safe" && l.from !== "private").map((l) => ({ from: NAME[l.from] ?? "", to: NAME[l.to] ?? "", v: cents(l.usd) }));
  if (others.some((o) => !o.from || !o.to)) return null;
  const { moveSheet } = await import("@zerofee/core/move-plan");
  const safe = cents(f.fill);
  return moveSheet(parts, safe, say, { brought: safe, ...(others.length ? { others } : {}) }).lines;
}

/** The floor's rows from the Check sheet's lines: its From rows, what each wallet gets ("Arrives in your SOL wallet ·
 *  about $54.50, at least $53.22"), its Fee row ("Fees · about $0.50"), then the time. Null: a line it can't place. */
export function floorFromCheck(lines: readonly string[], time: Row | undefined): Row[] | null {
  const from: Row[] = [], gets: Row[] = [];
  let fee: Row | null = null;
  for (const l of lines) {
    const g = /^Your (.+?) gets · (.+)$/.exec(l), s = /^From (.+?) · (.+)$/.exec(l), x = /^Fee · (.+)$/.exec(l);
    if (g) gets.push({ label: `To your ${g[1]}`, value: g[2]! });
    else if (s) from.push({ label: `From ${s[1]}`, value: s[2]! });
    else if (x) fee = { label: "Fees", value: x[1]! };
  }
  if (!from.length || !gets.length || !fee) return null;
  return [...from, ...gets, fee, ...(time ? [time] : [])];
}
