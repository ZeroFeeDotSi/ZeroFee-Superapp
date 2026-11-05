// Row 1 (3 Nov; QA's test run, 5 Nov): Send refused a VALID NEAR address, and said so at the
// top, and only after the hold. Every valid form goes through the whole read Send does (findRecipient, cantSendTo, the
// networks, payeeOf, sendTarget, the guard's judge), each with invalid controls; the line sits right above Hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findRecipient } from "@zerofee/pay/send";
import { judge, NOT_OPEN_LINE, OPENS_PROVEN } from "../../agent/src/zero/counterparty.ts";
import { blockedLine, cantSendTo, nearImplicitOf, sendNetworks, startNetwork, withNear } from "./send-reach.ts";
import { nearPayable, sendTarget } from "./send-target.ts";
import { EVM_SEND_TO } from "./send-to.ts";
import { payeeOf } from "./app/money/send-sources.ts";
import type { Catalogue } from "./catalogue.ts";

const cat = { coin: (id: string) => (id === "nep141:wrap.near" ? { chain: "near", symbol: "wNEAR" } : id === "nep141:hood.omft.near" ? { chain: "hood", symbol: "ETH" } : undefined), network: () => ({ name: "NEAR" }) } as unknown as Catalogue;
const IMPLICIT = "83e7fbd5142b7566020e937a988b3e86a76ddd776a9c9b4b6622543616ad74c6";
const ETH_IMPL = "0x7a3c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c";
/** A bridge whose NEAR read says each account exists or not (`open`); counts the reads. */
const nearSays = (open: Record<string, boolean>) => {
  const asked: string[] = [];
  return { asked, bridge: { call: async (m: string, p: { accountId: string }) => (m === "ledger.recipientInfo" ? (asked.push(p.accountId), { ok: { exists: open[p.accountId] ?? false, hasLedgerBalance: false, code: null } }) : { problem: { code: "x" } }) } as never };
};
/** Send's whole read of `typed`, as SendForm then SendSheet run it: what it lands as, or the line that stops it. */
async function sendTo(typed: string, open: Record<string, boolean>, pick?: string, onNear: string | null = null) {
  const r = await findRecipient(nearSays(open).bridge, typed, {});
  if ("problem" in r) return { refused: r.problem.whatHappened };
  const no = cantSendTo(r.ok.recipient);
  if (no) return { refused: no };
  const nets = withNear(sendNetworks(r.ok.recipient), r.ok.recipient, onNear);
  const network = (pick ?? startNetwork(nets, null)) as never;
  const to = payeeOf({ recipient: r.ok.recipient, network });
  const target = sendTarget(cat, to, undefined);
  const who = r.ok.recipient.kind === "address" ? r.ok.recipient.address : r.ok.recipient.accountId;
  const facts = { account: r.ok.recipient.kind === "address" ? { exists: true, code: null } : { exists: !!open[who], code: null }, paidBefore: false };
  const check = judge(who, facts, r.ok.recipient.kind === "address" ? network : "near", { opens: r.ok.recipient.kind === "near-wallet" });
  return { nets, to: target.to, verdict: check.verdict, line: check.line };
}

test("row 1: every valid NEAR form is paid on NEAR: named, sub-account, .tg, a top-level name, an open 64-hex, mixed case read lower; an UNOPENED 64-hex stays blocked until QA's dust test proves the route (the audit's MUST)", async () => {
  for (const [typed, id] of [["alice.near", "alice.near"], ["Alice.Near", "alice.near"], ["pay.alice.near", "pay.alice.near"], ["shop.tg", "shop.tg"], ["user-1_x.near", "user-1_x.near"], ["aurora", "aurora"], [IMPLICIT, IMPLICIT], [IMPLICIT.toUpperCase(), IMPLICIT]] as const) {
    const r = await sendTo(typed, { [id]: true });
    assert.ok(!("refused" in r), `${typed}: ${"refused" in r ? r.refused : ""}`);
    assert.deepEqual(r.to, { kind: "chain", chain: "near", address: id }, typed);
    assert.deepEqual(r.nets, ["near"]);
    assert.equal(r.verdict, "warn", `${typed}: a first payment is said, never blocked`);
  }
  // the test shot: a 64-hex no NEAR has reached yet: blocked, by name, until the route is proven with dust
  assert.equal(OPENS_PROVEN, false);
  const fresh = await sendTo(IMPLICIT, {});
  assert.ok(!("refused" in fresh));
  assert.deepEqual([fresh.verdict, fresh.line], ["block", NOT_OPEN_LINE]);
  // rule 8: what failed, where the money is (the source's own place), what to tap next
  assert.equal(blockedLine(NOT_OPEN_LINE, "your SOL wallet"), `${NOT_OPEN_LINE} Nothing left your SOL wallet. Paste another address.`);
  // control: AgentZero's own payments (wNEAR inside NEAR Intents, never opening it) still block it
  assert.equal(judge(IMPLICIT, { account: { exists: false, code: null }, paidBefore: false }).line, NOT_OPEN_LINE);
});

