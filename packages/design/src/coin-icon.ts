// What a coin's logo slot shows (CoinIcon.tsx), so it's never empty: the monogram until the image has loaded, the image
// once it has, and the monogram again if it fails. A new url starts over; a url already loaded on this page shows at once.
export type LogoLoad = "loading" | "loaded" | "error";
export interface LogoState { url?: string; load: LogoLoad }
export type LogoEvent = { kind: "url"; url: string | undefined; known?: boolean } | { kind: "load" | "error"; url: string };

export const logoStart = (url: string | undefined, known = false): LogoState => ({ url, load: url && known ? "loaded" : "loading" });

export function logoStep(s: LogoState, e: LogoEvent): LogoState {
  if (e.kind === "url") return e.url === s.url ? s : logoStart(e.url, e.known);
  if (e.url !== s.url) return s;                                                   // an old image answering late
  return { url: s.url, load: e.kind === "load" ? "loaded" : "error" };
}

export const logoShows = (s: LogoState): "image" | "monogram" => (s.url && s.load === "loaded" ? "image" : "monogram");
/** The <img> stays in the slot, invisible, while it loads (so its onLoad can fire); it leaves once it has failed. */
export const logoMountsImg = (s: LogoState): boolean => !!s.url && s.load !== "error";

/**
 * Logos drawn on a near-black disc (NEAR's, Stellar's…): on the Black theme the disc meets the page and the logo seems to
 * vanish, so these carry a hairline ring of the page's own ink. Keys as logos.ts keys them (after its aliases).
 */
export const DARK_DISC: ReadonlySet<string> = new Set(["ada", "near", "plasma", "sol", "xlm", "xrp"]);
/** The ring a dark-disc logo wears: the ink at 28%, so it reads on White and on Black. */
export const DARK_RING = "0 0 0 1px color-mix(in srgb, var(--ink) 28%, transparent)";
