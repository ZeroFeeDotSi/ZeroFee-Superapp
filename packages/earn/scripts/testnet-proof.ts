// Earn on testnet (free): stake, ask back and bring home with a real standard staking pool, through the real core.
//   node packages/earn/scripts/testnet-proof.ts           part 1: stake 0.25 NEAR with the validator Earn picks, then
//                                                         ask it all back
//   node packages/earn/scripts/testnet-proof.ts --home    part 2, once the wait is over (about a day): bring it home
//
// It runs on the e2e account with a phone key Security's proof already keeps (tools/testnet/second-device.ts): no
// takeover, and no change to the account's keys or protection, so other sessions' runs on it go on. Earn's own device
// storage is a private file next to the account's (mode 600), so part 2 knows what part 1 asked. Every sheet is printed
// line by line and approved; a held request is run once its wait is over. Each step is checked on chain, on two nodes.
// Nothing printed is secret.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { forApps, routeBridge, type Bridge, type BridgeResult } from "@zerofee/core/bridge";
import { RpcChain } from "@zerofee/core/chain";
import { DemoCore } from "@zerofee/core/demo-core";
import { FileVault } from "@zerofee/core/file-vault";
import type { PlainWords, TxOutcome } from "@zerofee/core/signer";
import { RpcNetwork } from "../src/network.ts";
import { createEarnService } from "../src/staking.ts";
import type { HistoryItem, Position, Validator, Validators } from "../src/types.ts";

const AMOUNT = "0.25";
const NEAR = 10n ** 24n;
/** A pool rounds shares down: what it reports may be a few yocto short of what went in. */
const ROUNDING = 10n ** 18n;
const home = process.argv.includes("--home");

const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");
const e2e = readdirSync(dir).filter((f) => f.startsWith("e2e-")).sort().at(-1);
if (!e2e) throw new Error("no e2e account: run tools/testnet/make-account.ts first");
const { accountId } = JSON.parse(readFileSync(join(dir, e2e), "utf8")) as { accountId: string };
const chain = new RpcChain("testnet");

const t0 = Date.now();
const step = (n: string, text: string) => console.log(`\n${n}. ${text}  (+${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const ok = <T>(r: BridgeResult<T>, what: string): T => {
  if ("problem" in r) throw new Error(`${what}: ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};
const check = (cond: boolean, what: string) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`   ✓ ${what}`);
};
const nearText = (y: bigint) => `${(Number(y) / 1e24).toFixed(6)} NEAR`;

/** The account at the pool, read from two nodes at one block. */
const atPool = async (poolId: string) => {
  const a = (await chain.view(poolId, "get_account", { account_id: accountId }, await chain.commonBlock())) as { staked_balance: string; unstaked_balance: string; can_withdraw: boolean };
  return { staked: BigInt(a.staked_balance), unstaked: BigInt(a.unstaked_balance), canWithdraw: a.can_withdraw };
};
const free = async () => {
  const a = await chain.account(accountId, await chain.commonBlock());
  return a ? a.balanceYocto : 0n;
};

// Earn's device storage, as the phone would keep it: a private file.
const storeFile = join(dir, `earn-proof-${accountId}.json`);
const kept: Record<string, string> = existsSync(storeFile) ? JSON.parse(readFileSync(storeFile, "utf8")) : {};
const device: Bridge = {
  async call<T>(method: string, p: Record<string, unknown> = {}) {
    const slot = `${String(p.app)}.${String(p.key)}`;
    if (method === "device.store.get") return { ok: { value: kept[slot] ?? null } as T };
    if (method === "device.store.set") {
      kept[slot] = String(p.value);
      writeFileSync(storeFile, JSON.stringify(kept), { mode: 0o600 });
      return { ok: { ok: true } as T };
    }
    return { problem: { code: "proof.device.unknown", whatHappened: `${method} isn't kept here.`, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } };
  },
  on: () => () => {},
};

// The phone: the newest kept phone key that is still on the e2e account.
let phone: DemoCore | null = null;
for (const file of readdirSync(dir).filter((f) => /^laptop-e2e-.*-phone\.json$/.test(f)).sort().reverse()) {
  const core = new DemoCore({ chain, vault: new FileVault(join(dir, file)), policyWasm: async () => new Uint8Array() });
  const state = await core.call<{ stage: string; account?: { accountId: string } }>("account.state");
  if ("ok" in state && state.ok.account?.accountId === accountId && state.ok.stage === "ready") {
    phone = core;
    console.log(`Phone: the key kept in ${file}, on ${accountId}.`);
    break;
  }
  core.close();
}
if (!phone) {
  console.log(`No ready phone key for ${accountId} is kept here. Run tools/testnet/second-device.ts once (it keeps one), then this again.`);
  process.exit(1);
}
phone.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => {
  console.log(`   [sheet] ${words.title}`);
  for (const line of words.lines) console.log(`      ${line}`);
  for (const w of words.warnings) console.log(`      ! ${w.text}`);
  void phone!.call("approval.answer", { id, approve: true });
});

const earn = createEarnService({ bridge: forApps(routeBridge(phone, { device }), "earn"), chain, network: new RpcNetwork("testnet") });
const call = async <T>(method: string, params?: Record<string, unknown>) => ok(await earn.call<T>(method, params), method);

