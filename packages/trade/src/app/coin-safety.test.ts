import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coinSafety, CREATOR_KNOW_PCT, NOT_CHECKED, QUESTION, safetySummary, sellTrap, TOP10_KNOW_PCT, type CheckId, type SafetyInput } from "./coin-safety.ts";
import { pageRefusal } from "./coin-refusal.ts";
import type { ChainId } from "../types.ts";

const rowOf = (chain: ChainId, o: SafetyInput, id: CheckId) => {
  const r = coinSafety(chain, o).rows.find((x) => x.id === id);
  assert.ok(r, `no ${id} row on ${chain}`);
  return r;
};
const stateOf = (chain: ChainId, o: SafetyInput, id: CheckId) => rowOf(chain, o, id).state;

test("freeze (Solana): fine only on the chain's own read; to know on either read; not checked yet otherwise", () => {
  assert.equal(stateOf("sol", { mintClean: true }, "freeze"), "fine");
  assert.equal(stateOf("sol", { mintClean: true, detail: { security: { freezeAuthority: false } } }, "freeze"), "fine");
  // QA (3 Nov): the market's "no freeze" alone is never fine: before the chain's read lands, or when it fails, not checked yet
  assert.equal(stateOf("sol", { detail: { security: { freezeAuthority: false } } }, "freeze"), "unread", "chain read not landed");
  assert.equal(stateOf("sol", { mintClean: false, detail: { security: { freezeAuthority: false } } }, "freeze"), "unread", "chain read failed");
  assert.equal(rowOf("sol", { mintClean: false, detail: { security: { freezeAuthority: false } } }, "freeze").text, `${QUESTION.freeze} ${NOT_CHECKED}`);
  assert.equal(stateOf("sol", { mintClean: true, detail: { security: { freezeAuthority: true } } }, "freeze"), "know", "a warning is never hidden");
  assert.equal(stateOf("sol", { detail: { security: { freezeAuthority: true } } }, "freeze"), "know");
  assert.equal(stateOf("sol", { mint: "freezable" }, "freeze"), "know", "the node read alone is enough");
  assert.equal(stateOf("sol", { mint: "freezable", detail: { security: { freezeAuthority: false } } }, "freeze"), "know", "the chain's refusal beats the market's no");
  assert.equal(stateOf("sol", { mint: "pausable" }, "freeze"), "know");
  assert.equal(stateOf("sol", { mint: "delegated" }, "freeze"), "know");
  assert.equal(stateOf("sol", {}, "freeze"), "unread");
  assert.equal(rowOf("sol", {}, "freeze").text, "Can its maker freeze your coins? Not checked yet.");
  // control: the freeze row reads the freeze answer, not the mint authority beside it
  assert.equal(stateOf("sol", { detail: { security: { mintAuthority: true } } }, "freeze"), "unread");
  assert.equal(stateOf("sol", { detail: { security: { mintAuthority: false } } }, "freeze"), "unread");
  // control: a refusal that isn't a freeze (a transfer hook, a fee) leaves the freeze answer to the flag; the Sell test row says it
  assert.equal(stateOf("sol", { mint: "hooked", detail: { security: { freezeAuthority: true } } }, "freeze"), "know");
  assert.equal(stateOf("sol", { mint: "hooked", detail: { security: { freezeAuthority: false } } }, "freeze"), "unread");
});

test("new coins (Solana): fine, to know, not checked yet", () => {
  assert.equal(stateOf("sol", { detail: { security: { mintAuthority: false } } }, "mint"), "fine");
  assert.equal(stateOf("sol", { detail: { security: { mintAuthority: true } } }, "mint"), "know");
  assert.equal(stateOf("sol", { detail: {} }, "mint"), "unread");
  // control: the freeze answer never fills this row
  assert.equal(stateOf("sol", { mint: "freezable", detail: { security: { freezeAuthority: true } } }, "mint"), "unread");
});

test("owner (BNB Chain, Robinhood Chain): fine, to know, not checked yet; never on Solana", () => {
  for (const c of ["bsc", "hood"] as const) {
    assert.equal(stateOf(c, { checks: { owner: "none" } }, "owner"), "fine");
    assert.equal(stateOf(c, { checks: { owner: "held" } }, "owner"), "know");
    assert.equal(stateOf(c, { checks: { owner: "unknown" } }, "owner"), "unread");
    assert.equal(stateOf(c, {}, "owner"), "unread", "checks still running");
    // control: no Solana mint answer makes an EVM row
    assert.deepEqual(coinSafety(c, { mint: "freezable", detail: { security: { freezeAuthority: true, mintAuthority: true } } }).rows.map((r) => r.id), ["owner", "top10", "creator", "sell", "lock"]);
  }
  assert.deepEqual(coinSafety("sol", { checks: { owner: "held" } }).rows.map((r) => r.id), ["freeze", "mint", "top10", "creator", "sell", "lock"], "EVM checks never read on Solana");
});

