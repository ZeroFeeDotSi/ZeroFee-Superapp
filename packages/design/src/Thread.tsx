// The one thread's bar (Job 1, the spine): the account's five steps as five hairline segments with their names, and one
// line under them saying what is happening or what to do next. Tap it: the next step. Without `onOpen` it only shows
// where the person is (on a step's own screen). Monument: one quiet object, the brand mint on the step under way only.
import "./thread.css";

export interface ThreadBarStep {
  key: string;
  label: string;
  state: "done" | "now" | "todo";
}

export function ThreadBar({ steps, line, onOpen }: { steps: readonly ThreadBarStep[]; line: string; onOpen?: () => void }) {
  const now = steps.find((s) => s.state === "now");
  const inside = (
    <>
      <ol className="zf-thread__steps" aria-label="Your account's steps">
        {steps.map((s) => (
          <li key={s.key} className={`zf-thread__step zf-thread__step--${s.state}`} aria-current={s.state === "now" ? "step" : undefined}>
            <span className="zf-thread__seg" aria-hidden="true" />
            <span className="zf-thread__name">{s.label}</span>
            <span className="zf-visually-hidden">{s.state === "done" ? " (done)" : s.state === "now" ? " (now)" : ""}</span>
          </li>
        ))}
      </ol>
      <span className="zf-thread__line">
        <span>{line}</span>
        {onOpen && <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path className="zf-hl" d="m9 6 6 6-6 6" /></svg>}
      </span>
    </>
  );
  return onOpen
    ? <button type="button" className="zf-thread zf-press" onClick={onOpen} aria-label={`${line}.${now ? ` Now: ${now.label}.` : ""}`}>{inside}</button>
    : <div className="zf-thread" role="status">{inside}</div>;
}
