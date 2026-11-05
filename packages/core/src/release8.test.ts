// Release 8 in the core and the fake chain: a request over 250 Tgas in all is refused before it is signed (RS-1), every
// call's gas counts as NEAR against the bands (RS-2). (The fake chain also re-checks a removal against the backup key.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { yesGasFor } from "./held.ts";
import { FakeChain } from "./testing/fake-chain.ts";

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;

function setup() {
  const chain = new FakeChain();
  const key = SoftwareKey.generate();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  chain.withRules("alice.testnet", [{ up_to: [["near", (NEAR / 10n).toString()]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "86400" } } }]);
  const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async () => true });
  return { chain, signer };
}

const callStep = (gasT: bigint) => ({ kind: "call" as const, method: "ft_transfer_call", args: { receiver_id: "burner.testnet", amount: "1", msg: "" }, depositYocto: "1", gas: (gasT * TGAS).toString() });

test("RS-1: the core refuses a request whose calls carry more than 250 Tgas in all (260 here), before anything is signed", async () => {
  const { chain, signer } = setup();
  const out = await signer.request({ receiverId: "bob.testnet", actions: [callStep(130n), callStep(130n)], why: "", from: "wallet" });
  assert.equal(out.status === "problem" && out.problem.code, "security.request.not-allowed");
  assert.equal(chain.sent.length, 0, "nothing was sent");
});

test("RS-2: a coin's call counts its gas as NEAR, so a gas-burning call is held to the Face ID band", async () => {
  const { signer } = setup();
  const burn = () => signer.request({ receiverId: "bob.testnet", actions: [callStep(40n)], why: "", from: "wallet" });
  // Release 9's count (1e9 yocto a gas): 40 Tgas counts as 0.04 NEAR, so two fit the 0.1 NEAR band, the third waits.
  assert.equal((await burn()).status, "done");
  assert.equal((await burn()).status, "done");
  assert.equal((await burn()).status, "waiting");
});

test("FB-3: a second device's yes that runs an added device carries the gas its key add and check cost", () => {
  // Release 10 round 4c: the contract reserves 40 Tgas for a key's check (second device, words, Agent); the yes carries
  // held.ts's key-add row, 75 Tgas (main's 50 and the RC's 70 are both under it). State-only kinds keep main's 25.
  assert.equal(yesGasFor({ AddSecondDevice: { public_key: "x" } }), 75_000_000_000_000);
  assert.equal(yesGasFor({ SetRecoveryKey: { public_key: "x" } }), 75_000_000_000_000);
  assert.equal(yesGasFor({ AgentSet: { public_key: "x", budget: {}, orders: [] } }), 75_000_000_000_000);
  assert.equal(yesGasFor({ SetProtection: { bands: [] } }), 25_000_000_000_000);
  assert.equal(yesGasFor({ Upgrade: { code_hash: "h" } }), 80_000_000_000_000);
  // Both sides' floors: never under the RC's 70 (15 + 40 + 15) or main's 50 for a key add, nor the RC's 15 for state.
  for (const k of ["AddSecondDevice", "SetRecoveryKey", "AgentSet"]) assert.ok(yesGasFor(k) >= 70_000_000_000_000, k);
  assert.ok(yesGasFor("SetProtection") >= 15_000_000_000_000);
  assert.ok(yesGasFor("Upgrade") >= 70_000_000_000_000, "the RC's 15 + UPGRADE_GAS 55");
});

test("FB-3: each kind's gas covers what the RC contract reserves and its own work, with at least 14 Tgas to spare", async () => {
  const { readFileSync } = await import("node:fs");
  const { YES_GAS, MAX_TX_GAS } = await import("./held.ts");
  const lib = readFileSync(new URL("../../../contracts/account-policy/src/lib.rs", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../../../contracts/account-policy/src/agent.rs", import.meta.url), "utf8");
  const u64 = (src: string, name: string) => Number(new RegExp(`const ${name}: u64 = (\\d+)_000_000_000_000;`).exec(src)![1]);
  const upgradeCheck = Number(/const UPGRADE_CHECK_GAS: Gas = Gas::from_tgas\((\d+)\);/.exec(lib)![1]);
  // What each finish attaches to the receipts it makes (the contract's reserves, in Tgas), and the contract's own work
  // around it (the 5 Nov audit's measures less the 10 then reserved; bounds for the rest).
  const reserve: Record<string, number> = {
    AddSecondDevice: u64(lib, "DEVICE_KEY_CHECK_GAS"),
    SetRecoveryKey: u64(lib, "DEVICE_KEY_CHECK_GAS"),
    AgentSet: u64(agent, "AGENT_CALLBACK_GAS"),
    Upgrade: upgradeCheck,
  };
  const ownWork: Record<string, number> = { AddSecondDevice: 16.2, SetRecoveryKey: 16.3, AgentSet: 18, Upgrade: 10, SetProtection: 3.5, AllowRelease: 3.5, AgentSetBudget: 3.5, CancelRecovery: 3.5, RemoveKey: 4, Spend: 5, SpendMany: 5 };
  assert.deepEqual(Object.keys(ownWork).sort(), Object.keys(YES_GAS).sort(), "every kind is checked");
  assert.equal(reserve.AddSecondDevice, 40);
  assert.equal(reserve.AgentSet, 40);
  assert.equal(reserve.Upgrade, 50);
  for (const [kind, row] of Object.entries(YES_GAS)) {
    const need = (reserve[kind] ?? 0) + ownWork[kind]!;
    assert.ok(row.finishTgas >= need, `${kind}: its finish counts ${need} Tgas`);
    assert.ok(row.gas >= (need + 14) * 1e12, `${kind}: ${row.gas / 1e12} Tgas for a ${need} Tgas need`);
    assert.ok(row.gas <= MAX_TX_GAS, kind);
  }
  // Control: the RC's 70 for a key add leaves Agent's 58 only 12 over, so it is caught.
  assert.equal(70 >= reserve.AgentSet! + ownWork.AgentSet! + 14, false);
});

test("round 4c: the reservation the app counts is the contract's, and the phone's own key-adding calls carry 75 Tgas", async () => {
  const { readFileSync } = await import("node:fs");
  const { KEY_CHECK_GAS } = await import("./held.ts");
  const { call, methodCallGas, KEY_CALL_GAS } = await import("./demo-core.ts");
  const lib = readFileSync(new URL("../../../contracts/account-policy/src/lib.rs", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../../../contracts/account-policy/src/agent.rs", import.meta.url), "utf8");
  const tgas = (src: string, name: string) => Number(/const [A-Z_]+: u64 = (\d+)_000_000_000_000;/.exec(src.slice(src.indexOf(`const ${name}`)))![1]) * 1e12;
  assert.equal(tgas(lib, "DEVICE_KEY_CHECK_GAS"), KEY_CHECK_GAS);
  assert.equal(tgas(agent, "AGENT_CALLBACK_GAS"), KEY_CHECK_GAS);
  assert.ok(KEY_CALL_GAS >= BigInt(KEY_CHECK_GAS) + 25n * TGAS, "the reservation and the call's own work");
  for (const m of ["add_second_device", "set_recovery_key", "agent_set", "agent_renew_key", "refill_recovery_key"]) {
    assert.equal(methodCallGas(m), KEY_CALL_GAS, m);
    assert.equal((call(m, {}) as { gas: bigint }).gas, KEY_CALL_GAS, m);
  }
  assert.equal(methodCallGas("set_protection"), 30n * TGAS, "control: any other call keeps 30 Tgas");
});
