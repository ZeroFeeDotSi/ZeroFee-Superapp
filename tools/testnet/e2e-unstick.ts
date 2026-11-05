// Free an e2e account that a half-finished restore has stuck (security.recovery.already for everyone after).
//
//   node tools/testnet/e2e-unstick.ts [accountId]
//
// A restore that never reached Finish leaves a pending move whose new key may be gone with its browser profile, and
// only a key already on the account can cancel it. The second-device proof (tools/testnet/second-device.ts) keeps its
// phone's key in a private file; this uses the newest one for the account to cancel the pending move, testnet only.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BridgeResult } from "../../packages/core/src/bridge.ts";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { DemoCore } from "../../packages/core/src/demo-core.ts";
import { FileVault } from "../../packages/core/src/file-vault.ts";
import type { TxOutcome } from "../../packages/core/src/signer.ts";

const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");
const e2e = readdirSync(dir).filter((f) => f.startsWith("e2e-") && f.endsWith(".json")).sort().at(-1);
/** A move only counts as stuck this long after it could have finished: a live restore is never cancelled. */
const STUCK_AFTER_MS = 10 * 60_000;
const accountId = process.argv[2] ?? (e2e ? (JSON.parse(readFileSync(join(dir, e2e), "utf8")) as { accountId: string }).accountId : undefined);
if (!accountId) throw new Error("no e2e account");
const chain = new RpcChain("testnet");
const phones = readdirSync(dir).filter((f) => /^laptop-e2e-.*-phone\.json$/.test(f)).sort().reverse();
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code}`);
  return r.ok;
};

for (const file of phones) {
  const phone = new DemoCore({ chain, vault: new FileVault(join(dir, file)), policyWasm: async () => new Uint8Array() });
  phone.on<{ id: string }>("approval.needed", ({ id }) => void phone.call("approval.answer", { id, approve: true }));
  try {
    const state = await phone.call<{ account?: { accountId: string } }>("account.state");
    if ("problem" in state || state.ok.account?.accountId !== accountId) continue;
    const { pending } = ok(await phone.call<{ pending: null | { readyAtIso: string } }>("recovery.status"), "status");
    if (!pending) {
      console.log(`${accountId}: nothing is stuck.`);
      process.exit(0);
    }
    if (Date.now() < Date.parse(pending.readyAtIso) + STUCK_AFTER_MS) {
      console.log(`${accountId}: a move is in progress (it can finish from ${pending.readyAtIso}); it only counts as stuck 10 minutes after that. Left alone.`);
      process.exit(2);
    }
    const out = ok(await phone.call<TxOutcome>("recovery.cancel"), "cancel");
    if (out.status !== "done") throw new Error(`cancel: ${JSON.stringify(out)}`);
    console.log(`${accountId}: the pending move is cancelled (${out.explorerUrl}). Restores work again.`);
    process.exit(0);
  } finally {
    phone.close();
  }
}
console.log(`No key for ${accountId} is kept here. Run tools/testnet/second-device.ts once (it keeps one), then this again.`);
process.exit(1);
