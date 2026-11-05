// The relay's email alerts (alerts.mjs): turned on only with a signature by one of the account's own keys and then an
// emailed link and its button, removed only by an emailed link and its button, each thing told once and only after
// it's turned on, read on NEAR nodes (any node's sighting is told), off without the self-hoster's store, sender,
// public address or cron secret.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS
import { createAlerts, DEVICE_METHOD_LISTS, isDeviceKey, memoryStore, PROOF_MS } from "./alerts.mjs";
// @ts-ignore: plain JS
import { createRelay } from "./relay.mjs";
import { BASE, mlDsaKey, nearKey, OWN_KEYS, proofBy, setup, type State } from "./alerts-harness.ts";
// @ts-ignore: plain JS
import { alertsProofMessage, nep413Hash, signatureOk } from "./alerts.mjs";
import { nep413Hash as coreNep413Hash } from "../../packages/core/src/private-pocket.ts";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const ACCOUNT = "kim.near";

test("turning on: a proof by the account's key, then the emailed link's button; nothing kept before; the first round only learns", async () => {
  const state: State = { waiting: [{ id: "4", change: { Spend: {} }, ready_at_ns: "1800000000000000000" }] };
  const s = setup({ stateOf: () => state });
  const key = s.keyFor(ACCOUNT);
  assert.equal((await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email: "kim@example.com", proof: proofBy(key, ACCOUNT, "kim@example.com") })).status, 200);
  await s.settle();
  assert.equal(s.mails.length, 1);
  assert.equal(s.mails[0]!.to, "kim@example.com");
  assert.equal(await s.store.get(`alerts:sub:${ACCOUNT}`), null, "nothing kept before the link is used");
  // Opening the link only shows a button (a mail scanner's GET changes nothing).
  const opened = await s.get(s.linkIn(s.mails[0]!));
  const page = await opened.clone().text();
  assert.match(page, /<form method="post" action="\/v0\/alerts\/confirm">/);
  assert.match(opened.headers.get("content-security-policy")!, /form-action 'self'; frame-ancestors 'none'/);
  assert.equal(opened.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await s.store.get(`alerts:sub:${ACCOUNT}`), null);
  assert.match(await (await s.press(opened)).text(), /Alerts are on/);
  assert.equal((await s.store.get(`alerts:sub:${ACCOUNT}`))[0].email, "kim@example.com");
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 0 }, "the first round learns the held payment already there");
  state.pending = { new_key: "x", ready_at_ns: "1800000000000000000" };
  state.waiting = [...state.waiting!, { id: "5", change: { SetRecoveryKey: { public_key: "y" } }, ready_at_ns: "1800000000000000000" }];
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 2 });
  assert.deepEqual(s.mails.slice(1).map((m) => m.subject), ["Someone started moving your ZeroFee account to a new phone", "Something is waiting on your ZeroFee account"]);
  assert.match(s.mails[2]!.text, /new backup words is waiting\. It can go Fri 8:00 AM UTC\.\n\nIf it wasn't you, open ZeroFee on your phone and cancel it before Fri 8:00 AM UTC\./);
  assert.match(s.mails[1]!.text, /To stop: https:\/\/relay\.example\/v0\/alerts\/remove\?t=/);
  assert.doesNotMatch(s.mails[1]!.text, /Seen on one/, "both nodes showed it");
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 0 }, "told once");
  assert.equal((await s.get("/v0/alerts/check", { authorization: "Bearer wrong" })).status, 404);
  assert.equal((await s.get("/v0/alerts/check")).status, 404);
});

