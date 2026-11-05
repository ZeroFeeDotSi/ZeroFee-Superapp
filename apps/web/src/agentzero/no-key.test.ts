// D152 (product decision, 3 Nov): normal people never need a Claude key. With no key of their own, whatever the relay said of the free
// reading (full, used up, off, nothing yet) and while the key is still being read, the chat shows AgentZero's wallet
// ("Fund AgentZero to start." on the first run, "Add money to keep going." when it's empty, the balance chip), never "Paste
// an AI key to start" and never "Add key". The test laptop showed both (3 Nov): a build whose chat had no wallet fell
// back to the key card. The own-key path is a developer setting (own-key.ts, keys.own). Rendered from the real screen
// (vite SSR, every lazy part resolved), with controls.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { prerender } from "react-dom/static";
import { createServer, type ViteDevServer } from "vite";
import { keyGate } from "./key-gate.ts";
import type { NeedsKey } from "@zerofee/agent/chat/turn";

const WHYS: (NeedsKey | null | undefined)[] = ["full", "used-up", "off", "no-key", null, undefined];
/** What the relay's answer makes of keys (live-chat.ts useKeys): `needed` whenever there's a why. */
const keysOf = (o: { saved: unknown; why?: NeedsKey | null | undefined; own?: boolean }) => ({
  saved: o.saved, why: o.why ?? null, needed: !!o.why, line: o.why === "full" ? "Free reading is full for today." : o.why === "used-up" ? "Your free reading is used up." : null,
  own: o.own ?? false, use: async () => ({ ok: false, line: "" }), remove: async () => true, paste: async () => null, getKey: () => undefined,
});
const KEY = { provider: "Claude" as const, tail: "a1b2" };

test("the gate: no own key, any why, pending or read, running or not: never the key card or the Keys chip; the wallet whenever there is one", () => {
  for (const why of WHYS) for (const saved of [undefined, null]) for (const running of [false, true]) {
    const at = `why ${String(why)}, saved ${String(saved)}, running ${running}`;
    const g = keyGate({ keys: keysOf({ saved, why }), wallet: true, running });
    assert.deepEqual(g, { wallet: true, card: false, chip: "wallet" }, at);
    // the root cause's shape: a chat with no wallet at all (the test build) still never asks a person for a key
    const none = keyGate({ keys: keysOf({ saved, why }), wallet: false, running });
    assert.deepEqual(none, { wallet: false, card: false, chip: "none" }, `no wallet, ${at}`);
  }
});

test("control: the developer setting on, the key card and \"Add key\" can show; a saved key keeps its chip, on or off", () => {
  assert.deepEqual(keyGate({ keys: keysOf({ saved: null, why: "full", own: true }), wallet: false, running: false }), { wallet: false, card: true, chip: "keys" });
  assert.deepEqual(keyGate({ keys: keysOf({ saved: null, why: "full", own: true }), wallet: true, running: false }), { wallet: true, card: false, chip: "wallet" }, "on, with the wallet: the wallet still leads");
  assert.deepEqual(keyGate({ keys: keysOf({ saved: undefined, why: null, own: true }), wallet: true, running: false }), { wallet: false, card: false, chip: "keys" }, "on, still reading the key: neither path flashes");
  for (const own of [false, true]) assert.deepEqual(keyGate({ keys: keysOf({ saved: KEY, own }), wallet: true, running: false }), { wallet: false, card: false, chip: "keys" }, `saved key, developer ${own}`);
  // the sample demo: no keys at all, no wallet
  assert.deepEqual(keyGate({ keys: undefined, wallet: false, running: false }), { wallet: false, card: false, chip: "none" });
});

test("the screen reads the gate (control: the old line that let a missing wallet fall back to the key card is gone)", () => {
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /const gate = keyGate\(\{ keys, wallet: !!chat\.wallet, running \}\);/);
  assert.match(chat, /const card = gate\.card;/);
  assert.match(chat, /: gate\.chip === "keys" && keys && <Suspense fallback=\{<div className="azc-keys" \/>\}><KeysChip /);
  assert.doesNotMatch(chat, /const card = !wallet && !!keys\?\.needed && !running;/);
});

