// ZeroFee Chat's key (D55): only Chat reaches nostr.*, with its own id stamped; the core and the demo's mock both
// refuse anyone else, and neither ever hands back a secret.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps, type Bridge } from "@zerofee/core/bridge";
import { verifyEvent } from "@zerofee/core/nostr";
import { readDmContent } from "@zerofee/core/bitchat-dm";
import { createMockBridge } from "./MockBridge.ts";

test("only Chat may call nostr.*, and its id is stamped on the call", async () => {
  const seen: Record<string, unknown>[] = [];
  const core: Bridge = { call: async (_m, p) => (seen.push(p ?? {}), { ok: { pubkey: "x" } }), on: () => () => {} };
  for (const app of ["wallet", "pay", "trade", "browser", "social", "agent", "earn", "extension"] as const) {
    const r = await forApps(core, app).call("nostr.sign", { geohash: "u0qj", kind: 20000, content: "hi" });
    assert.ok("problem" in r && r.problem.code === "security.bridge.not-allowed", app);
  }
  assert.equal(seen.length, 0);
  await forApps(core, "chat").call("nostr.publicKey", { geohash: "u0qj", app: "wallet" });
  assert.equal(seen[0]!.app, "chat", "the stamp wins over what the app says");
});

test("the demo's mock signs for Chat only, by the core's rules, and returns no secret", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const refused = await mock.call("nostr.sign", { geohash: "u0qj", kind: 20000, content: "hi" });
  assert.ok("problem" in refused, "the shell itself (no app stamp) can't sign a chat message");
  const chat = forApps(mock, "chat");
  const key = await chat.call<{ pubkey: string }>("nostr.publicKey", { geohash: "u0qj" });
  assert.ok("ok" in key && /^[0-9a-f]{64}$/.test(key.ok.pubkey));
  assert.deepEqual(Object.keys((key as { ok: object }).ok), ["pubkey"]);
  const signed = await chat.call<Record<string, unknown>>("nostr.sign", { geohash: "u0qj", kind: 20000, content: "hello", nickname: "anon1", teleport: true });
  assert.ok("ok" in signed && verifyEvent(signed.ok));
  assert.deepEqual(Object.keys(signed.ok).sort(), ["content", "created_at", "id", "kind", "pubkey", "sig", "tags"]);
  assert.equal(signed.ok.pubkey, key.ok.pubkey);
  const dm = await chat.call("nostr.sign", { geohash: "u0qj", kind: 1059, content: "x" });
  assert.ok("problem" in dm && dm.problem.code === "security.request.invalid", "no other kind (no DMs in slice 1)");
  // Another page is another person.
  const other = await forApps(createMockBridge({ latencyMs: 0 }), "chat").call<{ pubkey: string }>("nostr.publicKey", { geohash: "u0qj" });
  assert.ok("ok" in other && other.ok.pubkey !== key.ok.pubkey);
});

