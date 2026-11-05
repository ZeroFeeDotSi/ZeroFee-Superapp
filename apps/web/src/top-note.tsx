// The web app's top note (product decision, 5 Nov): the first thing on every screen of the public web build, Sim and Real, above the
// app. It says what ZeroFee does, that the smart contract account is the iPhone app's (with its laptop approval), and
// how to run the beta now. Closed with "Got it" for this page load only: in memory, never kept, so
// every fresh load shows it again. Its style is app.css .zf-top-note (design tokens only). No side effects at load, so a
// build where full-app.tsx's TOP_NOTE is false drops this module whole (speed-budget.test.ts checks the phone build).
import { useState, type ReactNode } from "react";
import {
  TOP_NOTE_CLOSE_LABEL, TOP_NOTE_CLOSE_NAME, TOP_NOTE_LAPTOP_LABEL, TOP_NOTE_LINE_1, TOP_NOTE_LINE_2,
  TOP_NOTE_LINE_3, TOP_NOTE_SELFHOST_LABEL, TOP_NOTE_TITLE, laptopHref, selfHostHref,
} from "./top-note-words.ts";

/** The public web build, Sim and Real (copy review, 5 Nov late: the web app opens on the Sim, so the note is there too); never the
 *  extension, never the phone app (not the public build). */
export const topNoteOn = (publicBuild: boolean, extensionBuild: boolean): boolean => publicBuild && !extensionBuild;

const out = (href: string, label: string) => (
  <a className="zf-top-note__link" href={href} target="_blank" rel="noopener noreferrer">{label}</a>
);

/** The note itself. `codeUrl`: the build's VITE_CODE_URL (selfHostHref falls back while it is unset). */
export function TopNote({ onClose, codeUrl }: { onClose: () => void; codeUrl: string | undefined }) {
  return (
    <section className="zf-top-note" role="note" aria-label={TOP_NOTE_TITLE}>
      <div className="zf-top-note__head">
        <p className="zf-top-note__title">{TOP_NOTE_TITLE}</p>
        <button type="button" className="zf-btn zf-top-note__close" aria-label={TOP_NOTE_CLOSE_NAME} onClick={onClose}>{TOP_NOTE_CLOSE_LABEL}</button>
      </div>
      <p className="zf-small zf-top-note__line">{TOP_NOTE_LINE_1}</p>
      <p className="zf-small zf-top-note__line">{TOP_NOTE_LINE_2} {out(laptopHref((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SECOND_DEVICE_SITE), TOP_NOTE_LAPTOP_LABEL)}</p>
      <p className="zf-small zf-top-note__line">{TOP_NOTE_LINE_3} {out(selfHostHref(codeUrl), TOP_NOTE_SELFHOST_LABEL)}</p>
    </section>
  );
}

/** The page with the note above it, open or closed. The app keeps its place in the tree either way (index 1), so closing
 *  the note never mounts the app again. */
export function topNoteView(open: boolean, close: () => void, codeUrl: string | undefined, app: ReactNode) {
  return (
    <div className="zf-top-note-page">
      {open && <TopNote onClose={close} codeUrl={codeUrl} />}
      <div className="zf-top-note-rest">{app}</div>
    </div>
  );
}

/** Open on every mount: the closed state lives in this component only (no storage), so a fresh load shows it again. */
export function TopNotePage({ children, codeUrl }: { children: ReactNode; codeUrl: string | undefined }) {
  const [open, setOpen] = useState(true);
  return topNoteView(open, () => setOpen(false), codeUrl, children);
}
