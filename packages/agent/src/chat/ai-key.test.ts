// AgentZero's AI key (product decision, 3 Nov): the provider read from the key's shape; one check with Anthropic, from the device;
// kept only after a 200, under the chat's own name; an OpenAI key or junk never checked, never kept; the clipboard read
// only by paste. Fake keys are built here at run time; no real key exists in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { KEY_LINE, cleanKey, keyController, keyTail, readKey, setUpKey } from "./ai-key.ts";
import { checkClaudeKey } from "./anthropic-check.ts";
import { CHAT_SECRETS } from "./use-chat-turn.ts";

const CLAUDE = "sk-ant-" + "api03-" + "x".repeat(84) + "AbCd";
const OPENAI = "sk-" + "proj-" + "y".repeat(40);

/** Anthropic, recorded: answers `status` (or throws for "offline"); keeps each call's address and headers. */
function anthropic(status: number | "offline") {
  const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, method: String(init.method) });
    if (status === "offline") throw new TypeError("Load failed");
    return new Response("{}", { status });
  }) as typeof fetch;
  return { f, calls };
}

/** A bridge with a secret store and a clipboard; `calls` names every method asked. */
function device(clip: string | null = null, secrets: Record<string, string> = {}) {
  const calls: string[] = [];
  const store = { ...secrets };
  const bridge: Bridge = {
    async call(method: string, p: Record<string, unknown> = {}) {
      calls.push(method);
      if (method === "device.secret.get") return { ok: { value: store[String(p.key)] ?? null } };
      if (method === "device.secret.set") {
        if (p.value === null) delete store[String(p.key)];
        else store[String(p.key)] = String(p.value);
        return { ok: {} };
      }
      if (method === "device.clipboard.read") return { ok: { text: clip } };
      return { problem: { code: "x", whatHappened: "no", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } } };
    },
  } as Bridge;
  return { bridge, calls, store };
}

test("the provider is read from the key: sk-ant- is Claude, sk- is OpenAI, anything else is not an AI key", () => {
  assert.deepEqual(readKey(CLAUDE), { kind: "claude", key: CLAUDE });
  assert.deepEqual(readKey(OPENAI), { kind: "openai" });
  for (const junk of ["", "hello", "ant-" + "z".repeat(40), "sk-ant-short", "pk-" + "q".repeat(30), "sk-"]) assert.deepEqual(readKey(junk), { kind: "junk" }, junk);
  // a pasted key loses its spaces and line breaks; control: the same key with them is the same key
  assert.deepEqual(readKey(`  ${CLAUDE.slice(0, 50)}\n${CLAUDE.slice(50)}\r\n `), { kind: "claude", key: CLAUDE });
  assert.equal(cleanKey(" a b\nc\t"), "abc");
  // the OpenAI result carries no key at all (nothing to keep or send)
  assert.equal("key" in readKey(OPENAI), false);
  assert.equal(keyTail(CLAUDE), "AbCd");
});

