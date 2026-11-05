// Read-only: what Earn would show right now, from real nodes (two per read). Signs nothing, sends nothing.
//   node packages/earn/scripts/live-read.ts [mainnet|testnet] [account] [--archive]
// --archive measures rates over 30 days on archival nodes (one dependable operator today, so not the default).
import { RpcChain } from "@zerofee/core/chain";
import type { Bridge } from "@zerofee/core/bridge";
import { ARCHIVAL_NODES, RpcNetwork } from "../src/network.ts";
import { createEarnService } from "../src/staking.ts";
import type { Validators } from "../src/types.ts";

const network = process.argv[2] === "testnet" ? "testnet" : "mainnet";
const accountId = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? (network === "mainnet" ? "near" : "testnet");

// A stand-in core that only answers account.state and keeps device storage in memory: enough for reads.
const store = new Map<string, string>();
const core: Bridge = {
  async call<T>(method: string, p?: Record<string, unknown>) {
    if (method === "account.state") return { ok: { stage: "ready", account: { accountId, network, keys: [], recovery: null } } as T };
    if (method === "device.store.get") return { ok: { value: store.get(String(p?.key)) ?? null } as T };
    if (method === "device.store.set") return (store.set(String(p?.key), String(p?.value)), { ok: { ok: true } as T });
    return { problem: { code: "live-read.no-signing", whatHappened: "This script never signs.", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } };
  },
  on: () => () => {},
};

const earn = createEarnService({
  bridge: core,
  chain: new RpcChain(network),
  network: new RpcNetwork(network),
  ...(process.argv.includes("--archive") ? { archive: { chain: new RpcChain(network, ARCHIVAL_NODES[network]), network: new RpcNetwork(network, ARCHIVAL_NODES[network]) } } : {}),
});

const started = Date.now();
const r = await earn.call<Validators>("earn.validators");
if ("problem" in r) {
  console.log("Problem:", r.problem.code, "-", r.problem.whatHappened, r.problem.more ?? "");
  process.exit(1);
}
const v = r.ok;
const listed = Date.now();
// As the screen does: the list first, then the rate of each one shown.
for (const x of [v.picked, ...v.others]) {
  if (!x) continue;
  const m = await earn.call<{ rate: Validators["picked"] extends infer V ? (V extends { rate: infer R } ? R : never) : never }>("earn.rate", { poolId: x.poolId });
  if ("ok" in m) x.rate = m.ok.rate;
}
const line = (x: NonNullable<Validators["picked"]>) =>
  `${x.name.padEnd(16)} ${x.poolId.padEnd(34)} fee ${x.feePercent.padStart(4)}%  rate ${x.rate ? `${x.rate.percent}% over ${x.rate.days} days` : "not measured"}  stake ${Number(x.stake).toLocaleString("en-US", { maximumFractionDigits: 0 })} NEAR  work ${x.uptimePercent ?? "-"}%`;
console.log(`Earn on ${network}: the list in ${((listed - started) / 1000).toFixed(1)} s, the rates ${((Date.now() - listed) / 1000).toFixed(1)} s after`);
console.log("picked:", v.picked ? line(v.picked) : "none passes the rules right now");
for (const o of v.others) console.log("other: ", line(o));
console.log(`wait: one epoch ${v.wait.epochHours} h; NEAR asked back waits ${v.wait.minHours}–${v.wait.maxHours} h; asked now, ready at ${v.wait.ifNowIso} (UTC)`);
console.log(`idle for ${accountId}:`, v.idle);
