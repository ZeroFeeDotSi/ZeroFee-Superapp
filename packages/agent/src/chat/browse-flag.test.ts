// E2 (audit 14): the chat offers "browse" only where AgentZero's browser is on; off, it says nothing about a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_TOOLS, phoneTools } from "./tools.ts";
import { SITES_OFF_LINE, WEB_BROWSE_LINE, chatTurn, type ChatEvent } from "./turn.ts";
import { AGENT_BROWSER } from "@zerofee/shell-api/agent-browser.ts";

const hands = { receipts: async () => "none", meter: async () => "ok" };
async function said(words: string, extra: Record<string, unknown>) {
  const out: ChatEvent[] = [];
  let fetched = 0;
  const fetch = (async () => (fetched++, new Response("{}", { status: 500 }))) as unknown as typeof globalThis.fetch;
  for await (const e of chatTurn([], words, { relayBase: "https://relay.test", token: "az1.x.y", fetch, hands: { ...hands, ...extra } as never })) out.push(e);
  return { out, fetched };
}

test("E2: off (every build people get), the phone's tools leave out browse; on, the relay's full list", () => {
  assert.equal(AGENT_BROWSER, false);
  const off = phoneTools(false)!;
  assert.ok(!off.includes("browse"));
  assert.deepEqual(off, CHAT_TOOLS.map((t) => t.name).filter((n) => n !== "browse"));
  assert.equal(phoneTools(true), null);
});

test("E2: a site ask on the phone with the browser off: one plain line from ZeroFee, no model call, no browser words", async () => {
  const { out, fetched } = await said("open news.com and read the top story", { offered: phoneTools(false), web: false });
  const text = out.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join("");
  assert.equal(text, SITES_OFF_LINE);
  assert.doesNotMatch(text, /browser|phone app/i);
  assert.ok(!out.some((e) => e.kind === "needs-you"), "no browse card");
  assert.equal(fetched, 0);
});

test("E2: the web wallet keeps its own line", async () => {
  const { out } = await said("open news.com and read the top story", { offered: ["send"], web: true });
  assert.equal(out.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join(""), WEB_BROWSE_LINE);
});

test("E2: the chat hook offers the phone's tools by the one flag", async () => {
  const { readFileSync } = await import("node:fs");
  const hook = readFileSync(new URL("./use-chat-turn.ts", import.meta.url), "utf8");
  assert.match(hook, /phoneTools\(AGENT_BROWSER\)/);
});
