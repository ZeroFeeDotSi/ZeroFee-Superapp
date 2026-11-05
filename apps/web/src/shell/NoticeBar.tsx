// One notice at a time, at the bottom (product decision, 3 Nov: "should be at the bottom with an X. Don't do these popups on top, it
// blocks the app"). Every notice the shell shows over an app (a service that stopped, a payment freeze, AgentZero at
// work, a move that just went) is one line just above the app row, never over it, never over the app's own top bar and
// never over a sheet (a full-screen sheet hides it: it says its own line). The most important one shows; the rest wait
// their turn. A tap on the line opens what it has to say beyond it (its links, its buttons); × hides it until it changes
// (its key carries what it says and since when). A notice that is resolved leaves by itself.
import { useState } from "react";
import { loadHidden, pickNotice, rememberHidden, type NoticeItem } from "./notices.ts";
import "./notice-bar.css";

export { RANK, pickNotice, type NoticeItem } from "./notices.ts";

/** `here`: the app on screen (a notice meant for some apps shows only over them). */
export function NoticeBar({ items, here }: { items: readonly (NoticeItem | null | undefined | false)[]; here?: string }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => loadHidden());
  const [open, setOpen] = useState<string | null>(null);
  const n = pickNotice(items, hidden, here);
  if (!n) return null;
  const expanded = open === n.key && !!n.more;
  return (
    <div className={`zf-notice${n.alert ? " zf-notice--alert" : ""}${expanded ? " is-open" : ""}`} role={n.alert ? "alert" : "status"} data-notice={n.key}>
      <div className="zf-notice__row">
        {n.more
          ? <button className="zf-notice__line" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : n.key)}>{n.line}</button>
          : <span className="zf-notice__line">{n.line}</span>}
        {n.act && <button className="zf-notice__act" onClick={n.act.run}>{n.act.label}</button>}
        {!n.pinned && <button className="zf-notice__x" aria-label="Hide" onClick={() => { if (n.remember) rememberHidden(n.key); setHidden((h) => new Set(h).add(n.key)); }}>×</button>}
      </div>
      {expanded && <div className="zf-notice__more">{n.more}</div>}
    </div>
  );
}
