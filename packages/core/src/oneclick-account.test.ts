// A confidential wallet's balances from 1Click (oneclick-account.ts): NEAR Intents' versioned nonce against the example
// in near/intents' docs, the one sign-in shape the core signs (an empty list of intents), and the read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateBalances, signInPayload, timestampedRandom, versionedNonce } from "./oneclick-account.ts";
import { nep413Hash } from "./private-pocket.ts";
import { base64, fromBase58 } from "./sol/bytes.ts";

const fromHex = (h: string) => Uint8Array.from(h.replace(/ /g, "").match(/../g)!.map((x) => parseInt(x, 16)));

test("the versioned nonce is near/intents' example byte for byte: magic, version 0, salt, deadline in ns (LE), random", () => {
  // From the defuse crate docs: 56 28 f6 c6 | 00 | 25 28 12 b3 | 00 36 72 90 57 5b a4 1f | 02 70 15 ec 13 dc 11 86 49 73 13 8f e6 81 2f
  const nonce = versionedNonce("252812b3", 2_280_047_743_000, fromHex("02 70 15 ec 13 dc 11 86 49 73 13 8f e6 81 2f"));
  assert.equal(base64(nonce), "Vij2xgAlKBKzADZykFdbpB8CcBXsE9wRhklzE4/mgS8=");
  assert.throws(() => versionedNonce("xyz", 0));
  assert.throws(() => versionedNonce("252812b3", 0, new Uint8Array(14)));
});

// Audit F-1: 1Click answered 401 "timestamp validation failed" to every sign-in, because the nonce's 15 bytes were all
// random. Its SDK (intents-sdk VersionedNonceBuilder.createTimestampedNonceBytes) puts the sign-in's start time (ns, i64
// LE) in their first 8; with that, a throwaway key got 201 and a session (live, 29 Oct 2026).
test("F-1: the sign-in's nonce carries its start time in nanoseconds right after the deadline, as 1Click's SDK builds it", () => {
  const start = Date.UTC(2026, 9, 29, 5, 3, 50), deadline = start + 120_000;
  const p = signInPayload("ab".repeat(32), "252812b3", deadline, start);
  const nonce = Uint8Array.from(atob(p.nonce), (c) => c.charCodeAt(0)), v = new DataView(nonce.buffer);
  assert.equal(nonce.length, 32);
  assert.equal(v.getBigUint64(9, true), BigInt(deadline) * 1_000_000n, "the deadline (ns)");
  assert.equal(v.getBigInt64(17, true), BigInt(start) * 1_000_000n, "the start time (ns)");
  // the SDK's own bytes for the same inputs: its encodeNonce over createTimestampedNonceBytes, rest 01..07
  const rest = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(base64(versionedNonce("252812b3", deadline, timestampedRandom(start, rest))), signInPayload("ab".repeat(32), "252812b3", deadline, start, timestampedRandom(start, rest)).nonce);
  assert.throws(() => timestampedRandom(start, new Uint8Array(8)));
});

test("the sign-in moves nothing: an empty list of intents for intents.near, from the wallet itself, with its deadline", () => {
  const p = signInPayload("ab".repeat(32), "252812b3", Date.UTC(2026, 9, 28, 12, 0, 0));
  assert.equal(p.recipient, "intents.near");
  assert.equal(p.callbackUrl, undefined);
  assert.deepEqual(JSON.parse(p.message), { deadline: "2026-10-28T12:00:00.000Z", intents: [], signer_id: "ab".repeat(32) });
  assert.equal(p.message, '{"deadline":"2026-10-28T12:00:00.000Z","intents":[],"signer_id":"' + "ab".repeat(32) + '"}');
});

test("the read: signs in with the wallet's own key, then reads with that session; keeps plain ids and whole amounts only", async () => {
  const secret = new Uint8Array(32).fill(3);
  const address = Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    if (url.endsWith("/auth/authenticate")) return new Response(JSON.stringify({ accessToken: "session-1", refreshToken: "r", expiresIn: 600, refreshExpiresIn: 6000 }));
    return new Response(JSON.stringify({ balances: [
      { tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", available: "49900000", source: "private" },
      { tokenId: "nep141:sol.omft.near", available: "0", source: "private" },
      { tokenId: "<script>", available: "5", source: "private" },
      { tokenId: "nep141:wrap.near", available: "1e3", source: "private" },
    ] }));
  }) as typeof globalThis.fetch;
  const got = await privateBalances({ signerId: address, secret, salt: async () => "252812b3", fetch, now: () => Date.UTC(2026, 9, 28) });
  assert.deepEqual(got, [{ tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "49900000" }]);
  assert.equal(asked[0]!.url, "https://1click.chaindefuser.com/v0/auth/authenticate");
  const { signedData } = JSON.parse(String(asked[0]!.init!.body));
  assert.equal(signedData.standard, "nep413");
  assert.deepEqual(JSON.parse(signedData.payload.message).intents, []);
  assert.equal(JSON.parse(signedData.payload.message).signer_id, address);
  // The signature is the wallet's own, over exactly that payload.
  assert.ok(ed25519.verify(fromBase58(signedData.signature.slice(8)), nep413Hash(signedData.payload), fromBase58(signedData.public_key.slice(8))));
  // F-1: signed at the core's own clock, the start time is in the nonce
  const signedNonce = Uint8Array.from(atob(signedData.payload.nonce), (c) => c.charCodeAt(0));
  assert.equal(new DataView(signedNonce.buffer).getBigInt64(17, true), BigInt(Date.UTC(2026, 9, 28)) * 1_000_000n);
  assert.equal(asked[1]!.url, "https://1click.chaindefuser.com/v0/account/balances");
  assert.equal((asked[1]!.init!.headers as Record<string, string>).authorization, "Bearer session-1");
  // No salt, or a refused sign-in: an error, never an empty balance.
  await assert.rejects(privateBalances({ signerId: address, secret, salt: async () => null, fetch }));
  await assert.rejects(privateBalances({ signerId: address, secret, salt: async () => "252812b3", fetch: (async () => new Response("no", { status: 401 })) as typeof globalThis.fetch }));
});