test("NF-01: no proof, a key not on the account, another app's key, a wrong recipient, an old or reused proof: refused", async () => {
  const s = setup();
  const key = s.keyFor(ACCOUNT);
  const ask = async (body: unknown, ip = `203.0.113.${Math.floor(Math.random() * 250)}`) => {
    const r = await s.post("/v0/alerts/subscribe", body, ip);
    return [r.status, (await r.json()).code];
  };
  const e = "kim@example.com";
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e }), [400, "quotes.alerts.proof-needed"], "the app can't sign yet: a clear no");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(nearKey(), ACCOUNT, e) }), [400, "quotes.alerts.proof-refused"], "a key not on the account");
  const dapp = s.keyFor(ACCOUNT, "game.near");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(dapp, ACCOUNT, e) }), [400, "quotes.alerts.proof-refused"], "another app's function-call key");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(key, ACCOUNT, e, { recipient: "other-relay.example" }) }), [400, "quotes.alerts.proof-refused"], "signed for another relay");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(key, ACCOUNT, "other@example.com") }), [400, "quotes.alerts.proof-refused"], "signed for another email");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(key, ACCOUNT, e, { deadline: new Date(Date.now() - 1000).toISOString() }) }), [400, "quotes.alerts.proof-refused"], "past its deadline");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(key, ACCOUNT, e, { deadline: new Date(Date.now() + PROOF_MS + 120_000).toISOString() }) }), [400, "quotes.alerts.proof-refused"], "a deadline too far ahead");
  const once = proofBy(key, ACCOUNT, e);
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: once }), [200, undefined]);
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: once }), [400, "quotes.alerts.proof-refused"], "the same proof twice");
  const device = s.keyFor(ACCOUNT, "device");
  assert.deepEqual(await ask({ accountId: ACCOUNT, email: e, proof: proofBy(device, ACCOUNT, e) }), [200, undefined], "the account's own device key (function-call on itself, DEVICE_METHODS)");
});

test("NEARchat review H1: only the device key (or full access) turns alerts on; a guardian, the recovery key, an agent's or any other function-call key on the account can't point them at its own email", async () => {
  const s = setup();
  const ask = async (kind: string, email: string) => {
    const k = s.keyFor(ACCOUNT, kind);
    const r = await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email, proof: proofBy(k, ACCOUNT, email) }, `203.0.113.${Math.floor(Math.random() * 250)}`);
    return [r.status, (await r.json()).code];
  };
  const refused = [400, "quotes.alerts.proof-refused"];
  const refusedKinds = ["guardian", "guardian-r7", "guardian-r6", "recovery", "agent", "device-plus", "device-part", "self-any", "device-elsewhere", "game.near"];
  for (const kind of refusedKinds) assert.deepEqual(await ask(kind, `${kind}@attacker.example`), refused, kind);
  assert.equal(s.mails.length, 0, "no link went to any of them");
  // The device key as the app signs (the chip's ML-DSA-65 key), without and with modules, and full access: the whole way on.
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim@example.com", s.keyFor(ACCOUNT, "device"), "198.51.100.61"), 200, "the device key");
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim2@example.com", s.keyFor(ACCOUNT, "device-modules"), "198.51.100.62"), 200, "the device key, contract with modules (any order)");
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim3@example.com", s.keyFor(ACCOUNT, "full"), "198.51.100.63"), 200, "a full-access key");
  assert.deepEqual((await s.store.get(`alerts:sub:${ACCOUNT}`)).map((x: { email: string }) => x.email), ["kim@example.com", "kim2@example.com", "kim3@example.com"]);

  // Control: the refused keys are on the account and to the account itself (all but the two to game.near), as the
  // nodes answer them; they are refused for their method lists alone. The old rule (any function-call key to the
  // account itself) took every one of those.
  const keyAnswer = async (kind: string) => {
    const k = s.keyFor(ACCOUNT, kind);
    const r = await s.nodes.fetchFn("https://rpc.mainnet.fastnear.com", { method: "POST", body: JSON.stringify({ params: { request_type: "view_access_key", account_id: ACCOUNT, public_key: k.publicKey } }) });
    return (await r.json()).result.permission.FunctionCall;
  };
  const oldRule = async (kind: string) => (await keyAnswer(kind)).receiver_id === ACCOUNT;
  for (const kind of refusedKinds.filter((k) => k !== "device-elsewhere" && k !== "game.near")) assert.equal(await oldRule(kind), true, `${kind}: on the account, to itself`);
  assert.deepEqual(isDeviceKey(ACCOUNT, await keyAnswer("guardian")), false);
  assert.deepEqual(isDeviceKey(ACCOUNT, await keyAnswer("device")), true);
  assert.deepEqual(isDeviceKey("other.near", await keyAnswer("device")), false, "another account's device key");
  assert.deepEqual(isDeviceKey(ACCOUNT, { receiver_id: ACCOUNT, method_names: [[...OWN_KEYS.device!].sort().join(",")] }), false, "one name that is the whole list, commas and all");
  assert.deepEqual(isDeviceKey(ACCOUNT, { receiver_id: ACCOUNT, method_names: [...OWN_KEYS.device!, "execute"] }), false, "a name twice");
  assert.deepEqual(isDeviceKey(ACCOUNT, { receiver_id: ACCOUNT, method_names: "execute" }), false, "not a list");
  assert.deepEqual(isDeviceKey(ACCOUNT, { receiver_id: ACCOUNT, method_names: [...OWN_KEYS.device!, 1] }), false, "a name that isn't text");
  assert.deepEqual(isDeviceKey(ACCOUNT, { receiver_id: ACCOUNT, method_names: [null] }), false, "null");
});

