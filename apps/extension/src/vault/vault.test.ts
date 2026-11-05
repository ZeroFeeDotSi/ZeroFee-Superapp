import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64, fromBase58 } from "@zerofee/trade/sol/bytes.ts";
import { ataOf, PROGRAM } from "@zerofee/trade/sol/keys.ts";
import { BLOCKHASH } from "@zerofee/trade/sol/testing/replay.ts";
import { buildTx, closeAccount, decodeTx, transfer } from "@zerofee/trade/sol/tx.ts";
import { solanaKey } from "./keys.ts";
import { openLink } from "./link.ts";
import { StaleBlockhash } from "./spend.ts";
import { createVault, IDLE_MS, type Store } from "./vault.ts";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASS = "a long passcode 1";
const mint = "EHPugw1ghE46BeySAa7cHvoZHwYometbp1aK1Q7jpump";

const memory = (): Store & { dump(): string } => {
  const m = new Map<string, string>();
  return {
    async get<T>(k: string) { const v = m.get(k); return v === undefined ? undefined : (JSON.parse(v) as T); },
    async set(k: string, v: unknown) { m.set(k, JSON.stringify(v)); },
    async remove(k: string) { m.delete(k); },
    dump: () => JSON.stringify([...m]),
  };
};

function setup(o: { spend?: () => Promise<bigint> } = {}) {
  let t = 1_800_000_000_000;
  const local = memory(), session = memory();
  const deps = { local, session, kdf: FAST, now: () => t, solUsd: async () => 150, spend: o.spend ?? (async () => 100_000_000n) }; // 0.1 SOL = $15
  return { vault: createVault(deps), deps, local, session, advance: (ms: number) => { t += ms; } };
}
const closeTx = (owner: string) => buildTx(owner, BLOCKHASH, [closeAccount(ataOf(owner, mint, PROGRAM.token), owner)]);

test("first run: a passcode of 10+ characters makes the wallet and opens it", async () => {
  const { vault } = setup();
  assert.deepEqual(await vault.status(), { stage: "none" });
  const short = await vault.create("123456789");
  assert.ok("problem" in short && short.problem.code === "extension.passcode.short");
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  const s = await vault.status();
  assert.equal(s.stage, "unlocked");
  assert.equal(s.stage === "unlocked" && s.sol, made.ok.sol);
  await assert.rejects(vault.create(PASS), /already exists/);
});

test("the seed is never stored in the clear", async () => {
  const { vault, local } = setup();
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  const link = await vault.linkCode(PASS, "7KQ2M-9XD4R");                     // the code the phone showed
  assert.ok("ok" in link);
  assert.deepEqual(Object.keys(link.ok).sort(), ["qr", "sol"], "the panel gets the QR, never the seed");
  const seed = await openLink(link.ok.qr, "7KQ2M9XD4R", FAST);
  assert.ok(seed);
  assert.equal(solanaKey(seed).address, made.ok.sol, "the phone gets this wallet's seed");
  assert.ok(!local.dump().includes(base64(seed)));
  const wrong = await vault.linkCode("not the passcode", "7KQ2M-9XD4R");
  assert.ok("problem" in wrong && wrong.problem.code === "extension.passcode.wrong", "the link needs the passcode again");
  const typo = await vault.linkCode(PASS, "7KQ2M-9XD4");
  assert.ok("problem" in typo && typo.problem.code === "extension.link.code");
});

test("lock, then unlock with the passcode; the wallet survives a restart of the worker", async () => {
  const { vault, deps } = setup();
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  await vault.lock();
  assert.equal((await vault.status()).stage, "locked");
  const again = createVault(deps);                                             // a new worker: same storage
  const wrong = await again.unlock("not the passcode");
  assert.ok("problem" in wrong && wrong.problem.code === "extension.passcode.wrong");
  assert.deepEqual(await again.unlock(PASS), { ok: { sol: made.ok.sol } });
  assert.equal((await again.status()).stage, "unlocked");
});

test("wrong passcodes slow down after five, then the right one still works", async () => {
  const { vault, advance } = setup();
  await vault.create(PASS);
  await vault.lock();
  for (let i = 1; i <= 4; i++) {
    const r = await vault.unlock(`wrong passcode ${i}`);
    assert.ok("problem" in r && r.problem.code === "extension.passcode.wrong", `try ${i}`);
  }
  const fifth = await vault.unlock("wrong passcode 5");
  assert.ok("problem" in fifth && fifth.problem.code === "extension.passcode.wait");
  const during = await vault.unlock(PASS);
  assert.ok("problem" in during && during.problem.code === "extension.passcode.wait", "even the right one waits");
  advance(30_001);
  assert.ok("ok" in (await vault.unlock(PASS)));
  await vault.lock();
  const fresh = await vault.unlock("wrong again");
  assert.ok("problem" in fresh && fresh.problem.code === "extension.passcode.wrong", "a right passcode resets the count");
});

