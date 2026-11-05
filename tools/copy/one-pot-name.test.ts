// D108 (QA 3 Nov): the money outside the Safe is "Trading" on every V4 surface. No user-facing string in packages/wallet
// or packages/core (the core's sheet words) says "Spending"; other packages are reported, not failed, until the copy job
// reaches them. Identifiers keep their names (SpendingStatus, spending.*): the reader sees only words a person reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allStrings, fromTs, type Found } from "./strings.ts";

const GATED = /^packages\/(wallet|core)\/src\//;
const saysSpending = (found: Found[]) => found.filter((f) => /\bSpending\b/.test(f.text));

test("D108: no user-facing string in packages/wallet or packages/core says Spending (the pot is Trading); other packages are reported only", () => {
  const all = saysSpending(allStrings());
  const gated = all.filter((f) => GATED.test(f.file));
  assert.deepEqual(gated.map((f) => `${f.file}:${f.line} "${f.text}"`), []);
  const rest = all.filter((f) => !GATED.test(f.file));
  const by = new Map<string, number>();
  for (const f of rest) { const k = f.file.split("/").slice(0, 2).join("/"); by.set(k, (by.get(k) ?? 0) + 1); }
  console.log(`report only (copy job): ${[...by].map(([k, n]) => `${k} ${n}`).join(", ")}`);
});

test("control: the check catches a planted \"Spending\" a person would read in Wallet, and leaves an identifier alone", () => {
  const planted = fromTs("packages/wallet/src/app/x.tsx", `import type { SpendingStatus } from "@zerofee/core/spending";
    export const A = (s: SpendingStatus) => <p>Move to Spending</p>;`);
  const hits = saysSpending(planted).filter((f) => GATED.test(f.file));
  assert.deepEqual(hits.map((f) => f.text), ["Move to Spending"]);
});
