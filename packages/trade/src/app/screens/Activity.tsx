// Activity (V1 port slice 7): every trade and Spending's moves the person made as one stream of job cards, newest first
// (D52: the engine's own background moves are behind the scenes unless one failed, boards.ts shownMove)
// (job-cards.ts, JobCard.tsx). A trade that didn't happen says so and what moved; an Add the account's protection holds
// waits on its first step until the hold ends (D17), never done.
import { useEffect, useSyncExternalStore } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import { EarlierHistory } from "@zerofee/shell-api/EarlierHistory.tsx";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { shownMove, siteMove } from "../boards.ts";
import { moveCard, tradeCard } from "../job-cards.ts";
import { useFloat, useLive, useTrade } from "../runtime.tsx";
import { goingIds } from "../trade-tasks.ts";
import { JobCard } from "./JobCard.tsx";
import "../activity.css";

/** `tradesOnly`: drawn in the Activity centre under Home's history, which lists every move between the Safe and the
 *  wallets: Trade shows its trades there, never each move a second time (QA's Jobs hunt M6, 5 Nov: one move,
 *  two rows, one saying "Now in your NEAR wallet", the other "in your SOL wallet"). Trade's own tab keeps them. */
export function Activity({ tradesOnly = false }: { tradesOnly?: boolean } = {}) {
  const { svc, active } = useTrade();
  const { bridge } = useShell();
  const { snap } = useFloat();
  const rows = useLive(() => svc.activity(), []);
  // T11 (the audit's Trade audit, 8 Nov): in the centre, a trade whose Jobs row is still going is that row in Now, never a
  // second card here ("Buy not confirmed" under Trade beside "Buy $5 of DOPE · Not confirmed yet"); it comes here as it ends
  const store = taskStore();
  const goingKey = useSyncExternalStore(store.subscribe, () => goingIds(store.list()), () => "");
  // a "not confirmed yet" card on screen (Trade's tab, or the Activity centre over any app): the service looks at it
  // again every RECHECK_MS (QA and the audit's MUST); none left, or this goes: it stops
  const open = !!rows.value?.some((r) => r.status === "unconfirmed") && (tradesOnly || active);
  useEffect(() => (open ? svc.watch() : undefined), [open, svc]);
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
  const going = new Set(goingKey.split("\n"));
  const listed = tradesOnly ? rows.value.filter((r) => !(r.task && going.has(r.task))) : rows.value;
  const cards = [...listed.map((r) => tradeCard(r)), ...(tradesOnly ? [] : moves)].sort((a, b) => b.at - a.at);
  // every trade still going is in Now above: never "Nothing yet" under it
  if (cards.length === 0) return <>{listed.length < rows.value.length ? null : <p className="zf-small tr-none">Nothing yet. Your trades will show here.</p>}<EarlierHistory bridge={bridge} /></>;
  return <div className="zf-enter tr-cards">{cards.map((c) => <JobCard key={c.id} card={c} />)}<EarlierHistory bridge={bridge} /></div>;
}
