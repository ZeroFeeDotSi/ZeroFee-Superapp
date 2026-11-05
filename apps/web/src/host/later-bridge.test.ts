import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { laterBridge } from "./later-bridge.ts";

/** A core that answers with its method's name and can raise an event. */
function fakeCore() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const core: Bridge = {
    call: async <T>(method: string) => ({ ok: method as T }),
    on: (event, handler) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as (p: unknown) => void);
      handlers.set(event, set);
      return () => set.delete(handler as (p: unknown) => void);
    },
  };
  return { core, emit: (event: string, p: unknown) => handlers.get(event)?.forEach((h) => h(p)) };
}

test("the core is made once, on first use, and never before", async () => {
  let made = 0;
  const fake = fakeCore();
  const b = laterBridge(async () => (made++, fake.core));
  assert.equal(made, 0, "nothing loads until asked");
  const [a, c] = await Promise.all([b.call("account.state"), b.call("ledger.tokens")]);
  assert.deepEqual([a, c], [{ ok: "account.state" }, { ok: "ledger.tokens" }]);
  await b.call("x");
  assert.equal(made, 1);
});

test("a listener added before the core is here hears its events; one removed before never does", async () => {
  const fake = fakeCore();
  let release!: () => void;
  const ready = new Promise<void>((r) => (release = r));
  const b = laterBridge(() => ready.then(() => fake.core));
  const heard: unknown[] = [];
  const gone: unknown[] = [];
  b.on("approval.needed", (p) => heard.push(p));
  b.on("approval.needed", (p) => gone.push(p))();
  release();
  await b.call("x");
  fake.emit("approval.needed", 1);
  assert.deepEqual(heard, [1]);
  assert.deepEqual(gone, []);
});

test("a load that fails is a Problem with Try again, and the next call loads again", async () => {
  let tries = 0;
  const fake = fakeCore();
  const b = laterBridge(async () => {
    if (tries++ === 0) throw new Error("chunk failed");
    return fake.core;
  });
  const first = await b.call("account.state");
  assert.ok("problem" in first && first.problem.next.kind === "retry", JSON.stringify(first));
  assert.deepEqual(await b.call("account.state"), { ok: "account.state" });
  assert.equal(tries, 2);
});
