// T2-6 (the copy review's walk, 8 Nov) and QA QA's SHOULD, on the Buy receipt mounted for real (fake-react, as
// trade-receipt-proof.test.ts): "Done in under a second." (never "Landed in 0.43 s"), "You now hold" over
// "7,505 DOPE · $24.85" (the coin once), the proof's page to come or See proof, and the gap between "$25.00" and "$24.85"
// named once: the buy's quote over the market price with its fee (copy review, 8 Nov: that line only). Controls beside each.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string };
let TradeMoment: FunctionComponent<Record<string, unknown>>;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 0);
  g.cancelAnimationFrame ??= (h: unknown) => clearTimeout(h as never);
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ TradeMoment } = (await server.ssrLoadModule("@zerofee/trade/app/screens/Moment.tsx")) as { TradeMoment: typeof TradeMoment });
});
after(async () => server?.close());

const SIG = "27UckxmYVcsFiu4vJ2QUTV8mGwT8iyWPGGm6aq9BnkdwEDBfgwNyJ7h4V3cQkuGkV8b6aSE6cN3U5pvWkn5U7zEHLR";
const HELD = { coins: "7,505 DOPE", usd: "$24.85" };
const COST = "About $0.08 over the market price. Fee $0.002.";
const receipt = async (extra: Record<string, unknown>): Promise<string> => {
  await runtime.mount(createElement(TradeMoment, { phase: "done", side: "buy", symbol: "DOPE", coinAmount: "7,505", where: "your SOL wallet", usd: "$25.00", tapAt: 0, landedMs: 430, onDone: () => {}, ...extra }));
  const t = runtime.text();
  runtime.unmount();
  return t;
};

test("T2-6: the Buy receipt says \"Done in under a second.\", \"You now hold\" over \"7,505 DOPE · $24.85\", and See proof once its page is there (control: none of the old words)", async () => {
  const t = await receipt({ held: HELD, cost: COST, tx: { chain: "sol", hash: SIG } });
  assert.match(t, /\nDone in under a second\.\n/);
  assert.match(t, /\nYou now hold\n7,505 DOPE · \$24\.85 \nif sold now\n/, "the coin once, with its figure");
  assert.match(t, /\nOn Solana · \nSee proof\n/);
  assert.doesNotMatch(t, /Landed in|You hold DOPE|No public page|\bs\n/, "control: the old words");
  // QA QA's SHOULD with the copy review's words (8 Nov): the holding's dollars are what selling it all gets, so it says "if sold now";
  // control: a holding with no dollars has no "if sold now"
  assert.doesNotMatch(await receipt({ held: { coins: "7,505 DOPE" } }), /if sold now/, "control: no figure, no words for it");
  assert.match(await receipt({ landedMs: 2_400 }), /\nDone in 2 seconds\.\n/, "from a second on: its seconds");
});

test("T2-6: with no page yet: \"On Solana. Proof page in a moment.\" and Copy proof (control: a chain with no explorer says so)", async () => {
  assert.match(await receipt({ tx: { chain: "sol", hash: "sample-3" } }), /\nOn Solana\. Proof page in a moment\.\nCopy proof\n/);
  assert.match(await receipt({ tx: { chain: "hood", hash: `0x${"a".repeat(64)}` } }), /\nOn Robinhood Chain · No public page yet\.\nCopy proof\n/, "control");
});

test("QA QA's SHOULD with the copy review's fix (8 Nov): one gap line on the Buy receipt, the buy's own (its quote over the market price and its fee), under the paid figure; none under the holding (two read as two prices for one coin); never a fee for a gap (controls)", async () => {
  const t = await receipt({ held: HELD, cost: COST, tx: { chain: "sol", hash: SIG } });
  const lines = t.split("\n");
  assert.equal(lines.filter((l) => l === COST).length, 1, "the buy's line, once");
  assert.equal(lines.filter((l) => /market price/.test(l)).length, 1, "the only gap line");
  assert.doesNotMatch(t, /under the market price/, "none under the holding");
  assert.ok(lines.indexOf("Done in under a second.") < lines.indexOf(COST) && lines.indexOf(COST) < lines.indexOf("You now hold"), "under the paid figure, over the holding");
  assert.equal((t.match(/fee/gi) ?? []).length, 1, "one fee named: the network's");
  // controls: no cost recorded, no line; a stray market line handed with the holding is never drawn
  const bare = await receipt({ held: { ...HELD, gap: "About $0.07 under the market price." } });
  assert.match(bare, /\nYou now hold\n7,505 DOPE · \$24\.85 \nif sold now\n/);
  assert.doesNotMatch(bare, /market price|Fee/, "control");
});
