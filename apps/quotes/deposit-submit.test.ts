// The relay's deposit/submit (1Click's "Submit deposit hash"): only a deposit this relay quoted (its tag), only a
// transaction hash and the address, the partner key added upstream only and never in an answer. Controls pass the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, UPSTREAM, createRelay } from "./relay.mjs";

const KEY = "partner-key-SECRET-1234567890";
const SECRET = "relay-tag-secret";
const SOL_DEPOSIT = "5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn";  // generated sample
const SIG = "5".repeat(88);
const tagOf = (d: string) => createHmac("sha256", SECRET).update(d).digest("base64url");

function setup(echoKey = false) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => (sent.push({ url, init }), new Response(JSON.stringify({ status: "KNOWN_DEPOSIT_TX", ...(echoKey ? { leak: KEY } : {}) }), { status: 200 }));
  const relay = createRelay({ key: KEY, secret: SECRET, origins: [...APP_ORIGINS], fetchFn });
  const post = (path: string, body: unknown, tag?: string) =>
    relay(new Request(`https://quotes.example${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(tag ? { "x-zerofee-status-tag": tag } : {}) } }), "203.0.113.9");
  return { sent, post };
}

test("deposit/submit: with its quote's tag, the hash and address only go to 1Click's fixed address, the partner key added there only", async () => {
  for (const path of ["/v0/deposit/submit", "/api/relay?route=deposit-submit"]) {
    const { sent, post } = setup();
    const r = await post(path, { txHash: SIG, depositAddress: SOL_DEPOSIT, nearSenderAccount: "someone.near", extra: 1 }, tagOf(SOL_DEPOSIT));
    assert.equal(r.status, 200, path);
    assert.ok(!(await r.text()).includes(KEY), "the key never in the answer");
    assert.deepEqual(sent.map((s) => s.url), [`${UPSTREAM}/deposit/submit`]);
    assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), { txHash: SIG, depositAddress: SOL_DEPOSIT }, "rebuilt from the two fields only");
    assert.equal((sent[0]!.init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
  }
  // an EVM deposit's hash is 0x and 64 hex
  const evm = "0x" + "a".repeat(40);
  assert.equal((await setup().post("/v0/deposit/submit", { txHash: "0x" + "b".repeat(64), depositAddress: evm }, tagOf(evm))).status, 200);
});

test("deposit/submit: no tag, another deposit's tag, or a hash or address of the wrong shape is refused before 1Click is asked; an answer naming the key is never passed on", async () => {
  const cases: [string, unknown, string | undefined][] = [
    ["no tag", { txHash: SIG, depositAddress: SOL_DEPOSIT }, undefined],
    ["another deposit's tag", { txHash: SIG, depositAddress: SOL_DEPOSIT }, tagOf("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")],
    ["a hash of the wrong shape", { txHash: "not a hash", depositAddress: SOL_DEPOSIT }, tagOf(SOL_DEPOSIT)],
    ["an address of the wrong shape", { txHash: SIG, depositAddress: "kid.near" }, tagOf("kid.near")],
  ];
  for (const [name, body, tag] of cases) {
    const { sent, post } = setup();
    assert.equal((await post("/v0/deposit/submit", body, tag)).status, 400, name);
    assert.equal(sent.length, 0, `${name}: 1Click not asked`);
  }
  const leaky = setup(true);
  const r = await leaky.post("/v0/deposit/submit", { txHash: SIG, depositAddress: SOL_DEPOSIT }, tagOf(SOL_DEPOSIT));
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes(KEY));
});
