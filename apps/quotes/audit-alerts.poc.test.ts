// Independent audit PoCs (network + supply chain, branch audit-network 4c347b9), against apps/quotes/alerts.mjs and
// relay.mjs at 18ad8d6. Each attack is the audit's, with its assertion as written; only the harness changed with the
// fixes: subscribing now takes a NEP-413 proof by one of the account's keys (NF-01), so the owner signs with a key the
// mocked nodes list for the account (the attacker has none for the victim's); and the emailed links now open a page
// whose button does the change (NF-02), so a person "opening" a link is a GET and then the button's POST, while a mail
// scanner is the GET alone. Where an attack's setup step itself is now refused, the test asserts that refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type NearKey, mlDsaKey, proofBy, setup as base } from "./alerts-harness.ts";

const BASE = "https://relay.example";
const VICTIM = "victim.near";
type State = { pending?: unknown; waiting?: unknown[]; legacy?: unknown };

function setup(o: { stateOf?: (a: string) => State; delayMs?: number; down?: (url: string) => boolean; mailDelayMs?: number; base?: string | undefined } = {}) {
  return base(o);
}

/** As the audit's helper, with the proof by `key` (the operator's) and the button pressed. */
async function subscribeAndConfirm(s: ReturnType<typeof setup>, accountId: string, email: string, ip = "198.51.100.1", key?: NearKey) {
  return s.subscribeAndConfirm(accountId, email, key ?? s.keyFor(accountId), ip);
}

// NF-01 ------------------------------------------------------------------------------------------------------------------
test("NF-01: someone who doesn't control an account can't fill its alert slots and lock the owner out (or watch it)", async () => {
  const state: State = {};
  const s = setup({ stateOf: (a) => (a === VICTIM ? state : {}) });
  const owner = s.keyFor(VICTIM);
  // The attacker (e.g. a thief who has the backup words, before using them) subscribes three addresses it controls:
  // with no proof, or signed by a key of its own that isn't on the victim's account. Refused.
  const attackerKey = mlDsaKey();
  for (const e of ["a1@attacker.example", "a2@attacker.example", "a3@attacker.example"]) {
    assert.notEqual(await s.subscribeAndConfirm(VICTIM, e, null, "203.0.113.50"), 200);
    assert.notEqual(await s.subscribeAndConfirm(VICTIM, e, attackerKey, "203.0.113.51"), 200);
  }
  await s.round(); // first round only learns
  // The attacker now reads the victim's account events by email (surveillance of any account, no proof of control):
  state.waiting = [{ id: "1", change: { Spend: {} }, ready_at_ns: "1800000000000000000" }];
  await s.round();
  const spied = s.mails.filter((m) => m.to.endsWith("@attacker.example") && /waiting on your ZeroFee account/.test(m.subject));
  // The owner then tries to turn alerts on in Security:
  const ownerAsk = await s.post("/v0/alerts/subscribe", { accountId: VICTIM, email: "owner@victim.example", proof: proofBy(owner, VICTIM, "owner@victim.example") }, "198.51.100.77");
  assert.equal(spied.length, 0, `an address that never proved control of ${VICTIM} received its alerts (${spied.length} emails)`);
  assert.equal(ownerAsk.status, 200, "the real owner can't turn alerts on: the slots are full of the attacker's addresses");
});

// NF-02 ------------------------------------------------------------------------------------------------------------------
test("NF-02: an email client's link scanner (a plain GET of the stop link) must not silence the owner's alerts", async () => {
  const s = setup();
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  // Whoever holds the phone (or anyone who knows the account and the email) asks for the stop link to be sent...
  assert.equal((await s.post("/v0/alerts/remove-ask", { accountId: VICTIM, email: "owner@victim.example" }, "203.0.113.50")).status, 200);
  await s.settle();
  const stop = s.linkIn(s.lastTo("owner@victim.example")!);
  // ...and the mail provider's safe-links scanner fetches every link in the message, with no person involved.
  await s.get(stop);
  const subs = (await s.store.get(`alerts:sub:${VICTIM}`)) ?? [];
  assert.equal(subs.length, 1, "a GET with no confirmation step removed the owner's alerts");
});

