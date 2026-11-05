// The demo's Add (D127): every one-time address it hands out is made up and taken by NO wallet on any chain, as written
// or lowercased (the security review of f614dc72); the same key gives the same address; the core's refusals mirrored.
// Each check has a control: a valid address of each chain passes the same check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge, sampleAddAddress } from "./MockBridge.ts";
import { checksumAddress, checksumOk } from "@zerofee/core/evm";
import { validAddress } from "@zerofee/wallet/addresses.ts";
import { findRecipient } from "@zerofee/pay/send";
import { addressFits } from "@zerofee/pay/request";
import type { Bridge } from "@zerofee/core/bridge";
import type { AddAddress } from "@zerofee/core/add-outside";

// a bridge that says every NEAR name exists, so only the address's own shape can refuse it
const bridge = { call: async (m: string, p: { accountId?: string }) => (m === "ledger.recipientInfo" ? { ok: { exists: true, hasLedgerBalance: false, accountId: p.accountId } } : { problem: { code: "x" } }) } as unknown as Bridge;
const VALID_SOL = "So11111111111111111111111111111111111111112";
const VALID_EVM = checksumAddress("0xab5e688e42ce07fc83e0ad8ca0486b96a5d53e39");

test("200 sample addresses per chain: each refused by the wallet's check, the core's checksum, Pay's findRecipient and a request link, as written and lowercased", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const sol = sampleAddAddress("sol", `add-sol-wallet-key-${i}`), evm = sampleAddAddress("hood", `add-hood-wallet-key-${i}`);
    // finding 56: base58 letters only (it reads like a Solana address), and still no key: it starts with "z"
    assert.match(sol, /^z[1-9A-HJ-NP-Za-km-z]{43}$/);
    assert.match(evm, /^0x[0-9a-fA-F]{41}$/);
    assert.doesNotMatch(evm, /0{6}/, "shaped like a real one: no long run of zeros");
    seen.add(sol).add(evm);
    for (const a of [sol, sol.toLowerCase()]) {
      assert.equal(validAddress("sol", a), false, a);
      assert.equal(addressFits(a, "sol"), false, a);
      assert.ok("problem" in (await findRecipient(bridge, a)), a);
    }
    for (const a of [evm, evm.toLowerCase(), `0x${evm.slice(2).toUpperCase()}`]) {
      for (const c of ["hood", "bsc", "eth", "base"]) assert.equal(validAddress(c, a), false, `${c} ${a}`);
      assert.equal(checksumOk(a), false, a);
      assert.equal(addressFits(a, "hood"), false, a);
      assert.ok("problem" in (await findRecipient(bridge, a)), a);
    }
  }
  assert.equal(seen.size, 400, "each key its own address");
  // controls: a valid address of each chain passes every check above
  assert.equal(validAddress("sol", VALID_SOL), true);
  assert.equal(addressFits(VALID_SOL, "sol"), true);
  assert.ok("ok" in (await findRecipient(bridge, VALID_SOL)));
  assert.equal(validAddress("hood", VALID_EVM), true);
  assert.equal(checksumOk(VALID_EVM), true);
  assert.equal(addressFits(VALID_EVM, "hood"), true);
  assert.ok("ok" in (await findRecipient(bridge, VALID_EVM)));
  assert.ok("ok" in (await findRecipient(bridge, VALID_EVM.toLowerCase())), "control: lowercase 40 hex is found");
});

test("subwallet.add.quote: a new address per key, the same key the same one, marked sample; NEAR and BNB refused by name; a request's dollars sized", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  const ask = (p: Record<string, unknown>) => b.call<AddAddress>("subwallet.add.quote", p);
  const a1 = await ask({ chain: "sol", to: "wallet", key: "add-sol-wallet-aaaaaaaaaa" });
  const a2 = await ask({ chain: "sol", to: "wallet", key: "add-sol-wallet-aaaaaaaaaa" });
  const a3 = await ask({ chain: "sol", to: "wallet", key: "add-sol-wallet-bbbbbbbbbb" });
  assert.ok("ok" in a1 && "ok" in a2 && "ok" in a3);
  assert.equal(a1.ok.depositAddress, a2.ok.depositAddress, "the same key, the same address");
  assert.notEqual(a1.ok.depositAddress, a3.ok.depositAddress, "a new key, a new address");
  assert.equal(a1.ok.sample, true);
  assert.equal(validAddress("sol", a1.ok.depositAddress), false);
  assert.ok(Date.parse(a1.ok.untilIso) - Date.now() > 23 * 3_600_000);
  assert.ok(BigInt(a1.ok.minAmountIn) < BigInt(a1.ok.amountIn));
  const h = await ask({ chain: "hood", to: "safe", key: "add-hood-safe-cccccccccc" });
  assert.ok("ok" in h && h.ok.symbol === "ETH" && h.ok.to === "safe" && checksumOk(h.ok.depositAddress) === false);
  for (const chain of ["near", "bsc"]) {
    const r = await ask({ chain, to: "wallet", key: `add-${chain}-wallet-dddddddddd` });
    assert.ok("problem" in r && /opens once ZeroFee has tested it with real money/.test(r.problem.more ?? ""), chain);
  }
  // a request: $20 of SOL at the demo's price, cut to 8 places; under $3 refused with the core's words
  const req = await ask({ chain: "sol", to: "wallet", key: "add-sol-wallet-eeeeeeeeee", usd: "20.00" });
  assert.ok("ok" in req && req.ok.usd === "20.00" && /0$/.test(req.ok.amountIn));
  const small = await ask({ chain: "sol", to: "wallet", key: "add-sol-wallet-ffffffffff", usd: "2.00" });
  assert.ok("problem" in small && small.problem.more === "Ask for $3 or more. Under that, most goes on fees.");
  assert.ok("problem" in (await ask({ chain: "sol", to: "wallet", key: "short" })), "a key out of shape");
  const way = await b.call<unknown[]>("subwallet.add.onWay");
  assert.ok("ok" in way && Array.isArray(way.ok) && way.ok.length === 0, "nothing lands at a made-up address");
});

test("home/add2: Wallet may read the NEAR wallet's balance (Home lists its SOL or ETH), never move it (control: a move out is still Trade's)", async () => {
  const b = createMockBridge({} as never);
  assert.ok("ok" in (await b.call("subwallet.float.balance", { app: "wallet" })), "Wallet reads it");
  const out = await b.call("subwallet.float.out", { app: "wallet", chain: "sol", amount: "1", key: "k".repeat(16) });
  assert.ok("problem" in out && out.problem.code === "security.request.not-allowed", "control: Wallet can't move it");
});

// Finding 56 (crawl, 4 Nov): the sample page's addresses held letters no real address has, and nothing said they were
// made up. They are labelled now: only the sample bridge marks an address `sample`, never the real core.
test("finding 56: only the sample bridge marks an Add address sample; the real core never does", async () => {
  const { readFileSync } = await import("node:fs");
  // the sample bridge marks them (the subwallet.add.quote test above); the real core never does
  for (const f of ["../../core/src/float-add.ts", "../../core/src/demo-core.ts", "../../core/src/subwallets.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /sample: true/, `${f} never marks a real address sample`);
  }
});
