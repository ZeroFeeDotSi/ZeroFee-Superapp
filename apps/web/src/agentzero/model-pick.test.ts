// The Claude sheet's choice (product decision, 3 Nov): the chip says
// the Claude it runs, the sheet's Model section shows the two rows with their plain lines and rough cost, and the meter
// its three steps, the chosen one marked. Rendered from the real components (vite SSR). Each with a control.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { ClaudeChoice } from "@zerofee/agent/chat/model";

let server: ViteDevServer;
let ModelPick: ComponentType<{ model: { choice: ClaudeChoice | undefined; set: (c: ClaudeChoice) => void } }>;
let KeysChip: ComponentType<{ keys: unknown }>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ ModelPick, KeysChip } = await server.ssrLoadModule("./KeySetup.tsx"));
});
after(async () => server?.close());

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const keys = (saved: unknown, choice?: ClaudeChoice) => ({ saved, needed: false, line: null, use: async () => ({ ok: false, line: "" }), remove: async () => true, paste: async () => null, getKey: () => undefined, ...(choice ? { model: { choice, set: () => undefined } } : {}) });
const chip = (k: unknown) => text(renderToStaticMarkup(createElement(KeysChip, { keys: k })));
const KEY = { provider: "Claude", tail: "a1b2" };

test("the chip says the Claude it runs: \"Opus ✓\" or \"Sonnet ✓\" (controls: no choice read yet \"Claude ✓\"; no key \"Add key\")", () => {
  assert.equal(chip(keys(KEY, { model: "claude-opus-5-5", effort: "medium" })), "Opus ✓");
  assert.equal(chip(keys(KEY, { model: "claude-sonnet-5-5", effort: "low" })), "Sonnet ✓");
  assert.equal(chip(keys(KEY)), "Claude ✓");
  assert.equal(chip(keys(null, { model: "claude-sonnet-5-5", effort: "high" })), "Add key");
});

test("the sheet's Model section: two rows with a plain line and a rough cost each, the chosen one ticked; the meter's three steps, the chosen one on, and its line", () => {
  const html = renderToStaticMarkup(createElement(ModelPick, { model: { choice: { model: "claude-sonnet-5-5", effort: "low" }, set: () => undefined } }));
  const t = text(html);
  assert.match(t, /^Model Claude Opus 5\.5 Most capable\. One message costs up to 7¢\. Claude Sonnet 5\.5 ✓ Faster and cheaper\. One message costs up to 3½¢\. Effort Low Medium High Quicker, shorter answers\.$/);
  const radios = [...html.matchAll(/role="radio" aria-checked="(true|false)"/g)].map((m) => m[1]);
  assert.deepEqual(radios, ["false", "true", "true", "false", "false"], "Sonnet, and Low");
  // control: Opus at High reads the other way
  const opus = renderToStaticMarkup(createElement(ModelPick, { model: { choice: { model: "claude-opus-5-5", effort: "high" }, set: () => undefined } }));
  assert.deepEqual([...opus.matchAll(/aria-checked="(true|false)"/g)].map((m) => m[1]), ["true", "false", "false", "false", "true"]);
  assert.match(text(opus), /Thinks harder, costs more\.$/);
  assert.equal(renderToStaticMarkup(createElement(ModelPick, { model: { choice: undefined, set: () => undefined } })), "", "nothing until it's read");
  // no raw ids or units on screen (plain copy)
  assert.doesNotMatch(t, /claude-|tokens|\$\//);
});

test("the Model section sits in the chip's sheet, with a key or without one; the real chat hands it the device's choice", () => {
  const src = readFileSync(new URL("./KeySetup.tsx", import.meta.url), "utf8");
  const sheet = src.slice(src.indexOf('<Sheet title="Claude"'), src.indexOf("</Sheet>"));
  assert.match(sheet, /\{keys\.model && <ModelPick model=\{keys\.model\} \/>\}/);
  assert.ok(sheet.indexOf("ModelPick") > sheet.lastIndexOf("<KeyForm"), "after the key part, in both of its states");
  const live = readFileSync(new URL("./live-chat.ts", import.meta.url), "utf8");
  assert.match(live, /const model = useModel\(bridge\);/);
  assert.match(live, /getKey: [^\n]+\n\s+model,\n\s+\};/);
});
