// The Jobs page's lead (product decision, 5 Nov): AgentZero's real features and its fee line, drawn by React's server renderer
// through vite's loader (as design's job-tracker.render.test.ts does). Controls: a line AgentZero can't do here isn't drawn.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let AzLead: ComponentType<{ copy: boolean; pocket: boolean }>;
let FEE_LINE: string, LEAD_COPY: string, LEAD_POCKET: string, LEAD_RECEIPT: string, LEAD_SIGN_IN: string, LEAD_TITLE: string;
let leadLines: (o: { copy: boolean; pocket: boolean }) => string[];
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const m = await server.ssrLoadModule("./AzLead.tsx");
  ({ AzLead, FEE_LINE, LEAD_COPY, LEAD_POCKET, LEAD_RECEIPT, LEAD_SIGN_IN, LEAD_TITLE, leadLines } = m as never);
});
after(async () => server?.close());

const draw = (copy: boolean, pocket: boolean) => renderToStaticMarkup(createElement(AzLead, { copy, pocket }));
/** What a person reads: the markup's text, tags dropped, entities read back. */
const words = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

test("the lead draws every feature line and the fee line, in order", () => {
  const html = draw(true, true);
  assert.equal(FEE_LINE, "Fees: 100% to the AI model. $0 to ZeroFee.");
  assert.match(html, new RegExp(`aria-label="${LEAD_TITLE}"`));
  const text = words(html), at = (s: string) => text.indexOf(s);
  for (const l of [LEAD_COPY, LEAD_SIGN_IN, LEAD_POCKET, LEAD_RECEIPT, FEE_LINE]) assert.ok(at(l) > 0, `${l} drawn`);
  assert.ok(at(LEAD_COPY) < at(LEAD_SIGN_IN) && at(LEAD_SIGN_IN) < at(LEAD_POCKET) && at(LEAD_POCKET) < at(LEAD_RECEIPT) && at(LEAD_RECEIPT) < at(FEE_LINE));
  const fee = html.match(/<p class="zf-body ag-fee">(.*?)<\/p>/)?.[1] ?? "";
  assert.equal(fee.replace(/<[^>]+>/g, ""), FEE_LINE, "the fee line, word for word");
  assert.equal((fee.match(/class="ag-nowrap"/g) ?? []).length, 2, "each sentence kept whole: '$0' never ends a line alone");
});

test("control: no copy job and no pocket money here, no line that says so; sign-in, receipts and the fee line stay", () => {
  const html = draw(false, false), text = words(html);
  assert.ok(!text.includes(LEAD_COPY) && !text.includes(LEAD_POCKET), text);
  for (const l of [LEAD_SIGN_IN, LEAD_RECEIPT, FEE_LINE]) assert.ok(text.includes(l), l);
  assert.deepEqual(leadLines({ copy: true, pocket: false }), [LEAD_COPY, LEAD_SIGN_IN, LEAD_RECEIPT]);
});

test("the copy bar: one idea a line, under 12 words, no 'we', never the old broad line", () => {
  for (const l of [LEAD_COPY, LEAD_SIGN_IN, LEAD_POCKET, LEAD_RECEIPT, FEE_LINE]) {
    assert.ok(l.split(/\s+/).length < 12, l);
    assert.doesNotMatch(l, /\b(we|us|our|any|fulfil|requirement|non-profit)\b/i, l);
  }
});

test("the Jobs page leads with it (the old tab and Jobs and limits), and the foot tagline is gone", () => {
  const app = readFileSync(new URL("./AgentApp.tsx", import.meta.url), "utf8");
  assert.match(app, /\{settles && <AzLead copy=\{starts\("copy"\)\} pocket=\{!noPocket\} \/>\}/);
  const at = (s: string) => app.indexOf(s);
  assert.ok(at("<AzLead ") < at('<form className="ag-ask"') && at("<AzLead ") < at('<div className="zf-label ag-section">Jobs</div>'), "before the field and the jobs");
  assert.doesNotMatch(app, /\{TAGLINE\}/, "control: the old foot line isn't drawn as well (say it once)");
});
