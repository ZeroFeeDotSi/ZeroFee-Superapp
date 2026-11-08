// QA's MUST (Sim test): Hot said $286.62 over rows adding to $294.06. Hot's number is the sum of
// what Hot shows: each wallet's own coin and the coins it holds (trade.positions, once), the money on its way as its
// own rows, and each site's section at its rows' figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingStatus } from "@zerofee/core/spending";
import { sumUsd, tradingUsd, type HeldCoin } from "./trading.ts";
import { MOVING_WORDS, movingRows } from "./hot-moving.ts";
import { siteSections } from "./screens/safe-hot.ts";

const net = (network: string, cashUsd: string, extra: Record<string, unknown> = {}) => ({ network, name: network, cashUsd, coinsUsd: "0.00", readyUsd: "0.00", ...extra });
const S = (o: Partial<SpendingStatus>) => ({ loaded: true, totalUsd: "0.00", reserveUsd: "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "0", ready: true, firstTopUp: false, onItsWay: [], networks: [], ...o }) as SpendingStatus;
const held: HeldCoin[] = [{ chain: "sol", address: "bonk", symbol: "BONK", amount: "1", usd: "4.97" }, { chain: "hood", address: "x", symbol: "X", amount: "1", usd: "2.47" }];
const site = { id: "sw-pump", role: "site", site: "pump", label: "pump.fun", network: "sol", current: true, cashUsd: "25.00", coinsUsd: "2.47" };

/** What Hot's rows say, by Home.tsx homeRows/walletUsd's rules: NEAR (its reserve and its coins), each chain's own coin
 *  and its coins, the moving rows, each site section. */
const rowsShown = (s: SpendingStatus, h: HeldCoin[]) => sumUsd([
  s.reserveUsd, ...h.filter((x) => x.chain === "near").map((x) => x.usd),
  ...["sol", "hood"].flatMap((c) => [s.networks.find((n) => n.network === c)?.cashUsd, ...h.filter((x) => x.chain === c).map((x) => x.usd)]),
  ...movingRows(s).map((m) => m.usd), "27.47",
]);

test("Hot's total is the sum of its rows: coins held on SOL and Robinhood counted once (control: the old engine-only figure was short by them)", () => {
  // the engine counts no coins (float-core coinsUsd 0): its total is the NEAR wallet and the chains' own coin
  const s = S({ totalUsd: "239.12", reserveUsd: "35.00", networks: [net("sol", "175.14"), net("hood", "28.98")] as never });
  const t = tradingUsd(s, held, [site as never]);
  assert.equal(t.usd, rowsShown(s, held));
  assert.equal(t.usd, "274.03");
  assert.notEqual(sumUsd([s.totalUsd, "27.47"]), t.usd, "control: the old figure left the held coins out");
  // an engine that counts a chain's coins itself is never counted twice
  const counted = S({ totalUsd: "246.56", reserveUsd: "35.00", networks: [net("sol", "175.14", { coinsUsd: "4.97" }), net("hood", "28.98", { coinsUsd: "2.47" })] as never });
  assert.equal(tradingUsd(counted, held, [site as never]).usd, "274.03");
});

test("money on its way is its own row, never dropped: one row per move, named by where it goes, and the rows still add up (control: nothing moving, no row)", () => {
  const away = { id: "m1", kind: "move", to: "sol", usd: "12.40", status: "on-its-way", shown: true, atIso: "", words: "", etaSeconds: 60 };
  const s = S({ totalUsd: "251.52", reserveUsd: "35.00", networks: [net("sol", "175.14"), net("hood", "28.98")] as never, onItsWay: [away] as never });
  const m = movingRows(s);
  assert.deepEqual(m, [{ id: "m1", to: "your SOL wallet", usd: "12.40", etaSec: 60 }]);
  assert.equal(MOVING_WORDS.row(m[0]!.to, "$12.40"), "On its way to your SOL wallet · $12.40");
  // a16: Hot's row says the name alone as its title; the figure is its own column (Home.tsx hot-moving)
  assert.equal(MOVING_WORDS.name(m[0]!.to), "On its way to your SOL wallet");
  assert.equal(MOVING_WORDS.engineName(), "On its way into your wallets");
  // the row's title is the destination (never cut), its sub-line the state and the time
  assert.equal(MOVING_WORDS.title(m[0]!.to), "Your SOL wallet");
  assert.equal(MOVING_WORDS.title("your wallets"), "Your wallets");
  assert.equal(MOVING_WORDS.sub("About 29 s left."), "On its way · About 29 s left.");
  assert.equal(MOVING_WORDS.sub(), "On its way");
  assert.equal(tradingUsd(s, held, [site as never]).usd, rowsShown(s, held));
  assert.equal(tradingUsd(s, held, [site as never]).usd, "286.43");
  // the engine counts more than the moves it names: no row of its own (test, MUST 1), and its dollars stay in the total
  // (the review's ruling on D128, 5 Nov: a Move never changes the total); a leg that runs late gets its row
  // (moving-own.test.ts)
  const more = S({ ...s, totalUsd: "253.52" });
  assert.deepEqual(movingRows(more).map((r) => [r.to, r.usd]), [["your SOL wallet", "12.40"]]);
  assert.equal(rowsShown(more, held), "286.43", "the rows: the named move only");
  assert.equal(tradingUsd(more, held, [site as never]).usd, "288.43", "the engine's extra $2.00 with no job is counted, with no row");
  // landed: the engine counts it in the wallet, so the row folds into it
  assert.deepEqual(movingRows(S({ ...s, totalUsd: "239.12" })), [], "control: nothing on its way, no row");
});

test("a site's section says the sum of its rows when every row is priced (control: a row with no price keeps spending.wallets' figure)", () => {
  const coins = [{ token: "native", symbol: "SOL", decimals: 9, amount: "245800000", usd: 25 }, { token: "bonk", symbol: "BONK", decimals: 5, amount: "123456700000", usd: 2.47 }];
  const w = { ...site, cashUsd: "23.74" };
  assert.equal(siteSections([w as never], () => coins as never, sumUsd)[0]!.usd, "27.47");
  assert.equal(siteSections([w as never], () => [coins[0], { ...coins[1], usd: null }] as never, sumUsd)[0]!.usd, "26.21", "control");
});

test("Home's Hot number and its bar are the sum of what Hot shows, the moving rows at the top of its wallets", () => {
  const home = readFileSync(new URL("./screens/Home.tsx", import.meta.url), "utf8");
  assert.match(home, /sumUsd\(\[\.\.\.rows\.map\(\(r\) => figure\(r\)\.usd\), awayUsd\.toFixed\(2\), \.\.\.sites\.map\(\(x\) => x\.usd\)\]\)/);
  assert.match(home, /: hotUsd;/);
  assert.doesNotMatch(home, /^import \{[^}]*\} from "\.\.\/(money\/JobMade\.tsx|hot-moving\.ts)";/m, "the moving rows and TimeLeft load lazily, never in Home's first load");
  assert.match(home, /import\("\.\.\/hot-moving\.ts"\), import\("\.\.\/money\/JobMade\.tsx"\)/);
  assert.match(home, /\$\(hotUsd\)/);
  assert.doesNotMatch(home, /: \$\(trading\)\}/, "control: the bar no longer says the core's figure");
  // phone test (5 Nov): a moving row with no estimate showed "This job has no time estimate." as its figure; a row says nothing then
  assert.doesNotMatch(home, /\{Left && <Left etaSec=\{m\.etaSec\} \/>\}/, "the time line never renders without an estimate");
  assert.match(home, /\{moving\.map\(\(m\) => \([\s\S]*?movingWords\?\.title\(m\.engine \? "your wallets" : m\.to\)\}<\/p>\n\s*<b className="wl-hw__usd">\{\$\(m\.usd\)\}<\/b>[\s\S]*?\{Left && \(m\.etaSec \|\| m\.endsAt\) \? <Left etaSec=\{m\.etaSec\} endsAt=\{m\.endsAt\} follow=\{false\} line=\{movingWords\?\.sub\} \/> : <p className="zf-receipt__line">\{movingWords\?\.sub\(\)\}<\/p>\}[\s\S]*?\{spending === null \|\| !spending\.loaded \? <Skeleton \/>/);
});

test("test, MUST 1: no job started, no moving row and no cent in Hot's total; only a move with a Jobs row is one (controls)", () => {
  const nets = [net("sol", "175.14"), net("hood", "28.98")] as never;
  // the engine's total rounds apart from its parts: a cent past them, nothing on its way
  const dust = S({ totalUsd: "239.13", reserveUsd: "35.00", networks: nets });
  assert.deepEqual(movingRows(dust), [], "rounding's cent is never \"On its way to your NEAR wallet · $0.01\"");
  assert.equal(tradingUsd(dust, [], [site as never]).usd, "266.59", "Hot's total is its rows: 35.00 + 175.14 + 28.98 + 27.47");
  assert.equal(tradingUsd(dust, [], [site as never]).usd, rowsShown(dust, []));
  // a background move the engine makes by itself (a rebalance: no Jobs row, spending.ts shownInActivity) is no row either
  const quiet = { id: "rb", kind: "rebalance", usd: "0.01", status: "on-its-way", shown: false, atIso: "", words: "" };
  assert.deepEqual(movingRows(S({ ...dust, onItsWay: [quiet] as never })), []);
  assert.equal(tradingUsd(S({ ...dust, onItsWay: [quiet] as never }), [], [site as never]).usd, "266.59");
  // control: the person's own Move on its way (its Jobs row) is its row and counts, to the cent, rounding or not
  const mine = { id: "m2", kind: "move", to: "sol", usd: "12.40", status: "on-its-way", shown: true, atIso: "", words: "" };
  const going = S({ totalUsd: "251.51", reserveUsd: "35.00", networks: nets, onItsWay: [mine] as never });
  assert.deepEqual(movingRows(going).map((r) => [r.id, r.usd]), [["m2", "12.40"]], "a cent short of the engine's count still shows the move");
  assert.equal(tradingUsd(going, [], [site as never]).usd, rowsShown(going, []));
  assert.equal(tradingUsd(going, [], [site as never]).usd, "278.99");
  // control: landed (the engine counts it in its wallet now), the row is gone
  assert.deepEqual(movingRows(S({ ...going, totalUsd: "239.12" })), []);
});
