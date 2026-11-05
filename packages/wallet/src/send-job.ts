// Home's Send, followed to its end (E3 from a wallet, E4 from the Safe, and the pocket's own share): one saved job per
// Send, kept on this device, so a restart finds it. Loaded with the first Send, never in Home's first load.
//
// Security review H1 (3 Nov): once the payment step is handed to 1Click, its outcome is UNKNOWN until 1Click's own status
// of that payment says how it ended. A submit that errors, or a restart, never reads "nothing was paid" (a person would
// send again, and the payee would be paid twice). The job is marked `handed` on the device BEFORE the submit; from then
// on it is only followed: SUCCESS is paid; REFUNDED, FAILED, or still waiting for its deposit past the payment's own
// deadline is not paid; anything else is "It may have gone. Activity will say." with no Try again. Sending the same
// signed payment again is harmless (its one-time number is spent once), so a payment 1Click hasn't seen is handed over
// again, never signed again.
//
// D137 (product decision, 3 Nov): no artificial waits. The payment is handed over in the same step that reads leg 1 landed with
// enough, for exactly leg 1's own signed minimum (no random wait, no trim). A job an older version saved may still carry
// its wait (`delayMs`, `notBefore`): it is ignored, so that payment goes at once too.
import type { Problem } from "@zerofee/core/problem";
import type { Apis } from "./apis.ts";
import type { Movement } from "./types.ts";
import { moveProof } from "@zerofee/core/tx-proof";
import { privateBack } from "@zerofee/core/private-route";

export interface SendJob {
  /** The movement's id. */
  id: string;
  /** A Send the Safe filled Private for (safe-send.ts, product decision, 5 Nov): a payout that doesn't go says the money is in
   *  Private (QA's MUST 3, rule 8), never "nothing was paid". */
  filled?: true;
  /** Leg 1's 1Click address (E3, E4); none for the pocket's own share, which has no leg 1. */
  inDeposit?: string;
  /** Leg 1's status tag (security review M2): through the relay, only with it does 1Click's answer say what arrived. */
  inTag?: string;
  /** Leg 2's (the payment's) 1Click address and its status tag. */
  outDeposit: string;
  outTag?: string;
  /** The payment's own deadline (ms): still waiting for its deposit after this, it wasn't paid. */
  outDeadline?: number;
  /** The signed payment (the pocket's NEP-413 transfer to outDeposit), handed to 1Click as is. */
  signedData: unknown;
  /** The pocket coin the payment takes (its 1Click id), and how much (units): leg 1 must bring at least that. */
  coinId: string;
  leg2In: string;
  coin: string;
  startedAtIso: string;
  /** Written before the first submit: from then on the payment's outcome is 1Click's to say. */
  handed?: true;
  lastSubmit?: number;
}
export const SEND_JOBS = "send-jobs";
/** D137 follow-up: a Send is asked about every second for its first 30 s, then every 3 s, so its payment starts about a
 *  second after leg 1 lands (it was every 10 s). One ask at a time: the next is planned only once this one answered. */
export const FOLLOW_FAST_MS = 1_000, FOLLOW_FAST_FOR_MS = 30_000, FOLLOW_SLOW_MS = 3_000;
export const followPace = (sinceMs: number): number => (sinceMs < FOLLOW_FAST_FOR_MS ? FOLLOW_FAST_MS : FOLLOW_SLOW_MS);
/** How long leg 1 may take to land once it is on its way (not while the Safe holds it), before the line says so. */
export const LEG1_WAIT_MS = 30 * 60_000;
/** A payment 1Click hasn't seen is handed over again at most this often (the same signature: harmless). */
const SUBMIT_AGAIN_MS = 60_000;
/** After the payment's deadline, how long 1Click may take to say it ended before "not paid". */
const DEADLINE_GRACE_MS = 5 * 60_000;

/**
 * The payment's quote lives this long: leg 1's own time (the follower gives it LEG1_WAIT_MS) and room. It is only the
 * latest the payment may go, never a wait: the payment goes the moment leg 1 lands (D137).
 */
export const SEND_QUOTE_MS = 60 * 60_000;