/** Done, or held then run once its wait is over. Anything else stops the proof. */
async function landed(outcome: TxOutcome, what: string): Promise<string> {
  if (outcome.status === "waiting") {
    if (outcome.needsSecondDevice) throw new Error(`${what} is held for a second device; this proof can't say yes for it`);
    console.log(`   held by the account's protection until ${outcome.readyAtIso} (UTC): waiting, then running it`);
    while (Date.now() < Date.parse(outcome.readyAtIso) + 5000) await new Promise((r) => setTimeout(r, 5000));
    const ran = ok(await phone!.call<TxOutcome>("account.waiting.run", { id: outcome.id }), "account.waiting.run");
    return landed(ran, what);
  }
  if (outcome.status !== "done") throw new Error(`${what}: ${JSON.stringify(outcome)}`);
  console.log(`   ${outcome.explorerUrl}`);
  return outcome.explorerUrl;
}

try {
  if (!home) {
    step("1", "the validator Earn picks by its rules, read again in full");
    const vs = await call<Validators>("earn.validators");
    if (!vs.picked) throw new Error("no testnet validator meets Earn's rules right now");
    const POOL = vs.picked.poolId;
    const pool = await call<Validator & { eligible: boolean; reason?: string }>("earn.pool", { poolId: POOL });
    console.log(`   ${pool.name} (${POOL}): ${pool.feePercent}% fee, ${pool.eligible ? "passes the rules" : `fails the rules: ${pool.reason}`}`);
    check(pool.eligible, "it passes the rules");
    const before = await atPool(POOL);
    check(before.unstaked < ROUNDING, "nothing of ours is waiting at the pool");

    // An earlier run that stopped after its stake left 0.25 NEAR there: go on from asking it back.
    if (before.staked === 0n) {
      step("2", `stake ${AMOUNT} NEAR with ${pool.name}: one approval`);
      await landed(await call<TxOutcome>("earn.stake", { poolId: POOL, amount: AMOUNT, feeSeen: pool.fee }), "the stake");
    } else console.log(`
2. ${nearText(before.staked)} is already staked there by an earlier run of this proof: asking it back`);
    const staked = await atPool(POOL);
    check(staked.staked >= NEAR / 4n - ROUNDING && staked.staked <= NEAR / 4n, `the pool holds ${nearText(staked.staked)} staked for us`);
    const [row] = (await call<Position[]>("earn.positions")).filter((p) => p.poolId === POOL);
    check(row?.staked !== undefined && Number(row.staked) > 0.2499, `Earning shows ${row?.staked} NEAR with ${row?.name}`);

    step("3", "ask all of it back");
    const { outcome, readyAtIso } = await call<{ outcome: TxOutcome; readyAtIso?: string }>("earn.unstake", { poolId: POOL, amount: "all" });
    await landed(outcome, "the unstake");
    const asked = await atPool(POOL);
    check(asked.staked === 0n && asked.unstaked >= staked.staked && asked.unstaked <= staked.staked + ROUNDING && !asked.canWithdraw, `${nearText(asked.unstaked)} waits at the pool, not yet free to take out`);
    console.log(`   Earn says it is ready ${readyAtIso} (UTC)`);

    step("4", "History");
    for (const h of await call<HistoryItem[]>("earn.history")) console.log(`   ${h.status.padEnd(9)} ${h.kind.padEnd(8)} ${h.amount} NEAR  ${h.name}  ${h.atIso}`);
    console.log(`\nPart 1 done. After ${readyAtIso} (UTC), run: node packages/earn/scripts/testnet-proof.ts --home`);
  } else {
    step("1", "is it ready to bring home?");
    const [row] = (await call<Position[]>("earn.positions")).filter((p) => Number(p.unstaked) > 0);
    if (!row) throw new Error("nothing of ours is waiting at a pool: run part 1 first");
    const POOL = row.poolId;
    if (!row.canWithdraw) {
      console.log(`   Not yet: ${row.unstaked} NEAR is ready ${row.readyAtIso} (UTC). Run this again then.`);
      process.exit(2);
    }
    const waiting = await atPool(POOL);
    const balance = await free();

    step("2", `bring ${row.unstaked} NEAR home: one approval`);
    await landed(await call<TxOutcome>("earn.withdraw", { poolId: POOL }), "bringing it home");
    const after = await atPool(POOL);
    check(after.unstaked === 0n && after.staked === 0n, "nothing of ours is left at the pool");
    // The account pays a small network fee for the withdrawal, so it gains a little less than came back.
    const gained = (await free()) - balance;
    check(gained > waiting.unstaked - NEAR / 100n && gained <= waiting.unstaked, `the account has ${nearText(gained)} more (${nearText(waiting.unstaked)} came back, less the network fee)`);
    check((await call<Position[]>("earn.positions")).every((p) => p.poolId !== POOL), "Earning no longer lists the pool");

    step("3", "History");
    for (const h of await call<HistoryItem[]>("earn.history")) console.log(`   ${h.status.padEnd(9)} ${h.kind.padEnd(8)} ${h.amount} NEAR  ${h.name}  ${h.atIso}`);
    console.log("\nPart 2 done: staked, asked back and brought home on testnet.");
  }
} finally {
  phone.close();
}