// NF-03 ------------------------------------------------------------------------------------------------------------------
test("NF-03: the alerts routes' 5-a-minute limit holds whatever the path says (no bypass via /check + ?action=)", async () => {
  const s = setup();
  let ok = 0;
  let limited = 0;
  for (let i = 0; i < 20; i++) {
    const r = await s.post(`/v0/alerts/check?action=subscribe`, { accountId: `acct${i}.near`, email: "target@victim.example" }, "203.0.113.50");
    if (r.status === 200) ok++;
    if (r.status === 429) limited++;
  }
  await s.settle();
  assert.ok(s.mails.length <= 5, `one address made the relay send ${s.mails.length} emails in a minute (limit 5): ${ok} asks answered 200`);
  // Since proofs (NF-01) no mail goes out here at all, so the limit itself is checked too: it counted these asks.
  assert.equal(limited, 15, `the limit counted ${20 - limited} asks, not 5`);
});

// NF-04 ------------------------------------------------------------------------------------------------------------------
test("NF-04: remove-ask answers in the same time whether or not that email watches that account (no timing oracle)", async () => {
  const s = setup({ mailDelayMs: 300 });
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  const time = async (email: string) => {
    const t0 = performance.now();
    await s.post("/v0/alerts/remove-ask", { accountId: VICTIM, email }, `203.0.113.${Math.floor(Math.random() * 200)}`);
    return performance.now() - t0;
  };
  const watched = await time("owner@victim.example");
  const notWatched = await time("nobody@victim.example");
  assert.ok(Math.abs(watched - notWatched) < 100, `watched: ${watched.toFixed(0)} ms, not watched: ${notWatched.toFixed(0)} ms: the answer time says which email watches the account`);
});

// NF-05 ------------------------------------------------------------------------------------------------------------------
test("NF-05: junk subscriptions can't push a real account's alert past the cron round's time limit", async () => {
  // Scaled 1:20: a node read of 10 ms here stands for ~200 ms on mainnet RPC, and a 1.5 s budget for Vercel's 30 s maxDuration.
  const victimState: State = {};
  const s = setup({ stateOf: (a) => (a === VICTIM ? victimState : {}), delayMs: 10 });
  // 200 junk accounts (since NF-01 each a real account of the attacker's, with its own key), each confirmed from a catch-all domain.
  // (Their keys ed25519 to keep this test quick; the victim's is ML-DSA-65, as a ZeroFee account's are.)
  for (let i = 0; i < 200; i++) await subscribeAndConfirm(s, `junk${i}.near`, `j${i}@catchall.example`, `203.0.113.${i % 250}`, s.keyFor(`junk${i}.near`, "full", "ed25519"));
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example", "198.51.100.77"), 200);
  victimState.pending = null;
  const BUDGET_MS = 1500;
  const withinBudget = () => Promise.race([s.round(), new Promise((r) => setTimeout(() => r("timed out"), BUDGET_MS))]);
  await withinBudget(); // learning round (allowed to run long)
  await new Promise((r) => setTimeout(r, 3000)); // let it finish
  victimState.pending = { new_key: "x", ready_at_ns: "1800000000000000000" }; // a thief starts a recovery
  const before = s.mails.length;
  await withinBudget();
  const told = s.mails.slice(before).some((m) => m.to === "owner@victim.example");
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(told, "the recovery alert didn't go out within the round's time: the round reads every subscription one after another");
});

// NF-06 ------------------------------------------------------------------------------------------------------------------
test("NF-06: one NEAR node that is down or blocked must not silence a recovery alert (alerts should fail loud)", async () => {
  const state: State = {};
  let drpcDown = false;
  const s = setup({ stateOf: () => state, down: (u) => drpcDown && u.includes("drpc") });
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  await s.round();
  drpcDown = true; // one node fails (or an attacker on the relay's path blocks it) for as long as the recovery's wait
  state.pending = { new_key: "x", ready_at_ns: "1800000000000000000" };
  for (let i = 0; i < 5; i++) await s.round();
  assert.ok(s.mails.some((m) => /Someone started moving/.test(m.subject)), "five rounds, the other node shows the recovery, no email");
});

