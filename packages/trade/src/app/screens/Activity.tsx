// Activity (V1 port slice 7): every trade and Spending's moves the person made as one stream of job cards, newest first
// (D52: the engine's own background moves are behind the scenes unless one failed, boards.ts shownMove)
// (job-cards.ts, JobCard.tsx). A trade that didn't happen says so and what moved; an Add the account's protection holds
// waits on its first step until the hold ends (D17), never done.
import { Mark } from "@zerofee/design/Mark.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { EarlierHistory } from "@zerofee/shell-api/EarlierHistory.tsx";
import { shownMove, siteMove } from "../boards.ts";
import { moveCard, tradeCard } from "../job-cards.ts";
import { useFloat, useLive, useTrade } from "../runtime.tsx";
import { JobCard } from "./JobCard.tsx";
import "../activity.css";

/** `tradesOnly`: drawn in the Activity centre under Home's history, which lists every move between the Safe and the
 *  wallets: Trade shows its trades there, never each move a second time (QA's Jobs hunt M6, 5 Nov: one move,
 *  two rows, one saying "Now in your NEAR wallet", the other "in your SOL wallet"). Trade's own tab keeps them. */
export function Activity({ tradesOnly = false }: { tradesOnly?: boolean } = {}) {
  const { svc } = useTrade();
  const { bridge } = useShell();
  const { snap } = useFloat();
  const rows = useLive(() => svc.activity(), []);
  if (!rows.value) return <div className="tr-center tr-tall"><Mark size={56} mode="loading" /></div>;
  const name = (c?: string) => snap.chains.find((x) => x.chain === c)?.name;
  // one move, one card (QA, 3 Nov): a Move's leg on to a chain, or back from one, folds into its move's card as a line
  const shown = snap.moves.filter((m) => shownMove(m) && !siteMove(m, snap.moves));
  const top = new Set(shown.filter((m) => !(m.of && shown.some((x) => x.id === m.of))).map((m) => m.id));
  // only a leg that went or is going folds; a failed or refunded one keeps its own "Didn't go" card (security review)
  const folds = (m: (typeof shown)[number]) => !!m.of && m.of !== m.id && top.has(m.of) && (m.status === "done" || m.status === "moving");
  const legs = (id: string) => shown.filter((m) => folds(m) && m.of === id);
  const moves = shown.filter((m) => !folds(m)).map((m) => {
    const c = moveCard(m, name(m.chain));
    const more = legs(m.id).map((l) => moveCard(l, name(l.chain)).title);
    return more.length ? { ...c, result: [c.result, ...more].filter(Boolean).join(" · ") } : c;
  });
  const cards = [...rows.value.map(tradeCard), ...(tradesOnly ? [] : moves)].sort((a, b) => b.at - a.at);
  if (cards.length === 0) return <><p className="zf-small tr-none">Nothing yet. Your trades will show here.</p><EarlierHistory bridge={bridge} /></>;
  return <div className="zf-enter tr-cards">{cards.map((c) => <JobCard key={c.id} card={c} />)}<EarlierHistory bridge={bridge} /></div>;
}