test("H1: the relay's device lists are the contract's: both of today's DEVICE_METHODS are among them, and none names a guardian's, the recovery key's or an agent's method", () => {
  const src = readFileSync(new URL("../../contracts/account-policy/src/lib.rs", import.meta.url), "utf8");
  const consts = (name: string) => [...src.matchAll(new RegExp(`pub const ${name}: &str = "([^"]+)"`, "g"))].map((m) => m[1]!);
  const today = consts("DEVICE_METHODS");
  assert.equal(today.length, 3, "without Agent, release 10 (Agent), and with modules");
  const asSet = (l: string) => l.split(",").sort().join(",");
  const ours = new Set((DEVICE_METHOD_LISTS as string[]).map(asSet));
  for (const l of today) assert.ok(ours.has(asSet(l)), l);
  const agent = /pub const AGENT_METHODS: &str = "([^"]+)"/.exec(readFileSync(new URL("../../contracts/account-policy/modules/agent/src/lib.rs", import.meta.url), "utf8"))![1]!;
  const others = [...consts("SECOND_DEVICE_METHODS"), ...consts("RECOVERY_METHODS"), agent].flatMap((l) => l.split(","));
  assert.ok(others.includes("approve") && others.includes("start_recovery") && others.includes("agent_pay"), "the other keys' lists were read");
  for (const l of DEVICE_METHOD_LISTS as string[]) for (const m of l.split(",")) assert.ok(!others.includes(m), `${m} is another key's`);
  assert.equal(OWN_KEYS.device!.join(","), today[0], "the harness's device key is the contract's");
  // An older account's device key (added under an earlier contract) still counts.
  for (const l of DEVICE_METHOD_LISTS as string[]) assert.equal(isDeviceKey(ACCOUNT, { receiver_id: ACCOUNT, method_names: l.split(",") }), true, l);
});

test("NF-01: a key the nodes can't confirm is 'try again', and one taken off the account before the button is pressed doesn't turn it on", async () => {
  let disagree = false;
  const s = setup({ down: () => disagree });
  const key = s.keyFor(ACCOUNT);
  disagree = true;
  const r = await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email: "kim@example.com", proof: proofBy(key, ACCOUNT, "kim@example.com") });
  assert.deepEqual([r.status, (await r.json()).code], [503, "quotes.alerts.unreadable"]);
  disagree = false;
  assert.equal((await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email: "kim@example.com", proof: proofBy(key, ACCOUNT, "kim@example.com") })).status, 200);
  await s.settle();
  s.keys.get(ACCOUNT)!.delete(key.publicKey);
  assert.match(await (await s.press(await s.get(s.linkIn(s.lastTo("kim@example.com")!)))).text(), /isn&#39;t on the account now/);
  assert.equal(await s.store.get(`alerts:sub:${ACCOUNT}`), null);
});

