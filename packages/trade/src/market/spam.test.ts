// The spam filter's verdicts (spam.ts), ported from the earlier module with its numbers. Real coins from 21 Oct 2026 must SHOW (the false-positive control: a filter
// that hid them would be worse than no filter); the shapes of spam must HIDE, each with its one plain reason; an incomplete answer is never a negative.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { baitName, classify, copyReason, factsOfPool, fold, plain, reasonText, type CoinFacts, type Verdict } from "./spam.ts";
import { LABEL_MAX, cleanLabel, poolView } from "./map.ts";

const ok = { quote: "ok", info: "ok", pools: "ok", holders: "ok" } as const;
const pool = (reserveUsd: number, buyers: number, sellers: number) => ({ reserveUsd, buys: buyers * 2, sells: sellers * 2, buyers, sellers });
const hidden = (v: Verdict) => (v.show ? undefined : v.reason);

// Our own featured coin as the market data answered on 21 Oct 2026 (Solana): 512 holders, top 10 own 35 %, one pool with ~$33.8k, freeze and mint authority off.
const ZEROFEE: CoinFacts = { chain: "sol", address: "ErvkxE8gc7EwmaQfvoGfVfcDJbVG4EcHQr3yweTkpump", state: ok, name: "ZeroFee", symbol: "ZeroFee", holders: 512, top10Pct: 35.39, freezeAuthority: false, mintAuthority: false, liquidityUsd: 33_797, pools: [pool(33_797, 60, 40)] };
// TST on BNB Chain: 47,443 holders, top 10 own 93 %, but the top holders are Binance cold wallets and the burn address.
const TST: CoinFacts = {
  chain: "bsc", address: "0x86Bb94DdD16Efc8bc58e6b056e8df71D9e666429", state: ok, name: "Test", symbol: "TST", holders: 47_443, top10Pct: 93.3, liquidityUsd: 800_000, pools: [pool(800_000, 12, 9)],
  top: [
    { address: "0xf977814e90da44bfa03b6295a0616a897441acec", pct: 65.17, label: "Cold Wallet" }, { address: "0x5a52e96bacdabb82fd05763e25335261b270efcb", pct: 7.46, label: "Cold Wallet" },
    { address: "0x000000000000000000000000000000000000dead", pct: 6.76, label: null }, { address: "0x1111111111111111111111111111111111111111", pct: 2.1, label: null },
  ],
};

