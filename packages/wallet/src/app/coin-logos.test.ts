// Home's held coins wear their own logos (product decision, 3 Nov: a bought MAMESUKE showed a plain "M" while Trade showed its
// picture). Home's rows ask the shared coin-logo source (by chain and address, through the relay), and the kept pictures
// load after Home's first paint (a lazy import), never in its first load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("Home: every held coin row (SOL, Robinhood, BNB and NEAR) draws the coin's own logo, by its chain and address", () => {
  const home = code(read("./screens/Home.tsx"));
  assert.match(home, /const logo = useCoinLogos\(bridge, held === null && !pictured\.length \? null : pictured\)/, "held coins and a site wallet's coins");
  assert.match(home, /bought\.map\(\(c, i\) => <CoinRow key=\{c\.key\} i=\{i \+ 1\} symbol=\{c\.symbol\} \{\.\.\.\(c\.icon \? \{ icon: c\.icon \} : c\.address && logo\(r\.chain, c\.address\)/, "a wallet's held coins, the NEAR wallet's too (a bundled icon wins)");
  assert.match(home, /<CoinIcon symbol=\{symbol\} icon=\{icon\} \{\.\.\.\(src \? \{ src \} : \{\}\)\}/, "the row hands it to the icon");
  // control: before, the held row had no picture at all
  assert.doesNotMatch(home, /\.\.\.r\.coins\.map\(\(c\) => \(\{ key: c\.key, symbol: c\.symbol, chain: r\.chain,/);
});

test("the kept pictures load lazily, beside Home, never in its first load", () => {
  const hook = code(read("./coin-logos.ts"));
  assert.match(hook, /import\("@zerofee\/core\/coin-logo-book"\)/);
  assert.doesNotMatch(hook, /^import \{[^}]*\} from "@zerofee\/core\/coin-logo-book"/m, "only its type is imported statically");
});