test("NF-01: at most three; a fourth proven email takes the oldest's place, and unproven (older) entries go first; never 'full'", async () => {
  const s = setup();
  const key = s.keyFor(ACCOUNT);
  // An entry from before proofs were asked for.
  await s.store.set(`alerts:sub:${ACCOUNT}`, [{ email: "old@example.com", remove: "r".repeat(32) }]);
  await s.store.set(`alerts:remove:${"r".repeat(32)}`, { accountId: ACCOUNT, email: "old@example.com" });
  for (const n of [1, 2, 3, 4]) assert.equal(await s.subscribeAndConfirm(ACCOUNT, `p${n}@example.com`, key, `9.9.9.${n}`), 200, `p${n}`);
  assert.deepEqual((await s.store.get(`alerts:sub:${ACCOUNT}`)).map((x: { email: string }) => x.email), ["p2@example.com", "p3@example.com", "p4@example.com"]);
  assert.equal(await s.store.get(`alerts:remove:${"r".repeat(32)}`), null, "the unproven entry's stop link is gone too");
});

test("removing: the ask answers at once and the same either way; the link shows a button; the button removes it", async () => {
  const s = setup();
  const key = s.keyFor(ACCOUNT);
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim@example.com", key), 200);
  const asked = await s.post("/v0/alerts/remove-ask", { accountId: ACCOUNT, email: "kim@example.com" });
  const other = await s.post("/v0/alerts/remove-ask", { accountId: ACCOUNT, email: "thief@example.com" });
  assert.deepEqual([asked.status, await asked.json(), other.status, await other.json()], [200, { asked: true }, 200, { asked: true }], "tells nobody what is watched");
  await s.settle();
  assert.deepEqual(s.mails.map((m) => m.to), ["kim@example.com", "kim@example.com"], "only the owner's address gets the link");
  const stop = await s.get(s.linkIn(s.mails[1]!));
  assert.notEqual(await s.store.get(`alerts:sub:${ACCOUNT}`), null, "opening the link alone removes nothing");
  // A forged button (no form token, or another link's) does nothing.
  const t = new URL(s.linkIn(s.mails[1]!)).searchParams.get("t")!;
  for (const body of [`t=${t}`, `t=${t}&f=${"x".repeat(43)}`]) {
    const r = await s.relay(new Request(`${BASE}/v0/alerts/remove`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }), "5.5.5.5");
    assert.match(await r.text(), /That link doesn&#39;t work/);
  }
  const cross = await s.relay(new Request(`${BASE}/v0/alerts/remove`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: `t=${t}` }), "5.5.5.6");
  assert.equal(cross.status, 403, "another site's form");
  assert.notEqual(await s.store.get(`alerts:sub:${ACCOUNT}`), null);
  assert.match(await (await s.press(stop)).text(), /Your email is removed/);
  assert.equal(await s.store.get(`alerts:sub:${ACCOUNT}`), null, "and it's no longer kept");
  assert.deepEqual(await s.store.members("alerts:accounts"), []);
});

