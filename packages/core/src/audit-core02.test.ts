// Audit CORE-02 (kept here, FIXED): signer.ts `readable` takes these characters out of a memo's line (coins.ts,
// intents.ts), of every word the signer builds (dev-signer.ts), and of every sheet's words (demo-core.ts approveOnSheet);
// the iOS sheet refuses them (IOS-6, SheetWords.swift). The auditor's text follows.
//
// AUDIT PoC CORE-02 (branch audit-core-ios, commit 18ad8d6, 28 Oct 2026).
//
// Claim under test (docs/layers/security.md: "Every signature shows exactly what will happen, decoded from the bytes";
// signer.ts: PlainWords is "what the approval screen shows"). The approval sheet's lines are built from the transaction's
// own bytes. A coin transfer's `memo` (and NEAR Intents' `memo`) is attacker-controllable text that is copied verbatim
// into a sheet line as `Note: <memo>` (coins.ts:128, intents.ts:401/462). The core strips bidi/control characters from
// the app's `why` hint (subwallets.ts:970, tradeSessionStart) but NOT from decoded memos, so a memo can carry
// right-to-left override (U+202E) or newlines into the "what you sign" text the person reads.
//
// Property (fails on 18ad8d6): no sheet line built from the bytes should contain a C0/C1 control character or a Unicode
// bidirectional-override character. The amounts and recipients on the sheet are correct; this is about the readable text
// the person is asked to trust being manipulable by the counterparty who chose the memo.
//
// Run: node --test audit-poc/core/CORE-02-sheet-line-control-chars.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCoinCall } from "./coins.ts";
import type { CoinFacts } from "./coins.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";

const BIDI_OR_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

test("CORE-02: an attacker-chosen memo must not carry control or bidi-override characters onto the sheet", () => {
  const coin = "wrap.testnet";
  // A memo that uses a right-to-left override and a newline to dress up as extra sheet lines.
  const memo = "pay rent ‮Send 1000 NEAR to attacker.testnet\nFrom your vault";
  const args = new TextEncoder().encode(JSON.stringify({ receiver_id: "friend.testnet", amount: "1000000", memo }));
  const action: DecodedAction = { kind: "call", method: "ft_transfer", args, gas: 30_000_000_000_000n, depositYocto: 0n };
  const tx: DecodedTx = {
    signerId: "me.testnet",
    publicKey: { type: "ml-dsa-65", text: "", handle: "" },
    nonce: 1n,
    receiverId: coin,
    blockHash: "",
    actions: [action],
  };
  const facts: CoinFacts = { pools: new Map(), coins: new Map([[coin, { symbol: "wNEAR", decimals: 24 }]]) };

  const described = describeCoinCall(action, tx, facts);
  assert.ok(described, "the coin transfer should be described");
  const offending = described!.lines.filter((l) => BIDI_OR_CONTROL.test(l));
  assert.deepEqual(offending, [], "sheet lines carry control/bidi characters straight from the memo: " + JSON.stringify(offending));
});

test("CORE-02: every field of the words is readable as it stands, whoever built them", async () => {
  const { readableWords } = await import("./signer.ts");
  const bad = "a\u202eb\nc\u2066d\u0000e\u200bf\u2028g";
  const w = readableWords({ title: bad, lines: [bad], warnings: [{ kind: "large-amount", text: bad }], effect: [{ token: bad, before: bad, after: bad }], hint: bad, protection: { level: "wait", waitSeconds: 60, text: bad } });
  const texts = [w.title, ...w.lines, ...w.warnings.map((x) => x.text), ...w.effect.flatMap((e) => [e.token, e.before, e.after]), w.hint!, w.protection!.text];
  assert.deepEqual(texts.filter((t) => BIDI_OR_CONTROL.test(t) || /[\u200b\u2028]/.test(t)), []);
  assert.equal(w.title, "a b c d e f g", "each such character reads as a space; the rest is untouched");
});

test("CORE-02: an app's words reach the sheet readable, through the signer", async () => {
  const { SoftwareKey } = await import("./device-key.ts");
  const { DevSigner } = await import("./dev-signer.ts");
  const { FakeChain } = await import("./testing/fake-chain.ts");
  const chain = new FakeChain();
  const key = SoftwareKey.generate();
  chain.fund("alice.testnet", key.publicKey);
  chain.fund("bob.testnet", SoftwareKey.generate().publicKey);
  const shown: any[] = [];
  const signer = new DevSigner({ accountId: "alice.testnet", chain, key, approve: async (w) => (shown.push(w), false) });
  await signer.request({ receiverId: "bob.testnet", actions: [{ kind: "transfer", yocto: "1" }], why: "rent \u202eSend 1000 NEAR\nFrom your vault", from: "wallet" });
  assert.equal(shown.length, 1);
  assert.ok(!BIDI_OR_CONTROL.test(JSON.stringify(shown[0]).replace(/\\n/g, "\n")), JSON.stringify(shown[0]));
});

test("security review 2 Nov (Low): Unicode tag characters and stray variation selectors blank too; an emoji keeps its own", async () => {
  const { readable } = await import("./signer.ts");
  const tags = "pay\u{e0041}\u{e0042}\u{e007f}me";
  assert.equal(readable(tags), "pay   me");
  assert.equal(readable("0xab️cd"), "0xab cd", "a selector after a letter hides in an address");
  assert.equal(readable("a︀b\u{e0100}c"), "a b c");
  assert.equal(readable("love ❤️"), "love ❤️", "❤️ keeps its presentation selector");
  assert.equal(readable("❤️️"), "❤️ ", "a second selector blanks");
});
