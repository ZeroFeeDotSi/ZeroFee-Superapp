// `tray pair` end to end with a fake relay, a fake NEAR and the phone's real sealing (packages/core/src/pair.ts): the six
// check words are printed with the offer, before anything is read; exactly one box is read; the seed's key is checked on
// NEAR as AgentZero's on that account; only then is anything kept. Every refusal keeps nothing. Keys are made per run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { makeOffer, pairWords, readOffer, sealSeed, trayBearer } from "@zerofee/core/pair";
import { SoftwareKey } from "@zerofee/core/device-key";
import { keyHandle } from "@zerofee/core/key-handle";
import type { Chain, ChainPermission } from "@zerofee/core/chain";
import { PAIR_WORDS, agentKeyOnChain, runPair } from "./pair-flow.ts";
import { memoryStore, stopHashOf } from "./store.ts";

const RELAY = "https://relay.example";
const ACCOUNT = "kim-safe.near";
const AGENT: ChainPermission = { kind: "function-call", receiverId: ACCOUNT, methods: ["agent_pay"], allowanceYocto: null };
const publicKeyOf = (seed: Uint8Array) => {
  const k = SoftwareKey.fromSeed(seed, "development");
  const p = k.publicKey;
  k.destroy();
  return p;
};
/** The phone's own full-access key, always on the account beside AgentZero's. */
const PHONE_KEY = { handle: keyHandle(publicKeyOf(new Uint8Array(32).fill(7))), nonce: 1n, permission: { kind: "full" } as ChainPermission };

/** NEAR listing the account's keys (the phone's, and AgentZero's with `permission`, or none; or down), as accessKeys does. */
function chainWith(seed: Uint8Array, permission: ChainPermission | null, { down = false } = {}) {
  const asked: { account: string }[] = [];
  const chain = {
    network: "mainnet",
    commonBlock: async () => ({ height: 1, hash: "h" }),
    accessKeys: async (account: string) => {
      asked.push({ account });
      if (down) throw new Error("down");
      return account === ACCOUNT ? [PHONE_KEY, ...(permission ? [{ handle: keyHandle(publicKeyOf(seed)), nonce: 1n, permission }] : [])] : [];
    },
  } as unknown as Chain;
  return { chain, asked };
}

/** The phone (seals once it has read the offer) behind a fake relay that answers 404 a few times first. */
function world(opts: { box?: (offerText: string, seed: Uint8Array) => string; permission?: ChainPermission | null; down?: boolean; never?: boolean; typed?: string[]; relay?: (read: number) => "throw" | 503 | null } = {}) {
  const typed = [...(opts.typed ?? ["", "yes"])];
  const asked: string[] = [];
  const lines: string[] = [];
  const seed = new Uint8Array(randomBytes(32));
  let t = Date.parse("2026-11-03T00:00:00Z");
  let reads = 0;
  let linesAtFirstRead = -1;
  const offerText = () => lines.find((l) => l.startsWith("zf-pair:")) ?? "";
  const fetchFn = (async (url: string) => {
    reads++;
    if (linesAtFirstRead < 0) linesAtFirstRead = lines.length;
    assert.equal(String(url), `${RELAY}/v0/pair/${readOffer(offerText())!.mailbox}`, "only the relay's mailbox is asked");
    const r = opts.relay?.(reads);
    if (r === "throw") throw new TypeError("fetch failed");
    if (r === 503) return new Response("", { status: 503 });
    if (opts.never || reads <= 3) return Response.json({ code: "pair.mailbox.empty" }, { status: 404 });
    return Response.json({ box: opts.box ? opts.box(offerText(), seed) : sealSeed(readOffer(offerText())!, seed, ACCOUNT) });
  }) as unknown as typeof fetch;
  const near = chainWith(seed, opts.permission === undefined ? AGENT : opts.permission, { down: opts.down ?? false });
  const store = memoryStore();
  const ask = async (q: string) => (asked.push(q), typed.shift() ?? "");
  const run = () => runPair({ relay: RELAY, store, chainFor: () => near.chain, fetchFn, print: (l) => void lines.push(l), ask, sleep: async (ms) => void (t += ms), now: () => t });
  return { run, store, lines, seed, near, asked, reads: () => reads, linesAtFirstRead: () => linesAtFirstRead };
}