/** The signed payment's own deadline (its NEP-413 message's `deadline`), as the job keeps it; nothing when unreadable. */
export function deadlineOf(payload: { message: string }): { outDeadline?: number } {
  try {
    const at = Date.parse(JSON.parse(payload.message)?.deadline);
    return Number.isFinite(at) ? { outDeadline: at } : {};
  } catch {
    return {};
  }
}

/** The words for each ending; none of them says "Try again" while money may be moving (H1). */
export const sendWords = {
  /** handed over, outcome not known yet (a submit that errored, a restart, a status that doesn't say) */
  unknown: (): Problem => ({ code: "ledger.send.unknown", whatHappened: "It may have gone. Activity will say.", money: { state: "on-the-way", where: "to the person you paid, or back to you" }, next: { kind: "wait", label: "Wait" } }),
  /** leg 1 came back before anything was paid */
  back: (coin: string): Problem => ({ code: "ledger.send.back", whatHappened: `The ${coin} came back. Nothing was paid.`, money: { state: "safe", where: "in your private balance on NEAR" }, next: { kind: "nothing", label: "Done" } }),
  /** leg 1 brought less than the payment needs, so the payment was never handed over */
  short: (coin: string): Problem => ({ code: "ledger.send.short", whatHappened: `Less ${coin} arrived than the payment needs, so nothing was paid.`, money: { state: "safe", where: "in your private balance on NEAR" }, next: { kind: "nothing", label: "Done" } }),
  /** leg 1 hasn't arrived in time; the payment was never handed over */
  slow: (coin: string): Problem => ({ code: "ledger.send.slow", whatHappened: `The ${coin} hasn't arrived yet, so nothing was paid.`, money: { state: "on-the-way", where: "to your private balance on NEAR" }, next: { kind: "wait", label: "Wait" } }),
  /** leg 1 arrived, but 1Click never said how much: the payment was never handed over (security review M2) */
  unread: (coin: string): Problem => ({ code: "ledger.send.no-figure", whatHappened: `The ${coin} arrived, but the swap service didn't say how much, so nothing was paid.`, money: { state: "safe", where: "in your private balance on NEAR" }, next: { kind: "nothing", label: "Done" } }),
  /** handed over, and 1Click says it ended unpaid (refunded, failed, or never taken before its deadline) */
  notPaid: (): Problem => ({ code: "ledger.send.not-paid", whatHappened: "It wasn't paid. The money came back to you.", money: { state: "safe", where: "in your private balance on NEAR" }, next: { kind: "nothing", label: "Done" } }),
  /** A Send the Safe filled Private for, whose payout didn't go (came back, short, unread, unpaid): the money left the Safe
   *  and is in Private, said by name (QA's MUST 3, rule 8), never "nothing moved"; the cause's own code kept. */
  inPrivate: (p: Problem, usd?: number | null): Problem => ({ ...p, whatHappened: `It wasn't paid. ${privateBack(usd)}`, money: { state: "safe", where: "in Private" }, next: { kind: "nothing", label: "Done" } }),
};

export interface SendJobDeps {
  apis: Pick<Apis, "status" | "submitIntent">;
  relayed: string | undefined;
  remember: (m: Movement) => Promise<void>;
  /** A movement kept on the device without telling anyone, and taken back (review L2: before a sheet, and on its No). */
  note: (m: Movement) => Promise<void>;
  forget: (id: string) => Promise<void>;
  loadMovements: () => Promise<Movement[]>;
  emit: (event: string, payload: unknown) => void;
  stored: (key: string) => Promise<string | null | undefined>;
  store: (key: string, value: string) => Promise<unknown>;
  serially: <T>(job: () => Promise<T>) => Promise<T>;
  iso: () => string;
  now: () => number;
  trackMs: number | undefined;
  /** A Send ended (paid or not): the ledger sweeps the pocket home to the Safe once no Send still needs it (M5), never
   *  for a Move's or a site top-up's payment (private-move.ts sweepHeld, by this id). */
  ended?: (id: string) => void;
}

