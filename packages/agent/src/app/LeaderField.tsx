// The copy sheet's "The wallet to copy": one field, the shape of Send's To (SendForm, send.css wl-send2__to). The field's
// value is always the whole address; while it isn't being edited a span over it shows the six-and-six form, and a tap on
// that puts the focus back in the field. Only a real address is cut: a bad one stays whole, so you can see what's wrong.
import { useRef, useState } from "react";
import { shortId } from "@zerofee/wallet/app/money/send-words.ts";
import { isSolanaAddress } from "../zero/jobs.ts";

export const leaderShort = (value: string, editing: boolean): string | null => (!editing && isSolanaAddress(value) ? shortId(value.trim()) : null);

export function LeaderField({ value, onChange }: { value: string; onChange: (address: string) => void }) {
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const short = leaderShort(value, editing);
  return (
    <label className="ag-to-box">
      <span className="zf-small">The wallet to copy</span>
      <span className="ag-to">
        <input ref={field} value={value} placeholder="Paste a Solana address" className={short ? "is-under" : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={(e) => onChange(e.target.value.trim())} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} />
        {short && <span className="ag-to__short" aria-hidden="true" onClick={() => field.current?.focus()}>{short}</span>}
      </span>
    </label>
  );
}
