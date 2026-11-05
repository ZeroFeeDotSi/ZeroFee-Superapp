// D37: ZeroFee never holds anyone's money. No string the app shows may say it does ("ZeroFee holds …", "held by
// ZeroFee", "ZeroFee keeps your money"). The copywriter's review (3 Nov) found two in the beta cap's lines.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url).pathname;
const CLAIM = /\bZeroFee (holds|keeps|has) (up to |your |the )?(\$|money|funds|coins)|\bheld by ZeroFee\b|\bZeroFee holds up to\b/i;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(tsx?|swift)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

/** Every source line under packages/ and apps/ that claims ZeroFee holds money, as file:line. */
export function custodyClaims(root = ROOT): string[] {
  const hits: string[] = [];
  for (const top of ["packages", "apps"]) {
    for (const f of sources(join(root, top))) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (CLAIM.test(l)) hits.push(`${f.slice(root.length)}:${i + 1}`); });
    }
  }
  return hits;
}

test("D37: no string says ZeroFee holds money", () => {
  assert.deepEqual(custodyClaims(), []);
});

test("D37 control: the check catches the beta cap's old wording", () => {
  assert.ok(CLAIM.test("During the beta, ZeroFee holds up to $5,000 per account."));
  assert.ok(!CLAIM.test("During the beta, an account holds up to $5,000."));
});
