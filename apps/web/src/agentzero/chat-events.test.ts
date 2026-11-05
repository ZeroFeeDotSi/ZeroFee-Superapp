import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, narrow, stopReply, type AzMessage, type ChatEvent } from "./chat-events.ts";

const run = (evs: ChatEvent[], start: AzMessage[] = []) => evs.reduce((t, e) => applyEvent(t, e, "r1"), start);

test("text streams into one reply, token by token", () => {
  const t = run([{ kind: "text", delta: "Hel" }, { kind: "text", delta: "lo" }, { kind: "text", delta: "" }]);
  assert.deepEqual(t, [{ id: "r1", role: "assistant", parts: [{ type: "text", text: "Hello" }], done: false }]);
});

test("a step is one card, updated in place by its id (running → done); another id is another card", () => {
  const t = run([
    { kind: "text", delta: "Checking." },
    { kind: "step", id: "a", tool: "look", line: "Looking", state: "running" },
    { kind: "step", id: "b", tool: "pay", line: "Paying", state: "running" },
    { kind: "step", id: "a", tool: "look", line: "Looked", state: "done" },
    { kind: "step", id: "b", tool: "pay", line: "Paying", state: "refused", why: "Over your limit." },
    { kind: "text", delta: " Done." },
    { kind: "done" },
  ]);
  const parts = t[0]!.parts;
  assert.deepEqual(parts.map((p) => p.type), ["text", "step", "step", "text"]);
  assert.deepEqual(parts.filter((p) => p.type === "step").map((p) => p.type === "step" && [p.id, p.state, p.why ?? null]), [["a", "done", null], ["b", "refused", "Over your limit."]]);
  assert.equal(t[0]!.done, true);
});

test("a fault ends the reply with its own line; the user's message is never touched", () => {
  const user: AzMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }], done: true };
  const t = run([{ kind: "text", delta: "Hi" }, { kind: "fault", line: "The relay didn't answer. Nothing was sent." }], [user]);
  assert.deepEqual(t[0], user);
  assert.deepEqual(t[1]!.parts.at(-1), { type: "fault", line: "The relay didn't answer. Nothing was sent." });
  assert.equal(t[1]!.done, true);
});

test("Stop: a running card reads stopped, one line says nothing else ran (control: done cards stay done)", () => {
  const t = stopReply(run([{ kind: "step", id: "a", tool: "x", line: "L", state: "done" }, { kind: "step", id: "b", tool: "y", line: "M", state: "running" }]), "r1");
  const steps = t[0]!.parts.filter((p) => p.type === "step");
  assert.deepEqual(steps.map((p) => p.type === "step" && p.state), ["done", "refused"]);
  assert.deepEqual(t[0]!.parts.at(-1), { type: "fault", line: "Stopped. Nothing else ran." });
});


test("events are narrowed at the door: text is text, a state is one of three, an unknown kind is dropped (review L1)", () => {
  assert.deepEqual(narrow({ kind: "text", delta: 42 }), { kind: "text", delta: "42" });
  assert.deepEqual(narrow({ kind: "step", id: "a", tool: "t", line: { x: 1 }, state: "evil class" }), { kind: "step", id: "a", tool: "t", line: "[object Object]", state: "running" });
  assert.equal(narrow({ kind: "rm -rf" }), null);
  assert.equal(narrow("text"), null);
  assert.deepEqual(narrow({ kind: "done" }), { kind: "done" });
});