test("private messages (slice 2): two people seal and open each other's, both ways; Chat only; no secret, no app bytes", async () => {
  const alice = forApps(createMockBridge({ latencyMs: 0 }), "chat");
  const bob = forApps(createMockBridge({ latencyMs: 0 }), "chat");
  const keyOf = async (b: Bridge) => ((await b.call<{ pubkey: string }>("nostr.publicKey", { geohash: "u0qj" })) as { ok: { pubkey: string } }).ok.pubkey;
  const [a, b] = [await keyOf(alice), await keyOf(bob)];
  const sent = await alice.call<{ event: Record<string, unknown>; messageId: string }>("nostr.seal", { geohash: "u0qj", to: b, kind: "message", text: "hi bob" });
  assert.ok("ok" in sent);
  assert.deepEqual(Object.keys(sent.ok).sort(), ["event", "messageId"]);
  assert.ok(verifyEvent(sent.ok.event) && sent.ok.event.kind === 1059);
  assert.match(sent.ok.messageId, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  const opened = await bob.call<{ from: string; at: number; content: string } | null>("nostr.open", { geohash: "u0qj", event: sent.ok.event });
  assert.ok("ok" in opened && opened.ok);
  assert.equal(opened.ok.from, a, "the sender is Alice's key in that place");
  assert.deepEqual(await readDmContent(opened.ok.content), { kind: "message", messageId: sent.ok.messageId, text: "hi bob" });
  // Bob answers with a delivered ack and a message; Alice opens both.
  const ack = await bob.call<{ event: unknown }>("nostr.seal", { geohash: "u0qj", to: a, kind: "delivered", messageId: sent.ok.messageId });
  assert.ok("ok" in ack);
  const back = await alice.call<{ content: string }>("nostr.open", { geohash: "u0qj", event: ack.ok.event });
  assert.ok("ok" in back && back.ok);
  assert.deepEqual(await readDmContent(back.ok.content), { kind: "delivered", messageId: sent.ok.messageId });
  // Not ours (another place's key, a third person's wrap): nothing, not an error.
  const elsewhere = await bob.call("nostr.open", { geohash: "u0qm", event: sent.ok.event });
  assert.ok("ok" in elsewhere && elsewhere.ok === null);
  // Refused: to oneself, too long for BitChat (255 bytes), another kind, a bad key, no app stamp, another app.
  for (const bad of [{ to: a, kind: "message", text: "me" }, { to: b, kind: "message", text: "é".repeat(128) }, { to: b, kind: "note", text: "x" }, { to: "f".repeat(64), kind: "message", text: "x" }, { to: b, kind: "read", messageId: "has space" }]) {
    const r = await alice.call("nostr.seal", { geohash: "u0qj", ...bad });
    assert.ok("problem" in r && r.problem.code === "security.request.invalid", JSON.stringify(bad));
  }
  const shell = await createMockBridge({ latencyMs: 0 }).call("nostr.seal", { geohash: "u0qj", to: b, kind: "message", text: "x" });
  assert.ok("problem" in shell);
  const wallet = await forApps(createMockBridge({ latencyMs: 0 }), "wallet").call("nostr.open", { geohash: "u0qj", event: sent.ok.event });
  assert.ok("problem" in wallet && wallet.problem.code === "security.bridge.not-allowed");
});

test("security review 2 Nov (Low): the demo's mock knows Chat by its id, chat: no public send from the Safe into the chain wallets", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const send = { tokenId: "nep141:wrap.near", amount: "1", toAddress: "y", chain: "base" };
  for (const caller of ["trade", "browser", "social", "chat"]) {
    const r = await mock.call("ledger.withdraw", { ...send, caller });
    assert.ok("problem" in r && r.problem.code === "ledger.caller.refused", caller);
  }
  const wallet = await mock.call("ledger.withdraw", { ...send, caller: "wallet" });
  assert.ok("ok" in wallet, "the control: Wallet still sends");
});

test("the demo's subwallet.send: Wallet's own Send's only (V4 Send from a row; Chat pays from the private balance), no sheet (D143), refused when the chain wallet holds too little", async () => {
  // the sample Solana wallet holds 1.42 SOL
  const mock = createMockBridge({ latencyMs: 0, float: { opening: { sol: "1420000000" } } });
  const sheets: { title: string; lines: string[]; hint?: string }[] = [];
  // every sheet would be answered no: a chain wallet is a hot key, so its send raises none (core approval-policy.ts)
  mock.on<{ id: string; words: { title: string; lines: string[]; hint?: string } }>("approval.needed", (a) => { sheets.push(a.words); void mock.call("approval.answer", { id: a.id, approve: false }); });
  await mock.call("subwallet.create", { chain: "sol" });
  const to = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const ask = { chain: "sol", to, amount: "0.5" };
  const held = async () => {
    const r = await forApps(mock, "wallet").call<{ token: string; amount: string }[]>("subwallet.balances", { id: "sw-trade-sol" });
    return "ok" in r ? r.ok.find((x) => x.token === "native")?.amount : undefined;
  };
  const before = await held();
  for (const app of ["chat", "trade", "browser", "social", "pay", undefined]) {
    const r = await (app ? forApps(mock, app as never) : mock).call("subwallet.send", ask);
    assert.ok("problem" in r && /not-allowed/.test(r.problem.code), app ?? "the shell");
  }
  // review L4: Chat's allowlist has no subwallet.* any more: the bridge refuses it before the demo (or the core) hears it
  const chat = await forApps(mock, "chat").call("subwallet.send", ask);
  assert.ok("problem" in chat && chat.problem.code === "security.bridge.not-allowed", JSON.stringify(chat));
  assert.equal(await held(), before, "nothing left the wallet for any refusal");
  // Wallet's own Send from the SOL row (the person's Hold): sent, with no sheet, and never said to be Chat's
  const w = await forApps(mock, "wallet").call<{ status: string }>("subwallet.send", { ...ask, amount: "0.1" });
  assert.ok("ok" in w && w.ok.status === "done", JSON.stringify(w));
  assert.equal(BigInt(before ?? "0") - BigInt((await held()) ?? "0"), 100_000_000n, "0.1 SOL left the sample wallet");
  const short = await forApps(mock, "wallet").call("subwallet.send", { ...ask, amount: "5" });
  assert.ok("problem" in short && short.problem.code === "security.balance.low-coin", "too little: refused");
  assert.equal(sheets.length, 0, "no sheet, for the send or any refusal");
});