test("top 10: a plain fact under the line (never counted fine), to know at it and over, not checked yet when missing or nonsense", () => {
  assert.equal(stateOf("sol", { detail: { top10Pct: 34 } }, "top10"), "fact");
  assert.equal(rowOf("sol", { detail: { top10Pct: 42.4 } }, "top10").text, "Top 10 wallets hold 42%.");
  assert.equal(stateOf("bsc", { detail: { top10Pct: TOP10_KNOW_PCT } }, "top10"), "know");
  assert.equal(stateOf("bsc", { detail: { top10Pct: TOP10_KNOW_PCT - 0.1 } }, "top10"), "fact", "control: just under the line");
  assert.equal(coinSafety("hood", { detail: { top10Pct: 5 } }).summary.includes("fine"), false, "a fact is never counted as fine");
  assert.match(rowOf("sol", { detail: { top10Pct: 0.3 } }, "top10").text, /less than 1%/);
  for (const bad of [undefined, NaN, -1, 140]) assert.equal(stateOf("sol", { detail: { top10Pct: bad } }, "top10"), "unread", String(bad));
});

test("creator: a plain fact under 20 %, to know at it and over, not checked yet when missing", () => {
  assert.equal(stateOf("sol", { detail: { devPct: 4 } }, "creator"), "fact");
  assert.equal(rowOf("sol", { detail: { devPct: 4.2 } }, "creator").text, "Its creator holds 4%.");
  assert.equal(stateOf("bsc", { detail: { devPct: CREATOR_KNOW_PCT } }, "creator"), "know");
  assert.equal(stateOf("bsc", { detail: { devPct: CREATOR_KNOW_PCT - 0.1 } }, "creator"), "fact", "control: just under the line");
  assert.match(rowOf("sol", { detail: { devPct: 0.4 } }, "creator").text, /less than 1%/);
  for (const bad of [undefined, NaN, -3, 101]) assert.equal(stateOf("hood", { detail: { devPct: bad } }, "creator"), "unread", String(bad));
  // control: the creator row reads the creator's share, not the top 10's
  assert.equal(stateOf("sol", { detail: { top10Pct: 90 } }, "creator"), "unread");
});

test("sell test: our own simulated sale first, the market's flag next, else not checked yet", () => {
  assert.equal(stateOf("bsc", { checks: { sell: "passes" } }, "sell"), "fine");
  assert.equal(stateOf("hood", { checks: { sell: "fails", cantSell: true } }, "sell"), "know");
  assert.equal(stateOf("bsc", { checks: { sell: "unknown" } }, "sell"), "unread");
  assert.equal(stateOf("bsc", {}, "sell"), "unread");
  assert.equal(stateOf("sol", { detail: { honeypot: true } }, "sell"), "know");
  assert.equal(stateOf("bsc", { checks: { sell: "passes" }, detail: { honeypot: true } }, "sell"), "know", "a warning is never hidden by a pass");
  assert.equal(stateOf("sol", {}, "sell"), "unread", "Solana's sale test runs inside Buy, not on the page");
  // Solana: every refusal Buy gives shows as something to know (security review M1: a hook or a fee was "fine" before)
  for (const m of ["hooked", "fee-raisable", "fee-high"] as const) assert.equal(stateOf("sol", { mint: m }, "sell"), "know", m);
  for (const m of ["freezable", "pausable", "delegated", "hooked", "fee-raisable", "fee-high"] as const) {
    assert.ok(coinSafety("sol", { mint: m, detail: { security: { freezeAuthority: false, mintAuthority: false }, top10Pct: 5 } }).rows.some((r) => r.state === "know"), `${m}: a refused coin is never all fine`);
  }
  assert.equal(stateOf("sol", { mint: "some-new-power" as never }, "sell"), "know", "a refusal not listed yet still says something");
  assert.equal(stateOf("sol", { mint: "freezable" }, "sell"), "unread", "control: a freeze is the Freeze row's, said once");
  // control: an EVM sell answer handed in on Solana is never read
  assert.equal(stateOf("sol", { checks: { sell: "passes" } }, "sell"), "unread");
  assert.equal(stateOf("sol", { checks: { sell: "fails", cantSell: true } }, "sell"), "unread");
});

test("pool lock: Trade has no read of it, so it always says not checked yet", () => {
  for (const c of ["sol", "bsc", "hood", "near"] as const) {
    const everything: SafetyInput = { detail: { security: { freezeAuthority: false, mintAuthority: false }, top10Pct: 10 }, checks: { owner: "none", sell: "passes" } };
    assert.equal(stateOf(c, everything, "lock"), "unread");
    assert.equal(rowOf(c, everything, "lock").text, "Can its maker pull the cash out? Not checked yet.");
  }
});

