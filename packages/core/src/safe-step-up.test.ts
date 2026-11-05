// D143 on the web (product decision, 3 Nov, P0: "I could sign a txn from the Safe… without any issue: no Face ID, no iPhone key
// check"). Every signature of the Safe's key needs, after the sheet's Approve, a fresh check that the person is there
// (safeStepUp: the browser's passkey, user verification read from its signed flags). Enforced in the core, where it
// signs: a shell that answers the sheet yes still can't sign without it. Trading wallets never reach the Safe's sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DemoCore } from "./demo-core.ts";
import { SecondDeviceCore } from "./second-device.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { MemoryVault } from "./vault.ts";
import { SoftwareKey } from "./device-key.ts";
import type { Bridge, BridgeResult } from "./bridge.ts";
import type { PlainWords } from "./signer.ts";

const wasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy-short-waits.wasm", import.meta.url)));
const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}`);
  return r.ok;
};
/** The shell's sheet, answering yes to everything (what a script on the page could do). */
function yesSheet(core: Bridge) {
  const shown: PlainWords[] = [];
  core.on<{ id: string; words: PlainWords }>("approval.needed", ({ id, words }) => (shown.push(words), void core.call("approval.answer", { id, approve: true })));
  return shown;
}
/** Face ID up to 5 NEAR, more waits (demo-core.test.ts's bands). */
const HOLD_ABOVE_5_NEAR = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];
const pay = { request: { receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1000000000000000000000000" }], why: "", from: "wallet" } };

async function ready(stepUp: () => Promise<boolean>) {
  const chain = new FakeChain();
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const asked: string[] = [];
  let pass = true; // set-up passes; each test sets what the payment's check says
  const core = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => rulesWasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), protection: HOLD_ABOVE_5_NEAR, watchIntervalMs: 20, indexRetryMs: 1, userVerified: async () => true,
    safeStepUp: async (reason) => (asked.push(reason), pass ? true : stepUp()) });
  yesSheet(core);
  ok(await core.call("account.create"));
  const { words } = ok(await core.call<{ words: string[] }>("recovery.words"));
  ok(await core.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  pass = false;
  asked.length = 0;
  return { core, asked };
}

test("a Safe payment approved on the sheet but without a fresh check is refused by name, and nothing is signed", async () => {
  const { core, asked } = await ready(async () => false);
  const r = await core.call<{ status: string; problem?: { code: string } }>("tx.request", pay);
  const out = "ok" in r ? r.ok : { status: "problem", problem: r.problem };
  assert.equal(out.status, "problem");
  assert.equal(out.problem?.code, "security.safe.not-verified");
  assert.equal(asked.length, 1, "asked once, after Approve");
  // a check that throws (a cancelled prompt) is a no too
  const t = await ready(async () => { throw new Error("cancelled"); });
  const r2 = await t.core.call<{ status: string; problem?: { code: string } }>("tx.request", pay);
  assert.equal(("ok" in r2 ? r2.ok.problem?.code : r2.problem.code), "security.safe.not-verified");
});

test("control: with the person's fresh check the same payment goes; a sheet's no asks nothing more", async () => {
  const { core, asked } = await ready(async () => true);
  const r = ok(await core.call<{ status: string }>("tx.request", pay));
  assert.equal(r.status, "done");
  assert.equal(asked.length, 1);
  // a no on the sheet: never asks the iPhone
  const chain = new FakeChain();
  let checks = 0;
  const no = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, safeStepUp: async () => (checks++, true) });
  no.on<{ id: string }>("approval.needed", ({ id }) => void no.call("approval.answer", { id, approve: false }));
  await no.call("account.create");
  await no.call("tx.request", pay);
  assert.equal(checks, 0);
});

test("the phone is never asked twice: with its own Face ID sheet the step-up isn't used", async () => {
  const chain = new FakeChain();
  let checks = 0;
  const phone = new DemoCore({ chain, vault: new MemoryVault(), policyWasm: async () => wasm, createAccount: async (id, pk) => chain.fund(id, pk), prices: async () => ({ near: 4 }), watchIntervalMs: 20, indexRetryMs: 1, sheet: async () => true, safeStepUp: async () => (checks++, false) });
  await phone.call("account.create");
  await phone.call("tx.request", pay);
  assert.equal(checks, 0);
});

test("trading wallets and sites never reach the Safe's sheet, so they are never asked (D143's speed rule); the web sets the check, the phone doesn't", () => {
  for (const f of ["./subwallets.ts", "./site-wallets.ts", "./float-moves.ts"]) {
    let src = "";
    try { src = readFileSync(new URL(f, import.meta.url), "utf8"); } catch { continue; }
    assert.doesNotMatch(src, /approveOnSheet|safeStepUp/, f);
  }
  const web = readFileSync(new URL("../../../apps/web/src/core.ts", import.meta.url), "utf8");
  // (the web wallet has no Safe and no passkey: its sheets take the password instead, the core's answerWeb)
  assert.match(web, /\.\.\.\(host \|\| WEB_WALLET \? \{\} : \{ safeStepUp: webCheck \}\)/);
  assert.match(web, /stepUp: webCheck/);
  assert.match(readFileSync(new URL("../../../apps/web/src/laptop/Laptop.tsx", import.meta.url), "utf8"), /new SecondDeviceCore\(\{[^\n]*stepUp:/);
});

test("the second device's yes (a laptop, a guardian) needs the same fresh check on the web; control: with it, the sheet's answer stands", async () => {
  const words = { title: "Say yes to: Send 900 USDC", lines: [], warnings: [], effect: [] } as unknown as PlainWords;
  const make = (stepUp?: () => Promise<boolean>) => {
    const d = new SecondDeviceCore({ chain: new FakeChain(), vault: new MemoryVault(), ...(stepUp ? { stepUp } : {}) });
    d.on<{ id: string }>("approval.needed", ({ id }) => void d.call("approval.answer", { id, approve: true }));
    return (d as unknown as { approveOnSheet: (w: PlainWords) => Promise<boolean> }).approveOnSheet(words);
  };
  await assert.rejects(make(async () => false), (e: { problem?: { code: string } }) => e.problem?.code === "security.safe.not-verified");
  assert.equal(await make(async () => true), true);
  assert.equal(await make(), true, "control: without stepUp (the phone's own sheet path) as before");
});

test("a guardian's and a Kids parent's yes on the web need the same fresh check (extension review P0): the page's guardian core gets stepUp, and the core's own second-device spaces answer through the Safe's stepped-up sheet", async () => {
  // the guardian core the web builds (apps/web/src/core.ts): stepUp in a browser, never on the phone (its sheet is Face ID)
  const web = readFileSync(new URL("../../../apps/web/src/core.ts", import.meta.url), "utf8");
  assert.match(web, /new SecondDeviceCore\(\{ chain: secondDeviceChain, vault: host \? new HostVault\(host, GUARDIAN_VAULT\) : new BrowserVault\(GUARDIAN_VAULT\), \.\.\.\(host \? \{\} : \{ stepUp: webCheck \}\) \}\)/);
  // the core's own spaces (a Kids parent, a guardian inside the core): their sheet IS the core's approveOnSheet
  const core = readFileSync(new URL("./demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /new SecondDeviceCore\(\{ chain: this\.chain, vault: secondDeviceVault\(this\.vault, space, `zerofee-\$\{space\}`\), approve: \(w\) => this\.approveOnSheet\(w\) \}\)/);
  // …and that sheet refuses a yes without the fresh check (control: with it, the yes stands)
  const words = { title: "Say yes to: Move this account to a new phone", lines: [], warnings: [], effect: [] } as unknown as PlainWords;
  const mk = (pass: boolean) => {
    const c = new DemoCore({ chain: new FakeChain(), vault: new MemoryVault(), policyWasm: async () => wasm, safeStepUp: async () => pass });
    yesSheet(c);
    return (c as unknown as { approveOnSheet: (w: PlainWords) => Promise<boolean> }).approveOnSheet(words);
  };
  await assert.rejects(mk(false), (e: { problem?: { code: string } }) => e.problem?.code === "security.safe.not-verified");
  assert.equal(await mk(true), true);
});
