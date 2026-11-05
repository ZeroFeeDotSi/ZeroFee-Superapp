// RECHECK (fix review, e72eddd) of the EVM direct-quote floor (3253e4a: "the EVM direct quote that sets a floor is read
// on two nodes, and they must agree"). readPair (evm/rpc.ts:118-132) waits only PAIR_GRACE_MS (120 ms) for the second
// node after the first answered; a node that answers fast (a malicious or just a close one) is then the only answer, so
// one node sets the floor again whenever the honest node is a little slower. Asserts that a floor-setting read never rests
// on one node while the other is still answering; FAILS today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPair, type EvmRpc, type NodeAnswer } from "../../evm/rpc.ts";

test("RT-8 (EVM floor variant): the quote that sets a floor isn't taken from the fast node alone", async () => {
  const LOW = "0x" + (80n).toString(16).padStart(64, "0"), FAIR = "0x" + (100n).toString(16).padStart(64, "0");
  const rpc: EvmRpc = {
    chain: "bsc",
    call: async () => FAIR,
    post: async () => FAIR,
    askNodes: (_m, _p, _max, opts) => new Promise<NodeAnswer[]>((resolve) => {
      const got: NodeAnswer[] = [];
      const answer = (a: NodeAnswer, ms: number) => setTimeout(() => { got.push(a); if (opts?.until?.(a)) resolve(got); if (got.length === 2) resolve(got); }, ms);
      answer({ ok: true, value: LOW, node: "fast-malicious" }, 5);          // 20 % under: lowers the floor
      answer({ ok: true, value: FAIR, node: "honest" }, 300);               // the honest node, 300 ms later
    }),
  };
  const seen = await readPair(rpc, "eth_call", []);
  assert.ok(seen.includes(FAIR), `the floor rests on ${seen.length} answer(s): ${seen.map((x) => BigInt(x)).join(", ")} (the honest node's 100 wasn't waited for)`);
});
