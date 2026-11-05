// Wallet's Activity rows never show machine text (mainnet rehearsal, 3 Nov: "Sent 0.2939 NEAR · with <64-hex>"): a NEAR
// account with no name is an address, said as one, and the account's own steps come in the core's plain words.
// Control: before, the row said the whole id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rawText } from "@zerofee/core/testing/no-raw";
import { activityItem } from "@zerofee/core/activity";
import type { PastTx } from "@zerofee/core/chain";
import { describe, payeeWords } from "./format.ts";
import type { Chain, Movement, Token } from "../types.ts";

const STRANGER = "2566".padEnd(64, "c");
const tokens = new Map<string, Token>();
const chains: Chain[] = [{ id: "near", name: "NEAR" }] as Chain[];
const row = (m: Partial<Movement>): Movement => ({ id: "chain:h", kind: "transfer", status: "done", from: "near", amount: "0.293912345678", startedAtIso: "2026-11-03T10:00:00.000Z", updatedAtIso: "2026-11-03T10:00:00.000Z", explorerUrls: [], caller: "wallet", ...m });

test("Activity: a send to a NEAR account with no name says it as an address, NEAR at most 4 places; the account's own step in the core's words (control: the whole id was there)", () => {
  const sent = describe(row({ to: STRANGER }), tokens, chains);
  assert.equal(sent.title, "Sent");
  assert.equal(sent.detail, "0.2939 NEAR · to 2566cc…cccccc");
  const past: PastTx = { hash: "h", atIso: "2026-11-03T10:00:00.000Z", signerId: "alice.near", signerKey: "ed25519:11111111111111111111111111111111", receiverId: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", actions: [{ kind: "call", method: "ft_transfer_call", args: new Uint8Array(), gas: 0n, depositYocto: 1n } as never], ok: true };
  const step = describe(row({ kind: "account", amount: "0", label: activityItem(past, [], "", "mainnet").title }), tokens, chains);
  for (const r of [sent, step]) assert.deepEqual([r.title, r.detail].flatMap(rawText), [], JSON.stringify(r));
  assert.ok(rawText(`with ${STRANGER}`).length > 0, "control: the whole id is flagged");
  assert.equal(payeeWords("bob.near"), "bob.near", "control: a named account keeps its name");
});
