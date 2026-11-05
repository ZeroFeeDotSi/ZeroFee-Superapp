// A sheet's scrim ignores a tap this soon after the open: a double tap on a tile opened the sheet and the second tap,
// landing on the scrim, shut it at once (Earn crawl, 5 Nov). Its own .ts so node tests can import it.
export const SCRIM_GUARD_MS = 300;
