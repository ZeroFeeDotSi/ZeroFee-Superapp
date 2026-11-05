// Security audit 2026-11-04 finding 1: a mainnet account still runs release 4, before
// F1's fix. The app's way out is Security's "update your rules" offer: from any older ZeroFee release straight to the
// current one (release 9) by its pinned hash, and only once two nodes show that hash published with its pinned sha256.
// This pins the offer for every older release the core knows, and that nothing else is ever offered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_POLICY, policyVersion } from "./known-contracts.ts";
import { v4Account } from "./release4-account.test.ts";

const ok = <T>(r: { ok: T } | { problem: { code: string } }): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};
type Rules = { release: number; current: number; update?: { waitSeconds: number } };

test("audit 1: every older known release (2-8) is offered the current release; 1, 9 and an unknown hash are not", async () => {
  const current = policyVersion(ACCOUNT_POLICY.codeHashBase58);
  assert.equal(current, 9, "the current release is 9, pinned by hash");
  const hashes = Object.entries(ACCOUNT_POLICY.versions);
  for (const release of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(hashes.some(([, v]) => v === release), `release ${release} is known by a hash`);
  const cases: [string, number, boolean][] = [...hashes.map(([h, v]) => [h, v, v >= 2 && v < 9] as [string, number, boolean]), ["11111111111111111111111111111111", 0, false]];
  for (const [hash, release, offered] of cases) {
    const { chain, core, a } = await v4Account();
    try {
      chain.publishGlobal(ACCOUNT_POLICY.codeHashBase58, ACCOUNT_POLICY.sha256Hex);
      a.codeHash = hash;
      const info = ok(await core.call<Rules>("account.rules"));
      assert.equal(info.release, release, hash);
      assert.equal(!!info.update, offered, `release ${release} (${hash.slice(0, 7)}): ${offered ? "offered" : "not offered"}`);
    } finally {
      core.close();
    }
  }
});

// That the update then runs to exactly the pinned hash is release4-account.test.ts's last test.
