import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "./cards.ts";
import { RECIPES, recipeFor } from "./recipes.ts";

test("schema A: exact hosts only (no wildcards, no paths), and the start page is on one of them", () => {
  for (const r of RECIPES) {
    assert.ok(r.hosts.length > 0, r.partner);
    for (const h of r.hosts) assert.match(h, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${r.partner}: ${h} is an exact host`);
    assert.ok(r.hosts.includes(new URL(r.start).hostname), `${r.partner}: start is on a recipe host`);
    if (r.login) assert.ok(r.hosts.includes(r.login.host), `${r.partner}: the login is on a recipe host`);
    if (r.modes.includes("wallet")) assert.ok(r.wallet && r.wallet.chains.length > 0, `${r.partner}: wallet mode names its chains`);
    assert.ok(r.commit.length > 0, `${r.partner}: commit buttons named`);
  }
  assert.equal(recipeFor("gnosis-pay")!.start, CARDS.find((c) => c.id === "gnosis-pay")!.signupUrl, "the page the Card tile opens");
});

test("F: the card's Safe is owned by its own capped pay wallet on Gnosis Chain, never the Browser wallet", () => {
  assert.deepEqual(recipeFor("gnosis-pay")!.wallet, { kind: "pay", chains: ["gnosis"] });
  for (const r of RECIPES) if (r.partner !== "gnosis-pay") assert.notEqual(r.wallet?.kind, "pay", `${r.partner} never uses the card's key`);
});

test("robot fills only the recipe's own slots and login; a new password only where the recipe may create one", () => {
  for (const r of RECIPES) {
    for (const s of r.steps) {
      for (const f of s.fill ?? []) {
        if (f.startsWith("profile.")) assert.ok(r.profile.includes(f.slice(8) as never), `${r.partner}/${s.id}: ${f} is a listed slot`);
        else assert.ok(r.login, `${r.partner}/${s.id}: ${f} needs the recipe's login`);
      }
    }
  }
});

test("D5: terms, codes, ID, selfies, payments and wallet sheets are always the person's turn", () => {
  for (const r of RECIPES) {
    assert.equal(r.steps[0].act, "open", r.partner);
    assert.equal(r.steps.at(-1)!.act, "done", r.partner);
    assert.equal(new Set(r.steps.map((s) => s.id)).size, r.steps.length, `${r.partner}: unique step ids`);
    for (const s of r.steps) {
      if (s.act === "your-turn" || s.act === "wallet") assert.ok(s.turn, `${r.partner}/${s.id} says why it's the person's`);
      if (s.turn === "terms" || s.turn === "payment" || s.turn === "id-document" || s.turn === "selfie") assert.equal(s.act, "your-turn", `${r.partner}/${s.id}`);
      assert.ok(s.source.length > 10 && ["official", "third-party", "unrecorded"].includes(s.sure), `${r.partner}/${s.id} names its source`);
    }
    assert.ok(r.steps.some((s) => s.turn === "terms"), `${r.partner}: the terms are the person's`);
  }
});

test("each recipe keeps what Pay's tile needs: the card's address, or the IBAN", () => {
  assert.ok(recipeFor("gnosis-pay")!.steps.some((s) => s.keep === "card-address"));
  assert.ok(recipeFor("mt-pelerin")!.steps.some((s) => s.keep === "iban"));
});

test("keep is the host's pattern, then Pay's own check: a card address, an IBAN with good check digits", async () => {
  const { KEEP_PATTERNS } = await import("./recipes.ts");
  const { readIban } = await import("../codes/iban.ts");
  const safe = "0x2527" + "0".repeat(32) + "f10d";
  assert.equal(`Your Safe ${safe} here`.match(KEEP_PATTERNS["card-address"])?.[0], safe);
  const iban = "IBAN: CH93 0076 2011 6238 5295 7".match(KEEP_PATTERNS.iban)?.[0];
  assert.equal(readIban(iban), "CH9300762011623852957");
});