// ── the real screen, rendered ───────────────────────────────────────────────────────────────────────────────────────
let server: ViteDevServer;
let AgentZeroChat: ComponentType<{ chat: unknown }>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] }, css: { postcss: { plugins: [] } } });
  ({ AgentZeroChat } = await server.ssrLoadModule("./AgentZeroChat.tsx"));
});
after(async () => server?.close());

const wallet = (state: string, usd: number | null) => ({
  state, walletUsd: usd, feesNear: null, totalUsd: usd, month: null, nearUsd: null, paused: false, problem: null,
  refresh: () => undefined, fund: async () => ({ declined: true }), empty: async () => ({ declined: true }), setCap: async () => ({ declined: true }),
  owe: () => undefined, settle: async () => true, setup: async () => ({ ok: true }), setPaused: () => undefined,
});
const chatOf = (keys: unknown, w: unknown) => ({ messages: [], running: false, send: () => undefined, stop: () => undefined, note: null, keys, ...(w ? { wallet: w } : {}) });
async function screen(chat: unknown): Promise<string> {
  const { prelude } = await prerender(createElement(AgentZeroChat, { chat }));
  let html = "";
  for await (const part of prelude as unknown as AsyncIterable<Uint8Array>) html += new TextDecoder().decode(part);
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}
const KEY_CARD = /Paste an AI key to start/;
const ADD_KEY = /Add key/;

test("rendered, no own key: first run is \"Fund AgentZero to start.\", whatever the relay said and while the key is read; never the key card or \"Add key\"", async () => {
  for (const why of WHYS) for (const saved of [undefined, null]) {
    const s = await screen(chatOf(keysOf({ saved, why }), wallet("fresh", 0)));
    const at = `why ${String(why)}, saved ${String(saved)}: ${s.slice(0, 200)}`;
    assert.match(s, /Fund AgentZero to start\./, at);
    assert.doesNotMatch(s, /Add money to keep going\./, `one call to action on the first run: ${at}`);
    assert.doesNotMatch(s, KEY_CARD, at);
    assert.doesNotMatch(s, ADD_KEY, at);
  }
});

test("rendered, no own key, AgentZero's wallet empty: \"Add money to keep going.\" and its balance chip; never the key card or \"Add key\"", async () => {
  for (const why of WHYS) {
    const s = await screen(chatOf(keysOf({ saved: null, why }), { ...wallet("empty", 0), month: { capUsd: 20, spentUsd: 3, endsAtIso: null } }));
    // D37: the relay refused a message for money (402, "used-up"): the refusal line, Add money and a message's price
    if (why === "used-up") assert.match(s, /AgentZero needs more money to answer\..*Add money.*One message costs up to .*¢\./, String(why));
    else assert.match(s, /Add money to keep going\./, String(why));
    assert.match(s, /\$0(\.00)?\b/, `the chip shows the balance (${String(why)}): ${s.slice(0, 200)}`);
    assert.doesNotMatch(s, KEY_CARD, String(why));
    assert.doesNotMatch(s, ADD_KEY, String(why));
  }
});

test("rendered, no wallet in the chat at all (the test laptop build) and no own key: still no key card, no \"Add key\"", async () => {
  for (const why of WHYS) {
    const s = await screen(chatOf(keysOf({ saved: null, why }), null));
    assert.doesNotMatch(s, KEY_CARD, String(why));
    assert.doesNotMatch(s, ADD_KEY, String(why));
  }
});

test("control, rendered: the developer setting on and no wallet, the key card and \"Add key\" show (so the checks above can fail)", async () => {
  const s = await screen(chatOf(keysOf({ saved: null, why: "full", own: true }), null));
  assert.match(s, KEY_CARD);
  assert.match(s, /Free reading is full for today\./);
  assert.match(s, ADD_KEY);
  // and a saved key keeps its chip, developer setting off
  assert.match(await screen(chatOf(keysOf({ saved: KEY }), wallet("fresh", 0))), /Claude ✓/);
});
