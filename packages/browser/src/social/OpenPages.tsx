// D131, the start page's open-pages strip (the phone's tabs): a chip per page, tap to show it, × to close it.
import { OPEN_PAGES, type OpenPage } from "../tabs.ts";

export function OpenPages({ pages, onShow, onClose }: { pages: OpenPage[]; onShow: (id: string) => void; onClose: (id: string) => void }) {
  if (!pages.length) return null;
  return (
    <section className="sh-open" aria-label={OPEN_PAGES.head}>
      <div className="zf-label sh-open-head">{OPEN_PAGES.head}</div>
      <ul className="sh-open-strip">
        {pages.map((p) => (
          <li key={p.id} className="sh-open-page">
            <button className="sh-open-show" onClick={() => onShow(p.id)} aria-label={OPEN_PAGES.show(p.title)} data-testid="open-page">
              <span className="sh-open-mark" aria-hidden="true">{p.private ? "◐" : "●"}</span>
              <span className="sh-open-name">{p.title}</span>
            </button>
            <button className="sh-open-x" onClick={() => onClose(p.id)} aria-label={OPEN_PAGES.close(p.title)} data-testid="open-page-close">×</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
