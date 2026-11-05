// Earn's mainnet proof, run by the operator with dust (tools/earn/PROOF.md). Never run by a session, except with --dry.
//
//   node tools/earn/proof.ts <name>.near read             what Earn sees: idle NEAR, the validator it picks, what's
//                                                         staked, and how long the way back takes today (no key needed)
//   node tools/earn/proof.ts <name>.near stake <near>     stake with the validator Earn picks: at most 0.3 NEAR
//   node tools/earn/proof.ts <name>.near unstake          ask all of it back
//   node tools/earn/proof.ts <name>.near home             bring it home, once the wait is over
//
// --dry on any step: the same reads and the same transactions, described by the core's own decoder, and nothing signed
// (no key file is read; the core is told this device's key is on the account so it can describe). Sessions use only that.
//
// Every transaction is built by Earn's own service (packages/earn/src/staking.ts), shown in the words the core decodes
// from its bytes, and signed only after you type "yes" (tools/wallet/kit.ts). Earn's own records (what it staked, so
// "earned so far" can be shown) go to a private file next to the account's key file (mode 600).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { codeOf, type Chain } from "@zerofee/core/chain";
import { SoftwareKey } from "@zerofee/core/device-key";
import { DevSigner } from "@zerofee/core/dev-signer";
import { policyVersion } from "@zerofee/core/known-contracts";
import type { TxOutcome, TxRequest } from "@zerofee/core/signer";
import { RpcNetwork } from "../../packages/earn/src/network.ts";
import { createEarnService } from "../../packages/earn/src/staking.ts";
import type { HistoryItem, Position, Validators } from "../../packages/earn/src/types.ts";
import type { Wait } from "../../packages/earn/src/epoch.ts";
import { chain, closeTerminal, loadAccount } from "../wallet/kit.ts";

/** The dust cap: the whole test budget is shared by every session. */
const CAP_NEAR = 0.3;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [accountId, step, amountText] = args.filter((a) => a !== "--dry");
if (!accountId || !["read", "stake", "unstake", "home"].includes(step ?? "")) {
  console.log("Usage: node tools/earn/proof.ts <name>.near read | stake <near> | unstake | home   [--dry]");
  process.exit(1);
}

// The signer: the operator's key file, or (--dry) a throwaway key the core is told is on the account, so it can describe
// what it would sign. A dry run never asks to sign.
const signer: DevSigner | null = (() => {
  if (step === "read") return null;
  if (dry) {
    const fakeKey = { handle: "dry-run", nonce: 0n, permission: { kind: "full" as const } };
    const dryChain = new Proxy(chain, {
      get: (t, p) => (p === "accessKey" ? async () => fakeKey : typeof Reflect.get(t, p) === "function" ? Reflect.get(t, p).bind(t) : Reflect.get(t, p)),
    }) as Chain;
    return new DevSigner({ accountId, chain: dryChain, key: SoftwareKey.fromSeed(new Uint8Array(32), "development"), approve: async () => false });
  }
  try {
    return loadAccount(accountId);
  } catch (e) {
    console.log(`Stopped: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
})();

// Earn's records, as the phone would keep them: a private file (in memory for --dry).
const storeFile = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "mainnet", `earn-${accountId}.json`);
const kept: Record<string, string> = !dry && existsSync(storeFile) ? JSON.parse(readFileSync(storeFile, "utf8")) : {};

const refuse = <T>(what: string): BridgeResult<T> => ({ problem: { code: "tool.none", whatHappened: what, money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } });
const core: Bridge = {
  async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
    if (method === "account.state") return { ok: { stage: "ready", account: { accountId, network: "mainnet", keys: [], recovery: null } } as T };
    if (method === "device.store.get") return { ok: { value: kept[String(p.key)] ?? null } as T };
    if (method === "device.store.set") {
      kept[String(p.key)] = String(p.value);
      if (!dry) writeFileSync(storeFile, JSON.stringify(kept), { mode: 0o600 });
      return { ok: { ok: true } as T };
    }
    const request = p.request as TxRequest | undefined;
    if (method === "tx.request" && request && signer) {
      if (!dry) return { ok: (await signer.request(request)) as T };
      const words = await signer.describe(request);
      console.log(`\n  ┌ ${words.title}   (dry run: described by the core, not signed)`);
      for (const line of words.lines) console.log(`  │ ${line}`);
      for (const w of words.warnings) console.log(`  │ ⚠ ${w.text}`);
      if (words.hint) console.log(`  │ (${words.hint})`);
      console.log("  └ not signed");
      return { ok: { status: "declined" } as T };
    }
    return refuse(`${method} isn't part of this tool.`);
  },
  on: () => () => {},
};
const earn = createEarnService({ bridge: core, chain, network: new RpcNetwork("mainnet") });
const call = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
  const r = await earn.call<T>(method, params);
  if (!("problem" in r)) return r.ok;
  const where = (r.problem.money as { where?: string } | undefined)?.where;
  throw new Error(`${r.problem.whatHappened}${where ? ` Your money is ${where}.` : ""} (${r.problem.code})`);
};
const hoursFromNow = (iso: string) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3.6e6));

