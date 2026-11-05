// Logos. A coin's logo is the image url GeckoTerminal gives for it (https, no key); when there is none the shell draws the coin's monogram.
// The three native coins are bundled here as small inline SVGs, so SOL, BNB and ETH never cost a request and always have a logo.
import type { ChainId } from "../types.ts";
import { WSOL, isEvm, logoOf, normAddr } from "./map.ts";

export const SOL_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="#14151a"/><g fill="url(#g)"><path d="M18 40.5h27.5a1.2 1.2 0 0 1 .85 2.05l-3.9 3.9a2.4 2.4 0 0 1-1.7.7H13.3a1.2 1.2 0 0 1-.85-2.05l3.9-3.9a2.4 2.4 0 0 1 1.65-.7z"/><path d="M18 17.4h27.5a1.2 1.2 0 0 1 .85 2.05l-3.9 3.9a2.4 2.4 0 0 1-1.7.7H13.3a1.2 1.2 0 0 1-.85-2.05l3.9-3.9a2.4 2.4 0 0 1 1.65-.7z"/><path d="M42.4 28.9H14.9a1.2 1.2 0 0 0-.85 2.05l3.9 3.9a2.4 2.4 0 0 0 1.7.7h28.5a1.2 1.2 0 0 0 .85-2.05l-3.9-3.9a2.4 2.4 0 0 0-1.7-.7z"/></g></svg>';
export const BNB_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#f0b90b"/><g fill="#14151a"><polygon points="32,12 38,18 32,24 26,18"/><polygon points="19,25 25,31 19,37 13,31"/><polygon points="45,25 51,31 45,37 39,31"/><polygon points="32,25 38,31 32,37 26,31"/><polygon points="32,38 38,44 32,50 26,44"/></g></svg>';
export const ETH_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#627eea"/><g fill="#fff"><path fill-opacity=".6" d="M32 10v15.6l13.2 5.9z"/><path d="M32 10L18.8 31.5 32 25.6z"/><path fill-opacity=".6" d="M32 44.5V54l13.2-18.2z"/><path d="M32 54v-9.5l-13.2-8.7z"/><path fill-opacity=".2" d="M32 42l13.2-10.5L32 25.6z"/><path fill-opacity=".6" d="M18.8 31.5L32 42V25.6z"/></g></svg>';

export const NEAR_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#00ec97"/><path fill="#14151a" d="M40.6 17.5l-6.7 9.9c-.5.7.4 1.5 1.1.9l6.6-5.7c.2-.2.5 0 .5.2v17.9c0 .3-.4.4-.6.2L21.5 18.2c-.6-.8-1.6-1.2-2.6-1.2h-.7c-1.8 0-3.2 1.4-3.2 3.2v23.6c0 1.8 1.4 3.2 3.2 3.2 1.1 0 2.2-.6 2.8-1.6l6.7-9.9c.5-.7-.4-1.5-1.1-.9l-6.6 5.7c-.2.2-.5 0-.5-.2V22.2c0-.3.4-.4.6-.2L40.1 45.8c.6.8 1.6 1.2 2.6 1.2h.7c1.8 0 3.2-1.4 3.2-3.2V20.2c0-1.8-1.4-3.2-3.2-3.2-1.1 0-2.2.6-2.8 1.6z"/></svg>';

export const NATIVE_LOGO_SVG: Record<ChainId, string> = { sol: SOL_LOGO_SVG, bsc: BNB_LOGO_SVG, hood: ETH_LOGO_SVG, near: NEAR_LOGO_SVG };
export const NATIVE_SYMBOL: Record<ChainId, string> = { sol: "SOL", bsc: "BNB", hood: "ETH", near: "NEAR" };
const dataUri = (svg: string): string => "data:image/svg+xml;utf8," + encodeURIComponent(svg);
/** The native coin's logo as a data url an <img> can show. */
export const nativeLogoUri = (chain: ChainId): string => dataUri(NATIVE_LOGO_SVG[chain]);

/** The wrapped native coins (WSOL, WBNB, WETH) and the native address itself use the bundled logo. */
const WRAPPED: Record<ChainId, string[]> = {
  sol: [WSOL],
  bsc: ["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"],
  hood: ["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "0x0bd7d308f8e1639fab988df18a8011f41eacad73"],
  near: ["wrap.near"],
};
/** The logo of a coin: the bundled one for a native coin, else the market data's image url, else undefined (the monogram). */
export function logoFor(chain: ChainId, address: string, gtImage?: string | null): string | undefined {
  if (WRAPPED[chain].includes(isEvm(chain) ? normAddr(chain, address) : address)) return nativeLogoUri(chain);
  return logoOf(gtImage);
}

/**
 * A row's logo (a 40 pt disc): a coingecko "/large/" image (up to ~130 KB) is asked as its "/small/" twin (~13 KB), as the
 * relay already does for its own logos (apps/quotes logo.mjs). The coin page, Buy and the receipt keep the large one
 * (UX audit 4 Nov: five row logos took 1.76 s, DOPE's 98 KB for a 40 pt disc). Any other url is as it is.
 */
export function rowLogo(u: string | undefined): string | undefined {
  if (!u) return u;
  try {
    const x = new URL(u);
    if (x.hostname === "coin-images.coingecko.com" && /\/coins\/images\/\d+\/large\//.test(x.pathname)) { x.pathname = x.pathname.replace("/large/", "/small/"); return x.toString(); }
  } catch { /* a data: image or not a url: as it is */ }
  return u;
}
