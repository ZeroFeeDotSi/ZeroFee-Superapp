// A site wallet's Take out (pump.fun → NEAR Confidential → the Safe) as Home's own job (bug report, 5 Nov:
// QA's real $2 Take out sat 33 min with no row on Home, its Activity row opened the Browser, and its second leg
// never went). Read from the core's own record (subwallet.site.moveBacks): reading it is also what sends a landed first
// leg on home (float-moves.ts goHome), so Home's read resumes one after a reload or a closed app, with no tap.
import { SITE_WALLETS } from "@zerofee/core/site-wallets";
import { proofUrlOk, swapIdOk, type MoveProof } from "@zerofee/core/tx-proof";
import type { LiveTrack } from "./live-steps.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import type { ProofEnd, ProofPage } from "../proof.ts";

/** A Take out as the core keeps it: the move out of the site's wallet, then on home (float-moves.ts moveBacks). */
export interface SiteBack {
  back: { id: string; status: string; usd?: number; site?: string; startedAtIso?: string; updatedAtIso?: string; proof?: MoveProof; homeStopped?: string; settled?: { amountOut?: string } };
  home?: { id?: string; status: string; usd?: number; updatedAtIso?: string; proof?: MoveProof; settled?: { amountOut?: string } };
}

export const BACK_ID = "back:";
export const BACK_WORDS = {
  safe: "Into your Safe",
  /** Under $2 into the NEAR wallet, a few cents of it go on the move home's fee (QA's NIT, 5 Nov): the least that
   *  lands (the core's own 98 %, float-floors.ts HOME_LEAST_PERCENT), so $1.86 of $1.90 surprises no one. */
  safeLeast: (usd: string) => (usd ? `Into your Safe. At least ${usd} lands.` : "Into your Safe, less a small fee."),
  /** live-steps.ts CONFIDENTIAL_STEP (inlined: live-steps imports this file); never "privately" (audit H1) */
  mid: "Through NEAR Confidential",
  out: (name: string) => `Out of your ${name} wallet`,
  title: (usd: string, name: string) => (usd ? `Take ${usd} out of your ${name} wallet` : `Take money out of your ${name} wallet`),
  done: "It's in your Safe.",
  stillThere: (name: string) => `Nothing left your ${name} wallet.`,
  // the copywriter's voice guard (say what happens) in D108's words (never "Spending": the NEAR wallet)
  backInSpending: "The swap didn't go through. It's in your NEAR wallet.",
  inSpending: (usd: string) => `It didn't reach your Safe. ${usd || "Your money"} is in your NEAR wallet.`,
} as const;

/** A Take out's time left (QA's Sim test Nov: no "Job created.", no time): the route's measured leg, a site's SOL
 *  wallet into NEAR (job-steps.ts LEG_SEC.chainIn, 79-112 s on mainnet), the one Move's own Take out counts down. */
export const TAKE_OUT_ETA_SEC = LEG_SEC.chainIn;
/** The Take out's job at the tap: its title as its row says it (BACK_WORDS.title), its dollars, its time. */
export const takeOutJob = (usd: number, name: string): { title: string; usd: string; etaSec: number } => ({ title: BACK_WORDS.title(`$${usd.toFixed(2)}`, name), usd: `$${usd.toFixed(2)}`, etaSec: TAKE_OUT_ETA_SEC });

/** The least of it that lands at home (core float-floors.ts HOME_LEAST_PERCENT, 98 %). */
const HOME_LEAST = 0.98;
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);
const dollars = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : "");
const usdcOut = (s: { amountOut?: string } | undefined) => (s?.amountOut && /^\d{1,30}$/.test(s.amountOut) ? Number(s.amountOut) / 1e6 : undefined);
export const siteNameOf = (site: string | undefined): string => SITE_WALLETS.find((w) => w.site === site)?.name ?? "your site";

