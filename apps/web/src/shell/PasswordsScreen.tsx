// Settings → Passwords (D29): the ZeroFee Keychain's logins, from the phone's secure chip. The list shows the website,
// the username and when it was last used; never a password. Reveal and Copy ask Face ID natively and the password stays
// in Swift (a native sheet, or this phone's clipboard for 30 seconds). Add opens a native sheet with a secure field.
// Monument: hairlines, spaced capitals, air.
import { useCallback, useEffect, useState } from "react";
import type { Problem } from "@zerofee/core/problem";
import { ProblemView } from "./ProblemView.tsx";
import { Back } from "@zerofee/design/icons.tsx";
import { lastUsedWords, siteName, type Login, type LoginsClient } from "../host/logins.ts";
import "./passwords.css";

type View = { k: "loading" } | { k: "problem"; problem: Problem } | { k: "list"; logins: Login[] };

export function PasswordsScreen({ client, onClose }: { client: LoginsClient; onClose: () => void }) {
  const [view, setView] = useState<View>({ k: "loading" });
  const [open, setOpen] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [adding, setAdding] = useState(false);
  const [site, setSite] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await client.list();
    setView("problem" in r ? { k: "problem", problem: r.problem } : { k: "list", logins: r.ok });
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: "reveal" | "copy" | "remove", id: string) => {
    setNote(null);
    const r = await client[what](id);
    if ("problem" in r) return setNote(r.problem.whatHappened);
    if (what === "copy" && "copied" in r.ok && r.ok.copied) setNote("Copied for 30 seconds, on this phone only.");
    if (what === "remove") {
      setOpen(null);
      setConfirmRemove(false);
      await load();
    }
  };

  const add = async () => {
    const h = siteName(site);
    if (!h) return setNote("Type the website's name, like app.example.com.");
    setNote(null);
    const r = await client.add(h);
    if ("problem" in r) return setNote(r.problem.whatHappened);
    if (r.ok.id) {
      setAdding(false);
      setSite("");
      await load();
    }
  };

  return (
    <div className="pw" role="dialog" aria-modal="true" aria-label="Passwords">
      <header className="pw__bar pw__bar--sheet">
        <button className="zf-sheet__back" onClick={onClose} aria-label="Back"><Back /></button>
        <h1 className="pw__bar-title">Passwords</h1>
      </header>
      {view.k === "problem" ? (
        <ProblemView problem={view.problem} onNext={onClose} />
      ) : (
        <div className="pw__body">
          <h2 className="pw__title">Your logins</h2>
          <p className="zf-small pw__sub">Kept in this phone's secure chip. Never in iCloud. Face ID to see or copy one.</p>
          {view.k === "loading" && <p className="zf-small pw__empty">Reading…</p>}
          {view.k === "list" && view.logins.length === 0 && <p className="zf-small pw__empty">No logins yet. The Sign-up Robot saves the ones it makes here.</p>}
          {view.k === "list" && (
            <ul className="pw__list">
              {view.logins.map((l) => (
                <li key={l.id} className="pw__item">
                  <button className="pw__row" aria-expanded={open === l.id} onClick={() => { setOpen(open === l.id ? null : l.id); setConfirmRemove(false); setNote(null); }}>
                    <span className="pw__host">{l.host}</span>
                    <span className="pw__meta">{l.username || "No username"} · {lastUsedWords(l)}</span>
                  </button>
                  {open === l.id && (
                    <div className="pw__actions">
                      <button onClick={() => void act("reveal", l.id)}>Reveal</button>
                      <button onClick={() => void act("copy", l.id)}>Copy</button>
                      {confirmRemove ? (
                        <button className="pw__danger" onClick={() => void act("remove", l.id)}>Remove for good</button>
                      ) : (
                        <button onClick={() => setConfirmRemove(true)}>Remove</button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {adding ? (
            <div className="pw__add">
              <label className="zf-label" htmlFor="pw-site">Website</label>
              <input id="pw-site" className="pw__field" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="app.example.com" value={site} onChange={(e) => setSite(e.target.value)} />
              <button className="pw__primary" onClick={() => void add()}>Add username and password</button>
              <p className="zf-small">Next, type the username and password. The phone keeps them.</p>
            </div>
          ) : (
            view.k === "list" && <button className="pw__link" onClick={() => { setAdding(true); setNote(null); }}>Add a login</button>
          )}
          {note && <p className="zf-small pw__note" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}
