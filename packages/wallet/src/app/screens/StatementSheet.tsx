// H-3, the statement sheet (opened from Activity's last row, loaded on its first tap): a month, its moves in one line,
// dollars first, and one button that hands the file to the person: the iPhone's share sheet (device.shareFile), or a
// download in a browser. Built on this phone from Activity's own reads; nothing is sent by ZeroFee.
import { useEffect, useMemo, useState } from "react";
import type { SpendingActivity } from "@zerofee/core/spending";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import type { Movement } from "../../types.ts";
import { useWallet } from "../runtime.tsx";
import { ownRows } from "../format.ts";
import { browserDownload, fileName, mayBeShort, monthName, nextRead, saveStatement, statementRows, summaryLine, toCsv } from "../statement.ts";

/** How far back the month can go (two years), and how many moves it reads (Activity reads 50). */
const MONTHS_BACK = 24;
const READ_LIMIT = 1000;

export const STATEMENT_WORDS = {
  title: "Statement",
  what: "Every move in a month, as a file for your records or taxes.",
  private: "It has full addresses and your private moves. Only you choose where it goes.",
  save: (phone: boolean) => (phone ? "Save statement" : "Download statement"),
  saved: { shared: "Your statement is saved.", closed: "", downloaded: "Your statement is in your downloads." },
  reading: "Reading your moves…",
  failed: "Your moves didn't load. Close this, then try again.",
  short: "This month may be missing older moves. Newer months are whole.",
} as const;

export function StatementSheet({ onClose }: { onClose: () => void }) {
  const { bridge, tokens, chains, spending, wallets } = useWallet();
  const now = new Date();
  const [back, setBack] = useState(0);
  const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const year = at.getFullYear(), month = at.getMonth();
  const [moves, setMoves] = useState<{ ledger: Movement[]; spending: SpendingActivity[] } | "failed" | null>(null);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(READ_LIMIT);
  useEffect(() => {
    let live = true;
    void Promise.all([
      bridge.call<Movement[]>("ledger.activity", { limit }),
      spending ? bridge.call<SpendingActivity[]>("spending.activity") : Promise.resolve({ ok: [] as SpendingActivity[] }),
    ]).then(([l, s]) => {
      if (!live) return;
      // a part that didn't read is said, never a statement short by it
      if (!("ok" in l) || !("ok" in s)) return setMoves("failed");
      setMoves({ ledger: l.ok, spending: s.ok });
    }, () => live && setMoves("failed"));
    return () => { live = false; };
  }, [bridge, spending, limit]);
  // the month older than what came back: read more, never a note while more can be read
  const short = !!moves && moves !== "failed" && mayBeShort(moves.ledger, limit, year, month);
  useEffect(() => { const more = nextRead(short, limit); if (more !== null) setLimit(more); }, [short, limit]);
  const rows = useMemo(() => (moves && moves !== "failed" ? statementRows(moves.ledger, moves.spending, tokens, chains, year, month, ownRows(wallets)) : null), [moves, tokens, chains, year, month, wallets]);
  const phone = onPhone();
  const save = async () => {
    if (!rows || busy) return;
    setBusy(true);
    setLine("");
    const r = await saveStatement(bridge, fileName(year, month), toCsv(rows), phone, browserDownload);
    setBusy(false);
    setLine("line" in r ? r.line : STATEMENT_WORDS.saved[r.saved]);
  };
  return (
    <Sheet title={STATEMENT_WORDS.title} onClose={onClose}>
      <p className="zf-small wl-st-what">{STATEMENT_WORDS.what}</p>
      <div className="wl-st-month" role="group" aria-label="Month">
        <button className="zf-icon-btn" aria-label="Month before" disabled={back >= MONTHS_BACK} onClick={() => { setBack(back + 1); setLine(""); }}>‹</button>
        <span className="wl-st-name" aria-live="polite">{monthName(year, month)}</span>
        <button className="zf-icon-btn" aria-label="Month after" disabled={back === 0} onClick={() => { setBack(back - 1); setLine(""); }}>›</button>
      </div>
      <p className="zf-body wl-st-sum" data-testid="statement-summary">{moves === "failed" ? STATEMENT_WORDS.failed : rows ? summaryLine(rows, year, month) : STATEMENT_WORDS.reading}</p>
      {short && nextRead(short, limit) === null && <p className="zf-small wl-st-note" role="status">{STATEMENT_WORDS.short}</p>}
      <p className="zf-small wl-st-note">{STATEMENT_WORDS.private}</p>
      <button className="zf-btn" disabled={!rows || !rows.length || busy} onClick={() => void save()}>{STATEMENT_WORDS.save(phone)}</button>
      {line && <p className="zf-small wl-st-line" role="status">{line}</p>}
    </Sheet>
  );
}