test("the check: GET /v1/models at api.anthropic.com, the key in a header (never the address), the browser's direct-access header", async () => {
  const a = anthropic(200);
  assert.equal(await checkClaudeKey(CLAUDE, a.f), "ok");
  assert.equal(a.calls.length, 1);
  const [c] = a.calls;
  assert.equal(new URL(c!.url).origin + new URL(c!.url).pathname, "https://api.anthropic.com/v1/models");
  assert.equal(c!.method, "GET");
  assert.equal(c!.url.includes(CLAUDE), false, "the key is never in the address");
  assert.equal(c!.headers["x-api-key"], CLAUDE);
  assert.equal(c!.headers["anthropic-version"], "2023-06-01");
  assert.equal(c!.headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("each answer is one plain line: 401/403 not accepted, no answer can't reach Claude, never \"price server\"", async () => {
  const line = async (status: number | "offline") => {
    const r = await setUpKey(CLAUDE, { fetch: anthropic(status).f, save: async () => true });
    return r.ok ? KEY_LINE.ready : r.line;
  };
  assert.equal(await line(200), "Claude is ready");
  assert.equal(await line(401), "Claude didn't accept that key.");
  assert.equal(await line(403), "Claude didn't accept that key.");
  assert.equal(await line("offline"), "Couldn't reach Claude. Check your connection.");
  assert.equal(await line(529), "Claude is busy. Try again in a minute.");
  for (const s of [200, 401, 403, "offline", 500] as const) assert.doesNotMatch(await line(s), /price server|relay|token|API/);
});

test("saved only after a 200, under the chat's own name; control: a 401 and no answer save nothing", async () => {
  for (const [status, kept] of [[200, true], [401, false], [403, false], ["offline", false], [500, false]] as const) {
    const d = device();
    const r = await keyController(d.bridge, { fetch: anthropic(status).f, relayBase: null }).use(`${CLAUDE}\n`);
    assert.equal(r.ok, kept, String(status));
    assert.equal(d.store[CHAT_SECRETS.ownKey], kept ? CLAUDE : undefined, String(status));
    assert.equal(CHAT_SECRETS.ownKey, "agentzero.claude-key", "the KeySheet's name, so Jobs and limits sees it too");
    if (r.ok) assert.deepEqual(r, { ok: true, provider: "Claude", tail: "AbCd" });
  }
});

test("an OpenAI key or junk is never checked, never stored; control: a Claude key is checked once", async () => {
  for (const raw of [OPENAI, ` ${OPENAI}\n`, "hello there", ""]) {
    const a = anthropic(200);
    const d = device();
    const r = await keyController(d.bridge, { fetch: a.f, relayBase: null }).use(raw);
    assert.equal(r.ok, false);
    assert.equal(a.calls.length, 0, "never sent anywhere");
    assert.equal(d.calls.includes("device.secret.set"), false, "never stored");
    assert.equal(!r.ok && r.line, raw.includes("sk-") ? KEY_LINE.openai : KEY_LINE.junk);
  }
  const a = anthropic(200);
  await keyController(device().bridge, { fetch: a.f, relayBase: null }).use(CLAUDE);
  assert.equal(a.calls.length, 1);
});

test("the clipboard is read only by paste: probe, use and remove never read it (control: paste does, once)", async () => {
  const d = device(` ${CLAUDE} `);
  const ctl = keyController(d.bridge, { fetch: anthropic(200).f, relayBase: null });
  await ctl.probe();
  await ctl.use(CLAUDE);
  await ctl.probe();
  await ctl.remove();
  assert.equal(d.calls.includes("device.clipboard.read"), false);
  assert.equal(await ctl.paste(), CLAUDE);
  assert.deepEqual(d.calls.filter((c) => c === "device.clipboard.read"), ["device.clipboard.read"]);
});

test("what the chat opens on: a saved key; the free reading (a kept token, or a sign-up that answers); else the key card", async () => {
  const signup = (status: number, body: object = {}) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const at = (fetchFn: typeof fetch, secrets: Record<string, string> = {}, relayBase: string | null = "https://relay.test") => keyController(device(null, secrets).bridge, { fetch: fetchFn, relayBase }).probe();
  assert.deepEqual(await at(signup(500), { [CHAT_SECRETS.ownKey]: CLAUDE }), { saved: { provider: "Claude", tail: "AbCd" } });
  assert.deepEqual(await at(signup(404), {}, null), { needs: "no-key" });
  assert.deepEqual(await at(signup(404)), { needs: "off" }, "the live relay today: no AgentZero route");
  assert.deepEqual(await at((async () => { throw new TypeError("offline"); }) as typeof fetch), { needs: "off" });
  assert.deepEqual(await at(signup(503)), { needs: "full" });
  // control: free reading that is on opens the chat, no card; its token is kept for the first turn
  const d = device();
  assert.deepEqual(await keyController(d.bridge, { fetch: signup(200, { token: "az1.t" }), relayBase: "https://relay.test" }).probe(), { free: true });
  assert.equal(d.store[CHAT_SECRETS.token], "az1.t");
  assert.deepEqual(await at(signup(404), { [CHAT_SECRETS.token]: "az1.t" }), { free: true });
});

test("a wrong key in a browser (Anthropic's 401 has no CORS header, so the fetch throws): not accepted, never \"check your connection\"; control: no network at all still says so", async () => {
  // the keyed check throws as a browser's blocked read does; the probe (no key, no-cors) is answered
  const seen: { key: boolean; mode: string | undefined }[] = [];
  const corsBlocked401 = (async (_url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ key: "x-api-key" in h, mode: init?.mode });
    if ("x-api-key" in h) throw new TypeError("Failed to fetch");
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const r = await setUpKey(CLAUDE, { fetch: corsBlocked401, save: async () => true });
  assert.deepEqual(r, { ok: false, line: "Claude didn't accept that key." });
  assert.deepEqual(seen, [{ key: true, mode: undefined }, { key: false, mode: "no-cors" }], "the probe carries no key");
  const offline = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  assert.deepEqual(await setUpKey(CLAUDE, { fetch: offline, save: async () => true }), { ok: false, line: "Couldn't reach Claude. Check your connection." });
});