test("the round trip: offer and check words shown first, one box read, AgentZero's key confirmed on NEAR, then kept; the Claude Code line carries the bearer", async () => {
  const w = world();
  assert.equal(await w.run(), true);
  const offer = readOffer(w.lines.find((l) => l.startsWith("zf-pair:"))!)!;
  assert.ok(offer, "the offer is printed as text to paste");
  const wordsLine = `Your phone will show 6 words. They must be: ${pairWords(offer.computerKey).join(" ")}.`;
  const at = w.lines.indexOf(wordsLine);
  assert.ok(at >= 0, "the six words, from this computer's key");
  assert.equal(pairWords(offer.computerKey).length, 6);
  assert.ok(at < w.linesAtFirstRead(), "shown before the mailbox is ever read");
  assert.equal(w.reads(), 4, "read until the box came, then never again");
  assert.deepEqual(w.near.asked, [{ account: ACCOUNT }], "the keys of the account the box names");
  const held = (await w.store.load())!;
  assert.deepEqual([...held.seed], [...w.seed]);
  assert.equal(held.secret.length, 64);
  assert.equal(held.accountId, ACCOUNT);
  assert.deepEqual(w.asked, ["How much may this computer spend a day? (default 20) ", `This computer will pay for ${ACCOUNT}. Is that your account? Type yes. `], "the day limit, then the account");
  assert.equal(held.dayLimitUsd, 20, "the default");
  assert.deepEqual(await w.store.spent(), [], "a new count");
  assert.ok(w.lines.includes(`claude mcp add --transport http agentzero http://127.0.0.1:7811/mcp --header "Authorization: Bearer ${trayBearer(held.secret)}"`));
  const phrase = w.lines.find((l) => l.startsWith("Your stop phrase: "))!.slice("Your stop phrase: ".length);
  assert.match(phrase, /^[a-z]+ [a-z]+ [a-z]+$/);
  assert.equal(held.stopHash, stopHashOf(phrase));
  assert.equal(held.stopHash, stopHashOf(`  ${phrase.toUpperCase().replace(/ /g, "   ")} `), "typed loosely, the same phrase");
  const shown = w.lines.join("\n");
  assert.ok(!shown.includes(Buffer.from(w.seed).toString("hex")) && !shown.includes(Buffer.from(w.seed).toString("base64url")), "the seed never shown");
  assert.ok(!shown.includes(Buffer.from(held.secret).toString("hex")) && !shown.includes(Buffer.from(held.secret).toString("base64url")), "the secret never shown");
});