/** Its row on Home's "Now", its tracker and its Activity centre task (one row: never the Browser's as well). */
export function backTrack(b: SiteBack, now: number = Date.now()): LiveTrack {
  const name = siteNameOf(b.back.site);
  const start = ms(b.back.startedAtIso);
  const startMs = Number.isFinite(start) ? start : now;
  const at = (iso: string | undefined) => (Number.isFinite(ms(iso)) ? { atMs: Math.max(0, ms(iso) - startMs) } : {});
  const out = BACK_WORDS.out(name), mid = BACK_WORDS.mid, safe = BACK_WORDS.safe;
  const base = { id: `${BACK_ID}${b.back.id}`, kind: "move" as const, title: BACK_WORDS.title(dollars(b.back.usd), name), wallets: ["safe"], startMs };
  const s = b.back.status, h = b.home?.status;
  // what reached Spending: leg 1's own count (USDC), else what it was quoted at
  const arrived = dollars(usdcOut(b.back.settled) ?? b.back.usd);
  if (s === "pending") return { ...base, steps: [{ label: out, state: "doing" }, { label: mid, state: "waiting" }, { label: safe, state: "waiting" }] };
  if (s === "failed" || s === "unpaid") return { ...base, steps: [{ label: out, state: "failed" }, { label: mid, state: "waiting" }, { label: safe, state: "waiting" }], end: { ok: false, line: BACK_WORDS.stillThere(name) }, endMs: ms(b.back.updatedAtIso) };
  // 1Click gave leg 1 back: its refund goes to Spending (float-moves.ts: refundTo the NEAR wallet, privately)
  if (s === "refunded") return { ...base, steps: [{ label: out, state: "done" }, { label: mid, state: "failed" }, { label: safe, state: "waiting" }], end: { ok: false, line: BACK_WORDS.backInSpending }, endMs: ms(b.back.updatedAtIso) };
  const legOne = [{ label: out, state: "done" as const, ...at(b.back.updatedAtIso) }, { label: mid, state: "done" as const, ...at(b.back.updatedAtIso) }];
  if (h === "done") return { ...base, steps: [...legOne, { label: safe, state: "done", ...at(b.home!.updatedAtIso) }], end: { ok: true, line: BACK_WORDS.done }, endMs: ms(b.home!.updatedAtIso) };
  if (h === "refunded" || h === "failed") return { ...base, steps: [...legOne, { label: safe, state: "failed" }], end: { ok: false, line: BACK_WORDS.inSpending(arrived) }, endMs: ms(b.home!.updatedAtIso) };
  // its home leg was refused (said, never a silent loop): where the money is; the core tries again on each read
  if (!b.home && b.back.homeStopped) return { ...base, steps: [...legOne, { label: safe, state: "failed" }], end: { ok: false, line: BACK_WORDS.inSpending(arrived) } };
  const got = usdcOut(b.back.settled);
  const small = got !== undefined && got < 2 ? BACK_WORDS.safeLeast(dollars(Math.floor(got * HOME_LEAST * 100) / 100)) : safe;
  return { ...base, steps: [...legOne, { label: small, state: "doing" }] };
}

/** Its page (Activity's "back:<id>"): each step with its proof, and both 1Click deposits to look up (View). */
export function backPage(b: SiteBack): ProofPage {
  const t = backTrack(b);
  const tx = (p: MoveProof | undefined, side: "start" | "end"): ProofEnd | undefined => {
    const x = p?.[side];
    if (x && typeof x.hash === "string") return { tx: { chain: x.chain, hash: x.hash, ...(proofUrlOk(x.url) ? { url: x.url } : {}) } };
    return (side === "start" ? p?.privateStart : p?.privateEnd) ? { private: true } : undefined;
  };
  const iso = (n: number | undefined) => (n !== undefined && Number.isFinite(t.startMs + n) ? new Date(t.startMs + n).toISOString() : undefined);
  const started = tx(b.back.proof, "start"), mid = tx(b.back.proof, "end"), landed = tx(b.home?.proof, "end");
  const step = (i: number, end?: ProofEnd, start?: ProofEnd) => ({ label: t.steps[i]!.label, ...(iso(t.steps[i]!.atMs) ? { atIso: iso(t.steps[i]!.atMs)! } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) });
  const swaps = [b.back.proof?.deposit, b.home?.proof?.deposit].filter((d): d is string => typeof d === "string" && swapIdOk(d));
  return {
    ...(started ? { started } : {}),
    ...(t.end?.ok && landed ? { finished: landed } : {}),
    steps: [step(0, started), step(1, mid), step(2, b.home?.status === "done" ? landed : undefined)],
    swaps,
    ...(t.end?.ok ? { done: true as const } : {}),
  };
}
