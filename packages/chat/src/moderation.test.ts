// Hide and mute, on this device (slice 2): bounded, damaged lists read as empty, one's own messages always show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_HIDDEN, hide, mute, readHidden, readMuted, unmute, visible } from "./moderation.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const id = (n: number) => n.toString(16).padStart(64, "0");

test("mute and unmute one person; hide one message; one's own always show", () => {
  const list = mute(mute([], { pubkey: A, who: "eve#aaaa" }), { pubkey: A, who: "eve#aaaa" });
  assert.equal(list.length, 1, "muting twice is once");
  const msgs = [
    { id: id(1), pubkey: A, mine: false },
    { id: id(2), pubkey: B, mine: false },
    { id: id(3), pubkey: B, mine: false },
    { id: id(4), pubkey: A, mine: true },
  ];
  const shown = visible(msgs, new Set(hide([], id(3))), new Set(list.map((m) => m.pubkey)));
  assert.deepEqual(shown.map((m) => m.id), [id(2), id(4)]);
  assert.deepEqual(unmute(list, A), []);
});

test("stored lists: damaged reads as empty, junk entries dropped, bounded", () => {
  assert.deepEqual(readMuted("{not json"), []);
  assert.deepEqual(readMuted(JSON.stringify([{ pubkey: "x", who: "y" }, { pubkey: A, who: "eve" }, null, 3])), [{ pubkey: A, who: "eve" }]);
  assert.deepEqual(readHidden(JSON.stringify([id(1), "nope", 5])), [id(1)]);
  let h: string[] = [];
  for (let i = 0; i < MAX_HIDDEN + 5; i++) h = hide(h, id(i));
  assert.equal(h.length, MAX_HIDDEN);
  assert.equal(h[0], id(5), "the oldest go first");
});
