// Audit 15 (8 Nov), Mail: FM1 the menu's "AgentZero's email" row and its sheet promised mail ("AgentZero can get mail now",
// "shows in its Inbox", "<address> · not working yet") while the Inbox is off (MAIL_RECEIVE_LIVE false); FM2 its sheet's
// busy line "Reading…" (main since says "Reading its address."). Rule 1, end to end or hidden. Both fail on main ea3017f8a.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MAIL_RECEIVE_LIVE } from "./inbox-gate.ts";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let ChatsMenu: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ChatsMenu = (await server.ssrLoadModule("./ChatsMenu.tsx")).ChatsMenu;
});
after(async () => server?.close());

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\{\/\*.*?\*\/\}/g, "").replace(/\s\/\/ .*$/, "")).join("\n");

test("FM1: while AgentZero's Inbox is off, the menu has no email row and no email sheet opens; with it on, the row is the address alone", () => {
  assert.equal(MAIL_RECEIVE_LIVE, false, "the Inbox is off today");
  const chat = read("./AgentZeroChat.tsx");
  assert.match(chat, /\{\.\.\.\(MAIL_RECEIVE_LIVE \? \{ onMail: \(\) => setMail\(true\), mail: /, "the row only with the Inbox on");
  assert.match(chat, /\{MAIL_RECEIVE_LIVE && mail && <Suspense fallback=\{null\}><MailSheet/, "no sheet either");
  // the menu draws the row only when it is given one (control: given one, it draws it)
  const noop = () => undefined;
  const without = renderToStaticMarkup(createElement(ChatsMenu, { onNew: noop, onJobs: noop, onClose: noop }));
  assert.ok(!without.includes("AgentZero&#x27;s email") && !without.includes("AgentZero's email"), without);
  const withRow = renderToStaticMarkup(createElement(ChatsMenu, { onNew: noop, onJobs: noop, onClose: noop, onMail: noop }));
  assert.ok(withRow.includes("AgentZero&#x27;s email") || withRow.includes("AgentZero's email"));
  const jobs = read("./Jobs.tsx");
  assert.doesNotMatch(jobs, /not working yet/, "one story: the row never says the opposite of the sheet");
});

test("FM2: the email sheet has no ellipsis busy line", () => {
  const jobs = read("./Jobs.tsx");
  const sheet = code(jobs.slice(jobs.indexOf("export function MailSheet")));
  assert.doesNotMatch(sheet, /…/);
});
