// Home's Swap (the Home plan §1.4; audit dead ends 3–6): only pairs the real core finishes are listed, each on the one
// private engine; no pick-then-refuse (BNB while shut, Hidden → NEAR coins, "Move it to NEAR first" are gone). Every cell
// of the pair table is here, with controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeSends } from "@zerofee/core/spending";
import { readFileSync } from "node:fs";
import { addOnWayLine } from "./adds-on-way.ts";
import { HOME_LEG_MIN_USD, PAIR_MIN_USD } from "@zerofee/core/float-floors";
import { fairLine, feeHigh, floorOf, ROW_USDC, SWAP_COIN, SWAP_PLACES, SWAP_WORDS, arrives, arrivesLine, arrivesWith, feesLine, leastFair, coinFigure, coinName, privateLine, getsFor, mostOn, payFor, paysHere, routeOf, routeSec, swapBlock, type SwapPlace, swapStays as grid } from "./swap-corridor.ts";
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { MOVE_WORDS } from "../screens/move-split.ts";

const SHUT = () => false, OPEN = () => true;
/** The test proof build with BNB still shut: the two-leg pairs listed (review L9). */
const PAIRS = (c: "bsc" | "pair") => c === "pair";

test("the pair table: wallet ↔ wallet is E5 (spending.move), the Safe → a wallet its Approve with that coin, a wallet → the Safe one take-out, the Safe's NEAR → its USDC is E7", () => {
  assert.deepEqual(routeOf("sol", "hood", PAIRS), { kind: "move", from: "sol", to: "hood" });
  assert.deepEqual(routeOf("hood", "sol", PAIRS), { kind: "move", from: "hood", to: "sol" });
  assert.deepEqual(routeOf("sol", "near", SHUT), { kind: "move", from: "sol", to: "near" });
  assert.deepEqual(routeOf("near", "hood", SHUT), { kind: "move", from: "near", to: "hood" });
  assert.deepEqual(routeOf("sol", "safe-usdc", SHUT), { kind: "home", from: "sol" });
  assert.deepEqual(routeOf("near", "safe-usdc", SHUT), { kind: "home", from: "near" });
  assert.deepEqual(routeOf("safe-usdc", "sol", SHUT), { kind: "topup", coin: "USDC", to: "sol" });
  assert.deepEqual(routeOf("safe-near", "hood", SHUT), { kind: "topup", coin: "NEAR", to: "hood" });
  assert.deepEqual(routeOf("safe-usdc", "near", SHUT), { kind: "topup", coin: "USDC", to: "near" });
  assert.deepEqual(routeOf("safe-near", "safe-usdc", PAIRS), { kind: "safe" });
});