test("NEAR: no checks of its own, every row says so", () => {
  const s = coinSafety("near", { detail: { security: { freezeAuthority: false } }, checks: { owner: "none", sell: "passes" } });
  assert.deepEqual(s.rows.map((r) => [r.id, r.state]), [["freeze", "unread"], ["mint", "unread"], ["top10", "unread"], ["creator", "unread"], ["sell", "unread"], ["lock", "unread"]]);
  assert.equal(s.summary, "4 not checked yet", "the card counts its 4 checks; the facts are said in More");
  assert.deepEqual(s.card.map((r) => r.id), ["freeze", "mint", "sell", "lock"]);
  assert.deepEqual(s.facts.map((r) => r.id), ["top10", "creator"]);
});

test("the summary line counts, fine first", () => {
  const s = coinSafety("bsc", { detail: { top10Pct: 82 }, checks: { owner: "none", sell: "passes" } });
  assert.equal(s.summary, "2 fine · 1 to know · 1 not checked yet", "the 82% top 10 is a warning, so it's on the card; the creator's unknown share is in More");
  assert.deepEqual(s.card.map((r) => r.id), ["owner", "top10", "sell", "lock"], "a fact to know stays on the card");
  const plain = coinSafety("sol", { mintClean: true, detail: { security: { freezeAuthority: false, mintAuthority: false }, top10Pct: 12, devPct: 3, honeypot: true } });
  assert.equal(plain.summary, "2 fine · 1 to know · 1 not checked yet", "two plain facts, said in More, not counted");
  assert.deepEqual(plain.facts.map((r) => [r.id, r.state]), [["top10", "fact"], ["creator", "fact"]]);
  assert.equal(safetySummary([{ id: "sell", label: "x", state: "fine", text: "" }]), "1 fine");
  assert.equal(coinSafety("sol", {}).summary, "4 not checked yet", "nothing read yet: nothing claimed");
  // control: the summary counts exactly the card's rows, whatever they are
  for (const [c, o] of [["sol", {}], ["bsc", { detail: { top10Pct: 82 }, checks: { owner: "none", sell: "passes" } }], ["near", {}]] as [ChainId, SafetyInput][]) {
    const x = coinSafety(c, o);
    assert.equal(x.summary, safetySummary(x.card));
    assert.equal(x.card.length + x.facts.length, x.rows.length, "every row is said somewhere");
  }
});

test("words: plain, one sentence each, nothing promised, never the coin's own name", () => {
  const inputs: [ChainId, SafetyInput][] = [
    ["sol", {}], ["sol", { mint: "freezable", detail: { security: { mintAuthority: true }, top10Pct: 90, honeypot: true } }],
    ["sol", { mint: "delegated" }], ["sol", { mint: "pausable" }], ["sol", { detail: { security: { freezeAuthority: false, mintAuthority: false }, top10Pct: 5 } }],
    ["bsc", { checks: { owner: "held", sell: "fails", cantSell: true } }], ["hood", { checks: { owner: "none", sell: "passes" } }], ["near", {}],
  ];
  for (const [c, o] of inputs) {
    for (const r of coinSafety(c, o).rows) {
      assert.doesNotMatch(`${r.label} ${r.text}`, /\bsafe\b|guarantee|risk-free|recommend|liquidity|private|spending|honeypot|authority|\bmint\b|0x|https?:/i, r.text);
      assert.match(r.text, /^[A-Z].*\.$/, `a sentence: ${r.text}`);
    }
  }
  // a scam coin's own text: the card's answer is the same whatever the coin calls itself, and never says it
  const named = (name: string) => ({ security: { freezeAuthority: true }, top10Pct: 40, symbol: name, name } as SafetyInput["detail"]);
  const a = coinSafety("sol", { detail: named("SAFE") }), b = coinSafety("sol", { detail: named("RUG") });
  assert.deepEqual(a, b);
  assert.doesNotMatch(JSON.stringify(a), /SAFE|RUG/);
});

