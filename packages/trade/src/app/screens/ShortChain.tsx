// The Buy sheet's short-chain state (S4): the buy is bigger than what's ready on this chain. What's ready now and the
// smaller buy, "More is on its way · about N s" while a move is in flight, and "Move more to Solana", one move at once
// because the person asked. The buy waits for no move.
import { useState } from "react";
import type { NextStep, Problem } from "@zerofee/core/problem";
import type { FloatChain, MoveRow } from "../../float-view.ts";
import { floatProblems, moveMoreUsd, overWalletWords, problemOf, shortChain } from "../boards.ts";
import { useFloat } from "../runtime.tsx";
import { OUT_FEE_ROOM } from "../../float.ts";
import { webWallet } from "@zerofee/shell-api/release.ts";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { runJob } from "@zerofee/shell-api/job-run.ts";
import { JOB_WORDS } from "@zerofee/shell-api/job-start.ts";
import { TimeLeft } from "@zerofee/wallet/app/money/JobMade.tsx";
import { LEG_SEC } from "@zerofee/wallet/app/screens/move-split.ts";

const COIN: Record<FloatChain, string> = { sol: "SOL", hood: "ETH", bsc: "BNB" };

/** `walletName`: the chain's wallet by its own name ("your SOL wallet", D129). The smaller buy is the page's one button
 *  (TradeSheet's floor, shortBuyNow); this says what the wallet has and the one way to add to it (UX audit 4 Nov). */
/** The short wallet's one way on: "add" is the quiet "Move money to your SOL wallet" button (TradeSheet's floor, second
 *  under the lit "Buy $X instead"); the rest are said here. One rule for both places. */
export function shortWay(c: Parameters<typeof shortChain>[0] & { closed?: boolean }, wantUsd: number, reserveUsd: number): "closed" | "onWay" | "move" | "add" {
  if (c.closed) return "closed";
  const s = shortChain(c, wantUsd);
  if (s.onWay) return "onWay";
  return moveMoreUsd(s.moreUsd, reserveUsd, OUT_FEE_ROOM) >= MOVE_OFFER_MIN_USD ? "move" : "add";
}
/** The floor's quiet button's words: the web wallet has no Move, so its way on is Add (a web test, 4 Nov). */
export const addWords = (chain: FloatChain, walletName: string): string => (webWallet() ? `Add ${COIN[chain]}` : `Move money to ${walletName}`);

