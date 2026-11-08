// Audit 15 FQ1 (8 Nov): the pay route's 503 said a setting's name to the person ("AGENTZERO_STORE_KEY isn't set: ...",
// "AGENTZERO_RECEIVE_ACCOUNT isn't the app's pinned receiving account: ..."). Rule 8: never a machine reason. The code
// keeps which one (deploy.sh reads it). Fails on main ea3017f8a.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVER_NOT_SET_UP, createRelay } from "./relay.mjs";
import { memoryCounter } from "./guards.mjs";
import { issueToken } from "./agentzero.mjs";
import { PINNED_RECEIVE } from "./agentzero-pay.mjs";

const APP = "https://zerofee.si";
const SECRET = "s".repeat(64);
const pay = (relay: (r: Request, ip: string) => Promise<Response>) => relay(new Request("https://relay.test/v0/agentzero/pay", { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${issueToken(SECRET)}` }, body: "{}" }), "10.1.1.1");

test("FQ1: a relay not set up for paid replies says so in plain words; which setting is the code's, never the words'", async () => {
  assert.equal(SERVER_NOT_SET_UP, "ZeroFee's server isn't set up for this yet.");
  const cases = [
    { receive: PINNED_RECEIVE, code: "agentzero.pay.store-key-unset" },
    { receive: "someone-else.near", code: "agentzero.pay.receive-mismatch" },
  ];
  for (const c of cases) {
    const relay = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: "sk-ant-scan-0000", agentZeroSecret: SECRET, agentZeroReceive: c.receive, counter: { ...memoryCounter(), shared: true } });
    const r = await pay(relay);
    const body = (await r.json()) as { code: string; whatHappened: string };
    assert.deepEqual([r.status, body.code], [503, c.code]);
    assert.equal(body.whatHappened, SERVER_NOT_SET_UP);
    assert.doesNotMatch(JSON.stringify(body), /AGENTZERO_|[A-Z]{3,}_[A-Z]{3,}/, "no setting's name anywhere in the answer");
  }
  // no other whatHappened in the relay names a setting
  const src = readFileSync(new URL("./relay.mjs", import.meta.url), "utf8");
  const said = [...src.matchAll(/problem\(\d{3}, "[^"]+", "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(said.length > 10, "control: the relay's own lines were read");
  assert.deepEqual(said.filter((w) => /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(w)), []);
});