test("it locks itself after an hour without a trade; a trade keeps it open", async () => {
  const { vault, advance } = setup();
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  advance(IDLE_MS - 60_000);
  assert.ok("ok" in (await vault.signSol(closeTx(made.ok.sol), { kind: "trade" })));
  advance(IDLE_MS - 60_000);
  assert.equal((await vault.status()).stage, "unlocked");
  advance(120_000);
  assert.equal((await vault.status()).stage, "locked");
  const r = await vault.signSol(closeTx(made.ok.sol), { kind: "trade" });
  assert.ok("problem" in r && r.problem.code === "extension.wallet.locked");
});

test("a trade within the limit signs in one tap, with a valid signature", async () => {
  const { vault } = setup();
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  const r = await vault.signSol(closeTx(made.ok.sol), { kind: "trade" });
  assert.ok("ok" in r);
  const t = decodeTx(r.ok.signedTx);
  assert.ok(ed25519.verify(t.signatures[0]!, t.message, fromBase58(made.ok.sol)));
});

test("over the one-tap limit needs the passcode for that trade", async () => {
  const { vault } = setup({ spend: async () => 1_000_000_000n });              // 1 SOL = $150 > $50
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  const tx = closeTx(made.ok.sol);
  const r = await vault.signSol(tx, { kind: "trade" });
  assert.ok("problem" in r && r.problem.code === "extension.trade.over-limit");
  const wrong = await vault.signSol(tx, { kind: "trade" }, { passcode: "nope nope nope" });
  assert.ok("problem" in wrong && wrong.problem.code === "extension.passcode.wrong");
  assert.ok("ok" in (await vault.signSol(tx, { kind: "trade" }, { passcode: PASS })));
  // audit L25: raising the one-tap limit needs the passcode
  const bare = await vault.setPerTradeUsd(200);
  assert.ok("problem" in bare && bare.problem.code === "extension.passcode.needed");
  const guessed = await vault.setPerTradeUsd(200, "nope nope nope");
  assert.ok("problem" in guessed && guessed.problem.code === "extension.passcode.wrong");
  assert.equal((await vault.status() as { perTradeUsd: number }).perTradeUsd, 50, "unchanged");
  assert.ok("problem" in (await vault.signSol(tx, { kind: "trade" })), "still one tap only up to $50");
  assert.deepEqual(await vault.setPerTradeUsd(200, PASS), { ok: true });
  assert.ok("ok" in (await vault.signSol(tx, { kind: "trade" })));
});

test("audit L25: lowering the limit is one tap (control); a transfer out needs the passcode every time, to any address", async () => {
  const { vault } = setup();
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  assert.deepEqual(await vault.setPerTradeUsd(20), { ok: true }, "lowering needs nothing");
  assert.deepEqual(await vault.setPerTradeUsd(20), { ok: true }, "the same value needs nothing");
  const HOME = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const out = buildTx(made.ok.sol, BLOCKHASH, [transfer(made.ok.sol, HOME, 1_000_000n)]);
  const bare = await vault.signSol(out, { kind: "withdraw", to: HOME });
  assert.ok("problem" in bare && bare.problem.code === "extension.passcode.needed", "unlocked, under the limit, still asks");
  const wrong = await vault.signSol(out, { kind: "withdraw", to: HOME }, { passcode: "nope nope nope" });
  assert.ok("problem" in wrong && wrong.problem.code === "extension.passcode.wrong");
  const r = await vault.signSol(out, { kind: "withdraw", to: HOME }, { passcode: PASS });
  assert.ok("ok" in r);
  const t = decodeTx(r.ok.signedTx);
  assert.ok(ed25519.verify(t.signatures[0]!, t.message, fromBase58(made.ok.sol)));
  // control: a trade under the limit is still one tap
  assert.ok("ok" in (await vault.signSol(closeTx(made.ok.sol), { kind: "trade" })));
});

test("nothing is signed with a stale blockhash, with or without the passcode", async () => {
  const { vault } = setup({ spend: async () => { throw new StaleBlockhash("old"); } });
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  for (const opts of [{}, { passcode: PASS }]) {
    const r = await vault.signSol(closeTx(made.ok.sol), { kind: "trade" }, opts);
    assert.ok("problem" in r && r.problem.code === "extension.sign.stale");
  }
});

test("nothing is signed when the network can't check the spend, or the rules refuse it", async () => {
  const { vault } = setup({ spend: async () => { throw new Error("no node answered"); } });
  const made = await vault.create(PASS);
  assert.ok("ok" in made);
  const r = await vault.signSol(closeTx(made.ok.sol), { kind: "trade" });
  assert.ok("problem" in r && r.problem.code === "extension.sign.unchecked");
  const drain = buildTx(made.ok.sol, BLOCKHASH, [transfer(made.ok.sol, "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", 1_000_000n)]);
  const no = await vault.signSol(drain, { kind: "trade" });
  assert.ok("problem" in no && no.problem.code === "extension.sign.refused");
  assert.match(no.problem.more!, /someone else/);
});
