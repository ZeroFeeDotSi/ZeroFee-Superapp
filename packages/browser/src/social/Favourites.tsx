// D131, favourites on the Browser's start page: a tile per saved site (its exact host), opened the way the address bar
// opens it (goAddress), with Edit to remove one. Saved from History's star. Kept on this phone only (bookmarks.ts).
import { useState } from "react";
import { PRESET_LOGO } from "../app/chains.tsx";
import { presetForHost } from "../presets.ts";
import { FAVOURITES, type Bookmark } from "../bookmarks.ts";

export const initialOf = (host: string) => host.replace(/^(www|app)\./, "").charAt(0).toUpperCase();

/** A favourite's name under its tile: the site's own name in its host ("duckduckgo.com" → "duckduckgo"), so a tile's
 *  name is never cut to "duckduck…" (UI audit 5 Nov); its full host is still its spoken name. */
export const tileName = (host: string) => {
  const parts = host.replace(/^(www|app|m)\./, "").split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : parts[0]!;
};

/** A site's mark: its letter first, its logo over it once loaded (a logo that hasn't loaded, or can't, is never an empty
 *  box: the letter shows; UI audit 5 Nov). The container (its class) gives the size, radius and fill. */
export function Mark({ logo, letter, size }: { logo?: string | undefined; letter: string; size: number }) {
  return (
    <>
      {letter}
      {logo && <img className="sh-mark-img" src={logo} alt="" width={size} height={size} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
    </>
  );
}

export function Favourites({ list, onOpen, onRemove }: { list: Bookmark[]; onOpen: (url: string) => void; onRemove: (url: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!list.length) return null;
  return (
    <section className="sh-favs" aria-label={FAVOURITES.head}>
      <div className="sh-favs-head">
        <span className="zf-label">{FAVOURITES.head}</span>
        <button className="zf-link" onClick={() => setEditing((e) => !e)}>{editing ? FAVOURITES.done : FAVOURITES.edit}</button>
      </div>
      <ul className="sh-favs-grid">
        {list.map((b) => {
          const logo = PRESET_LOGO[presetForHost(b.host)?.id ?? ""];
          return (
            <li key={b.url}>
              <button className="sh-fav" onClick={() => (editing ? onRemove(b.url) : onOpen(b.url))} aria-label={editing ? FAVOURITES.remove(b.host) : b.host} data-testid="browser-fav">
                <span className="sh-fav-logo"><Mark logo={logo} letter={initialOf(b.host)} size={56} /></span>
                <span className="sh-fav-name">{tileName(b.host)}</span>
                {editing && <span className="sh-fav-x" aria-hidden="true">×</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** History's star: saved or not, and its spoken name. */
export function Star({ saved, host, onToggle }: { saved: boolean; host: string; onToggle: () => void }) {
  return (
    <button className={`sh-star${saved ? " on" : ""}`} aria-pressed={saved} aria-label={saved ? FAVOURITES.unsave(host) : FAVOURITES.save(host)} onClick={onToggle} data-testid="browser-star">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    </button>
  );
}
