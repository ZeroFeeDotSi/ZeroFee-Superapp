// the copy review's UI walk and QA 20 (7 Nov): a trap coin's list row after its refusal (trade.coin.unsellable) read "Didn't buy · Not
// for sale. ZeroFe…" and drew "Not for sale" over its price and change. the copy review's rule: "Not for sale" in mute in place of Buy
// only; the price and change stay where they are; the line is "Didn't buy" alone (the refusal's sentence stays the coin's).
// The row's words (rowBuyLine, as Discover's Row calls it) and the cascade the row is laid out by (discover.css), per
// phase, with a normal coin and a non-trap refusal as controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rowBuyLine } from "./row-buy.ts";
import { tradeProblems } from "../../trade-problems.ts";

const src = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../discover.css", import.meta.url), "utf8");

type Theme = "light" | "dark";
/** A selector's theme prefix (`:root[data-theme="dark"] `, `:root:not([data-theme="dark"]) `, ...): which themes it
 *  applies in, and the specificity it adds. No prefix = both themes. */
function themeOf(sel: string): { rest: string; themes: Theme[]; spec: number } {
  const m = /^:root(?:\[data-theme="(dark|light)"\]|:not\(\[data-theme="(dark|light)"\]\))\s+(.*)$/.exec(sel);
  if (!m) return { rest: sel, themes: ["light", "dark"], spec: 0 };
  const is = (m[1] ?? (m[2] === "dark" ? "light" : "dark")) as Theme;
  return { rest: m[3]!, themes: [is], spec: 2 };
}

/** The row's padding-right for a `.dc-rr` with these classes in this theme: the cascade over every rule
 *  "[theme] <classes> .dc-row" (the highest specificity wins, the later one on a tie), as the browser lays the row out. */
function rowPadding(classes: string[], theme: Theme = "dark"): string | undefined {
  let best: { spec: number; at: number; v: string } | undefined;
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const v = /padding-right:\s*([^;]+);?/.exec(m[2]!)?.[1]?.trim();
    if (!v) continue;
    for (const raw of m[1]!.split(",").map((x) => x.trim())) {
      const t = themeOf(raw);
      if (!t.themes.includes(theme)) continue;
      const parts = /^((?:\.[\w-]+)+) \.dc-row$/.exec(t.rest);
      if (!parts) continue;
      const need = parts[1]!.split(".").filter(Boolean);
      if (!need.every((c) => classes.includes(c))) continue;
      const spec = need.length + 1 + t.spec;
      if (!best || spec > best.spec || (spec === best.spec && m.index! >= best.at)) best = { spec, at: m.index!, v };
    }
  }
  return best?.v;
}

