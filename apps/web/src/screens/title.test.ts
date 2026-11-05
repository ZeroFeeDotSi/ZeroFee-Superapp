import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAGLINE } from "../brand.ts";

// The test runner strips types but does not compile JSX, so the title screen is checked from its source.
const title = readFileSync(new URL("./Title.tsx", import.meta.url), "utf8");

test("the tagline is exactly the product's words", () => {
  assert.equal(TAGLINE, "Own what's yours.");
});

test("the title screen renders the tagline under the name, from the one constant", () => {
  assert.match(title, /<div className="title__promise">\{TAGLINE\}<\/div>/);
  assert.match(title, /aria-label=\{`ZeroFee\. \$\{TAGLINE\}`\}/);
  assert.equal(title.includes("Own your bank"), false);
});

test("D111: Welcome says what ZeroFee is under its name, from one constant each (QA's exact lines)", async () => {
  const onboarding = readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8");
  const { BRAND_LINE, BRAND_SUB } = await import("../brand.ts");
  assert.equal(BRAND_LINE, "One wallet for every chain.");
  assert.equal(BRAND_SUB, "Any coin in. Any coin out. Private by default.");
  assert.equal(onboarding.includes("Own your bank"), false);
  assert.match(onboarding, /<h1 className="zf-display"[^>]*>\{BRAND_LINE\}<\/h1>\s*<p className="zf-body"[^>]*>\{BRAND_SUB\}<\/p>/);
  assert.equal(/\{TAGLINE\}/.test(onboarding), false, "the title card's tagline stays on the title card");
});
