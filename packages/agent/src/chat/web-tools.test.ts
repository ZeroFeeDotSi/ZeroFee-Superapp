// W7: on the web wallet a tool that can't work is absent (never offered, then refused); the relay takes only a subset
// of its own fixed tools by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_TOOLS, WEB_ABSENT, webTools } from "./tools.ts";
import { NOT_OFFERED } from "./turn.ts";
import { offeredTools, chatTools as relayTools } from "../../../../apps/quotes/agentzero-chat.mjs";

test("the web offers holdings, quote, prices, send and trade; read_mail only with a mailbox; jobs, acts, browse, move, swap, add, request are absent (control: the phone offers all)", () => {
  const on = webTools(true), off = webTools(false);
  for (const n of ["read_holdings", "quote_dry", "market_price", "send", "trade", "read_mail", "plan"]) assert.ok(on.includes(n), n);
  assert.ok(!off.includes("read_mail"), "no mailbox yet: read_mail absent");
  for (const n of Object.keys(WEB_ABSENT)) assert.ok(!on.includes(n), n);
  assert.ok(Object.keys(WEB_ABSENT).every((n) => CHAT_TOOLS.some((t) => t.name === n)), "each absent name is a real tool");
  assert.equal(CHAT_TOOLS.length, on.length + Object.keys(WEB_ABSENT).length, "control: every other tool stays");
  assert.match(NOT_OFFERED, /Nothing moved\.$/);
});

test("the relay sends only the named subset of its own tools; a name it doesn't hold, a repeat or an empty list is refused (control: no list, every tool)", () => {
  const all = relayTools({ type: "object" });
  const names = webTools(true);
  assert.deepEqual(offeredTools(all, names).map((t: { name: string }) => t.name), all.map((t: { name: string }) => t.name).filter((n: string) => names.includes(n)));
  assert.equal(offeredTools(all, ["read_holdings", "make_a_new_tool"]), null);
  assert.equal(offeredTools(all, ["send", "send"]), null);
  assert.equal(offeredTools(all, []), null);
  assert.equal(offeredTools(all, "send"), null);
  assert.equal(offeredTools(all, undefined), all, "control");
});