test("no pick-then-refuse: a pair no core path finishes is never listed (BNB while shut, anything → NEAR in the Safe, the same coin, USDC in the Safe → itself); control: BNB is listed once its gate opens", () => {
  for (const p of SWAP_PLACES) {
    const gets = getsFor(p, SHUT);
    assert.ok(!gets.includes("bsc") && !gets.includes("safe-near") && !gets.includes(p), `${p}: ${gets.join(",")}`);
    for (const g of gets) assert.ok(routeOf(p, g, SHUT), `${p} → ${g} is listed and has a route`);
  }
  assert.equal(routeOf("bsc", "sol", SHUT), null);
  assert.equal(routeOf("safe-usdc", "safe-near", SHUT), null);
  assert.deepEqual(getsFor("sol", OPEN), ["hood", "bsc", "near", "safe-usdc"], "control: BNB once open");
  assert.deepEqual(routeOf("bsc", "sol", OPEN), { kind: "move", from: "bsc", to: "sol" });
  // the old corridor's dead ends are gone from the words
  const src = readFileSync(new URL("./swap-corridor.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  for (const gone of ["Move it to NEAR first", "Hidden can't swap BNB", "Then swap that", "isn't in ZeroFee yet"]) assert.ok(!src.includes(gone), gone);
});

test("what arrives, before any quote: 'At least' where the core holds every leg to a floor, 'About' where 1Click's own quote is on the Approve; and about how long", () => {
  // SOL → ETH (RH), $50 at ETH $3,000: the move in's floor, then the move out sized from it less its fee room
  const line = arrivesLine({ kind: "move", from: "sol", to: "hood" }, "hood", 50, 3000);
  assert.match(line, /^At least 0\.01\d{0,2} ETH arrives\. About 1 min\.$/);
  const a = arrives({ kind: "move", from: "sol", to: "hood" }, 50, 3000);
  assert.ok(a.amount * 3000 < 50 && a.amount * 3000 > 45, String(a.amount));
  assert.match(arrivesLine({ kind: "home", from: "sol" }, "safe-usdc", 20, 1), /^At least 1[89]\.\d+ USDC arrives\. About 1 min\.$/);
  assert.match(arrivesLine({ kind: "topup", coin: "USDC", to: "near" }, "near", 10, 1), /^About 10 USDC arrives\. About 30 s\.$/);
  assert.match(arrivesLine({ kind: "safe" }, "safe-usdc", 10, 1), /^About 9\.\d+ USDC arrives\. About 1 min\.$/);
  // D137: the network's own time, one 1Click leg about 30 s, two about a minute; control: no line says the old "About 10 min."
  assert.doesNotMatch(arrivesLine({ kind: "move", from: "sol", to: "hood" }, "hood", 50, 3000), /10 min/);
  assert.match(arrivesLine({ kind: "home", from: "near" }, "safe-usdc", 10, 1), /About 30 s\.$/, "one leg home: about 30 s (D137: no gap)");
  assert.match(arrivesLine({ kind: "move", from: "sol", to: "near" }, "near", 10, 1), /About 30 s\.$/);
  // a UI test (4 Nov) measured about 4 min on the old public route (the Safe into the NEAR wallet, then 1Click out);
  // since the product's HARD RULE it is paid from Private by NEAR Confidential, the route the job's row counts down (Sim
  // re-check, 5 Nov: "About 4 min left." on a Swap that landed at once)
  assert.match(arrivesLine({ kind: "topup", coin: "USDC", to: "sol" }, "sol", 10, 100), /About 1 min\.$/);
  assert.equal(routeSec({ kind: "topup", coin: "USDC", to: "sol" }), LEG_SEC.privateSwap);
});

test("a coin's figure has at most 4 decimals: what arrives rounds down, what must be sent rounds up (control: the old \"0.003774 ETH\")", () => {
  assert.equal(coinFigure(0.003774, "down"), "0.0037");
  assert.equal(coinFigure(0.003774, "up"), "0.0038");
  assert.equal(coinFigure(1234.56789, "down"), "1,234.5678");
  assert.equal(coinFigure(0.0037, "up"), "0.0037", "a figure already at 4 decimals stays");
  assert.equal(coinFigure(2, "down"), "2");
  // the walk's own pair: $10 of SOL for ETH (RH) at the demo's price
  const line = arrivesLine({ kind: "move", from: "sol", to: "hood" }, "hood", 10, 2348.33);
  assert.match(line, /^At least 0\.\d{1,4} ETH arrives\./, line);
  assert.doesNotMatch(line, /0\.\d{5,}/, "control: never a fifth decimal");
});

test("each coin says its name and where it sits once each, in the Agent app's words: \"SOL · your SOL wallet\" (control: the old \"SOL  SOL wallet\")", () => {
  assert.equal(coinName("sol"), "SOL · your SOL wallet");
  assert.equal(coinName("hood"), "ETH (RH) · your ETH (RH) wallet");
  assert.equal(coinName("near"), "USDC · your NEAR wallet");
  assert.equal(coinName("safe-near"), "NEAR · your Safe");
  for (const p of SWAP_PLACES) {
    assert.match(SWAP_COIN[p].where, /^your (Safe|SOL wallet|ETH \(RH\) wallet|BNB wallet|NEAR wallet)$/, "control: the old \"SOL wallet\" fails this");
    assert.doesNotMatch(coinName(p), /Hidden|\brow\b|Trading|ETH on Robinhood/);
    assert.doesNotMatch(coinName(p), /^(\S+) \1 wallet/, "never the coin twice in a row");
  }
});

test("what each coin can pay: a wallet with coins keeps its fee reserve, the NEAR wallet keeps a move out's fee room, the Safe's coin inside the room under the limit (one coin pays); BNB only while open", () => {
  const p = paysHere({
    networks: [{ network: "sol", cashUsd: "20.00", coinsUsd: "8.00", readyUsd: "17.50" }, { network: "hood", cashUsd: "10.00", coinsUsd: "0.00", readyUsd: "8.00" }, { network: "bsc", cashUsd: "5.00", coinsUsd: "0", readyUsd: "5", closed: true }],
    reserveUsd: "10.30", roomUsd: "40.00",
    safe: [{ tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", usd: "100", amount: "100" }, { tokenId: "near", usd: "12", amount: "4" }, { tokenId: "nep141:wrap.near", usd: "30", amount: "10" }, { tokenId: "nep141:wrap.near", usd: "500", amount: "1", held: "private" }],
  });
  const by = (x: SwapPlace) => p.find((q) => q.place === x);
  assert.deepEqual(p.map((x) => x.place), ["sol", "hood", "near", "safe-usdc", "safe-near"]);
  assert.equal(by("sol")!.most, 17.5);
  assert.equal(by("hood")!.most, 10, "control: no coins, all of it");
  assert.equal(by("near")!.most, 10);
  assert.equal(mostOn(by("near")!, { kind: "home", from: "near" }), 10.29, "home pays no move out's fee room");
  assert.equal(by("safe-usdc")!.most, 40, "inside the room under the limit");
  assert.equal(by("safe-near")!.most, 30, "the largest NEAR coin, never Hidden's");
});

test("opened from a Home tab, You pay starts on that wallet; from the Safe, its USDC, else its NEAR (from All, the Safe's, D70)", () => {
  const pays = [{ place: "sol", usd: 10, most: 10 }, { place: "hood", usd: 5, most: 5 }, { place: "safe-near", usd: 30, most: 30 }] as const;
  assert.equal(payFor("hood", pays), "hood");
  assert.equal(payFor("safe", pays), "safe-near", "no USDC in the Safe: its NEAR");
  assert.equal(payFor("near", pays), null, "a wallet with nothing to swap: the first coin");
  // D70 (a web test): from All, the Safe's, never the SOL wallet first; control: no Safe coin, the first coin
  assert.equal(payFor(undefined, pays), "safe-near");
  assert.equal(payFor(undefined, [...pays, { place: "safe-usdc", usd: 50, most: 40 }]), "safe-usdc");
  assert.equal(payFor(undefined, pays.filter((p) => !p.place.startsWith("safe"))), null, "control");
});

test("review M1: between two wallets, Hold to swap starts at the core's least ($2.65), so no line ever says \"arrives\" for less (control: the NEAR wallet's cash to a wallet at $2.00 goes)", () => {
  const pair = { kind: "move", from: "sol", to: "hood" } as const;
  assert.equal(swapBlock({ route: pair, usd: 2.64, most: 10 }), SWAP_WORDS.leastPair);
  assert.equal(swapBlock({ route: pair, usd: 2.65, most: 10 }), null);
  assert.equal(swapBlock({ route: { kind: "move", from: "near", to: "sol" }, usd: 2, most: 10 }), null, "control");
});

test("review L6: \"It goes privately through NEAR.\" only where it holds: never on the Safe's NEAR to its own USDC, both ends the Safe's public account (control: a wallet to a wallet says it)", () => {
  assert.equal(privateLine({ kind: "safe" }), null);
  assert.equal(privateLine({ kind: "move", from: "sol", to: "hood" }), SWAP_WORDS.privately, "control");
  assert.equal(privateLine({ kind: "topup", coin: "NEAR", to: "sol" }), SWAP_WORDS.privately);
});

test("review L9: a release build lists no pair that waits on the $1 proof: no chain's wallet to another, no Safe NEAR to its USDC; one leg to or from the NEAR wallet, the Safe to a wallet and a wallet home still are (control: the proof build lists them)", () => {
  assert.deepEqual(getsFor("sol", SHUT), ["near", "safe-usdc"]);
  assert.deepEqual(getsFor("near", SHUT), ["sol", "hood", "safe-usdc"]);
  assert.deepEqual(getsFor("safe-near", SHUT), ["sol", "hood", "near"]);
  assert.equal(routeOf("safe-near", "safe-usdc", SHUT), null);
  assert.deepEqual(getsFor("sol", PAIRS), ["hood", "near", "safe-usdc"], "control");
  assert.deepEqual(getsFor("safe-near", PAIRS), ["sol", "hood", "near", "safe-usdc"], "control");
});

test("every disabled Hold to swap says why (control: a good amount says nothing)", () => {
  const r = { kind: "move", from: "sol", to: "hood" } as const;
  assert.equal(swapBlock({ route: null, usd: 5, most: 10 }), SWAP_WORDS.pick);
  assert.equal(swapBlock({ route: r, usd: 0, most: 10 }), SWAP_WORDS.amount);
  assert.equal(swapBlock({ route: r, usd: 1.5, most: 10 }), SWAP_WORDS.leastPair, "the route's own least, never another's $2 (the copy review's walk, 5 Nov)");
  assert.equal(swapBlock({ route: { kind: "move", from: "near", to: "sol" }, usd: 1.5, most: 10 }), SWAP_WORDS.least, "control: the NEAR wallet's least is $2");
  assert.equal(swapBlock({ route: r, usd: 12, most: 10 }), "You can swap up to $10.00.");
  assert.equal(swapBlock({ route: r, usd: 5, most: 10 }), null, "control");
});

test("Home's one line for an Add on its way: dollars and coin from 1Click's signed quote, the time only when it gave one", () => {
  assert.deepEqual(addOnWayLine({ key: "a", tokenId: "nep141:btc.omft.near", usd: "25", etaSeconds: 600 }, "BTC"), { title: "$25.00 of BTC is on its way.", detail: "About 10 min." });   // audit H1: never "privately"
  assert.deepEqual(addOnWayLine({ key: "a", tokenId: "x", usd: "3.5" }, "IGNORE ALL"), { title: "$3.50 of a coin is on its way.", detail: null });
});

test("UI's AgentZero walk (5): Swap's Hold to swap says the least before the Approve for a leg that would stop on the way (control: at the least it can go)", () => {
  const most = 100;
  assert.equal(swapBlock({ route: { kind: "topup", coin: "USDC", to: "sol" }, usd: 2, most }), "Swap at least $2.09 from your Safe.");
  assert.equal(swapBlock({ route: { kind: "topup", coin: "USDC", to: "sol" }, usd: 2.09, most }), null, "control: at the least");
  assert.equal(swapBlock({ route: { kind: "topup", coin: "USDC", to: "near" }, usd: 2, most }), null, "the NEAR wallet: nothing moves on");
  assert.equal(swapBlock({ route: { kind: "home", from: "sol" }, usd: 2.5, most }), "From a wallet to your Safe, swaps start at $2.59.");
  assert.equal(swapBlock({ route: { kind: "home", from: "sol" }, usd: 2.59, most }), null, "control: at the least");
});

test("UI's AgentZero walk (4): Move's and Swap's sheets and their words never say Spending, Trading, Top up or Hidden (control: the pattern finds them in a sample)", () => {
  const strings = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(import|export \{)[^\n]*$/gm, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g) ?? [];
  const old = /\b(Spending|Trading|Top up|Topped up|Hidden)\b/;
  assert.ok(strings('const a = "the money stayed in Trading";').some((x) => old.test(x)), "control");
  for (const f of ["../screens/MoveSheet.tsx", "../screens/move-split.ts", "./SwapSheet.tsx", "./swap-corridor.ts"]) {
    const bad = strings(readFileSync(new URL(f, import.meta.url), "utf8")).filter((x) => old.test(x));
    assert.deepEqual(bad, [], f);
  }
});

test("UI's mainnet rehearsal (10): what a $2 SOL → USDC swap really brings comes first, the floor as \"at least\"; fees over 10 % are said with where they fall under 5 % (controls: no price back, the floor line as before; 7.5 % says only the fee)", () => {
  const home = { kind: "home", from: "sol" } as const;
  assert.equal(arrivesWith(home, "safe-usdc", 2, 1, { arrivesUsd: 1.98, feeUsd: 0.02 }), "About 1.98 USDC arrives, at least 1.4. About 1 min.");
  assert.equal(arrivesWith(home, "safe-usdc", 2, 1, null), "At least 1.4 USDC arrives. About 1 min.", "control: no price back yet");
  // QA (5 Nov): the real figure before the tap; product decision, 5 Nov: never scary, who gets it, ZeroFee takes nothing
  assert.equal(feesLine(2, { arrivesUsd: 1.45, feeUsd: 0.55 }), "About $0.55 of your $2 goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.ok(feeHigh(2, { arrivesUsd: 1.45, feeUsd: 0.55 }) && !feeHigh(20, { arrivesUsd: 19.45, feeUsd: 0.55 }), "control: under 5 % is not over");
  assert.equal(feesLine(20, { arrivesUsd: 19.45, feeUsd: 0.55 }), "About $0.55 of your $20 goes to NEAR Intents and the network. ZeroFee takes nothing.");
  // fees = $0.54 fixed + 0.42 %: under 5 % from $12
  assert.equal(leastFair(2, 0.55, { usd: 50, feeUsd: 0.75 }), 12);
  assert.equal(fairLine(2, { arrivesUsd: 1.45, feeUsd: 0.55 }, { usd: 50, feeUsd: 0.75 }), "Swap $12 or more and the fee drops under 5%.");
  assert.equal(fairLine(20, { arrivesUsd: 19.45, feeUsd: 0.55 }, { usd: 50, feeUsd: 0.75 }), null, "control: under 5 %, nothing more said");
  assert.equal(fairLine(2, { arrivesUsd: 1.85, feeUsd: 0.15 }, null), null, "7.5 % is over 5 %, but with no second price no size is offered");
  assert.equal(leastFair(2, 0.55, { usd: 50, feeUsd: 5 }), null, "fees that stay over 5 % at any size: no amount offered");
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /arrivesWith\(route, get!, amount, priceOf\(get!, status, tokens\), price\.cost\)/);
  assert.match(sheet, /"subwallet\.float\.swapCost"/);
});

test("audit H1 (fix #3): the Safe's USDC swapped on to a wallet says what really leaves the Safe and that the rest stays hidden in the NEAR wallet, by the core's own rule, before the hold (controls: a Safe that can't pay it, a band one cent short, the NEAR wallet itself, NEAR paying: nothing said)", () => {
  const sol = { kind: "topup", coin: "USDC", to: "sol" } as const;
  const usdc = (amount: string) => [{ tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", amount, usd: amount }];
  const sends = (held: string, bandUsd: number | null) => (u: number) => safeSends(usdc(held), u, { swap: "USDC", roomUsd: 500, bandUsd, onward: true });
  // S4 (the copy review's Sim walk, 5 Nov): "$26.00 leaves your Safe" under a $25 swap named no reason; now the total, how much more
  // than typed, and where the extra is (the copy review's words; never "hidden", the audit's ruling)
  // the grid's own rule, for a Safe → wallet Add on the public leg (the app pays from Private: swapsend-logic.test)
  const swapStays = (r: Parameters<typeof grid>[0], u: number, s?: (u: number) => number) => grid(r, u, s, false);
  assert.equal(swapStays(sol, 100, sends("800", null)), "Your Safe sends $110.00. $10.00 stays in Private.");
  assert.equal(SWAP_WORDS.fill("$110.00", "$10.00"), MOVE_WORDS.fill("$110.00", "$10.00"), "control: Move's own line, word for word");
  assert.equal(swapStays(sol, 100, sends("105", null)), null, "control: the Safe holds only $105");
  assert.equal(swapStays(sol, 100, sends("800", 110)), "Your Safe sends $110.00. $10.00 stays in Private.", "the Face ID band's edge: $110.00 fits a band of $110");
  assert.equal(swapStays(sol, 100, sends("800", 109.99)), null, "control: a band of $109.99: nothing promised, as the core sends exactly");
  assert.equal(swapStays(sol, 100, undefined), null, "the band not read yet: nothing promised");
  assert.equal(swapStays(sol, 17.43, sends("800", null)), "Your Safe sends $18.00. $0.57 stays in Private.", "privacy audit: no $2 floor now nothing goes home, so $17.43 is rounded too");
  assert.doesNotMatch(swapStays(sol, 100, sends("800", null))!, /hidden|The rest|leaves your Safe/, "the audit's ruling: never \"hidden\"; every figure named, never \"the rest\"");
  assert.equal(swapStays({ kind: "topup", coin: "USDC", to: "near" }, 100, sends("800", null)), null, "control: into the NEAR wallet itself");
  assert.equal(swapStays({ kind: "topup", coin: "NEAR", to: "sol" }, 100, sends("800", null)), null, "control: paid with NEAR, as asked");
});

test("audit H1: Home's money sheets (Swap, Move, Send, Add, a site's Put money in and Take out, the steps) say only what's true: no line says \"privately\" while an amount and time can still be matched (control: the pattern finds the old line)", () => {
  const strings = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(import|export \{)[^\n]*$/gm, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g) ?? [];
  const claim = /\bprivately\b/i;
  assert.ok(strings('const a = "It goes privately through NEAR.";').some((x) => claim.test(x)), "control");
  for (const f of ["./SwapSheet.tsx", "./swap-corridor.ts", "./SendSheet.tsx", "./SendForm.tsx", "./SiteMoney.tsx", "./adds-on-way.ts", "./live-steps.ts", "../screens/MoveSheet.tsx", "../screens/move-split.ts", "../../send-reach.ts", "../../../../core/src/intents.ts"]) {
    const bad = strings(readFileSync(new URL(f, import.meta.url), "utf8")).filter((x) => claim.test(x));
    assert.deepEqual(bad, [], f);
  }
  assert.equal(SWAP_WORDS.privately, "Your account isn't named on the chain. The amount and time can still be matched.");
});

test("R3 (the design review §4.4): Swap's pickers say the coin over where it sits (never \" · your SOL wallet\" wrapped), a line chevron not ▾; what arrives is the one line under the dollars with its room kept; the privacy line is a \"Who can see this?\" row; \"Pick an amount.\" is never a line above Hold (the $0 and the off button say it) (controls: the old markup)", () => {
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<span className="zf-body wl-sw-name">\{SWAP_COIN\[pay\.place\]\.label\}<span className="zf-small wl-sw-where">\{SWAP_COIN\[pay\.place\]\.where\}<\/span><\/span>/);
  assert.doesNotMatch(sheet, /wl-sw-where"> · \{SWAP_COIN\[(pay\.place|get)\]|aria-hidden="true">▾</, "control: the wrapped phrase and the ▾ glyph (the list's one-line rows keep theirs)");
  assert.match(sheet, /<p className="zf-small wl-sw-arrives" data-testid="swap-arrives">\{route && !block \? arrivesWith\(/, "always rendered, so nothing jumps");
  assert.match(sheet, /\{who && <p className="zf-small wl-mv-foot" data-testid="swap-private">\{privateLine\(route\)\}<\/p>\}/);
  assert.doesNotMatch(sheet, /\{privateLine\(route\) && <p className="zf-small wl-sheet-lead">/, "control: the grey paragraph");
  // never a standing line; only once a press at $0 asked (a UI test, 4 Nov: $0 did nothing and said nothing)
  assert.match(sheet, /\{block && block !== floor\.under && \(block !== SWAP_WORDS\.amount \|\| tried\) && <p className="zf-small wl-mv-why"/);
  const css = readFileSync(new URL("./move-swap.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-sw-arrives \{ min-height: 40px;/);
  assert.match(css, /\.wl-swap-chips \.zf-chip\.wl-swap-all \{ height: 32px; padding: 0 12px; font: 600 15px\/20px var\(--font\); \}/, "Max is the same chip as the others");
});

test("finding 48: Swap says the fee whenever priced; what it can't pay with is simply not listed (drop, don't degrade)", () => {
  assert.equal(feesLine(3, { arrivesUsd: 2.87, feeUsd: 0.13 }), "About $0.13 of your $3 goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.equal(feesLine(3, { arrivesUsd: 3, feeUsd: 0 }), "Under a cent goes to NEAR Intents and the network. ZeroFee takes nothing.");
  assert.equal(feesLine(3, null), "Any fee goes to NEAR Intents and the network. ZeroFee takes nothing.", "control: no price yet, no figure said");
  // drop, don't degrade (QA's Sim walk, 5 Nov): what Swap can't pay with is not listed, never apologised for
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  const corridor = readFileSync(new URL("./swap-corridor.ts", import.meta.url), "utf8");
  for (const [name, src] of [["SwapSheet.tsx", sheet], ["swap-corridor.ts", corridor]] as const) {
    assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), /notSwappable|swap-not-here|can't use your Safe|can't use your private/, `${name}: no "can't use ... yet" line`);
  }
  assert.match(sheet, /why=\{coinWhy\(which\)\} onPick=/, "control: the picker is still drawn, with no foot line");
  assert.ok(!("notHere" in SWAP_WORDS) && !("privateNot" in SWAP_WORDS), "the words are gone too");
  // the copy review's ruling (5 Nov): an empty From list, one line
  assert.equal(SWAP_WORDS.nothing, "Nothing in your Safe can be swapped yet.");
  assert.match(sheet, /\{balances === null \? "Reading your money…" : SWAP_WORDS\.nothing\}<\/p>\n\s*<button className="zf-btn zf-btn--quiet wl-sheet-go" onClick=\{onClose\}>Close<\/button>/, "control: the empty sheet says that one line, then Close");
  assert.match(sheet, /data-testid="swap-go"[\s\S]{0,600}\{route && !block && <p className="zf-small wl-zerofee" data-testid="swap-fees">\{price\.fees\}<\/p>\}/, "who gets the fee, under the button, whenever a route is picked");
});

test("QA (5 Nov): each route's floor said once, plainly; no chip or Max under it; fees over 5 % said plainly before the tap", () => {
  assert.equal(floorOf({ kind: "home", from: "sol" }).line, SWAP_WORDS.leastToSafe);
  assert.deepEqual(floorOf({ kind: "move", from: "sol", to: "hood" }), { usd: PAIR_MIN_USD, line: SWAP_WORDS.leastPair, under: SWAP_WORDS.leastPair });
  assert.equal(floorOf({ kind: "home", from: "sol" }).usd, HOME_LEG_MIN_USD);
  assert.deepEqual(floorOf({ kind: "home", from: "near" }), { usd: 2, line: SWAP_WORDS.least, under: SWAP_WORDS.least }, "control: the NEAR wallet's floor is Swap's own");
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.equal(sheet.match(/data-testid="swap-floor"/g)?.length, 1, "said once");
  assert.match(sheet, /disabled=\{Number\(d\) > most \|\| Number\(d\) < floor\.usd\}/);
  assert.match(sheet, /disabled=\{most < floor\.usd\}/, "Max under the floor is never offered");
  assert.match(sheet, /data-testid="swap-floor">\{floorSay\(route, amount, !block \? price\.cost\?\.feeUsd \?\? null : null\)\}/, "the copy review's ruling: the floor's one line carries the quote's own fee, never a fee-size line; was: the size where it falls under, plainly, in the floor's one line (product decision, 5 Nov: never scary; S9)");
  assert.doesNotMatch(sheet, /data-testid="swap-fair"/, "never a second figure beside the floor (S9)");
  assert.doesNotMatch(sheet, /role: "alert" \} : \{\}\)\} data-testid="swap-fees"/, "control: the fee line is no alarm");
  assert.doesNotMatch(sheet, /HoldGo|onPointerDown/, "the tap IS the swap");
});
