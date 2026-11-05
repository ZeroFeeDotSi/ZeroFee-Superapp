// Geohashes, the way BitChat names places (bitchat/Utils/Geohash.swift): base32 letters, each one a smaller box.
// Precision 2 is a region, 4 a province, 5 a city, 6 a neighbourhood, 7 a block (GeohashChannelLevel).
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** A place ZeroFee Chat can join: 2 to 12 geohash letters, lower case (as BitChat's deep link bitchat://geohash/<gh>). */
export const isPlace = (g: string): boolean => /^[0-9bcdefghjkmnpqrstuvwxyz]{2,12}$/.test(g);

/** Typed text as a place: "#U0QJ" → "u0qj"; null when it isn't one. */
export function readPlace(text: string): string | null {
  const g = text.trim().replace(/^#/, "").toLowerCase();
  return isPlace(g) ? g : null;
}

/** The box's centre. */
export function center(geohash: string): { lat: number; lon: number } {
  const lat = [-90, 90];
  const lon = [-180, 180];
  let even = true;
  for (const c of geohash) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error("not a geohash");
    for (let b = 4; b >= 0; b--) {
      const r = even ? lon : lat;
      const mid = (r[0]! + r[1]!) / 2;
      if ((v >> b) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0]! + lat[1]!) / 2, lon: (lon[0]! + lon[1]!) / 2 };
}

/** The geohash of a point at `precision` letters. */
export function encode(lat: number, lon: number, precision: number): string {
  const la = [-90, 90];
  const lo = [-180, 180];
  let even = true;
  let out = "";
  let bit = 0;
  let ch = 0;
  while (out.length < precision) {
    const r = even ? lo : la;
    const v = even ? lon : lat;
    const mid = (r[0]! + r[1]!) / 2;
    if (v >= mid) {
      ch = (ch << 1) | 1;
      r[0] = mid;
    } else {
      ch <<= 1;
      r[1] = mid;
    }
    even = !even;
    if (++bit === 5) {
      out += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

/** Great-circle distance in km (BitChat's haversineKm). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