describe("real coins show (false-positive control)", () => {
  it("our ZeroFee coin shows", () => assert.deepEqual(classify({ chain: "sol", address: ZEROFEE.address, symbol: "ZeroFee" }, ZEROFEE), { show: true, why: "organic" }));
  it("TST shows: its 93 % top 10 are exchange cold wallets and the burn address, not one owner", () => assert.equal(classify({ chain: "bsc", address: TST.address, symbol: "TST" }, TST).show, true));
  it("TST shows with no holder list at all (the list needs a key): the one-entity rule cannot decide alone", () => assert.equal(classify({ chain: "bsc", address: TST.address, symbol: "TST" }, { ...TST, top: undefined }).show, true));
  it("real USDT on BNB Chain shows with no market read at all", () => assert.deepEqual(classify({ chain: "bsc", address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" }, undefined), { show: true, why: "stable" }));
  it("a coin this wallet bought shows whatever the facts say (even a honeypot flag)", () => assert.deepEqual(classify({ chain: "sol", address: "x", symbol: "X" }, { ...ZEROFEE, address: "x", honeypot: true }, { bought: true }), { show: true, why: "bought" }));
  it("a coin the person chose to show shows", () => assert.deepEqual(classify({ chain: "sol", address: "x", symbol: "X" }, undefined, { shown: true }), { show: true, why: "override" }));
});

describe("spam hides, each with one plain reason", () => {
  it("a fake USDT on BNB Chain (famous symbol, wrong contract) is a copy before any market read", () => {
    const v = classify({ chain: "bsc", address: "0x00000000000000000000000000000000deadbeef", symbol: "USDT" }, undefined);
    assert.equal(hidden(v), "copycat");
    assert.equal(reasonText(v), "Copies a known coin");
  });
  it("a link in the name is a copy", () => assert.equal(hidden(classify({ chain: "bsc", address: "0xabc0000000000000000000000000000000000001", symbol: "VISIT", name: "https://claim-bnb.xyz" }, undefined)), "copycat"));
  it("unknown to the market: no market", () => assert.equal(hidden(classify({ chain: "bsc", address: "0x1", symbol: "AAA" }, { chain: "bsc", address: "0x1", state: { quote: "none", info: "none", pools: "none", holders: "none" } })), "no-market"));
  it("a pool with $200 in it: no market", () => assert.equal(hidden(classify({ chain: "sol", address: "y", symbol: "Y" }, { ...ZEROFEE, address: "y", liquidityUsd: 200, pools: [pool(200, 40, 30)] })), "no-market"));
  it("a honeypot flag: can't be sold", () => assert.equal(reasonText(classify({ chain: "bsc", address: "0x2", symbol: "HP" }, { ...TST, address: "0x2", honeypot: true })), "Can't be sold"));
  it("Solana freeze authority on: can't be sold", () => assert.equal(hidden(classify({ chain: "sol", address: "z", symbol: "Z" }, { ...ZEROFEE, address: "z", freezeAuthority: true })), "cant-sell"));
  it("one wallet owns most of it and almost nobody trades it: one entity (when the holder list is known)", () => {
    const f: CoinFacts = { chain: "bsc", address: "0x3", state: ok, symbol: "PUMP", holders: 900, top10Pct: 92, liquidityUsd: 5_000, pools: [pool(5_000, 4, 1)], top: [{ address: "0x9999999999999999999999999999999999999999", pct: 88, label: null }] };
    assert.equal(reasonText(classify({ chain: "bsc", address: "0x3", symbol: "PUMP" }, f)), "One holder owns most of it");
  });
  it("12 holders: few real holders", () => assert.equal(reasonText(classify({ chain: "sol", address: "w", symbol: "W" }, { ...ZEROFEE, address: "w", holders: 12 })), "Few real holders"));
  it("3 wallets traded it in 24 hours: inorganic", () => assert.equal(hidden(classify({ chain: "sol", address: "v", symbol: "V" }, { ...ZEROFEE, address: "v", holders: undefined, pools: [pool(20_000, 2, 1)] })), "inorganic"));
  it("many buyers and only one wallet that ever sells: inorganic", () => assert.equal(hidden(classify({ chain: "sol", address: "u", symbol: "U" }, { ...ZEROFEE, address: "u", pools: [{ reserveUsd: 20_000, buys: 80, sells: 30, buyers: 40, sellers: 1 }] })), "inorganic"));
  it("a claim-style name with no crowd is hidden; with a real crowd it shows", () => {
    const f = { ...ZEROFEE, address: "c", symbol: "CLAIM", name: "Claim Reward", holders: 200, pools: [pool(20_000, 40, 30)] };
    assert.equal(hidden(classify({ chain: "sol", address: "c", symbol: "CLAIM", name: "Claim Reward" }, f)), "copycat");
    const crowd = { ...f, holders: 5_000, liquidityUsd: 90_000, pools: [pool(90_000, 400, 300)] };
    assert.equal(classify({ chain: "sol", address: "c", symbol: "CLAIM", name: "Claim Reward" }, crowd).show, true);
  });
});

describe("an incomplete answer is never a negative", () => {
  it("no facts yet: Checking…, not spam", () => {
    const v = classify({ chain: "sol", address: "q", symbol: "Q" }, undefined);
    assert.deepEqual(v, { show: false, reason: "checking" });
    assert.equal(reasonText(v), "Checking…");
  });
  it("info and pools could not be read: Checking…, never a verdict", () => assert.deepEqual(classify({ chain: "sol", address: "q", symbol: "Q" }, { ...ZEROFEE, address: "q", state: { quote: "ok", info: "failed", pools: "failed", holders: "failed" } }), { show: false, reason: "checking" }));
  it("a row from a list with no crowd numbers is not read as 'no one trades it'", () => {
    const f = factsOfPool({ chain: "sol", coin: { address: "r", symbol: "R", name: "Rowcoin", listed: false }, pool: "p", liquidityUsd: 50_000 });
    assert.equal(classify({ chain: "sol", address: "r", symbol: "R", name: "Rowcoin" }, f).show, true);
  });
  it("no reason text uses a forbidden word", () => {
    for (const r of ["no-market", "cant-sell", "one-entity", "few-holders", "inorganic", "copycat", "checking"] as const) {
      const t = reasonText(r === "checking" ? { show: false, reason: r } : { show: false, reason: r, detail: "" });
      assert.doesNotMatch(t, /stuck|failed|error|try again|safe|guaranteed|unhackable/i);
    }
  });
});

// ---- invisible characters and lookalike letters can no longer dress a copy up as a different symbol (22 Oct audit) ----
describe("a copy of USDC with an invisible character or a lookalike letter is still a copy", () => {
  const FAKE = "0x00000000000000000000000000000000deadbeef";
  const REAL_USDC_BSC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const cases: [string, string][] = [
    ["U+202E (RLO)", "USDC‮"], ["U+202E inside", "US‮DC"], ["U+2066 (LRI)", "⁦USDC"], ["U+00AD (soft hyphen)", "US­DC"], ["U+034F (grapheme joiner)", "USD͏C"],
    ["U+180E (Mongolian vowel separator)", "US᠎DC"], ["U+2064 (invisible plus)", "USDC⁤"], ["Cyrillic С", "USDС"], ["Cyrillic Ѕ and С together", "UЅDС"],
    ["a combining accent", "USDĆ"], ["full-width", "ＵＳＤＣ"], ["all at once", "⁦U­S͏D᠎С⁤‮"],
  ];
  for (const [label, sym] of cases) {
    it(`${label}: on a wrong contract it is hidden as a copy, in the symbol and in the name`, () => {
      assert.equal(hidden(classify({ chain: "bsc", address: FAKE, symbol: sym }, undefined)), "copycat");
      assert.equal(plain(sym), "usdc");
      assert.equal(copyReason({ chain: "bsc", address: FAKE, symbol: sym })?.why, "famous");
      assert.equal(hidden(classify({ chain: "bsc", address: FAKE, symbol: "TST", name: sym }, undefined)), "copycat");
    });
    it(`${label}: the real contract still shows (the address decides, not the letters)`, () => assert.deepEqual(classify({ chain: "bsc", address: REAL_USDC_BSC, symbol: sym }, undefined), { show: true, why: "stable" }));
  }
  it("a famous symbol hidden inside a longer one stays caught", () => {
    assert.equal(copyReason({ chain: "bsc", address: FAKE, symbol: "USDС-TRC20" })?.why, "famous");
    assert.equal(copyReason({ chain: "bsc", address: FAKE, symbol: "US​DT⁤.e" })?.why, "famous");
  });
  it("a link or claim-bait word with an invisible character in it is still seen", () => {
    assert.equal(copyReason({ chain: "bsc", address: FAKE, symbol: "X", name: "h­ttps://claim-bnb.xyz" })?.why, "url");
    assert.equal(baitName({ chain: "bsc", address: FAKE, symbol: "CLA⁤IM" }), true);
  });
  it("control: honest names are untouched", () => {
    for (const sym of ["TST", "ZeroFee", "Ελλάδα", "Привет", "狗币", "PEPE🐸", "USDCAT", "SUSDC"]) assert.equal(copyReason({ chain: "bsc", address: FAKE, symbol: sym, name: sym }), undefined, sym);
    assert.notEqual(fold("Привет"), "Привет");
  });
});

describe("provider-supplied names and symbols are cleaned and capped (map.ts)", () => {
  it("cleanLabel strips every format and control character, collapses spaces and caps at 32 characters", () => {
    assert.equal(cleanLabel("US‮DC⁦­͏᠎⁤"), "USDC͏");
    assert.equal(cleanLabel("  A \n\t B​  "), "A B");
    assert.equal(cleanLabel(undefined), "");
    assert.equal(cleanLabel(null), "");
    assert.equal(cleanLabel("X".repeat(300)).length, LABEL_MAX);
    assert.equal(Array.from(cleanLabel("🐸".repeat(100))).length, LABEL_MAX);
  });
  it("poolView cleans the coin's name and symbol and falls back to the pool name when the token's own is nothing but invisible characters", () => {
    const tokens = new Map<string, any>([
      ["bsc_0x00000000000000000000000000000000000000aa", { address: "0x00000000000000000000000000000000000000aa", name: "‮Evil".padEnd(80, "n"), symbol: "U⁦SD­C", decimals: 18 }],
      ["bsc_0x00000000000000000000000000000000000000bb", { address: "0x00000000000000000000000000000000000000bb", name: "Q", symbol: "​⁤", decimals: 18 }],
    ]);
    const p = { id: "bsc_0x00000000000000000000000000000000000000cc", type: "pool", attributes: { address: "0x00000000000000000000000000000000000000cc", name: "FALL / BACK 0.3%", base_token_price_usd: "0.5", quote_token_price_usd: "1", reserve_in_usd: "1000" },
      relationships: { base_token: { data: { id: "bsc_0x00000000000000000000000000000000000000aa" } }, quote_token: { data: { id: "bsc_0x00000000000000000000000000000000000000bb" } }, dex: { data: { id: "pancakeswap" } } } };
    const v = poolView("bsc", p as never, tokens)!;
    assert.equal(v.coin.symbol, "USDC");
    assert.ok(v.coin.name.length <= LABEL_MAX);
    assert.doesNotMatch(v.coin.name, /‮/);
    assert.equal(v.quote.symbol, "BACK");
    assert.equal(hidden(classify({ chain: "bsc", address: v.coin.address, symbol: v.coin.symbol, name: v.coin.name }, undefined)), "copycat");
  });
});

// re-check (5 Nov): "Hoot Test 4 (DO NOT SNIPE)" showed on NEAR's Hot list. A name that says not to buy it is a test coin:
// never in a list, whatever its market. "Test" alone is no flag (TST on BNB Chain is called Test).
describe("test coins: a name that says not to buy it", () => {
  const HOOT = { chain: "near" as const, address: "hoot-test-4.launchpad.justhoot.near", symbol: "HTEST4", name: "Hoot Test 4 (DO NOT SNIPE)" };
  const market = { ...ZEROFEE, address: HOOT.address, chain: "sol" as const, symbol: HOOT.symbol, name: HOOT.name, listed: true, holders: 5_000, liquidityUsd: 80_000, pools: [pool(80_000, 60, 40)] };
  it("DO NOT SNIPE / don't buy: hidden even with a market and a listing (control: the same facts, a plain name, shows)", () => {
    assert.equal(hidden(classify(HOOT, market)), "no-market");
    assert.equal(hidden(classify({ ...HOOT, name: "Don't buy this" }, { ...market, name: "Don't buy this" })), "no-market");
    assert.equal(hidden(classify({ ...HOOT, name: "dont snipe" }, { ...market, name: "dont snipe" })), "no-market");
    assert.equal(classify({ ...HOOT, symbol: "HOOT", name: "Hoot" }, { ...market, symbol: "HOOT", name: "Hoot" }).show, true, "control");
  });
  it("a person who bought it or chose it still sees it", () => {
    assert.equal(classify(HOOT, market, { bought: true }).show, true);
    assert.equal(classify(HOOT, market, { shown: true }).show, true);
  });
  it("control: \"Test\" alone is no flag (TST, named Test, shows; \"Do it\" is not \"do not\")", () => {
    assert.equal(classify({ chain: "bsc", address: TST.address, symbol: "TST", name: "Test" }, TST).show, true);
    assert.equal(classify({ ...HOOT, name: "Do it, buy" }, { ...market, name: "Do it, buy" }).show, true);
  });
});