// NF-10 ------------------------------------------------------------------------------------------------------------------
test("NF-10: emailed links never take their host from the request (no Host-derived base without ALERTS_PUBLIC_URL)", async () => {
  const s = setup({ base: undefined });
  // The first request an instance sees used to fix `base` for its lifetime. Without ALERTS_PUBLIC_URL, alerts are off.
  const evil = await s.post("/v0/alerts/subscribe", { accountId: "x.near", email: "x@x.example" }, "203.0.113.5", "https://evil.example");
  const owner = await s.post("/v0/alerts/subscribe", { accountId: VICTIM, email: "owner@victim.example" }, "198.51.100.77", BASE);
  assert.deepEqual([evil.status, owner.status], [503, 503]);
  assert.ok(s.mails.every((m) => !/evil\.example/.test(m.text)), "no link points anywhere the request named");
  // With it set, every link is on it, whatever host the request came in on.
  const t = setup();
  t.keyFor(VICTIM);
  await t.post("/v0/alerts/subscribe", { accountId: "x.near", email: "x@x.example" }, "203.0.113.5", "https://evil.example");
  assert.equal(await subscribeAndConfirm(t, VICTIM, "owner@victim.example", "198.51.100.77"), 200);
  assert.ok(t.mails.every((m) => t.linkIn(m).startsWith(BASE)), `a link points at ${t.mails.map((m) => new URL(t.linkIn(m)).origin)}`);
});

// Controls: the same harness passes when the thing each PoC depends on is taken away, so a failure above is the finding,
// not the harness.
test("control NF-05: with no junk subscriptions the same round alerts the owner within the budget", async () => {
  const victimState: State = {};
  const s = setup({ stateOf: () => victimState, delayMs: 10 });
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  await s.round();
  victimState.pending = { new_key: "x", ready_at_ns: "1800000000000000000" };
  await Promise.race([s.round(), new Promise((r) => setTimeout(r, 1500))]);
  assert.ok(s.mails.some((m) => /Someone started moving/.test(m.subject)));
});
test("control NF-06: with both nodes up the recovery is emailed", async () => {
  const state: State = {};
  const s = setup({ stateOf: () => state });
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  await s.round();
  state.pending = { new_key: "x", ready_at_ns: "1800000000000000000" };
  await s.round();
  assert.ok(s.mails.some((m) => /Someone started moving/.test(m.subject)));
});
test("control NF-03: on its own path the alerts limit does hold (5 a minute)", async () => {
  const s = setup();
  const statuses = [];
  for (let i = 0; i < 20; i++) statuses.push((await s.post(`/v0/alerts/subscribe`, { accountId: `acct${i}.near`, email: "target@victim.example" }, "203.0.113.50")).status);
  // Was: 5 mails. Since NF-01 an unproven ask sends none, so the 5 answered and 15 limited are what's counted.
  assert.deepEqual([statuses.filter((x) => x !== 429).length, statuses.filter((x) => x === 429).length], [5, 15]);
});
test("control NF-01: the owner, with a key on the account, turns alerts on and is told", async () => {
  const state: State = {};
  const s = setup({ stateOf: () => state });
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  await s.round();
  state.waiting = [{ id: "1", change: { Spend: {} }, ready_at_ns: "1800000000000000000" }];
  await s.round();
  assert.ok(s.mails.some((m) => m.to === "owner@victim.example" && /waiting on your ZeroFee account/.test(m.subject)));
});
test("control NF-02: the stop link's button (a person's press) does remove", async () => {
  const s = setup();
  assert.equal(await subscribeAndConfirm(s, VICTIM, "owner@victim.example"), 200);
  await s.post("/v0/alerts/remove-ask", { accountId: VICTIM, email: "owner@victim.example" }, "203.0.113.50");
  await s.settle();
  await s.press(await s.get(s.linkIn(s.lastTo("owner@victim.example")!)));
  assert.equal(await s.store.get(`alerts:sub:${VICTIM}`), null);
});