test("row 1: an ETH-style implicit NEAR account (0x, lower case) gets NEAR as one more network once NEAR says it exists; paid there on NEAR (controls: not confirmed, only EVM networks; mixed case is never NEAR)", async () => {
  const r = await sendTo(ETH_IMPL, { [ETH_IMPL]: true }, "near", ETH_IMPL);
  assert.ok(!("refused" in r));
  // every EVM network Send reaches (base: Send S3, EVM_SEND_TO), then NEAR once NEAR says the account exists
  assert.deepEqual(r.nets, [...EVM_SEND_TO, "near"]);
  assert.deepEqual(r.to, { kind: "chain", chain: "near", address: ETH_IMPL });
  const unconfirmed = await sendTo(ETH_IMPL, {}, "hood", null);
  assert.ok(!("refused" in unconfirmed));
  assert.deepEqual(unconfirmed.nets, [...EVM_SEND_TO], "control: NEAR never offered on a guess");
  assert.deepEqual(withNear(["hood"], { kind: "address", chain: null, candidates: [], address: ETH_IMPL }, "0x" + "a".repeat(40)), ["hood"], "control: another address's yes doesn't count");
  assert.equal(nearPayable(ETH_IMPL), true);
  // the audit's SHOULD: mixed case is checked against EIP-55 before it is lowercased for NEP-518
  const { checksumAddress } = await import("@zerofee/core/evm");
  const mixed = checksumAddress(ETH_IMPL);
  assert.notEqual(mixed, ETH_IMPL);
  assert.equal(nearImplicitOf(mixed), ETH_IMPL, "a checksummed paste: the NEAR account is its lower case");
  const typo = mixed.slice(0, -1) + (mixed.at(-1) === "c" ? "C" : "c");
  assert.equal(nearImplicitOf(typo), null, "control: a checksum typo is never a NEAR account");
  assert.ok("refused" in (await sendTo(typo, { [ETH_IMPL]: true })), "control: and Send refuses it");
  const paid = await sendTo(mixed, { [ETH_IMPL]: true }, "near", ETH_IMPL);
  assert.ok(!("refused" in paid));
  assert.deepEqual(paid.to, { kind: "chain", chain: "near", address: ETH_IMPL }, "paid on NEAR at the lower-case id");
  assert.equal(nearPayable(ETH_IMPL.toUpperCase().replace("0X", "0x")), false, "control: upper-case 0x is an EVM address, never a NEAR account");
});

