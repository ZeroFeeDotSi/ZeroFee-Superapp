// D77 + D98 (QA, 2 Nov): Mt Pelerin's bank tile (its sign-up types a legal name and a date of birth) is off while no
// card or bank ships this quarter: never offered, never on Pay's Home, its page unreachable; kept in code behind a flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BANK_TILE_ON, REGISTRY, shown } from "./registry.ts";
import { PROVIDERS, offersFor } from "./countries.ts";

const payApp = readFileSync(new URL("./app/PayApp.tsx", import.meta.url), "utf8");

test("the bank tile is off: Mt Pelerin is in the code, and offered nowhere", () => {
  assert.equal(BANK_TILE_ON, false);
  const mt = REGISTRY.find((r) => r.id === "mt-pelerin");
  assert.ok(mt, "kept in code");
  assert.equal(shown(mt!), false);
  assert.ok(!PROVIDERS.some((p) => p.id === "mt-pelerin"), "never in What's available");
  // every country's offers, the control being that the bank section would carry it
  for (const code of ["CH", "DE", "FR", "GB", "US", "ZZ"]) {
    const offers = offersFor({ code, name: code, card: [], bank: ["mt-pelerin"], exchange: [], voucher: [] } as never);
    assert.ok(!offers.some((o) => o.providers.some((p) => p.id === "mt-pelerin")), code);
  }
});

test("Pay's Home, its tile tap, a provider pick and its page all pass through the flag (so the tile never renders)", () => {
  assert.match(payApp, /bank=\{BANK_TILE_ON \? savedBank : null\}/, "Home gets no bank while off: its tile is drawn only with one");
  assert.match(payApp, /\{BANK_TILE_ON && tab === "bank" && <BankTile /, "the page itself");
  assert.match(payApp, /const openTile = \(t: Tile\) => \(t === "bank" && !BANK_TILE_ON \? undefined : setTab\(t\)\);/);
  assert.match(payApp, /if \(p\.section === "bank"\) return BANK_TILE_ON \? setTab\("bank"\) : undefined;/);
  // the control: no other way into the bank page
  assert.equal((payApp.match(/setTab\("bank"\)/g) ?? []).length, 1);
});