test("display only: the card never blocks or allows a buy; pageRefusal alone decides, unchanged", () => {
  const cases: [ChainId, SafetyInput & { freezeFlag?: boolean }][] = [
    ["sol", {}], ["sol", { mint: "freezable" }], ["sol", { mint: "hooked" }], ["sol", { mint: "fee-high" }],
    ["sol", { detail: { security: { freezeAuthority: true } } }], ["sol", { detail: { honeypot: true, top10Pct: 99, security: { mintAuthority: true } } }],
    ["bsc", { checks: { owner: "held", sell: "passes" }, detail: { top10Pct: 95, honeypot: true } }], ["bsc", { checks: { owner: "none", sell: "fails", cantSell: true } }],
    ["hood", { checks: { owner: "unknown", sell: "unknown" } }], ["near", { detail: { honeypot: true } }],
  ];
  for (const [chain, o] of cases) {
    const refusal = () => pageRefusal(chain, { mint: o.mint, freezeFlag: o.detail?.security?.freezeAuthority === true, ...(o.checks ? { checks: { level: "ok", notes: [], ...o.checks } } : {}) });
    const before = refusal();
    coinSafety(chain, o);
    assert.equal(refusal(), before, "drawing the card changes nothing Buy reads");
  }
  // a card full of things to know keeps Buy (the market's flag, an owner, a top-heavy coin: warnings, not refusals) ...
  const warned = coinSafety("bsc", { checks: { owner: "held", sell: "passes" }, detail: { top10Pct: 95, honeypot: true } });
  assert.ok(warned.rows.filter((r) => r.state === "know").length >= 3);
  assert.equal(pageRefusal("bsc", { checks: { level: "warn", notes: [], owner: "held", sell: "passes" } }), undefined);
  // ... and today's refusals need no card at all (control: the card is not what refuses)
  assert.equal(pageRefusal("sol", { mint: "hooked" }), "hooked");
  assert.equal(pageRefusal("sol", { freezeFlag: true }), "freezable");
  // the gate's own source never reads the card, and the coin page's Buy decision is pageRefusal's
  const gate = readFileSync(new URL("./coin-refusal.ts", import.meta.url), "utf8");
  assert.doesNotMatch(gate, /coin-safety|coinSafety/);
  const page = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  const noLine = page.split("\n").find((l) => /const no = /.test(l)) ?? "";
  assert.match(noLine, /const no = pageRefusal\(/);
  assert.doesNotMatch(noLine, /safety/i);
});

/** The calls a file makes on `market.` (the coin page's reads), and whether it reaches the network by itself. */
const marketCalls = (src: string) => [...new Set([...src.matchAll(/\bmarket\.(\w+)/g)].map((m) => m[1]))].sort();
const reachesOut = (src: string) => /\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource|sendBeacon|import\(/.test(src);

test("no new host: the card's module asks nothing, and the coin page reads what it read before", () => {
  const mod = readFileSync(new URL("./coin-safety.ts", import.meta.url), "utf8");
  assert.equal(reachesOut(mod), false);
  for (const m of mod.matchAll(/^import\s+(.*)$/gm)) assert.match(m[1]!, /^type\s/, `type-only import: ${m[0]}`);
  // the coin page's market reads, the same set as before T-3: its coin and candles through runtime.tsx's paint-first hooks
  // (D145: useCoinDetail / useCoinChart read market.coin / market.candles, painted from the device first), the live price
  // and trades, and the checks
  const page = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.deepEqual(marketCalls(page), ["checks", "livePrice", "liveTrades", "recorded", "trades"]);
  assert.match(page, /useCoinDetail\(seed\.chain, seed\.address\)/);
  assert.match(page, /useCoinChart\(seed\.chain, seed\.address, range\)/);
  const hooks = readFileSync(new URL("../market/paint.ts", import.meta.url), "utf8");
  assert.deepEqual(marketCalls(hooks).filter((m) => m === "coin" || m === "candles"), ["candles", "coin"], "the hooks read the same two market methods");
  assert.equal(/\bfetch\s*\(|new WebSocket|XMLHttpRequest/.test(hooks), false);
  assert.equal(/\bfetch\s*\(|new WebSocket|XMLHttpRequest/.test(page), false);
  assert.doesNotMatch(page, /goplus|rugcheck|honeypot\.is|birdeye|dexscreener/i);
  // controls: the detectors can fire
  assert.deepEqual(marketCalls(`${page}\nmarket.safetyScan(a)`), ["checks", "livePrice", "liveTrades", "recorded", "safetyScan", "trades"]);
  assert.equal(reachesOut(`${mod}\nfetch("https://api.gopluslabs.io/")`), true);
});

test("a coin people couldn't sell back leads with its sell check's words; a clean or unread check says nothing first (UX audit 4 Nov; controls)", () => {
  const row = (state: "fine" | "know" | "unread", text = "Recent buyers couldn't sell it. That is a common trap.") => ({ id: "sell" as const, label: "Sell test", state, text });
  assert.equal(sellTrap([row("know")]), "Recent buyers couldn't sell it. That is a common trap.");
  assert.equal(sellTrap([row("fine", "Recent holders could sell it.")]), undefined, "control: a sell that passes");
  assert.equal(sellTrap([row("unread", "Not checked yet.")]), undefined, "control: not checked yet");
  assert.equal(sellTrap([{ id: "top10", label: "Top 10", state: "know", text: "The top 10 hold 80%." }]), undefined, "control: another check to know isn't a trap");
  const page = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf('className="cp-trap"') < page.indexOf('className="tr-price"'), "the warning comes before the price");
});