export function ShortChain({ chain, wantUsd, wantText, haveUsd, walletName, onProblem }: { chain: FloatChain; wantUsd: number; wantText: string; haveUsd: string; walletName: string; onProblem: (p: Problem) => Promise<NextStep> }) {
  const { view, snap } = useFloat();
  const { tasks } = useShell();
  const [busy, setBusy] = useState(false);
  /** The move's job is made at the tap (rule 2: "Job created." and its time left, never "Moving…"). */
  const [made, setMade] = useState(false);
  /** The job its receipt follows (runJob's made): its own rows, never another job's (the audit's finding, 7 Nov). */
  const [madeJob, setMadeJob] = useState<string | null>(null);
  const c = snap.chains.find((x) => x.chain === chain)!;
  const s = shortChain(c, wantUsd);
  // never the whole reserve: the move's fee comes out of it too (re-walk.3: "Move $8 more" of $8.06 was refused)
  const moveUsd = moveMoreUsd(s.moreUsd, snap.reserveUsd, OUT_FEE_ROOM);
  // and only a move the core takes: it prices the chain's coin at its own rate, so $2 sent as coin can arrive as $1.99 under
  // its $2 floor (re-walk, 10.3: "Move $2 more" was refused every time). Short of it: nothing spare, and Add
  const canMove = moveUsd >= MOVE_OFFER_MIN_USD;
  const more = async () => {
    setBusy(true);
    try {
      // rule 2: the job is made at the tap ("Job created." and its time left here, its row on Home; no Face ID: Trade's
      // own reserve to its own wallet). A move that didn't go takes its row away again and is said here, once, as before
      let thrown: { e: unknown } | undefined;
      let row: MoveRow | undefined;
      const end = await runJob<MoveRow>({
        tasks, title: `Move $${moveUsd.toLocaleString("en-US")} more to ${walletName}`, usd: `$${moveUsd.toFixed(2)}`, etaSec: LEG_SEC.nearOut,
        safe: false, money: [`row:${chain}`],
        call: async () => { try { row = await view.moveNow(chain, moveUsd); return { ok: row }; } catch (e) { thrown = { e }; return { problem: problemOf(e, floatProblems.moveFailed(chain)) }; } },
        declined: (x) => !("ok" in x) || x.ok.status === "failed" || x.ok.status === "refunded",
        made: (j) => { setMadeJob(j.id); setMade(true); },
      });
      if ("refused" in end) { setMade(false); return void await onProblem(end.refused); }
      if (thrown) { setMade(false); throw thrown.e; }
      if ("ok" in end) return end.job.made([`move:${end.ok.id}`]);
      setMade(false);
      // the move's own row, as the core answered it (declined above: it didn't go)
      const r = row ?? { status: "failed" as const, stayed: true as const };
      // a move the core turned down comes back as a row, not a throw: said here, not left to Activity. Turned down because
      // the chain isn't open (re-walk.2): nothing moved, and the sheet now says the chain opens after its own test
      const after = view.snapshot();
      const nowClosed = after.chains.find((x) => x.chain === chain)?.closed;
      // the reserve was spent before this move could go (the split's own moves went first): nothing spare, said as that,
      // with Add as the way on, never "it didn't go through, coming back" (re-walk: nothing had moved)
      // and a move that never left (refused before anything moved) is never "coming back"
      if ((r.status === "failed" || r.status === "refunded") && !nowClosed) {
        await onProblem(moveMoreUsd(s.moreUsd, after.reserveUsd, OUT_FEE_ROOM) < MOVE_OFFER_MIN_USD ? floatProblems.reserveEmpty(chain)
          : r.stayed ? floatProblems.moveRefused(chain) : floatProblems.moveFailed(chain));
      }
    }
    catch (e) { await onProblem(problemOf(e, floatProblems.moveFailed(chain))); }
    finally { setBusy(false); }
  };
  const Wallet = walletName.replace(/^./, (x) => x.toUpperCase());
  const words = overWalletWords(walletName, haveUsd, wantText);
  return (
    <div className="tr-inline">
      {/* T2-5 (the copy review's walk): the refusal's head and body, each one string (k-trade crawl: "has $0.00 ."); the figure is what
          the wallet can spend, the sheet's own "to spend" (the fee reserve stays out of it; Copywriter batch 3) */}
      <p className="zf-body tp-refuse-head" data-testid="over-wallet-head">{words.head}</p>
      <p className="zf-small tp-has">{words.body}</p>
      {c.closed ? <p className="zf-small">{Wallet} opens once ZeroFee has tested it.</p>
        // the job made at the tap: said at once, with its time left (never "Moving…")
        : made ? <div data-testid="short-move-made"><p className="zf-small tp-has">{JOB_WORDS.created}</p><TimeLeft etaSec={LEG_SEC.nearOut} job={madeJob} /></div>
        : s.onWay ? <p className="zf-small">{s.onWay}</p>
        // TRADE-FLOAT §4: a move the person asks for goes at once, not after the planner's wait
        : canMove ? <>
            <button className="tp-move" disabled={busy} onClick={more}>{`Move $${moveUsd.toLocaleString("en-US")} more to ${walletName}`}</button>
            <p className="zf-small tp-has">It goes right away.</p>
          </>
        // nothing spare to move: the way on is the floor's quiet "Move money to your SOL wallet" (T2-5), never bold text here
        : null}
    </div>
  );
}

/** The core's floor for one move (subwallet.float.limits minUsd): under it a move would mostly go on fees. */
const MIN_MOVE_USD = 2;
/** The least move the sheet offers: the core's floor with room for its own price of the chain's coin to differ from Trade's
 *  (up to 5 %, the spot sources' spread), so what's offered is what the core takes. */
export const MOVE_OFFER_MIN_USD = MIN_MOVE_USD * 1.05;