/** Done, or why not. A RESULT line for Earn either way. */
function report(what: string, o: TxOutcome): void {
  if (o.status === "done") console.log(`   ✓ landed: ${o.explorerUrl}\nRESULT earn ${what} done ${o.txHash}`);
  else if (o.status === "waiting") console.log(`   Held by the account's protection until ${o.readyAtIso} (UTC); nothing has moved yet.\nRESULT earn ${what} held ${o.id}`);
  else if (o.status === "declined") console.log(dry ? `RESULT earn ${what} dry-run (nothing signed)` : "   Not signed (you didn't type yes). Nothing moved.");
  else console.log(`   ✗ ${o.problem.whatHappened} (${o.problem.code})\nRESULT earn ${what} problem ${o.problem.code}`);
  if (o.status !== "done" && !dry) process.exitCode = 1;
}

async function positions(): Promise<Position[]> {
  return (await call<Position[]>("earn.positions")).filter((p) => Number(p.staked) > 0 || Number(p.unstaked) > 0);
}

try {
  // --dry on someone else's account: Earn has no records of it, so treat today's validators as ones it staked with,
  // so their unstake and withdrawal can be described too.
  if (dry && (step === "unstake" || step === "home")) {
    const vs = await call<Validators>("earn.validators");
    const pools = Object.fromEntries([vs.picked, ...vs.others].filter((v) => v !== null).map((v) => [v!.poolId, { feeAtStake: v!.fee }]));
    kept.pools = JSON.stringify(pools);
  }
  const block = await chain.commonBlock();
  const rulesVersion = policyVersion(codeOf(await chain.account(accountId, block)));

  if (step === "read") {
    console.log(`Earn on NEAR mainnet for ${accountId} (two nodes agree):`);
    const vs = await call<Validators>("earn.validators");
    console.log(`   Idle: ${vs.idle.account} NEAR on the account, ${vs.idle.accountWrapped} wNEAR on the account, ${vs.idle.ledger} wNEAR in NEAR Intents (${vs.idle.reserve} NEAR kept for fees)`);
    if (vs.picked) {
      const { rate } = await call<{ rate: { percent: string; days: number } | null }>("earn.rate", { poolId: vs.picked.poolId });
      console.log(`   Earn would stake with ${vs.picked.name} (${vs.picked.poolId}): ${vs.picked.feePercent}% fee${rate ? `, ${rate.percent}% a year over the last ${Math.round(rate.days * 24)} hours (it changes)` : ""}`);
    } else console.log("   No validator meets Earn's rules right now.");
    const wait = await call<Wait>("earn.wait");
    console.log(`   NEAR asked back now is ready in ${Math.round(wait.minHours)} to ${Math.round(wait.maxHours)} hours (at ${wait.ifNowIso} UTC at the latest)`);
    console.log(`   Account rules: ${rulesVersion >= 2 ? `ZeroFee's, version ${rulesVersion}: NEAR from NEAR Intents can go in with one approval` : "none: only NEAR on the account itself can be staked here, one step at a time"}`);
    for (const p of await positions()) console.log(`   With ${p.name}: ${p.staked} NEAR earning${p.earned ? ` (+${p.earned} earned)` : ""}, ${p.unstaked} NEAR asked back${Number(p.unstaked) > 0 ? (p.canWithdraw ? ", ready to bring home" : `, ready at ${p.readyAtIso} UTC`) : ""}`);
  }

  if (step === "stake") {
    const amount = Number(amountText);
    if (!(amount > 0)) throw new Error(`"${amountText ?? ""}" isn't an amount of NEAR`);
    if (amount > CAP_NEAR) throw new Error(`${amountText} NEAR is more than the ${CAP_NEAR} NEAR dust cap for this proof`);
    const vs = await call<Validators>("earn.validators");
    if (!vs.picked) throw new Error("No validator meets Earn's rules right now, so nothing was staked.");
    // Native NEAR goes first, then wNEAR: anything beyond the account's own NEAR is a chain of steps in one approval,
    // which only ZeroFee's account rules (version 2 and up) can run.
    if (amount > Number(vs.idle.account) && rulesVersion < 2) {
      throw new Error(`This account has only ${vs.idle.account} NEAR of its own to stake, and no ZeroFee account rules to take the rest from NEAR Intents in one approval. Stake at most ${vs.idle.account} NEAR here, or stake from NEAR Intents in the app (PROOF.md step 4).`);
    }
    const from = amount > Number(vs.idle.account) ? `${vs.idle.account} NEAR from the account, the rest from wNEAR` : "the account's own NEAR";
    console.log(`Stake ${amountText} NEAR with ${vs.picked.name} (${vs.picked.feePercent}% fee, read now), from ${from}.`);
    report("stake", await call<TxOutcome>("earn.stake", { poolId: vs.picked.poolId, amount: amountText, feeSeen: vs.picked.fee }));
  }

  if (step === "unstake") {
    const [p] = (await positions()).filter((x) => Number(x.staked) > 0);
    if (!p) throw new Error("Nothing of yours is earning through Earn on this account, so there's nothing to ask back.");
    console.log(`Ask ${p.name} for all ${p.staked} NEAR back.`);
    const { outcome, readyAtIso } = await call<{ outcome: TxOutcome; readyAtIso?: string }>("earn.unstake", { poolId: p.poolId, amount: "all" });
    report("unstake", outcome);
    if (outcome.status === "done" && readyAtIso) console.log(`   Ready to bring home at ${readyAtIso} UTC (in about ${hoursFromNow(readyAtIso)} hours). Then: node tools/earn/proof.ts ${accountId} home`);
  }

  if (step === "home") {
    const [p] = (await positions()).filter((x) => Number(x.unstaked) > 0);
    if (!p) throw new Error("Nothing of yours is waiting at a pool, so there's nothing to bring home.");
    if (!p.canWithdraw) {
      console.log(`Not yet: ${p.unstaked} NEAR at ${p.name} is ready at ${p.readyAtIso} UTC (in about ${hoursFromNow(p.readyAtIso!)} hours). Run this again then.`);
      process.exit(2);
    }
    // To the NEAR Intents balance needs a chain of steps, so only with ZeroFee's account rules; else to the account.
    const toLedger = rulesVersion >= 2;
    console.log(`Bring ${p.unstaked} NEAR home from ${p.name}, to ${toLedger ? "your NEAR Intents balance" : "the account"}.`);
    report("home", await call<TxOutcome>("earn.withdraw", { poolId: p.poolId, toLedger }));
  }

  if (step !== "read") for (const h of (await call<HistoryItem[]>("earn.history")).slice(0, 3)) console.log(`   History: ${h.status} · ${h.kind} ${h.amount} NEAR · ${h.name} · ${h.atIso}`);
} catch (e) {
  console.log(`Stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  closeTerminal();
}