test("refused: a bad account or email, a link that doesn't work, too many asks a minute", async () => {
  const s = setup();
  for (const body of [{ accountId: "Kim.near", email: "a@b.co" }, { accountId: ACCOUNT, email: "not an email" }, { accountId: ACCOUNT }, "x"]) {
    assert.equal((await s.post("/v0/alerts/subscribe", body, `8.8.8.${Math.floor(Math.random() * 250)}`)).status, 400, JSON.stringify(body));
  }
  assert.match(await (await s.get("/v0/alerts/confirm?t=nope")).text(), /<title>That link doesn&#39;t work<\/title>/);
  const stale = await s.press(await s.get(`/v0/alerts/confirm?t=${"a".repeat(32)}`));
  assert.match(await stale.text(), /doesn&#39;t work any more/);
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await s.post("/v0/alerts/remove-ask", { accountId: ACCOUNT, email: "p1@example.com" }, "7.7.7.7")).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("NF-06: a node down, the third stands in; nodes that disagree: what any shows is told, marked; the operator is told after 3 rounds", async () => {
  // drpc down: the third node agrees with the first, so it's told plainly.
  const state: State = {};
  let drpcDown = false;
  const s = setup({ stateOf: () => state, down: (u) => drpcDown && u.includes("drpc") });
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim@example.com", s.keyFor(ACCOUNT)), 200);
  await s.round();
  drpcDown = true;
  state.pending = { ready_at_ns: "1800000000000000000" };
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 1 });
  assert.doesNotMatch(s.mails.at(-1)!.text, /Seen on one/);

  // One node shows something the other doesn't: told, marked; after more than 3 such rounds the operator hears once.
  const st: State = {};
  let lie = false;
  const d = setup({ stateOf: () => st, disagree: (u) => lie && u.includes("drpc"), operator: "ops@relay.example" });
  assert.equal(await d.subscribeAndConfirm(ACCOUNT, "kim@example.com", d.keyFor(ACCOUNT)), 200);
  await d.round();
  lie = true;
  st.pending = { ready_at_ns: "1800000000000000000" };
  assert.deepEqual(await (await d.round()).json(), { accounts: 1, sent: 1 });
  assert.match(d.mails.at(-1)!.text, /Seen on one of the NEAR nodes/);
  for (let i = 0; i < 4; i++) await d.round();
  const ops = d.mails.filter((m) => m.to === "ops@relay.example");
  assert.equal(ops.length, 1);
  assert.match(ops[0]!.subject, /NEAR nodes disagree/);

  // Every node down: nothing told, nothing learned.
  let allDown = false;
  const all = setup({ stateOf: () => ({ pending: { ready_at_ns: "1" } }), down: () => allDown });
  assert.equal(await all.subscribeAndConfirm(ACCOUNT, "kim@example.com", all.keyFor(ACCOUNT)), 200);
  allDown = true;
  assert.deepEqual(await (await all.round()).json(), { accounts: 1, sent: 0 });
  assert.equal((await all.store.get(`alerts:sub:${ACCOUNT}`))[0].seen, undefined, "nothing learned either");
});

test("NF-05: each account read once per round however many emails; least recently checked first; a round stops starting new ones at its budget", async () => {
  let t = 1_000_000;
  const s = setup();
  for (const n of [1, 2, 3]) assert.equal(await s.subscribeAndConfirm(ACCOUNT, `p${n}@example.com`, s.keyFor(ACCOUNT), `9.9.9.${n}`), 200);
  const before = s.nodes.calls();
  await s.round();
  assert.equal(s.nodes.calls() - before, 10, "five reads (pending, waiting, legacy, keys, agent) on two nodes, once for three emails");
  // A round whose clock runs past its budget after the first account leaves the rest for the next, oldest first.
  const r = setup();
  for (const a of ["a.near", "b.near", "c.near"]) assert.equal(await r.subscribeAndConfirm(a, `x@${a.replace(".near", "")}.example`, r.keyFor(a), `8.8.4.${a.charCodeAt(0)}`), 200);
  const slow = createAlerts({ store: r.store, mail: async () => {}, base: BASE, cronSecret: "c", fetchFn: r.nodes.fetchFn, parallel: 1, roundMs: 10, now: () => (t += 6) });
  const call = () => slow(new Request(`${BASE}/v0/alerts/check`, { headers: { authorization: "Bearer c" } }), new URL(`${BASE}/v0/alerts/check`), (x: { body: unknown }) => x.body, () => null, "check");
  const first = await call();
  assert.ok(first.left > 0 && first.accounts < 3, JSON.stringify(first));
  const checked = await r.store.get("alerts:checked");
  const second = await call();
  const after = await r.store.get("alerts:checked");
  const fresh = Object.keys(after).filter((k) => !(k in checked));
  assert.ok(fresh.length > 0, "the next round starts with the ones never checked");
  assert.ok(second.accounts >= 1);
});

test("off without the self-hoster's store, sender, https public address or cron secret, and says so", async () => {
  for (const alerts of [
    createAlerts({ store: null, mail: async () => {}, base: BASE, cronSecret: "c" }),
    createAlerts({ store: memoryStore(), mail: null, base: BASE, cronSecret: "c" }),
    createAlerts({ store: memoryStore(), mail: async () => {}, cronSecret: "c" }),
    createAlerts({ store: memoryStore(), mail: async () => {}, base: "http://relay.example", cronSecret: "c" }),
    createAlerts({ store: memoryStore(), mail: async () => {}, base: BASE }),
    undefined,
  ]) {
    const relay = createRelay({ key: "k", secret: "s", origins: [], alerts });
    const r = await relay(new Request(`${BASE}/v0/alerts/subscribe`, { method: "POST", body: JSON.stringify({ accountId: ACCOUNT, email: "a@b.co" }) }), "3.3.3.3");
    assert.deepEqual([r.status, (await r.json()).code], [503, "quotes.alerts.off"]);
  }
});

test("NF-01, ML-DSA-65 (a ZeroFee account's only key kind): a real keypair's proof is taken; wrong account, stale, replayed, not on the account: refused", async () => {
  const s = setup();
  const key = s.keyFor(ACCOUNT); // ML-DSA-65, full 1,952-byte key in NEAR's text form
  assert.match(key.publicKey, /^ml-dsa-65:[1-9A-HJ-NP-Za-km-z]{2600,2700}$/);
  const e = "kim@example.com";
  const ask = async (accountId: string, proof: unknown) => {
    const r = await s.post("/v0/alerts/subscribe", { accountId, email: e, proof }, `203.0.113.${Math.floor(Math.random() * 250)}`);
    return [r.status, (await r.json()).code];
  };
  const good = proofBy(key, ACCOUNT, e);
  assert.ok(JSON.stringify({ accountId: ACCOUNT, email: e, proof: good }).length < 12 * 1024, "fits the body cap");
  assert.deepEqual(await ask(ACCOUNT, good), [200, undefined], "valid proof accepted");
  assert.deepEqual(await ask(ACCOUNT, good), [400, "quotes.alerts.proof-refused"], "the same nonce again");
  // Wrong account: signed for another account (by a key on that one), sent for this one; and this key's proof for an account it isn't on.
  const otherKey = s.keyFor("other.near");
  assert.deepEqual(await ask(ACCOUNT, proofBy(otherKey, "other.near", e)), [400, "quotes.alerts.proof-refused"], "message names another account");
  assert.deepEqual(await ask(ACCOUNT, proofBy(otherKey, ACCOUNT, e)), [400, "quotes.alerts.proof-refused"], "a key of another account");
  assert.deepEqual(await ask(ACCOUNT, proofBy(mlDsaKey(), ACCOUNT, e)), [400, "quotes.alerts.proof-refused"], "a key not on the account");
  assert.deepEqual(await ask(ACCOUNT, proofBy(key, ACCOUNT, e, { deadline: new Date(Date.now() - 1).toISOString() })), [400, "quotes.alerts.proof-refused"], "stale");
  // Someone else's signature under the account's public key, and the key types mixed.
  const forged = { ...proofBy(mlDsaKey(), ACCOUNT, e), publicKey: key.publicKey };
  assert.deepEqual(await ask(ACCOUNT, forged), [400, "quotes.alerts.proof-refused"], "signed by another key");
  const ed = nearKey();
  assert.deepEqual(await ask(ACCOUNT, { ...proofBy(ed, ACCOUNT, e), publicKey: key.publicKey }), [400, "quotes.alerts.proof-refused"], "an ed25519 signature for an ML-DSA key");
  // The whole flow with it: the button checks the ML-DSA key again, and alerts are on.
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim2@example.com", key, "198.51.100.40"), 200);
  // ed25519 still works, for completeness.
  assert.equal(await s.subscribeAndConfirm(ACCOUNT, "kim3@example.com", s.keyFor(ACCOUNT, "full", "ed25519"), "198.51.100.41"), 200);
});

test("the proof's bytes are the core's NEP-413 bytes; the signature check is ML-DSA-65 over that hash as the core signs", () => {
  const nonce = randomBytes(32);
  const message = alertsProofMessage("kim.near", "kim@example.com", "2026-10-28T03:10:00.000Z");
  assert.equal(message, "ZeroFee email alerts\nAccount: kim.near\nEmail: kim@example.com\nUntil: 2026-10-28T03:10:00.000Z");
  const ours = nep413Hash({ message, nonce, recipient: "relay.example" });
  const core = coreNep413Hash({ message, nonce: nonce.toString("base64"), recipient: "relay.example" });
  assert.deepEqual([...ours], [...core]);
  const key = mlDsaKey();
  const sig = key.sign(ours);
  assert.equal(signatureOk(key.publicKey, sig, ours), true);
  const flipped = Uint8Array.from(ours);
  flipped[0] ^= 1;
  assert.equal(signatureOk(key.publicKey, sig, flipped), false, "another hash");
  assert.equal(signatureOk(key.publicKey, "ml-dsa-65:abc", ours), false, "a short signature never throws");
  assert.equal(signatureOk("ml-dsa-65:abc", sig, ours), false);
});

test("S-1: a new key on the account is emailed once, in words (never the key), with the person's own time zone on what waits; the first round only learns the keys", async () => {
  const state: State = { waiting: [], agent: { budget: { coins: [{ coin: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", per_day: "20000000" }] } } };
  const s = setup({ stateOf: () => state });
  const device = s.keyFor(ACCOUNT, "device");
  const r = await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email: "kim@example.com", zone: "America/New_York", proof: proofBy(device, ACCOUNT, "kim@example.com") });
  assert.equal(r.status, 200);
  await s.settle();
  assert.match(await (await s.press(await s.get(s.linkIn(s.mails.at(-1)!)))).text(), /Alerts are on/);
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 0 }, "the first round learns the keys already there");
  // Someone adds a full-access key, and AgentZero's key: each told once, in words.
  const full = s.keyFor(ACCOUNT, "full");
  const agent = s.keyFor(ACCOUNT, "agent");
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 2 });
  const texts = s.mails.slice(-2).map((m) => m.text);
  assert.deepEqual(s.mails.slice(-2).map((m) => m.subject), ["A new key was added to your ZeroFee account", "A new key was added to your ZeroFee account"]);
  assert.ok(texts.some((t) => t.includes("a new key that can do anything was added")), texts.join("|"));
  assert.ok(texts.some((t) => t.includes("a key not from ZeroFee that can pay from your Safe was added")), texts.join("|"));
  for (const t of texts) {
    assert.ok(!t.includes(full.publicKey) && !t.includes(agent.publicKey) && !/ml-dsa-65|ed25519/.test(t), "never the key itself");
  }
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 0 }, "told once");
  // A change waiting: its time in the person's zone (New York, UTC-5 in January), with "before".
  state.waiting = [{ id: "9", change: { AgentSetPaymentCaps: {} }, ready_at_ns: "1800000000000000000" }];
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 1 });
  assert.match(s.mails.at(-1)!.text, /a change to AgentZero's limits is waiting\. It can go Fri 3:00 AM\.\n\nIf it wasn't you, open ZeroFee on your phone and cancel it before Fri 3:00 AM\./);
});

test("S-1: a subscription made before key lists only learns them on its next round (no flood of old keys); a zone the runtime doesn't know is UTC, said so", async () => {
  const state: State = { waiting: [] };
  const s = setup({ stateOf: () => state });
  const device = s.keyFor(ACCOUNT, "device");
  await s.post("/v0/alerts/subscribe", { accountId: ACCOUNT, email: "lee@example.com", zone: "Mars/Olympus", proof: proofBy(device, ACCOUNT, "lee@example.com") });
  await s.settle();
  await s.press(await s.get(s.linkIn(s.mails.at(-1)!)));
  // An older subscription: seen without keys.
  const subs = await s.store.get(`alerts:sub:${ACCOUNT}`);
  subs[0].seen = { recovery: null, held: [], claim: null };
  await s.store.set(`alerts:sub:${ACCOUNT}`, subs);
  s.keyFor(ACCOUNT, "full");
  assert.deepEqual(await (await s.round()).json(), { accounts: 1, sent: 0 }, "keys learned, not told");
  state.waiting = [{ id: "1", change: { Spend: {} }, ready_at_ns: "1800000000000000000" }];
  await s.round();
  assert.match(s.mails.at(-1)!.text, /It can go Fri 8:00 AM UTC\./);
});
