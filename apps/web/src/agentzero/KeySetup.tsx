// AgentZero's AI key, for humans (product decision, 3 Nov: "on top there should be API keys; you just copy-paste any model key and
// we auto-read the provider and run it"). The card the chat shows when there's no key and no free reading, and the Keys
// chip on top with its sheet (the provider, the key's last 4, Replace, Remove). The checks and the store are
// @zerofee/agent/chat/ai-key's; this file never sees more of a saved key than its last 4. The clipboard is read only in
// onPaste, which only the Paste button's tap calls (D33): never on open, never on focus.
import { useState } from "react";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";
import type { KeysSource, ModelSource } from "./AgentZeroChat.tsx";
import { CLAUDE_MODELS, EFFORTS, EFFORT_WORDS, MODEL_WORDS, DEFAULT_EFFORT, messageUpperUsd, upToLine } from "@zerofee/agent/chat/model";
import { OR_FUND } from "./wallet-words.ts";

/** On the iPhone app "this iPhone"; in a browser "this device" (D87: the web says its own words). */
const PRIVATE = `Your key stays on ${onPhone() ? "this iPhone" : "this device"} and goes only to the AI company. ZeroFee never sees it.`;

/** The field, Paste, and the check: one key in, "Claude is ready" or one plain line out. */
export function KeyForm({ keys, onSaved }: { keys: KeysSource; onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (raw: string) => {
    if (!raw.trim() || busy) return;
    setBusy(true);
    setLine(null);
    const r = await keys.use(raw).catch(() => ({ ok: false as const, line: "Couldn't reach Claude. Check your connection." }));
    setBusy(false);
    // the field empties either way: a key that wasn't kept (an OpenAI key, a refused one) isn't held on screen either
    setText("");
    if (r.ok) onSaved?.();
    else setLine(r.line);
  };
  // the Paste button's tap, and only that, reads what was copied; then it checks at once (one tap)
  const onPaste = async () => {
    const got = await keys.paste();
    if (!got) return setLine("Nothing to paste. Copy your key, then tap Paste.");
    setText(got);
    await check(got);
  };
  return (
    <div className="azc-keyform">
      <div className="azc-keyrow">
        <input className="azc-field azc-keyfield" type="password" value={text} placeholder="sk-ant-…" aria-label="Your AI key" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => { setText(e.target.value); setLine(null); }} onKeyDown={(e) => { if (e.key === "Enter") void check(text); }} />
        <button type="button" className="zf-btn azc-paste" disabled={busy} onClick={() => void onPaste()}>Paste</button>
      </div>
      {text.trim() !== "" && <button type="button" className="zf-btn" disabled={busy} onClick={() => void check(text)}>{busy ? "Checking with Claude…" : "Use this key"}</button>}
      {busy && text.trim() === "" && <p className="zf-small azc-thinking" role="status">Checking with Claude…</p>}
      {line && <p className="zf-small azc-keyline" role="alert">{line}</p>}
      <p className="zf-small azc-keyprivate">{PRIVATE}</p>
      <button type="button" className="azc-link" onClick={keys.getKey}>Get a Claude key at console.anthropic.com</button>
    </div>
  );
}

/** First run, and whenever a turn finds no key and no free reading: in the chat itself, never an error line. */
export function KeyCard({ keys }: { keys: KeysSource }) {
  return (
    <div className="azc-keycard">
      <p className="zf-title azc-keytitle">Paste an AI key to start</p>
      {keys.line && <p className="zf-small azc-keyline">{keys.line}</p>}
      <KeyForm keys={keys} />
    </div>
  );
}

/** Which Claude, and how hard it thinks (product decision, 3 Nov): two rows, each a plain line and a rough cost a message, then the
 *  meter. A tap keeps it on this device; the next message uses it. */
export function ModelPick({ model }: { model: ModelSource }) {
  const c = model.choice;
  if (!c) return null;
  return (
    <div className="azc-model">
      <p className="zf-small azc-sect" id="azc-model-h">Model</p>
      <div role="radiogroup" aria-labelledby="azc-model-h">
        {CLAUDE_MODELS.map((m) => {
          const on = c.model === m;
          return (
            <button key={m} type="button" role="radio" aria-checked={on} className="azc-pick" onClick={() => !on && model.set({ model: m, effort: DEFAULT_EFFORT[m] })}>
              <span className="azc-pick-name">{MODEL_WORDS[m].name}</span>
              <span className="azc-pick-mark" aria-hidden="true">{on ? "✓" : ""}</span>
              <span className="zf-small azc-pick-line">{`${MODEL_WORDS[m].line} ${upToLine(messageUpperUsd(m))}`}</span>
            </button>
          );
        })}
      </div>
      <p className="zf-small azc-sect" id="azc-effort-h">Effort</p>
      <div role="radiogroup" aria-labelledby="azc-effort-h" className="azc-meter">
        {EFFORTS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={c.effort === e} className="azc-meter-step" onClick={() => c.effort !== e && model.set({ model: c.model, effort: e })}>{EFFORT_WORDS[e].name}</button>
        ))}
      </div>
      <p className="zf-small azc-meterline">{EFFORT_WORDS[c.effort].line}</p>
    </div>
  );
}

/** The Keys chip on top: the Claude it runs ("Opus ✓", "Sonnet ✓"), or "Add key" (short, so a clear gap stays between it and
 *  the mark, left of the shell's Activity icon; its label says "Add an AI key"); its sheet holds the rest. */
export function KeysChip({ keys, onFund }: { keys: KeysSource; onFund?: () => void }) {
  const [open, setOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const close = () => {
    setOpen(false);
    setReplacing(false);
  };
  const s = keys.saved;
  if (s === undefined) return <div className="azc-keys" />;
  const chosen = keys.model?.choice;
  const label = chosen ? MODEL_WORDS[chosen.model].chip : s?.provider;
  // the sheet beside the chip, never inside it: the chip's box sits top right (look.css), and a sheet inside it opened
  // as a small box in that corner (L9 walk, 3 Nov)
  return (
    <>
    <div className="azc-keys">
      <button type="button" className="azc-chip" onClick={() => setOpen(true)} aria-label={s ? `${chosen ? MODEL_WORDS[chosen.model].name : s.provider}, your key added. Open your keys` : "Add an AI key"}>{s ? `${label} ✓` : "Add key"}</button>
    </div>
      {open && (
        <Sheet title="Claude" onClose={close}>
          {s && !replacing ? (
            <>
              <div className="azc-keyrows">
                <p className="azc-keyrowline">{s.provider}</p>
                <p className="azc-keyrowline zf-small">{`Key ending ${s.tail}`}</p>
              </div>
              <p className="zf-small azc-keyprivate">{PRIVATE}</p>
              <div className="azc-keyacts">
                <button type="button" className="zf-btn" onClick={() => setReplacing(true)}>Replace</button>
                <button type="button" className="zf-btn azc-btn-quiet" onClick={() => void keys.remove().then((ok) => ok && close())}>Remove</button>
              </div>
              {/* AgentZero's own wallet (L9, only when it is on): the other way to think */}
              {onFund && <button type="button" className="azc-link" onClick={() => (close(), onFund())}>{OR_FUND}</button>}
            </>
          ) : (
            <KeyForm keys={keys} onSaved={close} />
          )}
          {keys.model && <ModelPick model={keys.model} />}
        </Sheet>
      )}
    </>
  );
}
