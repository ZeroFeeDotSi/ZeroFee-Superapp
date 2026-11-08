// ST-C: the leader's report card on the copy sheet, under "The wallet to copy": that wallet's last 30 days of pump.fun
// trades from Solana's own record (zero/leader-card.ts). Read-only; the copy itself stays the job sheet's. With sample
// money there is no real wallet: one line, nothing read.
import { READ_WORDS } from "./read-left.ts";
import { useEffect, useState } from "react";
import { isSolanaAddress } from "../zero/jobs.ts";
import { NO_ANSWER_LINE, SAMPLE_LINE, cardNotes, cardRows, cardTitle, type Card } from "../zero/leader-card.ts";

type Read = { card: Card; solUsd: number | undefined };
/** Cards read in this run, by wallet, kept 5 minutes, the one being read included: reopening the sheet (or a second
 *  render) joins it, never a second read of the nodes (review H1). A read that failed or was left is dropped. */
interface Entry { p: Promise<Read>; at: number; done: boolean; viewers: number }
const kept = new Map<string, Entry>();
const KEEP_MS = 300_000;
/** How long the address must stand still before it is read. */
export const SETTLE_MS = 700;

export function LeaderCard({ wallet, sample }: { wallet: string; sample: boolean }) {
  const w = wallet.trim();
  const valid = isSolanaAddress(w);
  const [read, setRead] = useState<Read | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (sample || !valid) return;
    let live = true;
    const watch = (e: Entry) => {
      e.viewers++;
      e.p.then(
        (r) => { if (live) setRead(r); },
        (err) => { if (live) setFault(String((err as Error)?.message) === NO_ANSWER_LINE ? NO_ANSWER_LINE : "This wallet couldn't be read. Try again in a moment."); },
      );
      return () => { live = false; e.viewers--; };
    };
    const k = kept.get(w);
    setFault(null);
    if (k && (!k.done || Date.now() - k.at < KEEP_MS)) { if (!k.done) setRead(null); return watch(k); }
    setRead(null);
    // a typed address is a valid shape at every letter from 32 to 44: read only once it has stood still a moment; a read
    // nobody is looking at any more stops at its next step (never a pile of reads on the nodes the trade path shares)
    let leave: (() => void) | undefined;
    const t = setTimeout(() => {
      const entry: Entry = { p: Promise.resolve() as never, at: Date.now(), done: false, viewers: 0 };
      // its reads load only when the card shows
      entry.p = import("../zero/leader-read.ts").then((m) => m.readLeader(w, () => entry.viewers === 0));
      kept.set(w, entry);
      entry.p.then(() => { entry.done = true; entry.at = Date.now(); }, () => { if (kept.get(w) === entry) kept.delete(w); });
      leave = watch(entry);
    }, SETTLE_MS);
    return () => { live = false; clearTimeout(t); leave?.(); };
  }, [w, valid, sample, n]);
  if (sample) return <p className="zf-small ag-under" data-testid="leader-card-sample">{SAMPLE_LINE}</p>;
  if (!valid) return null;
  return (
    <section className="ag-leader" data-testid="leader-card" aria-label={cardTitle(read?.card ?? null)}>
      <div className="zf-label">{cardTitle(read?.card ?? null)}</div>
      {fault ? (
        <>
          <p className="zf-small ag-under">{fault}</p>
          <button className="zf-link" onClick={() => setN((x) => x + 1)}>Try again</button>
        </>
      ) : !read ? (
        <p className="zf-small ag-under">{READ_WORDS.leader}</p>
      ) : (
        <>
          <div className="ag-rows ag-rows--tight">
            {cardRows(read.card, read.solUsd).map((r) => <div className="ag-row" key={r.label}><span className="t">{r.label}</span><span className="v">{r.value}</span></div>)}
          </div>
          {cardNotes(read.card, read.solUsd).map((l) => <p className="zf-small ag-under" key={l}>{l}</p>)}
        </>
      )}
    </section>
  );
}
