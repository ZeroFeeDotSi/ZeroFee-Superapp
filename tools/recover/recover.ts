// The recovery tool's command line. See README.md next to this file.
//
//   node tools/recover/recover.ts start  [--account name.near] [--testnet]
//   node tools/recover/recover.ts status | finish | balance | waiting [--testnet]
//   node tools/recover/recover.ts send <to> <NEAR amount | all> [--testnet]
//   node tools/recover/recover.ts run <number> [--testnet]
//   node tools/recover/recover.ts call <contract> <method> '<json args>' [NEAR to attach] [--testnet]
//   node tools/recover/recover.ts wallets                     (every separate wallet your words make: addresses only)
//   node tools/recover/recover.ts key <kind> <chain> [number] (one wallet's key, to open it in another wallet app)
//
// The words are typed without being shown, and never saved. The new key is kept in ~/.zerofee-recovery/ (mode 600).
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { RpcChain } from "../../packages/core/src/chain.ts";
import { FileVault } from "../../packages/core/src/file-vault.ts";
import type { PlainWords, TxOutcome } from "../../packages/core/src/signer.ts";
import { Recovery, RecoveryError } from "./lib.ts";
import { HOT_PASSPHRASE, hotKey, hotWallets } from "./hot.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const testnet = args.includes("--testnet");
if (testnet) args.splice(args.indexOf("--testnet"), 1);
const account = flag("--account");
const [command, ...rest] = args;
const network = testnet ? "testnet" : "mainnet";

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false });
  if (hidden && process.stdin.isTTY) {
    // Show the question, never the words typed after it.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  }
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), hidden && process.stdout.write("\n"), resolve(answer))));
}

const words = async () => (await ask("Your 24 backup words (they won't show): ", true)).trim().toLowerCase().split(/\s+/).filter(Boolean);

/** The terminal's approval sheet: every line of what is about to be signed, then a typed yes. */
async function confirm(w: PlainWords): Promise<boolean> {
  console.log(`\n  ${w.title}`);
  for (const line of w.lines) console.log(`    ${line}`);
  for (const warn of w.warnings) console.log(`  ! ${warn.text}`);
  for (const e of w.effect) console.log(`    ${e.token}: ${e.before} → ${e.after}`);
  return (await ask("\nType yes to sign it: ")).trim().toLowerCase() === "yes";
}

function nearToYocto(text: string): bigint {
  const m = /^(\d{1,15})(?:\.(\d{1,24}))?$/.exec(text);
  if (!m) throw new RecoveryError(`"${text}" isn't an amount of NEAR, like 1.5`);
  return BigInt(m[1]) * 10n ** 24n + BigInt((m[2] ?? "").padEnd(24, "0"));
}
const near = (yocto: bigint) => `${yocto / 10n ** 24n}.${(yocto % 10n ** 24n).toString().padStart(24, "0").slice(0, 4)} NEAR`;
const said = (o: TxOutcome) =>
  o.status === "done" ? `Done: ${o.explorerUrl}` : o.status === "waiting" ? `Held by your account's rules as number ${o.id}: it can go after ${o.readyAtIso}${o.needsSecondDevice ? ", with your second device's yes" : ""}. Then: run ${o.id}` : o.status === "declined" ? "Nothing was signed." : `It didn't go through: ${o.problem.whatHappened}`;

const tool = new Recovery({ chain: new RpcChain(network), vault: new FileVault(join(homedir(), ".zerofee-recovery", `${network}.json`)), confirm });

async function main(): Promise<string> {
  switch (command) {
    case "start": {
      const r = await tool.start(await words(), account);
      return `Started for ${r.accountId}. It can finish after ${r.readyAtIso}: then run "finish". If the account's phone stops it, it was still yours.`;
    }
    case "status": {
      const s = await tool.status();
      return s.stage === "none" ? "Nothing started from this computer." : s.stage === "waiting" ? `${s.accountId}: waiting until ${s.readyAtIso}.` : s.stage === "done" ? `${s.accountId}: this computer can use it.` : `${s.accountId}: the account's phone stopped the move.`;
    }
    case "finish":
      return `This computer can now use ${(await tool.finish(await words())).accountId}, under the same rules as a phone.`;
    case "balance": {
      const b = await tool.balance();
      return `${b.accountId}: ${near(b.nearYocto)}, of which ${near(b.spendableYocto)} can be sent.`;
    }
    case "send":
      if (rest.length !== 2) throw new RecoveryError("send <to> <amount | all>");
      return said(await tool.send(rest[0], rest[1] === "all" ? "all" : nearToYocto(rest[1])));
    case "waiting": {
      const list = await tool.waiting();
      return list.length ? list.map((w) => `${w.id}: ${w.title} (${w.ready ? "can go now" : w.needsSecondDevice ? "needs your second device" : `after ${w.readyAtIso}`})`).join("\n") : "Nothing is waiting.";
    }
    case "run":
      return said(await tool.run(String(rest[0])));
    case "call": {
      if (rest.length < 3) throw new RecoveryError("call <contract> <method> '<json args>' [NEAR]");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rest[2]);
      } catch {
        throw new RecoveryError("The args must be JSON, in single quotes.");
      }
      return said(await tool.call(rest[0], rest[1], parsed, rest[3] ? nearToYocto(rest[3]) : 0n));
    }
    // The separate wallets (docs/ESCAPE.md): straight from the words, no account and no network needed.
    case "wallets": {
      let list;
      try {
        list = hotWallets(await words());
      } catch {
        throw new RecoveryError("Those aren't your 24 words: check each one and try again.");
      }
      return [`Every separate wallet your words make (passphrase "${HOT_PASSPHRASE}"):`, ...list.map((w) => `  ${w.name}  ${w.address}  ${w.path}`), `Open one in another wallet app with: key <kind> <chain> [number], e.g. key trade sol 1`].join("\n");
    }
    case "key": {
      const [kind, chain, number] = rest;
      if (!kind || !chain) throw new RecoveryError("key <kind: trade, private, browser or pay> <chain: sol, bsc, hood, near, eth, base, gnosis or arb> [number, for a trading wallet: 1 to 5]");
      const slot = number === undefined ? 0 : Number(number) - 1;
      if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new RecoveryError("A trading wallet's number is 1 to 5.");
      if ((await ask(`This shows a secret key on screen: anyone who sees it can take everything in that wallet. Type show to go on: `)).trim().toLowerCase() !== "show") return "Nothing was shown.";
      let k;
      try {
        k = hotKey(await words(), kind, chain, slot);
      } catch (e) {
        throw new RecoveryError(String((e as Error).message).startsWith("recovery words rejected") ? "Those aren't your 24 words: check each one and try again." : String((e as Error).message));
      }
      return `${k.wallet.name}  ${k.wallet.address}\n${k.secretKey}\nImport it as a private key. Clear your screen and your terminal's history afterwards.`;
    }
    default:
      return "Commands: start, status, finish, balance, send, waiting, run, call, wallets, key. Add --testnet for testnet. See tools/recover/README.md and docs/ESCAPE.md.";
  }
}

main().then(
  (text) => console.log(text),
  (e) => {
    console.error(e instanceof RecoveryError ? e.message : "Something went wrong. Nothing was signed unless it said Done.");
    process.exit(1);
  },
);
