import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COUNTRIES, ELSEWHERE, PROVIDERS, costLines, countryFor, countryName, groupsFor, offersFor } from "./countries.ts";
import { REGISTRY, shown } from "./registry.ts";
import { chain } from "./chains.ts";
import { presetFor } from "./partners/exchange.ts";

test("every row names only providers of its own section, once; codes are unique", () => {
  const codes = [...COUNTRIES, ELSEWHERE].map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of [...COUNTRIES, ELSEWHERE]) {
    for (const section of ["card", "bank", "exchange"] as const) {
      assert.equal(new Set(c[section]).size, c[section].length, `${c.code}/${section}`);
      for (const id of c[section]) assert.ok(PROVIDERS.some((p) => p.id === id && p.section === section), `${c.code}: ${id} is a ${section} provider`);
    }
  }
});

test("every provider of a section is listed, A–Z: ZeroFee puts no one first (Security's review)", () => {
  for (const c of [...COUNTRIES, ELSEWHERE]) {
    for (const o of offersFor(c)) {
      const names = o.providers.map((p) => p.name);
      assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" })), `${c.code}/${o.section} is A–Z`);
      assert.equal(o.providers.length, c[o.section].length, `${c.code}/${o.section}: every one listed`);
    }
  }
  // What shows is the verifier's (verified.ts), so this checks the rule, not a list: every shown provider of TH, by section.
  const th = offersFor(countryFor("TH"));
  for (const o of th) {
    const want = REGISTRY.filter((r) => r.kind === o.section && shown(r) && PROVIDERS.find((p) => p.id === r.id)?.countries.includes("TH")).map((r) => r.id).sort();
    assert.deepEqual(o.providers.map((p) => p.id).sort(), want, `TH/${o.section}: every shown provider there`);
  }
});

test("Mt Pelerin never in the EU or UK (until a product decision), nor where it can't serve; a child never gets a card", () => {
  for (const code of ["EU", "GB", "ID"]) assert.ok(!countryFor(code).bank.includes("mt-pelerin"), code);
  const eu = offersFor(countryFor("EU"));
  assert.deepEqual(eu.map((o) => [o.section, o.providers.map((p) => p.id)]), [["card", ["bleap", "etherfi-cash", "metamask-card", "solcard"]], ["exchange", ["kraken"]], ["voucher", ["bitrefill"]]]);
  assert.ok(offersFor(countryFor("TH"), { kid: true }).every((o) => o.section !== "card"), "D30");
  assert.equal(countryFor("XX"), ELSEWHERE, "an unknown answer is anywhere else");
});

test("every exchange takes USDC on a network Pay sends; Scan's codes are ones it reads", () => {
  for (const c of COUNTRIES) for (const id of c.exchange) assert.ok(presetFor(id as never)!.chains.every((n) => chain(n)), `${c.code}: ${id}`);
  const known = ["PromptPay", "QR Ph", "VietQR", "QRIS", "UPI", "PIX", "SEPA transfer"];
  for (const c of COUNTRIES) for (const s of c.scan) assert.ok(known.includes(s), `${c.code}: ${s}`);
});

test("names come from the person's own language, never from this repo (no place names written in the table)", () => {
  assert.equal(countryName("EU", "en"), "European Union");
  assert.equal(countryName("ZZ"), "Somewhere else");
  const source = readFileSync(new URL("./countries.ts", import.meta.url), "utf8");
  for (const c of COUNTRIES) {
    const name = countryName(c.code, "en");
    assert.ok(name !== c.code && !source.includes(name), `${c.code}'s name isn't written in countries.ts`);
  }
});

test("the registry's seed: one record per provider, each with its places and its own costs (D37 step 3)", () => {
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length);
  for (const p of PROVIDERS) {
    assert.ok(p.costs.every((c) => c.says.endsWith(".") && ["itself", "a review"].includes(c.by)), `${p.id}: each cost says who says it`);
    for (const code of p.countries) assert.ok([...COUNTRIES, ELSEWHERE].some((c) => c.code === code), `${p.id}: ${code} is a place Pay asks about`);
  }
  for (const c of [...COUNTRIES, ELSEWHERE]) for (const id of [...c.card, ...c.bank, ...c.exchange, ...c.voucher]) assert.ok(PROVIDERS.find((p) => p.id === id)!.countries.includes(c.code), `${c.code}: ${id} is read from its record's places`);
  assert.deepEqual(costLines(PROVIDERS.find((p) => p.id === "binance-th")!), ["Binance TH says: Taking money out to your bank costs ฿20 (as of 26 Oct 2026)."]);
  // No figure from a review without its source (Security): ether.fi's is its own words, from its own help page.
  assert.deepEqual(costLines(PROVIDERS.find((p) => p.id === "etherfi-cash")!), ["ether.fi says: Core members normally get one free virtual card; in some regions the first one costs $10 (as of 26 Oct 2026)."]);
  assert.ok(REGISTRY.find((r) => r.id === "etherfi-cash")!.source.includes("https://help.ether.fi/en/articles/833743"), "its source is on record");
});

test("product decision (27 Oct): no ID check on top, the rest under it; nothing lost, nothing twice, each section A–Z", () => {
  for (const c of [...COUNTRIES, ELSEWHERE]) {
    for (const kid of [false, true]) {
      const groups = groupsFor(c, { kid });
      assert.deepEqual(groups.map((g) => g.label), ["No ID check", "With an ID check"].filter((l) => groups.some((g) => g.label === l)), `${c.code}: no ID check first`);
      for (const g of groups) {
        for (const o of g.offers) {
          assert.ok(o.providers.length > 0, `${c.code}: no empty section`);
          for (const p of o.providers) assert.equal(p.noId, g.label === "No ID check", `${c.code}: ${p.id} in the right group`);
          const names = o.providers.map((p) => p.name);
          assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })), `${c.code}: ${o.section} A–Z`);
        }
      }
      const grouped = groups.flatMap((g) => g.offers.flatMap((o) => o.providers.map((p) => `${o.section}:${p.id}`))).sort();
      const all = offersFor(c, { kid }).flatMap((o) => o.providers.map((p) => `${o.section}:${p.id}`)).sort();
      assert.deepEqual(grouped, all, `${c.code}: every provider exactly once`);
      if (kid) assert.ok(!groups.some((g) => g.offers.some((o) => o.section === "card")), `${c.code}: no card on a child's account (D30)`);
    }
  }
});
