import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "@zerofee/core/device-key";
import { ProblemError } from "@zerofee/core/problem";
import type { BridgeResult } from "@zerofee/core/bridge";
import type { IosHost } from "./ios.ts";
import { HostKey, hostDeviceKeys } from "./vault.ts";

const publicKey = SoftwareKey.generate().publicKey;

/** A stand-in phone: answers key.create / key.info with whatever the test says, and records the calls. */
function phone(answer: (method: string) => BridgeResult<unknown>): { host: IosHost; calls: string[] } {
  const calls: string[] = [];
  const host: IosHost = {
    async call<T>(method: string) {
      calls.push(method);
      return answer(method) as BridgeResult<T>;
    },
    on: () => () => {},
  };
  return { host, calls };
}

const refused = { problem: { code: "security.key.refused", whatHappened: "Face ID didn't approve it.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } } as const;

test("make asks the chip to create the key and returns it as the account key", async () => {
  const { host, calls } = phone(() => ({ ok: { publicKey } }));
  const key = await hostDeviceKeys(host).make();
  assert.ok(key instanceof HostKey);
  assert.equal(key.publicKey, publicKey);
  assert.equal(key.kind, "secure-chip");
  assert.deepEqual(calls, ["key.create"]);
});

test("make never resolves null: a refusal or an empty key becomes a Problem the shell shows", async () => {
  const no = phone(() => refused);
  await assert.rejects(hostDeviceKeys(no.host).make(), (e) => e instanceof ProblemError && e.problem.whatHappened === "Face ID didn't approve it." && e.problem.money.state === "not-involved");
  const empty = phone(() => ({ ok: { publicKey: null } }));
  await assert.rejects(hostDeviceKeys(empty.host).make(), (e) => e instanceof ProblemError && e.problem.code === "security.key.refused");
});

test("get only looks (key.info): null when the phone has no key or can't answer, and it never creates one", async () => {
  const none = phone(() => ({ ok: { publicKey: null } }));
  assert.equal(await hostDeviceKeys(none.host).get(), null);
  assert.deepEqual(none.calls, ["key.info"]);
  assert.equal(await hostDeviceKeys(phone(() => refused).host).get(), null);
  const has = phone(() => ({ ok: { publicKey } }));
  assert.equal((await hostDeviceKeys(has.host).get())?.publicKey, publicKey);
});

test("forget leaves the chip key alone (no call to the phone)", async () => {
  const { host, calls } = phone(() => ({ ok: { publicKey } }));
  await hostDeviceKeys(host).forget();
  assert.deepEqual(calls, []);
});
