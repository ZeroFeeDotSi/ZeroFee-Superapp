// the audit's four conditions on B21 (7 Nov). (a) the copy review's quiet line: Face ID approves the Safe's part only; a wallet's part and
// Private's send on their own. (b) The core's own read of the parts runs beside the Add and never holds the sheet: 1 s at
// most, later the Safe's side only. (c) Only Spending's own engine reaches subwallet.moveOthers. Each fails on dadbd65ef:
// no hotLine (no such line on the sheet), the read waits as long as it takes and the sheet waits for it (othersSettled,
// 4 s), and the core takes the parts from any app the bridge lets reach subwallet.*.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as plan from "./move-plan.ts";
import { othersForSheet } from "./move-plan.ts";
import { appMayCall } from "./bridge.ts";
import { DemoCore } from "./demo-core.ts";
import { SubWallets } from "./subwallets.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";

const P = plan as unknown as Record<string, any>;
const SAFE = "Face ID approves the Safe's part. ", NONE = "No Face ID. ";

test("(a) the copy review's quiet line, every case: by the sources, the wallets by the rows' names in the plan's order; the Safe the only source: none", () => {
  assert.equal(typeof P.hotLine, "function", "move-plan.ts exports hotLine");
  const rows: [string, string[], boolean, boolean, string | null][] = [
    ["Safe, a wallet and Private", ["your ETH (RH) wallet"], true, true, `${SAFE}Your ETH (RH) wallet and Private send on their own.`],
    ["Safe and Private", [], true, true, `${SAFE}Private sends on its own.`],
    ["Safe and a wallet", ["your ETH (RH) wallet"], false, true, `${SAFE}Your ETH (RH) wallet sends on its own.`],
    ["the Safe alone", [], false, true, null],
    ["two wallets", ["your ETH (RH) wallet", "your SOL wallet"], false, true, `${SAFE}Your SOL and ETH (RH) wallets send on their own.`],
    ["two wallets and Private", ["your SOL wallet", "your ETH (RH) wallet"], true, true, `${SAFE}Your SOL and ETH (RH) wallets and Private send on their own.`],
    ["three wallets", ["your NEAR wallet", "your SOL wallet", "your ETH (RH) wallet"], false, true, `${SAFE}Your wallets send on their own.`],
    ["three wallets and Private", ["your NEAR wallet", "your SOL wallet", "your BNB wallet"], true, true, `${SAFE}Your wallets and Private send on their own.`],
    ["no Safe: a wallet and Private", ["your ETH (RH) wallet"], true, false, `${NONE}Your ETH (RH) wallet and Private send on their own.`],
    ["no Safe: Private", [], true, false, `${NONE}Private sends on its own.`],
    ["no Safe: a wallet", ["your SOL wallet"], false, false, `${NONE}Your SOL wallet sends on its own.`],
    ["no Safe: two wallets", ["your SOL wallet", "your NEAR wallet"], false, false, `${NONE}Your SOL and NEAR wallets send on their own.`],
    ["no Safe: three wallets and Private", ["your SOL wallet", "your NEAR wallet", "your ETH (RH) wallet"], true, false, `${NONE}Your wallets and Private send on their own.`],
  ];
  for (const [name, wallets, priv, safe, want] of rows) assert.equal(P.hotLine(wallets, priv, safe), want, name);
});

test("(a) on the sheet: the row stays plain, the line is the last under the rows (the caller adds \"Anyone can see the Safe's part.\" after it); the Safe alone, no line", () => {
  const c = (n: number) => BigInt(Math.round(n * 100));
  const say = (v: bigint) => `$${(Number(v) / 100).toFixed(2)}`;
  const s = plan.moveSheet([{ wallet: "your SOL wallet", priv: c(8.39), pay: 0n }, { wallet: "your NEAR wallet", priv: 0n, pay: c(101.48) }], c(150), say, { others: [{ from: "your ETH (RH) wallet", to: "your SOL wallet", v: c(3.94) }, { from: "your ETH (RH) wallet", to: "your NEAR wallet", v: c(5.52) }] });
  assert.ok(s.lines.includes("From your ETH (RH) wallet · about $9.46"), s.lines.join(" | "));
  assert.equal(s.lines.at(-1), `${SAFE}Your ETH (RH) wallet and Private send on their own.`, s.lines.join(" | "));
  const alone = plan.moveSheet([{ wallet: "your NEAR wallet", priv: 0n, pay: c(150) }], c(150), say);
  assert.ok(!alone.lines.some((l) => /Face ID|on its own|on their own/.test(l)), alone.lines.join(" | "));
});

test("(b) a slow core read never holds the sheet: past 1 s it ends with none kept (the Safe's side only), and the sheet's leg is read at once, never waited for", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new SubWallets({ vault: new MemoryVault(), sol: { balance: () => new Promise<bigint>((r) => setTimeout(() => r(63_100_000n), 1_500)) } as never, evm: {} as never, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
    await w.create("trade", "sol");
    const job = "phone-move-slow-0123456789";
    let got: { kept: number } | undefined;
    void w.moveOthers(job, [{ from: "sol", to: "near", cents: "500" }], false).then((r) => (got = r));
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    // the sheet's leg (subwallets privateLeg) answers now, with the read still out
    assert.ok(!((w.privateLeg("dep") as unknown) instanceof Promise), "privateLeg reads the core's record at once");
    assert.equal(othersForSheet(job, "dep"), undefined, "nothing kept while it reads: the Safe's side only, now");
    mock.timers.tick(1_000);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.deepEqual(got, { kept: 0 }, "past 1 s: none kept");
    mock.timers.tick(600);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(othersForSheet(job, "dep"), undefined, "the read that came back late keeps nothing");
  } finally { mock.timers.reset(); }
});

test("(b) the core's sheet reads its leg straight (no wait for the parts' read), and nothing in the core waits for it", () => {
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /privateLeg: async \(depositAddress\) => this\.subwallets\.privateLeg\(depositAddress\),/);
  const sw = readFileSync(new URL("./subwallets.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sw, /othersSettled|othersPending/);
  assert.match(sw, /export const OTHERS_READ_MS = 1_000;/);
});

test("(c) the caller gate: subwallet.moveOthers only from Spending's own engine (Trade's bridge); refused for AgentZero, Browser, the sites' apps, Pay, the extension, Wallet's own bridge and a call naming no one; Chat and AgentZero never reach it at the bridge", async () => {
  const core = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), unstampedIsShell: false });
  const ask = (app: string | undefined) => core.call("subwallet.moveOthers", { job: "gate-move-0123456789", others: [{ from: "sol", to: "near", cents: "100" }], ...(app === undefined ? {} : { app }) });
  for (const app of ["agent", "browser", "social", "pay", "extension", "wallet", "chat", "site", "relay", undefined]) {
    const r = await ask(app);
    assert.ok("problem" in r && r.problem.code === "security.request.not-allowed", `${app}: ${JSON.stringify(r)}`);
  }
  const t = await ask("trade");
  assert.ok(!("problem" in t) || t.problem.code !== "security.request.not-allowed", `control: Trade's own passes the gate (${JSON.stringify(t)})`);
  for (const app of ["agent", "chat"] as const) assert.equal(appMayCall(app, "subwallet.moveOthers"), false, app);
});
