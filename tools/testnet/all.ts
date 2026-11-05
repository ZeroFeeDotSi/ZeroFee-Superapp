// Every testnet proof in one command: one line per proof, a total, and exit 1 if any failed.
//
//   node tools/testnet/all.ts                 check the funders, then run every proof
//   node tools/testnet/all.ts --check         only check whether the funders can pay for a full run
//   node tools/testnet/all.ts laptop rules    only these proofs (by key, see PROOFS)
//
// Before anything runs, it works out which of our funders pays for each new account (as funder.ts picks them) and
// stops if they can't cover the run, saying how much NEAR is missing. Each proof's full output goes to a private log
// under $ZEROFEE_HOME/testnet/proofs/<run>/; the proofs print no secrets.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { FUNDERS, FUNDER_SPARE, funderBudgets } from "./funder.ts";

const NEAR = 10n ** 24n;
const near = (y: bigint) => `${(Number(y / 10n ** 21n) / 1000).toFixed(3)} NEAR`;
const dir = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");

interface Proof {
  key: string;
  name: string;
  script: string;
  /** NEAR each new account it makes gets from a funder, in tenths. */
  accounts: bigint[];
  /** Arguments, possibly read from an earlier proof's output. */
  args?: (logs: Map<string, string>) => string[];
}

const PROOFS: Proof[] = [
  { key: "pq", name: "M1  an account with only post-quantum keys", script: "tools/testnet/pq-account.ts", accounts: [20n] },
  {
    key: "recovery",
    name: "M3  24 words that can't steal the account",
    script: "tools/testnet/recovery-policy.ts",
    accounts: [],
    args: (logs) => [/account (zf-[0-9a-f]{10}\.testnet)/.exec(logs.get("pq") ?? "")?.[1] ?? "(M1 made no account)"],
  },
  { key: "demo", name: "S1.4 the demo core: create, back up, recover", script: "tools/testnet/demo-core.ts", accounts: [20n] },
  { key: "rules", name: "S1.6c protection by amount, second device", script: "tools/testnet/account-rules.ts", accounts: [45n] },
  { key: "laptop", name: "S1.8 the laptop as second signer", script: "tools/testnet/second-device.ts", accounts: [] },
];

const flags = process.argv.slice(2);
const checkOnly = flags.includes("--check");
const wanted = flags.filter((f) => !f.startsWith("--"));
const run = PROOFS.filter((p) => wanted.length === 0 || wanted.includes(p.key) || (p.key === "pq" && wanted.includes("recovery")));
if (wanted.some((w) => !PROOFS.some((p) => p.key === w))) {
  console.error(`Unknown proof. Choose from: ${PROOFS.map((p) => p.key).join(", ")}`);
  process.exit(2);
}

// The laptop proof uses the e2e account; without one, make-account.ts makes it first (another 4.5 NEAR).
const e2e = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("e2e-")).sort().at(-1) : undefined;
if (run.some((p) => p.key === "laptop") && !e2e) run.splice(run.findIndex((p) => p.key === "laptop"), 0, { key: "e2e", name: "     make the e2e account", script: "tools/testnet/make-account.ts", accounts: [45n] });

// ── Can the funders pay for this run? ──
const chain = new RpcChain("testnet");
const budgets = await funderBudgets(chain);
const left = new Map(budgets);
let missing = 0n;
const needs: bigint[] = run.flatMap((p) => p.accounts.map((tenths) => (tenths * NEAR) / 10n));
for (const deposit of needs) {
  // funder.ts takes the first funder that can pay the deposit and still keep its spare.
  const id = FUNDERS.find((f) => (left.get(f) ?? 0n) >= deposit);
  if (id) left.set(id, left.get(id)! - deposit - NEAR / 100n);
  else missing += deposit;
}
if (run.some((p) => p.key === "laptop") && e2e) {
  const { accountId } = JSON.parse(readFileSync(join(dir, e2e), "utf8")) as { accountId: string };
  const a = await chain.account(accountId, await chain.commonBlock());
  const free = a ? a.balanceYocto - a.storageBytes * 10n ** 19n : 0n;
  if (free < (2n * NEAR) / 10n) missing += (2n * NEAR) / 10n - free;
}
const total = needs.reduce((s, x) => s + x, 0n);
console.log(`Funders can give: ${FUNDERS.map((f) => `${f} ${near(budgets.get(f) ?? 0n)}`).join(", ")} (each keeps ${near(FUNDER_SPARE)} for fees).`);
console.log(`This run makes ${needs.length} new account(s) needing ${near(total)} in all.`);
if (missing > 0n) {
  console.log(`NOT ENOUGH: about ${near(missing)} more is needed. Top up ${FUNDERS[0]} with at least ${near(missing + NEAR)} (testnet NEAR is free; that covers its fees too), then run this again.`);
  process.exit(1);
}
if (checkOnly) {
  console.log("Enough for this run.");
  process.exit(0);
}

// ── Run them, one after another ──
const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const logDir = join(dir, "proofs", runId);
mkdirSync(logDir, { recursive: true, mode: 0o700 });
const logs = new Map<string, string>();
const t0 = Date.now();
let failed = 0;
for (const p of run) {
  const started = Date.now();
  const logFile = join(logDir, `${p.key}.log`);
  const out = createWriteStream(logFile, { mode: 0o600 });
  let text = "";
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [p.script, ...(p.args?.(logs) ?? [])], { stdio: ["ignore", "pipe", "pipe"] });
    const keep = (b: Buffer) => {
      text += b.toString();
      out.write(b);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), 30 * 60_000);
    child.on("close", (c) => (clearTimeout(timer), resolve(c ?? 1)));
  });
  out.end();
  logs.set(p.key, text);
  const secs = `${Math.round((Date.now() - started) / 1000)} s`.padStart(6);
  if (code === 0) console.log(`PASS  ${p.name.padEnd(48)} ${secs}`);
  else {
    failed++;
    const last = text.trim().split("\n").filter((l) => l.trim()).at(-1)?.trim().slice(0, 160) ?? "";
    console.log(`FAIL  ${p.name.padEnd(48)} ${secs}   ${last}`);
  }
}
const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(failed === 0 ? `\nALL ${run.length} PASSED in ${mins} min. Logs: ${logDir}` : `\n${failed} OF ${run.length} FAILED in ${mins} min. Logs: ${logDir}`);
process.exit(failed === 0 ? 0 : 1);
