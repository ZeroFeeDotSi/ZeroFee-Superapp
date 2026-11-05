// Copy on the web (QA, 4 Nov: Add's Copy did nothing on a page without focus). The clipboard takes a write only
// inside the person's tap, so copyText is called in the click handler itself, never after an await: it asks
// navigator.clipboard.writeText at once; when that is refused (no focus, an older browser, no permission) it selects
// the text in a hidden field and asks execCommand("copy"). It answers true only when the text was copied, so "Copied"
// is said only then.

type Doc = Pick<Document, "createElement" | "execCommand"> & { body: Pick<HTMLElement, "appendChild"> | null; activeElement?: Element | null };
type Clip = { writeText?: (text: string) => Promise<void> } | undefined;

/** The fallback: a hidden, read-only field holding the text, selected, then execCommand("copy"). */
export function copyBySelection(text: string, doc: Doc | undefined = (globalThis as { document?: Doc }).document): boolean {
  if (!doc?.body) return false;
  const was = doc.activeElement as (Element & { focus?: () => void }) | null | undefined;
  const el = doc.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.setAttribute("aria-hidden", "true");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.opacity = "0";
  doc.body.appendChild(el);
  let ok = false;
  try {
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    ok = doc.execCommand("copy");
  } catch {
    ok = false;
  }
  el.remove();
  try { was?.focus?.(); } catch { /* nothing to give focus back to */ }
  return ok;
}

/** Copies `text`; call it in the tap itself. True: it is on the clipboard. */
export function copyText(text: string, clip: Clip = (globalThis as { navigator?: { clipboard?: Clip } }).navigator?.clipboard, doc?: Doc): Promise<boolean> {
  if (typeof clip?.writeText !== "function") return Promise.resolve(copyBySelection(text, doc));
  let asked: unknown;
  try {
    asked = clip.writeText(text);
  } catch {
    return Promise.resolve(copyBySelection(text, doc));
  }
  // a web view's writeText that answers nothing (no promise) and didn't throw: it took the text
  if (!asked || typeof (asked as Promise<void>).then !== "function") return Promise.resolve(true);
  return (asked as Promise<void>).then(() => true, () => copyBySelection(text, doc));
}
