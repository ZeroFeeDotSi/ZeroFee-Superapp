// Pay's flow against Wallet's real ledger service, with Wallet's own test fakes for the core, the chain and 1Click.
// The two layers are proven to fit each other here, not each against its own mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeBridge } from "@zerofee/core/bridge";
import type { TxRequest } from "@zerofee/core/signer";
import { createApis } from "@zerofee/wallet/apis.ts";
import { createLedgerService } from "@zerofee/wallet/ledger.ts";
import type { CallResult } from "@zerofee/wallet/receipts.ts";
import { fakeCore, fakeNear, replayFetch } from "@zerofee/wallet/testing/replay.ts";
import { PayFlow, type Step } from "./pay.ts";
import { requestLink } from "./request.ts";

const ME = "sam.near";
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const NEAR = 10n ** 24n;

function setup(answers: CallResult[] = []) {
  const core = fakeCore({ accountId: ME });
  const chain = fakeNear(ME, { nearYocto: NEAR, ledger: { [USDC_SOL]: "200000000" } }, { "bob.near": { nearYocto: NEAR } });
  const reads: string[] = [];
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(replayFetch()), readCall: async (tx) => (reads.push(tx), answers.shift() ?? assert.fail("no answer for this transfer_call")) });
  const flow = new PayFlow({ bridge: routeBridge(core, { ledger }) });
  return { core, flow, reads };
}
const call = (r: TxRequest) => r.actions[0] as { kind: "call"; method: string; args: Record<string, unknown> };
const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};
const requestTo = (to: string) => requestLink({ to, amount: "30", token: USDC_SOL, note: "Dinner", ref: "1042" });

test("a request link with a ref is a plain transfer with the ref as its memo", async () => {
  const { core, flow, reads } = setup();
  kind(await flow.read(requestTo("bob.near")), "confirm");
  kind(await flow.confirm(), "paid");
  assert.equal(call(core.signed[0]).method, "mt_transfer");
  assert.equal(call(core.signed[0]).args.msg, undefined);
  assert.equal(call(core.signed[0]).args.memo, "1042");
  assert.deepEqual(reads, [], "no transfer_call to read back");
});
