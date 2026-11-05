import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { EARLIER_HISTORY, restoredHere } from "./earlier-history.ts";

const answering = (r: BridgeResult<unknown> | Error): Bridge => ({
  call: async <T,>() => {
    if (r instanceof Error) throw r;
    return r as BridgeResult<T>;
  },
  on: () => () => {},
});

test("A12 (02e, E8): Activity says where the earlier history is only when the core says the account came back from the words", async () => {
  assert.equal(EARLIER_HISTORY, "Earlier history is in Security, under Activity. It's read from your account.");
  assert.equal(await restoredHere(answering({ ok: { stage: "ready", restoredAtIso: "2026-11-01T12:00:00.000Z" } })), true);
  assert.equal(await restoredHere(answering({ ok: { stage: "ready" } })), false, "an account made on this phone has all its history here");
  assert.equal(await restoredHere(answering({ ok: { stage: "ready", restoredAtIso: "soon" } })), false);
  assert.equal(await restoredHere(answering({ problem: { code: "x", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } })), false);
  assert.equal(await restoredHere(answering(new Error("offline"))), false);
});

test("A12: Trade's Activity ends with the line, under the list and under Nothing yet; Wallet's, built on the account's record (02f), only under Nothing yet", () => {
  for (const [f, n] of [["../../wallet/src/app/screens/Activity.tsx", 1], ["../../trade/src/app/screens/Activity.tsx", 2]] as const) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(src.match(/<EarlierHistory bridge=\{bridge\} \/>/g)?.length, n, f);
  }
});
