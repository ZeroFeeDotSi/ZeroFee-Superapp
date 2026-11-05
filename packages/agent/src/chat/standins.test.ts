// Audit L16: addresses (and NEAR names in data) reach Claude only as stand-ins; the phone turns them back. Each with an
// attack-shaped control: what leaked before must not leak now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskMessages, maskText, unmaskInput, unmaskStream, unmaskText } from "./standins.ts";

const SOL = "Do1RHZV32j5V7oAEb3PKVwzUxc2XQPBGGwpf6MrC7vcy";
const EVM = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
const IMPLICIT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

test("an address typed by the person, and any address or NEAR name in data, becomes a stand-in; the same one keeps its stand-in (append-only)", () => {
  const list: string[] = [];
  assert.equal(maskText(`Send $5 in SOL to ${SOL}`, list, false), "Send $5 in SOL to a1");
  assert.equal(maskText(`and $3 to ${EVM}, then ${SOL} again`, list, false), "and $3 to a2, then a1 again");
  assert.equal(maskText(`Tue: AgentZero paid $5 to kim.near and ${IMPLICIT}`, list, true), "Tue: AgentZero paid $5 to a4 and a3");
  assert.deepEqual(list, [SOL, EVM, IMPLICIT, "kim.near"]);
  // the person's own words keep a NEAR name they typed (Claude reads the ask); data never does
  assert.equal(maskText("send $2 to kim.near", list, false), "send $2 to kim.near");
  // controls: plain words, figures and short codes are untouched
  assert.equal(maskText("What did I spend this week? $25.00 at 2:05 PM, code 123456", list, true), "What did I spend this week? $25.00 at 2:05 PM, code 123456");
});

test("what goes to Claude holds no address and no data name (control: the unmasked thread held all three); the kept thread is unchanged", () => {
  const thread = [
    { role: "user" as const, content: `send $5 in SOL to ${SOL}` },
    { role: "assistant" as const, content: [{ type: "tool_use" as const, id: "t1", name: "read_receipts", input: {} }] },
    { role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "t1", content: `<data-ab>Paid $4 to bob.near; to ${EVM}</data-ab>` }] },
    { role: "user" as const, content: `<data-cd>What the person asked AgentZero to remember.\n- Someone they pay: mum is mum.near</data-cd>` },
  ];
  const frozen = JSON.stringify(thread);
  const list: string[] = [];
  const sent = JSON.stringify(maskMessages(thread, list));
  for (const leak of [SOL, EVM, "bob.near", "mum.near"]) {
    assert.ok(frozen.includes(leak), `control: ${leak} was in the thread`);
    assert.equal(sent.includes(leak), false, `${leak} never goes to Claude`);
  }
  assert.equal(JSON.stringify(thread), frozen, "the kept thread is the real one");
  // the same thread again gives the same request, byte for byte (the cache holds)
  assert.equal(JSON.stringify(maskMessages(thread, list)), sent);
});

test("Claude's stand-ins come back as the real ones, in its tool calls and on screen, even split across streamed pieces (control: an unknown stand-in stays)", () => {
  const list = [SOL, "kim.near"];
  assert.deepEqual(unmaskInput({ to: "a1", usd: 5, coin: "SOL" }, list), { to: SOL, usd: 5, coin: "SOL" });
  assert.deepEqual(unmaskInput({ steps: ["Send $5 to a2", "Tell me what's left"] }, list), { steps: ["Send $5 to kim.near", "Tell me what's left"] });
  assert.equal(unmaskText("Sending to a1 now.", list), `Sending to ${SOL} now.`);
  assert.equal(unmaskText("a9 isn't one", list), "a9 isn't one");
  const s = unmaskStream(list);
  const shown = ["Send $5 to a", "1? It's a ", "good one, a", "2 too."].map((d) => s.next(d)).join("") + s.end();
  assert.equal(shown, `Send $5 to ${SOL}? It's a good one, kim.near too.`);
});

// ── through chatTurn (no network) ───────────────────────────────────────────────────────────────────────────────
import { chatTurn, type ChatEvent } from "./turn.ts";
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const head = () => ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const textSse = (t: string) => head() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + ev("content_block_stop", { index: 0 }) + ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
const toolSse = (name: string, input: object) => head() + ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "t1", name, input: {} } }) + ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + ev("content_block_stop", { index: 0 }) + ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
function claude(answers: string[]) {
  const bodies: string[] = [];
  const f = (async (_u: unknown, init: { body?: string } = {}) => (bodies.push(init.body ?? ""), new Response(answers.shift() ?? textSse(""), { headers: { "content-type": "text/event-stream" } }))) as typeof fetch;
  return { f, bodies };
}
const go = async (words: string, f: typeof fetch, o: Record<string, unknown> = {}) => {
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], words, { relayBase: null, ownKey: "sk-ant-own-test-key-7777777777777777", anthropicFetch: f, hands: { receipts: async () => `Tue: AgentZero paid $4 to bob.near and ${EVM}`, meter: async () => "" }, ...o })) out.push(e);
  return out;
};

test("through a turn: the typed address and the receipts' payees reach Claude as stand-ins; Claude's send to a1 opens Home's Send to the real address, from the person's own words (control: the request held them before L16)", async () => {
  const c = claude([toolSse("send", { to: "a1", usd: 5, coin: "SOL" })]);
  const out = await go(`Send $5 in SOL to ${SOL}`, c.f);
  assert.equal(JSON.stringify(JSON.parse(c.bodies[0]!).messages).includes(SOL), false, "the typed address never goes to Claude");
  assert.match(c.bodies[0]!, /Send \$5 in SOL to a1/);
  const sheet = out.find((e) => e.kind === "needs-you") as { sheet: { ask: { to: string } } };
  assert.equal(sheet.sheet.ask.to, SOL, "the money tool gets the real payee, checked against the person's own words");
  assert.deepEqual((out.find((e) => e.kind === "stand-ins") as { list: string[] }).list, [SOL]);
  // receipts: their payees as stand-ins; Claude's words about a2 shown as the real name on screen
  const r = claude([toolSse("read_receipts", {}), textSse("You paid a1 and a2.")]);
  const out2 = await go("what did AgentZero pay?", r.f);
  // the conversation sent (the fixed prompt's own example names aside)
  const msgs = JSON.stringify(JSON.parse(r.bodies[1]!).messages);
  assert.equal(msgs.includes("bob.near") || msgs.includes(EVM), false);
  assert.equal(out2.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join(""), `You paid ${EVM} and bob.near.`);
  // control: a stand-in Claude made up for an address the person never typed opens nothing
  const z = claude([toolSse("send", { to: "a9", usd: 5 })]);
  const out3 = await go("send $5 to my friend", z.f);
  assert.equal(out3.some((e) => e.kind === "needs-you"), false);
});
