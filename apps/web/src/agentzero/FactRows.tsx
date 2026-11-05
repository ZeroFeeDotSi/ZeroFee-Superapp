// H-2: a figure's own rows. Tapping a figure in AgentZero's answer opens the Activity moves it came from, in Activity's own
// words (title, detail, the move's figure, when, as Activity says it); a move with a record on its network opens it there, as Activity
// does. Read on this phone only (money-reader.ts kept them when it read); nothing here signs or moves.
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { useShell } from "@zerofee/shell-api/AppFrame.tsx";
import type { ChatFact } from "@zerofee/agent/chat/turn";
import { Check } from "@zerofee/design/icons.tsx";
import { ago, dollars, coins } from "@zerofee/wallet/app/format.ts";
import { keptRow } from "./money-reader.ts";

const NUM = /^\d+(\.\d+)?$/;

export function FactRows({ fact, onClose }: { fact: ChatFact; onClose: () => void }) {
  const { bridge } = useShell();
  const rows = fact.rows.map((id) => ({ id, row: keptRow(id) }));
  const n = fact.rows.length;
  const now = Date.now();
  return (
    <Sheet title={fact.shown} onClose={onClose}>
      <p className="zf-small wl-sheet-lead">{n === 1 ? "From this move in your Activity." : `From these ${n} moves in your Activity.`}</p>
      <div className="wl-rows">
        {rows.map(({ id, row }) => {
          if (!row) return <div className="wl-row" key={id}><span aria-hidden="true" /><div className="d">This move isn't on this phone now.</div><div className="r" /></div>;
          const figure = row.dollars && NUM.test(row.dollars) ? dollars(row.dollars) : NUM.test(row.amount) ? `${coins(row.amount)} ${row.coin}`.trim() : "";
          const inside = (
            <>
              <span className={`zf-tick ${row.done ? "on" : "off"}`} aria-hidden="true">{row.done ? <Check /> : null}</span>
              <div><div className="t">{row.title}</div><div className="d">{row.detail}</div></div>
              <div className="r"><div className="v">{figure}</div><div className="vd">{ago(row.atIso, now)}</div></div>
            </>
          );
          return row.url
            ? <button className="wl-row wl-pick" key={id} onClick={() => void bridge.call("device.openUrl", { url: row.url, mode: "sheet" })}>{inside}</button>
            : <div className="wl-row" key={id}>{inside}</div>;
        })}
      </div>
    </Sheet>
  );
}
