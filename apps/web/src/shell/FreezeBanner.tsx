// Above every app while payments are frozen (freeze.ts), so Home says it plainly: why, who can stop it, the countdown,
// until when, and what to do.
import type { FreezeNotice } from "./freeze.ts";
import { useCountdown } from "../screens/countdown.ts";

/** `onSee` (the web demo only): look at the waiting move from the other devices. */
/** `bare`: inside the shell's one notice (NoticeBar.tsx), whose line already says notice.text. */
export function FreezeBanner({ notice, onCancel, onNewWords, onSee, bare = false }: { notice: FreezeNotice; onCancel: () => void; onNewWords?: () => void; onSee?: () => void; bare?: boolean }) {
  return (
    <div className={bare ? "ah-notice__bare" : "ah-notice__in"} role="status">
      {!bare && <p className="ah-notice__text">{notice.text}</p>}
      {notice.count && <Count {...notice.count} />}
      {notice.who && <p className="zf-small">{notice.who}</p>}
      <p className="zf-small">{notice.also}</p>
      {(notice.recovering || onNewWords || onSee) && (
        <div className="ah-notice__acts">
          {notice.recovering && notice.canStop !== false && <button className="ah-notice__act alert" onClick={onCancel}>Stop it</button>}
          {onNewWords && <button className="ah-notice__act" onClick={onNewWords}>Get new words</button>}
          {onSee && <button className="ah-notice__act" onClick={onSee}>See the new device</button>}
        </div>
      )}
    </div>
  );
}

function Count({ untilIso, before, after, atZero }: { untilIso: string; before: string; after: string; atZero?: string }) {
  const { left, text } = useCountdown(untilIso);
  // at nothing left: its own words, never "It finishes in 0s" (grade 1 Nov, item 7)
  if (left === 0 && atZero) return <p className="zf-small ah-notice__count">{atZero}</p>;
  return <p className="zf-small ah-notice__count">{before}<b>{text}</b>{after}</p>;
}
