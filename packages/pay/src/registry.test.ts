import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, NETWORK_WORDS, NO_ID_LINES, REGISTRY, fundable, lastChecked, shown, simple, statesNetwork, verifiedOf } from "./registry.ts";
import { VERIFIED } from "./verified.ts";
import { PROVIDERS } from "./countries.ts";
import { chain } from "./chains.ts";

test("RECIPES §1/§4: one recipe per provider, bound to its exact domain; every claim has a source; never an address", () => {
  assert.equal(new Set(REGISTRY.map((r) => r.id)).size, REGISTRY.length);
  for (const r of REGISTRY) {
    assert.match(r.domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${r.id}: an exact host`);
    assert.ok(!r.domain.startsWith("xn--") && !r.domain.includes(".xn--"), `${r.id}: never punycode`);
    assert.equal(new URL(r.signup.url).hostname, r.domain, `${r.id}: its sign-up is on its own domain`);
    assert.ok(r.source.length > 0 && r.source.every((u) => u.startsWith("https://")), `${r.id}: sourced`);
    assert.ok(!/0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/.test(JSON.stringify({ ...r, source: [] })), `${r.id}: no address anywhere in the recipe`);
    for (const c of r.funding.coins) for (const n of c.networks) assert.ok(chain(n), `${r.id}: ${n} is a network Pay knows`);
    const site = (h: string) => h.split(".").slice(-2).join(".");
    if (r.refund) assert.equal(site(new URL(r.refund).hostname), site(r.domain), `${r.id}: its refund page is on its own domain`);
    if (r.kind === "voucher") assert.ok(r.refund, `${r.id}: a checkout shop links its refund page (Security d)`);
  }
});

test("only green shows; a research note (Peer) never does; Pay never sends where the coin and network are unknown", () => {
  assert.ok(REGISTRY.some((r) => r.id === "peer" && !shown(r)));
  assert.ok(!PROVIDERS.some((p) => p.id === "peer"));
  for (const id of ["solcard", "redotpay", "bleap"]) assert.equal(fundable(REGISTRY.find((r) => r.id === id)!), false, `${id}: its own page doesn't say its coin and network`);
  assert.ok(fundable(REGISTRY.find((r) => r.id === "bitrefill")!) && fundable(REGISTRY.find((r) => r.id === "etherfi-cash")!));
});

test("SolCard is listed as what it is, in its own words, with Security's no-ID lines (D38, RECIPES §4b.7)", () => {
  const s = REGISTRY.find((r) => r.id === "solcard")!;
  assert.equal(s.kind, "card");
  for (const line of NO_ID_LINES) assert.ok(s.facts.includes(line));
  assert.ok(s.facts.some((f) => /suspend/.test(f)) && s.facts.some((f) => /SC Payments Ltd/.test(f)));
  // Its dormancy charge is a cost, so it shows before the pill (Security's SHOULD on 1ea4d90).
  assert.deepEqual(s.fees, [
    { says: "Top-ups cost 5%, plus $10 for each new card.", by: "itself" },
    { says: "After 90 days unused, it may take 10% a month of what's left.", by: "itself" },
  ]);
});

test("RECIPES §2/§3: the verifier's result decides: red or changed hides, and so does a run older than 7 days", () => {
  const bitrefill = REGISTRY.find((r) => r.id === "bitrefill")!;
  const saved = VERIFIED.bitrefill;
  try {
    VERIFIED.bitrefill = { at: new Date().toISOString(), by: "test", result: "green" };
    assert.equal(shown(bitrefill), true);
    VERIFIED.bitrefill = { at: new Date().toISOString(), by: "test", result: "changed", why: "no longer says usdc_base" };
    assert.equal(shown(bitrefill), false, "changed hides");
    VERIFIED.bitrefill = { at: new Date().toISOString(), by: "test", result: "red", why: "a bot wall" };
    assert.equal(shown(bitrefill), false, "red hides");
    // RECIPES §2 amended: never empties itself; 7–30 days shows with "Last checked N days ago"; older hides.
    VERIFIED.bitrefill = { at: "2026-10-01T00:00:00Z", by: "test", result: "green" };
    const at = (d: string) => Date.parse(d);
    assert.equal(shown(bitrefill, at("2026-10-07T00:00:00Z")), true);
    assert.equal(lastChecked(bitrefill, at("2026-10-07T00:00:00Z")), null, "6 days: no line");
    assert.equal(shown(bitrefill, at("2026-10-11T00:00:00Z")), true, "10 days: still shown");
    assert.equal(lastChecked(bitrefill, at("2026-10-11T00:00:00Z")), "Last checked 10 days ago");
    assert.equal(shown(bitrefill, at("2026-10-31T00:00:00Z")), true, "30 days: still shown");
    assert.equal(shown(bitrefill, at("2026-11-01T00:00:00Z")), false, "31 days: hidden");
    assert.equal(lastChecked(bitrefill, at("2026-11-01T00:00:00Z")), null);
    assert.equal(verifiedOf(REGISTRY.find((r) => r.id === "peer")!).result, "research", "a research note stays one");
  } finally {
    if (saved) VERIFIED.bitrefill = saved;
    else delete VERIFIED.bitrefill;
  }
});

test("Security's MUST (e9fcc17): every recipe Pay sends to names its own page stating the coin and each network", () => {
  const site = (h: string) => h.split(".").slice(-2).join(".");
  const PINNED: Record<string, string[]> = { "etherfi-cash": ["etherfi.gitbook.io"] };
  for (const r of REGISTRY.filter((x) => fundable(x) && x.kind !== "rail")) {
    const stated = r.funding.stated;
    if (r.id === "pexx") {
      assert.equal(stated, undefined, "PEXX: no page of its own on record that states its networks, so the verifier keeps it hidden");
      continue;
    }
    assert.ok(stated, `${r.id}: a page that states its coin and networks`);
    assert.ok(r.source.includes(stated!), `${r.id}: that page is one of its sources`);
    const host = new URL(stated!).hostname;
    assert.ok(site(host) === site(r.domain) || (PINNED[r.id] ?? []).includes(host), `${r.id}: on its own domain`);
    for (const c of r.funding.coins) for (const n of c.networks) assert.ok(NETWORK_WORDS[n], `${r.id}: how ${n} is written is known`);
  }
  // site() takes the last two labels: no recipe may sit under a two-part public suffix (Security, not blocking).
  for (const r of REGISTRY) assert.ok(!/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(r.domain), `${r.id}: not under a two-part suffix`);
});

test("Security's MUST (67a357d): a network counts only as a whole word, case as written", () => {
  assert.equal(statesNetwork("Based on our database, Coinbase charges a base fee.", "base"), false);
  assert.equal(statesNetwork("A splash of display text.", "sol"), false);
  assert.equal(statesNetwork("Nearly linear growth, near the top.", "near"), false);
  assert.equal(statesNetwork("Deposit USDC on Base.", "base"), true);
  assert.equal(statesNetwork("BASE network", "base"), true);
  assert.equal(statesNetwork('{"method":"usdc_base"}', "base"), true);
  assert.equal(statesNetwork("USDC (SPL token)", "sol"), true);
  assert.equal(statesNetwork("USDC on ERC-20", "eth"), true);
  assert.equal(statesNetwork("Arbitrum", "zz"), false);
});

test("product decision (27 Oct): a provider is listed only with its own steps on record, 4 or fewer", () => {
  assert.equal(MAX_STEPS, 4);
  const r = (id: string) => REGISTRY.find((x) => x.id === id)!;
  assert.equal(simple(r("redotpay")), false, "RedotPay: app, account, ID check, card fee, apply = 5");
  assert.equal(shown(r("redotpay")), false);
  for (const id of ["etherfi-cash", "metamask-card", "bleap", "solcard", "mt-pelerin", "bitrefill", "kraken", "binance-th", "coins-ph", "indodax", "binance-br", "paribu"]) assert.equal(simple(r(id)), true, id);
  assert.equal(simple({ ...r("etherfi-cash"), steps: undefined }), false, "no steps on record: not listed");
  assert.equal(simple({ ...r("etherfi-cash"), steps: [] }), false);
  for (const x of REGISTRY.filter((y) => shown(y))) assert.ok(x.steps!.length >= 1 && x.steps!.length <= MAX_STEPS, `${x.id}: 1–4 steps`);
  assert.equal(r("bitrefill").identity, "none", "Bitrefill: no account, no ID check");
  assert.equal(r("solcard").identity, "some", "SolCard: its virtual card needs only an email");
});