test("row 1 controls: what isn't a NEAR account stays refused before any hold, by its own line", async () => {
  assert.match((await sendTo("alice.near", {}) as { refused: string }).refused, /no account called alice\.near/, "a name NEAR doesn't have");
  for (const bad of ["alice", "a..near", "-a.near", "alice_.near", "x", IMPLICIT + "0", "ali ce.near", "alice.near."]) {
    const r = await sendTo(bad, {});
    assert.ok("refused" in r, bad);
  }
  for (const bad of ["a..near", "-a.near", "x", IMPLICIT + "0", "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD.near"]) assert.equal(nearPayable(bad), false, bad);
  // a Solana or Bitcoin address is never read as a top-level NEAR name (no NEAR read is even asked)
  const sol = nearSays({});
  const r = await findRecipient(sol.bridge, "4Nd1mQ7k3Vb7Xp9yKk2s1F4Q5n6R7t8U9v1W2x3YZ9pE", {});
  assert.ok("ok" in r && r.ok.recipient.kind === "address");
  const btc = nearSays({});
  await findRecipient(btc.bridge, "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", {});
  assert.deepEqual([sol.asked, btc.asked], [[], []]);
  // a 32-letter-or-longer word (a lowercased address, not base58 any more) that NEAR even says exists is never a top-level NEAR name (32 letters or more)
  const yes = nearSays({ "4nd1mq7k3vb7xp9ykk2s1f4q5n6r7t8u9v1w2x3yz9pl": true });
  assert.ok("problem" in (await findRecipient(yes.bridge, "4nd1mq7k3vb7xp9ykk2s1f4q5n6r7t8u9v1w2x3yz9pl", {})));
});

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
// The line's place (under To, or the slot above the button) is web-send-private's look on the base (the copy review's ruling: it wins
// Send); this branch's behaviour is kept: a block known when To is read, Send off, a new To clears it.
test("row 1: a block is known before the tap, keeps Send off, and a new To clears it", () => {
  const form = src("./app/money/SendForm.tsx"), sheet = src("./app/money/SendSheet.tsx");
  assert.match(form, /const ready = [^\n]*!why/, "a line there keeps Hold off");
  assert.match(sheet, /if \(check\.verdict === "block"\) setStop\(check\.line\);/, "judged when To is read");
  assert.match(sheet, /blocked=\{stop\}/, "handed to the form");
  assert.match(form, /: blocked \? blockedLine\(blocked, source\.place\)/, "said above Hold in rule 8's words, so Hold is off");
  assert.match(sheet, /setStop\(null\);\n\s*setLine\(null\);/, "a new To clears the old line");
  assert.match(sheet, /\{ opens: a\.recipient\.kind === "near-wallet" \}/, "the hold's judge agrees with the early one");
});

// Failure paths (rules file proof list): a dead node on the address check, offline, a reload mid-Send.
test("failure paths: a dead NEAR node on the address check says NEAR didn't answer (never 'isn't an account'); offline throws to the form's own line; NEAR's 0x check dying offers no NEAR (never a guess); a reload mid-Send keeps the job row (controls)", async () => {
  const dead = { call: async (m: string) => (m === "ledger.recipientInfo" ? { problem: { code: "ledger.near.unavailable", whatHappened: "NEAR didn't answer. Try again." } } : { problem: { code: "x" } }) } as never;
  const r = await findRecipient(dead, "alice.near", {});
  assert.ok("problem" in r && r.problem.whatHappened === "NEAR didn't answer. Try again.", "the node's own words, not a refusal of the name");
  const offline = { call: async () => { throw new TypeError("Failed to fetch"); } } as never;
  await assert.rejects(findRecipient(offline, "alice.near", {}), "offline: the form's catch says it");
  const form = src("./app/money/SendForm.tsx");
  assert.match(form, /\(\) => n === seq\.current && setLine\(isNamedNearAccount\(t\.toLowerCase\(\)\) \? refusedLine\("NEAR didn't answer", [^\n]*TAP_AGAIN\) : refusedLine\("That address can't be read", [^\n]*TAP_PASTE\)\)\)/);
  assert.match(form, /"ledger\.recipientInfo", \{ accountId: a \}\)\.then\(\(r\) => live && "ok" in r && r\.ok\.exists && setOnNear\(a\), \(\) => undefined\)/, "the 0x NEAR check failing leaves only the EVM networks");
  assert.deepEqual(withNear(["hood", "bsc", "eth", "base"], { kind: "address", chain: null, candidates: [], address: ETH_IMPL }, null), ["hood", "bsc", "eth", "base"]);
  // reload mid-Send: the job row is in the store the page keeps (job-start.ts, sealed by Home), so a new page finds it
  const { createTaskStore } = await import("@zerofee/shell-api/tasks.ts");
  const { startJob } = await import("@zerofee/shell-api/job-start.ts");
  const kept = new Map<string, string>();
  const kv = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  const page = createTaskStore({ kv });
  startJob(page.forApp("wallet"), { title: "Send $5.00 to alice.near", usd: "$5.00" });
  const reloaded = createTaskStore({ kv });
  assert.ok(reloaded.list().some((t) => t.title === "Send $5.00 to alice.near"), "the row after a reload");
  assert.equal(createTaskStore({ kv: { getItem: () => null, setItem: () => undefined } }).list().length, 0, "control: a fresh store has none");
});
