// RM-4's key lock (move-key.ts), speed (D145): a real lock, so two copies of the core still make one key's move one at a
// time, and a move nobody else is making starts at once (it paid a fixed 100 ms on every money move).
import { test } from "node:test";
import assert from "node:assert/strict";
import { withMoveKey } from "./move-key.ts";
import { MemoryVault } from "./vault.ts";

/** The two kinds of vault: one whose storage other copies share (lockScope: Web Locks too), and one in memory. */
const KINDS = [["a shared storage (Web Locks)", (tag: string) => ({ lockScope: `test:${tag}` })], ["a vault in memory", () => new MemoryVault()]] as const;

/** Two runs of one key at once, on `a` and `b` (the same vault, or two copies of one storage). */
async function twoAtOnce(a: unknown, b: unknown, name: string) {
  let inside = 0, overlapped = false;
  const order: string[] = [];
  const run = (who: string) => async () => {
    inside++;
    if (inside > 1) overlapped = true;
    order.push(`${who} in`);
    await new Promise((r) => setTimeout(r, 15));
    order.push(`${who} out`);
    inside--;
    return who;
  };
  const got = await Promise.all([withMoveKey(a, name, Date.now, run("a")), withMoveKey(b, name, Date.now, run("b"))]);
  return { overlapped, order, got };
}

test("RM-4 still: two copies of one key's move never run at once (control: two keys, or two vaults, do run at once)", async () => {
  for (const [label, make] of KINDS) {
    const v = make("one");
    // two cores on one vault; for a shared storage, also two copies of it (another window's vault object)
    const copies = label.startsWith("a shared") ? [[v, v], [v, make("one")]] : [[v, v]];
    for (const [a, b] of copies) {
      const one = await twoAtOnce(a, b, "key-1");
      assert.equal(one.overlapped, false, `${label}: one at a time (${one.order.join(", ")})`);
      assert.deepEqual(one.order, ["a in", "a out", "b in", "b out"], `${label}: the second waits for the first`);
      assert.deepEqual(one.got, ["a", "b"]);
    }
    // controls: different keys, or the same key on two different vaults, are not held for each other
    for (const [a, b, x, y] of [[v, v, "x", "y"], [make("one"), make("two"), "same", "same"]] as const) {
      let inside = 0, most = 0;
      const run = async () => { inside++; most = Math.max(most, inside); await new Promise((r) => setTimeout(r, 15)); inside--; };
      await Promise.all([withMoveKey(a, x, Date.now, run), withMoveKey(b, y, Date.now, run)]);
      assert.equal(most, 2, `${label}: control: ${x === y ? "two vaults" : "two keys"} run side by side`);
    }
  }
});

test("speed (D145): a move nobody else is making starts at once, never after a fixed hold (control: one being made waits for it)", async () => {
  for (const [, make] of KINDS) {
    const v = make("speed");
    // the move starts before a 50 ms timer fires (it waited a fixed 100 ms before)
    const started = await Promise.race([withMoveKey(v, "alone", Date.now, async () => "ran"), new Promise((r) => setTimeout(() => r("held"), 50))]);
    assert.equal(started, "ran");
    // control: while one is being made, a second of the same key is still waiting at that timer
    let release!: () => void;
    const first = withMoveKey(v, "busy", Date.now, () => new Promise<void>((r) => { release = r; }));
    const second = withMoveKey(v, "busy", Date.now, async () => "ran");
    const at50 = await Promise.race([second, new Promise((r) => setTimeout(() => r("waiting"), 50))]);
    assert.equal(at50, "waiting");
    release();
    await first;
    assert.equal(await second, "ran");
  }
});

test("a wait that runs out says the move is being made elsewhere, and frees its turn for the next", async () => {
  const v = new MemoryVault();
  let release!: () => void;
  const first = withMoveKey(v, "slow", Date.now, () => new Promise<void>((r) => { release = r; }));
  await assert.rejects(withMoveKey(v, "slow", Date.now, async () => "x", 20), /still being made elsewhere/);
  const third = withMoveKey(v, "slow", Date.now, async () => "third");
  release();
  await first;
  assert.equal(await third, "third", "the one that gave up never holds the key");
});
