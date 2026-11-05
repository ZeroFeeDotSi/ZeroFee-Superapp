// Nearby's one look at where the phone is (phone test, 2 Nov, B22: "Asking your phone…" for ever). In the iPhone app
// the page's own navigator.geolocation never prompts and never answers inside its web view, so it asks the host
// (device.location.once: Core Location, the person's own permission, a fix about a city's size). In a browser, the
// browser's own ask. Either way an answer comes within LOCATION_WAIT_MS: a place, or "refused", never a spinner for ever.
//
// B27 (phone test, 2 Nov): the first tap shows iOS's own ask, and
// a person reads it. The old 10 s clock ran while it was on screen, so "Allow" after 10 s answered nothing and the person
// stayed on the first screen. Now `nearby` says the one line at 10 s (never a waiting screen), and keeps listening for
// the answer until GIVE_UP_MS: a fix that comes after the line still opens the place by itself.
import type { Bridge } from "@zerofee/core/bridge";

export const LOCATION_WAIT_MS = 10_000;
/** How long a late answer still opens the place: iOS's own ask on screen (the host gives it 60 s), then the fix (10 s). */
export const GIVE_UP_MS = 75_000;

export type Located = { lat: number; lon: number } | { refused: true };

export const onPhone = () => typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.zerofee;

/** `geo` and `phone` are for tests. */
export function locateOnce(bridge: Bridge, o: { phone?: boolean; geo?: Geolocation | undefined; waitMs?: number } = {}): Promise<Located> {
  const waitMs = o.waitMs ?? LOCATION_WAIT_MS;
  const refused: Located = { refused: true };
  const ask = new Promise<Located>((resolve) => {
    if (o.phone ?? onPhone()) {
      void bridge.call<{ lat: number; lon: number }>("device.location.once").then(
        (r) => resolve("ok" in r && Number.isFinite(r.ok.lat) && Number.isFinite(r.ok.lon) ? { lat: r.ok.lat, lon: r.ok.lon } : refused),
        () => resolve(refused),
      );
      return;
    }
    const geo = "geo" in o ? o.geo : globalThis.navigator?.geolocation;
    if (!geo) return resolve(refused);
    geo.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), () => resolve(refused), { enableHighAccuracy: false, maximumAge: 600_000, timeout: waitMs });
  });
  // whatever the phone or the browser does, the answer is in by then
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Located>((resolve) => (timer = setTimeout(() => resolve(refused), waitMs)));
  return Promise.race([ask, late]).finally(() => clearTimeout(timer));
}

/**
 * Nearby, as Chat's first screen uses it. `onLine` is called once, at `lineAfterMs` (10 s), if nothing has answered yet:
 * the screen then says its one line ("Your iPhone didn't share your location. Pick a city"), never a waiting screen.
 * The answer is still awaited until `giveUpMs`; a fix that comes after the line still resolves as a place. A refusal
 * before the line resolves at once.
 */
export function nearby(bridge: Bridge, onLine: () => void, o: { phone?: boolean; geo?: Geolocation | undefined; lineAfterMs?: number; giveUpMs?: number } = {}): Promise<Located> {
  let answered = false;
  const line = setTimeout(() => { if (!answered) onLine(); }, o.lineAfterMs ?? LOCATION_WAIT_MS);
  return locateOnce(bridge, { ...o, waitMs: o.giveUpMs ?? GIVE_UP_MS }).finally(() => {
    answered = true;
    clearTimeout(line);
  });
}

/**
 * A late answer never moves a person who went somewhere else meanwhile. `ask` takes a ticket; a newer ask replaces it.
 * `fits` says whether this answer may still open its place: it is the newest ask, and no place was opened since it was
 * asked. Kept while the page lives, so an answer that comes while Chat is off screen still lands.
 */
export class NearbyTicket {
  #opened = 0;
  #seq = 0;
  #current: { seq: number; opened: number } | null = null;
  /** A place was opened (by a city, a row, or Nearby itself). */
  opened(): void {
    this.#opened++;
  }
  ask(): number {
    this.#current = { seq: ++this.#seq, opened: this.#opened };
    return this.#seq;
  }
  /** This ask's answer came, a place or a refusal: may it open its place? */
  fits(ticket: number): boolean {
    const c = this.#current;
    if (!c || c.seq !== ticket) return false;
    this.#current = null;
    return c.opened === this.#opened;
  }
  /** Is this still the newest ask (its answer may still change the screen)? */
  current(ticket: number): boolean {
    return this.#current?.seq === ticket;
  }
  get asking(): boolean {
    return this.#current !== null;
  }
}