test("exactly one box: one that doesn't open ends the pairing (Start again), and the mailbox is never read again", async () => {
  const elsewhere = readOffer(makeOffer().offer)!;
  for (const box of [() => "junk", (_: string, seed: Uint8Array) => sealSeed(elsewhere, seed, ACCOUNT)]) {
    const w = world({ box });
    assert.equal(await w.run(), false);
    assert.equal(w.reads(), 4, "no read after the box");
    assert.match(w.lines.at(-1)!, /^That didn't come from your phone\. Nothing was saved\. Start again: node apps\/tray\/tray\.ts pair --relay https:\/\/relay\.example$/);
    assert.equal(w.store.value, null);
    assert.equal(w.near.asked.length, 0);
  }
});

test("a key that isn't AgentZero's on that account, as NEAR lists it: refused, nothing kept", async () => {
  const cases: [ChainPermission | null, string][] = [
    [null, "not on the account"],
    [{ kind: "full" }, "a full-access key"],
    [{ ...AGENT, receiverId: "other.near" } as ChainPermission, "for another contract"],
    [{ ...AGENT, methods: ["agent_convert"] } as ChainPermission, "no agent_pay"],
    [{ ...AGENT, methods: ["agent_pay", "agent_convert", "run_order"] } as ChainPermission, "more than agent_pay"],
    [{ ...AGENT, methods: ["agent_pay", "agent_pay"] } as ChainPermission, "agent_pay twice"],
    [{ ...AGENT, methods: [] } as ChainPermission, "any method"],
  ];
  for (const [permission, name] of cases) {
    const w = world({ permission });
    assert.equal(await w.run(), false, name);
    assert.match(w.lines.at(-1)!, /^That key isn't AgentZero's on kim-safe\.near\. Nothing was saved\. Start again/, name);
    assert.equal(w.store.value, null, name);
  }
  assert.equal(await world({ permission: AGENT }).run(), true, "control: exactly agent_pay");
  const down = world({ down: true });
  assert.equal(await down.run(), false);
  assert.match(down.lines.at(-1)!, /^NEAR didn't answer, so AgentZero's key couldn't be checked\. Nothing was saved\./);
  assert.equal(down.store.value, null);
});

test("agentKeyOnChain: yes only for a function-call key on the account itself whose methods are exactly agent_pay", async () => {
  const seed = new Uint8Array(randomBytes(32));
  assert.equal(await agentKeyOnChain(chainWith(seed, AGENT).chain, ACCOUNT, publicKeyOf(seed)), "yes");
  assert.equal(await agentKeyOnChain(chainWith(seed, AGENT).chain, ACCOUNT, publicKeyOf(new Uint8Array(randomBytes(32)))), "no");
  assert.equal(await agentKeyOnChain(chainWith(seed, AGENT).chain, "someone-else.near", publicKeyOf(seed)), "no");
  assert.equal(await agentKeyOnChain(chainWith(seed, AGENT, { down: true }).chain, ACCOUNT, publicKeyOf(seed)), "unknown");
});

test("no phone in 10 minutes: it gives up, keeps nothing, and stays under the relay's 120 reads", async () => {
  const w = world({ never: true });
  assert.equal(await w.run(), false);
  assert.match(w.lines.at(-1)!, /^Your phone didn't answer in 10 minutes\. Nothing was saved\. Start again/);
  assert.ok(w.reads() <= 120, `${w.reads()} reads`);
  assert.ok(w.reads() >= 60, "every 2 s at first");
  assert.equal(w.store.value, null);
});

test("D104: this computer's day limit, asked first: whole dollars 1 to 1,000 (empty: 20); three wrong answers end the pairing before anything is shown", async () => {
  const typedOk = world({ typed: ["$35", "yes"] });
  assert.equal(await typedOk.run(), true);
  assert.equal((await typedOk.store.load())!.dayLimitUsd, 35);
  assert.ok(typedOk.lines.some((l) => l.endsWith("up to $35 a day from here.")));
  const retried = world({ typed: ["lots", "0", "50", "yes"] });
  assert.equal(await retried.run(), true);
  assert.equal((await retried.store.load())!.dayLimitUsd, 50);
  assert.equal(retried.lines.filter((l) => l === "Say whole dollars from 1 to 1000, like 20.").length, 2);
  const never = world({ typed: ["1001", "2.5", "-3"] });
  assert.equal(await never.run(), false);
  assert.equal(never.reads(), 0, "no offer made, no mailbox read");
  assert.ok(!never.lines.some((l) => l.startsWith("zf-pair:")));
  assert.match(never.lines.at(-1)!, /^No day limit was given\. Nothing was saved\. Start again/);
  assert.equal(never.store.value, null);
});

test("the account check: after NEAR confirms the key, the person must type yes to the account's name; anything else keeps nothing", async () => {
  for (const answer of ["no", "", "y", "yes please", ACCOUNT]) {
    const w = world({ typed: ["", answer] });
    assert.equal(await w.run(), false, answer);
    assert.equal(w.asked.at(-1), `This computer will pay for ${ACCOUNT}. Is that your account? Type yes. `);
    assert.equal(w.store.value, null, `${answer}: nothing stored`);
    assert.ok(!w.lines.some((l) => l.startsWith("claude mcp add")), "no token shown");
    assert.match(w.lines.at(-1)!, /^Not your account, or no yes\. Nothing was saved\. Start again/);
  }
  const yes = world({ typed: ["", " YES "] });
  assert.equal(await yes.run(), true, "control: yes, any case");
});

test("the relay must be an https address", async () => {
  const lines: string[] = [];
  const ok = await runPair({ relay: "http://relay.example", store: memoryStore(), chainFor: () => assert.fail("never asked"), print: (l) => void lines.push(l), ask: async () => "", fetchFn: (async () => assert.fail("never asked")) as never });
  assert.equal(ok, false);
  assert.match(lines[0]!, /https/);
});

// Audit 15 FL4: a down relay was said as the phone ("Your phone didn't answer in 10 minutes.") and the wait line had an ellipsis.
test("FL4: the relay down for the whole wait is named as ZeroFee's relay, said once while waiting, never as the phone; the wait line has no ellipsis", async () => {
  const w = world({ never: true, relay: () => "throw" });
  assert.equal(await w.run(), false);
  assert.ok(w.lines.includes(PAIR_WORDS.waiting) && !w.lines.some((l) => l.includes("…")), "plain wait words");
  assert.equal(w.lines.filter((l) => l === PAIR_WORDS.relayDown).length, 1, "said once, while it keeps checking");
  assert.match(w.lines.at(-1)!, /^ZeroFee's server didn't answer\. Your yes didn't reach this Mac\. Nothing was saved\. Start again/);
  assert.ok(!w.lines.some((l) => l.startsWith(PAIR_WORDS.phoneLate)), "never blames the phone");
  assert.equal(w.store.value, null);
  const five = world({ never: true, relay: () => 503 });
  assert.equal(await five.run(), false);
  assert.match(five.lines.at(-1)!, /^ZeroFee's server didn't answer/, "a 5xx is the relay too");
});

test("FL4: a relay blip that ends is said and unsaid; the pairing goes on; a lone failed ask says nothing; a quiet phone is still the phone", async () => {
  const blip = world({ relay: (n) => (n <= 4 ? "throw" : null) });
  assert.equal(await blip.run(), true, "the box came once the relay was back");
  assert.ok(blip.lines.includes(PAIR_WORDS.relayDown));
  const one = world({ relay: (n) => (n === 1 ? "throw" : null) });
  assert.equal(await one.run(), true);
  assert.ok(!one.lines.includes(PAIR_WORDS.relayDown), "one failed ask is not an outage");
  const late = world({ never: true, relay: (n) => (n <= 5 ? "throw" : null) });
  assert.equal(await late.run(), false);
  assert.deepEqual(late.lines.filter((l) => l === PAIR_WORDS.relayDown || l === PAIR_WORDS.relayBack), [PAIR_WORDS.relayDown, PAIR_WORDS.relayBack], "said, then unsaid");
  assert.match(late.lines.at(-1)!, /^Your phone didn't answer in 10 minutes\./, "the relay came back: the phone is what didn't answer");
});
