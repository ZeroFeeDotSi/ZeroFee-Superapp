// The logo slot's state: never empty, never a broken image.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DARK_DISC, logoMountsImg, logoShows, logoStart, logoStep } from "./coin-icon.ts";

const URL = "https://coin-images.coingecko.com/coins/images/31212/large/PYUSD.png";

test("no url: the monogram, and no <img>", () => {
  const s = logoStart(undefined);
  assert.deepEqual([logoShows(s), logoMountsImg(s)], ["monogram", false]);
});

test("a url still loading: the monogram, with the <img> mounted (invisible) so it can load", () => {
  const s = logoStart(URL);
  assert.deepEqual([logoShows(s), logoMountsImg(s)], ["monogram", true]);
});

test("loaded: the image", () => {
  assert.equal(logoShows(logoStep(logoStart(URL), { kind: "load", url: URL })), "image");
  assert.equal(logoShows(logoStart(URL, true)), "image", "a url already loaded on this page shows at once");
});

test("an error: the monogram again, and the <img> leaves", () => {
  const s = logoStep(logoStart(URL), { kind: "error", url: URL });
  assert.deepEqual([logoShows(s), logoMountsImg(s)], ["monogram", false]);
});

test("a new url starts over; an old image answering late changes nothing", () => {
  const loaded = logoStep(logoStart(URL), { kind: "load", url: URL });
  const next = logoStep(loaded, { kind: "url", url: "https://example.com/other.png" });
  assert.equal(logoShows(next), "monogram");
  assert.equal(logoShows(logoStep(next, { kind: "load", url: URL })), "monogram");
  assert.equal(logoStep(loaded, { kind: "url", url: URL }), loaded, "the same url keeps its state");
});

/** How light a "#rrggbb" or "#rgb" fill is (0 black, 1 white); null for anything else. */
const lightness = (fill: string | undefined): number | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill ?? "");
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

test("every logo on a near-black disc wears the ring, so NEAR's never vanishes on Black (and no other logo does)", () => {
  const dir = new globalThis.URL("./logos/", import.meta.url);
  const dark = readdirSync(dir).filter((f) => f.endsWith(".svg")).filter((f) => {
    const svg = readFileSync(new globalThis.URL(f, dir), "utf8");
    const disc = /<(circle|rect)[^>]*fill="([^"]+)"/.exec(svg)?.[2];
    const l = lightness(disc);
    return l !== null && l < 0.2;
  }).map((f) => f.replace(/\.svg$/, ""));
  assert.deepEqual([...DARK_DISC].sort(), dark.sort());
  assert.ok(DARK_DISC.has("near"), "NEAR's disc is #0b0b0c");
  assert.ok(DARK_DISC.has("sol"), "Solana's official mark sits on black (product decision, 5 Nov)");
  assert.ok(!DARK_DISC.has("eth") && !DARK_DISC.has("usdc"), "control: a light or coloured disc wears none");
});