/** WCAG 2.x contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("the copy review's walk: a trap coin's refused row reads \"Didn't buy\" alone, never the refusal's sentence (control: another refusal keeps its why)", () => {
  const trap = tradeProblems.coinUnsellable("NOSELL").whatHappened;
  assert.match(trap, /^Not for sale\./, "the refusal's own words");
  // (changed pin, audit 11's B9, 8 Nov: who said no and the money, never "Didn't buy" alone)
  assert.equal(rowBuyLine({ phase: "refused", at: 0, why: trap }, "NOSELL", true), "ZeroFee won't buy it · Nothing was spent");
  assert.equal(rowBuyLine({ phase: "refused", at: 0, why: "Only $3.00 on Solana. Open the coin to buy less." }, "DOPE"), "Didn't buy · Only $3.00 on Solana. Open the coin to buy less.", "control: a refusal on a coin for sale says why");
  assert.equal(rowBuyLine({ phase: "landed", at: 0, got: "7,505 DOPE" }, "DOPE", true), "Bought · 7,505 DOPE", "control: only the refused line changes");
  // the row hands its own not-for-sale state to the line
  assert.match(src, /<span className="dc-sub__words">\{rowBuyLine\(buy, r\.symbol, noSale\)\}<\/span>/);
});

test("the copy review's walk: \"Not for sale\" sits where Buy was, never over the price: the row keeps its room for it in every phase (control: a normal row keeps Buy's room, a receipt row with no chip gives it back)", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const phase of ["", "is-away", "is-landed", "is-checking", "is-refused"]) {
      assert.equal(rowPadding(["dc-rr", "dc-rr--nfs", ...(phase ? [phase] : [])], theme), "86px", `not for sale, ${phase || "at rest"}, ${theme}`);
    }
    assert.equal(rowPadding(["dc-rr"], theme), "76px", `control: a normal coin keeps the chip's room ("Buy $50", QA 16), ${theme}`);
    assert.equal(rowPadding(["dc-rr", "is-refused"], theme), "0", `control: a refused coin for sale is the receipt, no chip, ${theme}`);
  }
  // "Not for sale" is drawn in that room only, in mute, on one line, and lets the tap through to the row (44 pt: the row's own)
  const nfs = /\.dc-nfs \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(nfs, /position: absolute; right: 0;/);
  assert.match(nfs, /color: var\(--mute\)/);
  assert.match(nfs, /white-space: nowrap/);
  assert.match(nfs, /pointer-events: none/);
});

test("the copy review's walk: the price and change are drawn on every row, trap or not, receipt or not; \"Not for sale\" takes Buy's place only (control: a normal coin keeps Buy)", () => {
  // the row's figures depend on the coin alone, never on the chip's trade or the not-for-sale mark
  assert.match(src, /usd=\{<span className=\{`dc-px[^\n]*>\{r\.priceUsd \? listPrice\(r\.priceUsd\) : ""\}<\/span>\}/);
  assert.match(src, /when=\{ch !== undefined \? <span className=\{`dc-chg [^\n]*\{pct\(ch\)\}<\/span> : undefined\} \/>/);
  const row = src.slice(src.indexOf("const Row = memo("), src.indexOf("/** The quiet Buy chip (Build A)"));
  assert.doesNotMatch(row.slice(row.indexOf("usd={"), row.indexOf("{/* T2-5")), /noSale|buy \?/, "the figures never wait on the row's state");
  assert.match(row, /\{noSale \? <span className="dc-nfs" data-testid="row-not-for-sale">\{NOT_FOR_SALE\}<\/span> : !buy && !down && <RowBuy r=\{r\} onState=\{setBuy\} follow=\{follow\} \/>\}/, "Buy or Not for sale, one of them");
});

test("the copy review's walk, both themes: \"Not for sale\" in mute reads on White and on Black (WCAG 4.5:1), and the row it sits in is the 44 pt tap target (control: the theme reader sees a dark-only rule)", () => {
  const tokens = readFileSync(new URL("../../../../design/src/tokens.css", import.meta.url), "utf8");
  const rebrand = tokens.slice(tokens.indexOf("Rebrand (product decision, 4 Nov"));
  const [white, black] = rebrand.split(':root[data-theme="dark"]');
  const tok = (block: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)?.[1];
  for (const [theme, block] of [["light", white!], ["dark", black!]] as const) {
    const mute = tok(block, "mute"), bg = tok(block, "bg");
    assert.ok(mute && bg, `${theme}: --mute and --bg are solid colours`);
    assert.ok(contrast(mute!, bg!) >= 4.5, `${theme}: "Not for sale" ${mute} on ${bg} is ${contrast(mute!, bg!).toFixed(2)}:1`);
  }
  // no theme rule recolours or moves "Not for sale"
  assert.doesNotMatch(css, /data-theme[^{]*\.dc-(nfs|rr--nfs)/, "one look for the mark in both themes");
  // the row is the tap target (the mark lets taps through, pointer-events: none above): 68 pt, over 44
  const lrow = readFileSync(new URL("../../../../design/src/liverow.css", import.meta.url), "utf8");
  const h = Number(/\.zf-lrow \{[^}]*min-height: (\d+)px/.exec(lrow)?.[1]);
  assert.ok(h >= 44, `the row is ${h} pt tall`);
  // control: a dark-only rule is read in dark, not in light
  assert.deepEqual(themeOf(':root[data-theme="dark"] .dc-rr .dc-row').themes, ["dark"]);
  assert.deepEqual(themeOf(':root:not([data-theme="dark"]) .dc-rr .dc-row').themes, ["light"]);
});
