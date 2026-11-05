// A person to pay: an initial in a circle and their name under it. Picked = ink; everyone else hairline.
import "./person.css";

export function Person({ name, picked, onPick }: { name: string; picked?: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`zf-person${picked ? " on" : ""}`} onClick={onPick} aria-pressed={picked}>
      <span className="zf-person__face" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "?"}</span>
      <span className="zf-person__name">{name}</span>
    </button>
  );
}

/** The last circle in a row of people: add someone new. */
export function AddPerson({ onAdd, label = "New" }: { onAdd: () => void; label?: string }) {
  return (
    <button type="button" className="zf-person zf-person--add" onClick={onAdd}>
      <span className="zf-person__face" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24"><path className="zf-hl" d="M12 5v14M5 12h14" /></svg>
      </span>
      <span className="zf-person__name">{label}</span>
    </button>
  );
}