export function createSendJobs(x: SendJobDeps) {
  const { apis, relayed, remember, emit, iso, now } = x;
  /** Jobs this run follows or followed: a second follower of the same job never starts (review L4: claimed before any
   *  await, and never given back in this run). */
  const following = new Set<string>();

  const jobs = async (): Promise<Record<string, SendJob>> => {
    try {
      const v = JSON.parse((await x.stored(SEND_JOBS)) ?? "{}");
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  };
  const save = (j: SendJob) => x.serially(async () => x.store(SEND_JOBS, JSON.stringify({ ...(await jobs()), [j.id]: j })));
  const drop = (id: string) =>
    x.serially(async () => {
      const all = await jobs();
      if (!(id in all)) return;
      delete all[id];
      await x.store(SEND_JOBS, JSON.stringify(all));
    });

  /** Hand the signed payment to 1Click. The job says `handed` first; an error leaves it handed (unknown, H1). */
  async function hand(job: SendJob, m: Movement): Promise<SendJob> {
    const marked: SendJob = { ...job, handed: true, lastSubmit: now() };
    await save(marked);
    try {
      await apis.submitIntent(relayed!, job.signedData);
      if (m.problem) await remember({ ...m, problem: undefined, updatedAtIso: iso() });
    } catch {
      await remember({ ...m, status: "moving", problem: sendWords.unknown(), updatedAtIso: iso() });
      emit("ledger.balancesChanged", {});
    }
    return marked;
  }

  /** Follow one job to its end, once per run. */
  function follow(first: SendJob): void {
    if (following.has(first.id)) return;
    following.add(first.id);
    let job = first;
    let movingSince: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // a Send the Safe filled Private for: its ending says the money is in Private (MUST 3)
    // the copy review's words: the figure ("The $12.00 is back in Private."), never "your <coin>"; a dollar coin's amount is its dollars
    const said = (p: Problem, m?: Movement): Problem => (job.filled ? sendWords.inPrivate(p, m ? Number(m.usd ?? (/^USD[CT]$/i.test(job.coin) ? m.amount : NaN)) : null) : p);
    // security review L4: the job stays claimed for the whole run, even once it ends, so a resume that read it before its
    // end was saved never starts a second follower (whose refused submit would write "not paid" over a Send that was paid)
    const quit = () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    const end = async (m: Movement, patch: Partial<Movement>) => {
      quit();
      await drop(job.id);
      await remember({ ...m, ...patch, updatedAtIso: iso() });
      emit("ledger.balancesChanged", {});
      // M5: what this Send left in the pocket (what leg 1 brought over its minimum, a refund, a payment that ended
      // unpaid) goes home to the Safe
      x.ended?.(job.id);
    };
    const tick = async () => {
      const m = (await x.loadMovements()).find((y) => y.id === job.id);
      // ended elsewhere (a hold cancelled or declined on the account): nothing more to do, nothing is ever paid
      if (!m || (m.status !== "moving" && m.status !== "waiting")) {
        quit();
        return void (await drop(job.id));
      }
      if (m.status === "waiting") return;
      if (!job.handed) {
        if (!job.inDeposit) return void (job = await hand(job, m));
        movingSince ??= now();
        const s = await apis.status(job.inDeposit, relayed, job.inTag).catch(() => null);
        const status = s?.status ?? "";
        if (status === "REFUNDED" || status === "FAILED") return end(m, { status: "problem", problem: said(sendWords.back(job.coin), m) });
        if (status !== "SUCCESS") {
          if (now() - movingSince > LEG1_WAIT_MS) await end(m, { status: "problem", problem: sendWords.slow(job.coin) });
          return;
        }
        // what reached the pocket, as 1Click says it (security review M2: read with leg 1's tag, so the relay answers it).
        // No figure is no proof: it waits, never goes. Less than the payment takes: the payment is never handed over.
        const landed = (s as { swapDetails?: { amountOut?: unknown } } | null)?.swapDetails?.amountOut;
        if (typeof landed !== "string" || !/^\d+$/.test(landed)) {
          if (now() - movingSince > LEG1_WAIT_MS) await end(m, { status: "problem", problem: said(sendWords.unread(job.coin), m) });
          return;
        }
        if (BigInt(landed) < BigInt(job.leg2In)) return end(m, { status: "problem", problem: said(sendWords.short(job.coin), m) });
        // D137: landed with enough, so the payment goes now, in this same step (no wait of ours)
        job = await hand(job, m);
        return;
      }
      // handed over: only 1Click's own status of the payment says how it ended
      const s = await apis.status(job.outDeposit, relayed, job.outTag).catch(() => null);
      const status = s?.status ?? "";
      // its proof (product decision, 3 Nov): the payee's transaction, from 1Click's own record of the payment (it leaves the private
      // balance, which has no public transaction); its link joins the movement's explorer links
      if (status === "SUCCESS") {
        const proof = moveProof(s, { from: "private", to: m.toChain ?? "near", deposit: job.outDeposit, ...(m.proof ? { was: m.proof } : {}) });
        return end(m, { status: "done", problem: undefined, proof, ...(proof.end?.url && !m.explorerUrls.includes(proof.end.url) ? { explorerUrls: [...m.explorerUrls, proof.end.url] } : {}) });
      }
      if (status === "REFUNDED" || status === "FAILED") return end(m, { status: "problem", problem: said(sendWords.notPaid(), m) });
      if (status === "PENDING_DEPOSIT") {
        if (job.outDeadline !== undefined && now() > job.outDeadline + DEADLINE_GRACE_MS) return end(m, { status: "problem", problem: said(sendWords.notPaid(), m) });
        // 1Click hasn't seen the payment: the same signature again (its one-time number makes a second one harmless)
        if (now() - (job.lastSubmit ?? 0) >= SUBMIT_AGAIN_MS) job = await hand(job, m);
      }
    };
    // single-flight (D137 follow-up): the next ask is planned only when this one answered, so a slow answer never piles
    // asks up; every second for the first 30 s, then every 3 s (a test's trackMs sets its own pace)
    const began = now();
    const next = () => {
      if (stopped) return;
      timer = setTimeout(() => void tick().catch(() => undefined).finally(next), x.trackMs ?? followPace(now() - began));
      (timer as unknown as { unref?: () => void }).unref?.();
    };
    next();
  }

  /** Start a job: saved first (a restart finds it), then followed. */
  async function start(job: SendJob): Promise<void> {
    await save(job);
    follow(job);
  }

  /**
   * Security review L2: a Send's movement ("moving") and its job (the payment already signed) are written BEFORE the
   * sheet that sends its first step, quietly, and not followed yet. A crash in between leaves both, so a restart follows
   * it: its first step's own status says whether anything went. A No, or a sheet that errored, takes both back.
   */
  async function keep(job: SendJob, m: Movement): Promise<void> {
    await x.note(m);
    await save(job);
  }
  async function discard(id: string): Promise<void> {
    await drop(id);
    await x.forget(id);
  }

  /**
   * After a restart: every saved job whose Send is still open is followed again; a handed one only to its end. A Send
   * still "moving" with no job (an older version kept its payment in memory only) is said as unknown, never as unpaid.
   */
  async function resume(prefixes: readonly string[]): Promise<void> {
    const all = await jobs();
    const list = await x.loadMovements();
    for (const j of Object.values(all)) {
      const m = list.find((y) => y.id === j.id);
      if (!m || (m.status !== "moving" && m.status !== "waiting")) await drop(j.id);
      else follow(j);
    }
    for (const m of list) {
      if (m.status !== "moving" || !prefixes.some((p) => m.id.startsWith(p)) || following.has(m.id) || m.id in all || m.problem?.code === "ledger.send.unknown") continue;
      await remember({ ...m, problem: sendWords.unknown(), updatedAtIso: iso() });
    }
  }

  /** The units of a pocket coin the open jobs hold (review L5): a Safe-coin Send never spends a Send still on its way. */
  async function reserved(coinId: string): Promise<bigint> {
    return Object.values(await jobs()).reduce((n, j) => (j.coinId === coinId ? n + BigInt(j.leg2In) : n), 0n);
  }

  return { start, keep, discard, follow, resume, jobs, reserved, hand };
}
export type SendJobs = ReturnType<typeof createSendJobs>;
