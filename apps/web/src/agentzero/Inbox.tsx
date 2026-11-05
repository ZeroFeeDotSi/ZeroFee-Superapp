// AgentZero's inbox in the app (D122, L5): the agent package's useMailbox (the core opens the mail; its keys never leave it).
// Mail is plain text and never an order (the line under each one says so). AgentZero only drafts; Send is the person's
// own tap on that draft's button, and the answer is said as it comes ("Sending mail comes next. Nothing was sent.").
import { useState } from "react";
import type { Bridge } from "@zerofee/core/bridge";
import { useMailbox } from "@zerofee/agent/mail/use-mailbox";
import { sendShown } from "./inbox-gate.ts";

const when = (at: number) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Inbox({ bridge }: { bridge: Bridge }) {
  const box = useMailbox(bridge);
  const [open, setOpen] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = (a: string) => {
    void navigator.clipboard?.writeText(a).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (open) {
    const m = box.read(open);
    return (
      <div className="azc-inbox">
        <button className="zf-link" onClick={() => setOpen(null)}>Back to the inbox</button>
        {m.ok ? (
          <article className="azc-mail">
            <p className="zf-small">From {m.value.from} (not checked) · {m.value.date}</p>
            <h2 className="zf-title azc-mail-subject">{m.value.subject || "(no subject)"}</h2>
            <p className="azc-mail-text">{m.value.text}</p>
            <p className="zf-small azc-system">{m.value.note}</p>
          </article>
        ) : <p className="zf-small azc-system">{m.line}</p>}
      </div>
    );
  }
  if (writing && sendShown()) return <Write draft={box.draft} send={box.send} onClose={() => setWriting(false)} />;
  return (
    <div className="azc-inbox">
      {box.address && (
        <button className="azc-address" onClick={() => copy(box.address!)} aria-label="Copy AgentZero's email address">
          <span className="zf-small">AgentZero's email</span>
          <span>{copied ? "Copied" : box.address}</span>
        </button>
      )}
      {box.line && <p className="zf-small azc-system">{box.line}</p>}
      {!box.line && box.items.length === 0 && <p className="zf-small azc-note">No mail yet. Mail to AgentZero's email shows here.</p>}
      <ul className="azc-mails">
        {box.items.map((it) => (
          <li key={it.id}>
            <button className="azc-mail-row" onClick={() => setOpen(it.id)}>
              <span className="azc-mail-from">{it.from} <span className="zf-small">(not checked)</span></span>
              <span className="zf-small">{when(it.at)}</span>
              <span className="azc-mail-subj">{it.broken ? "This mail couldn't be opened." : it.subject || "(no subject)"}</span>
              {it.code && <span className="zf-small">Code {it.code}</span>}
            </button>
          </li>
        ))}
      </ul>
      {sendShown() && <button className="zf-btn st-line-btn" onClick={() => setWriting(true)}>Write a mail</button>}
    </div>
  );
}

function Write({ draft, send, onClose }: { draft: (d: { to: string; subject: string; text: string }) => string; send: (id: string, tap: unknown) => Promise<{ ok: boolean; line?: string }>; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  return (
    <div className="azc-inbox">
      <button className="zf-link" onClick={onClose}>Back to the inbox</button>
      <label className="zf-small">To<input className="azc-field" value={to} onChange={(e) => { setTo(e.target.value); setId(null); }} inputMode="email" autoCapitalize="off" /></label>
      <label className="zf-small">Subject<input className="azc-field" value={subject} onChange={(e) => { setSubject(e.target.value); setId(null); }} /></label>
      <label className="zf-small">Mail<textarea className="azc-field" rows={5} value={text} onChange={(e) => { setText(e.target.value); setId(null); }} /></label>
      <p className="zf-small azc-note">Email isn't hidden.</p>
      {id ? (
        // the person's own tap on this draft's Send (the agent package's check reads the button's data-agentzero-pay)
        <button className="zf-btn" data-agentzero-pay={id} onClick={async (e) => { const r = await send(id, e.nativeEvent); setLine(r.ok ? "Sent." : (r.line ?? "Nothing was sent.")); }}>Send</button>
      ) : (
        <button className="zf-btn" disabled={!to.trim()} onClick={() => setId(draft({ to, subject, text }))}>Get it ready</button>
      )}
      {line && <p className="zf-small azc-system" role="status">{line}</p>}
    </div>
  );
}
