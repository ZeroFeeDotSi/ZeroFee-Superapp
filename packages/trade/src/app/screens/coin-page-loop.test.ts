// The coin page draws once per real change, never in a loop (design session, 5 Nov: opening DOPE in ?demo logged 41
// "Maximum update depth exceeded" in 2 s). The page builds its candles afresh on every render (the live price on the last
// one); the chart redrew on each new array, the chart library then reported "no finger", the page set its scrub to null
// and rendered again, and so on. Here the real coin page renders with ?demo's recorded market (MockBridge's sample
// wallets, as the web demo) into a small stand-in DOM, with a stand-in chart library that does what the real one does:
// it reports "no finger" after every draw. Control: the same detector catches a component that does loop.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, useEffect, useState, type ReactElement } from "react";
import { createServer, type Plugin, type ViteDevServer } from "vite";

// ---- a stand-in DOM, just enough for react-dom's client to mount, update and unmount a tree
class FakeStyle { [k: string]: unknown; setProperty(k: string, v: string) { this[k] = v; } removeProperty(k: string) { delete this[k]; } getPropertyValue(k: string) { return String(this[k] ?? ""); } }
class FakeNode {
  childNodes: FakeNode[] = []; parentNode: FakeNode | null = null; style = new FakeStyle(); attrs = new Map<string, string>(); nodeValue: string | null = null;
  nodeType: number; nodeName: string; ownerDocument: FakeDoc | null; namespaceURI: string;
  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDoc | null, namespaceURI = "http://www.w3.org/1999/xhtml") { this.nodeType = nodeType; this.nodeName = nodeName; this.ownerDocument = ownerDocument; this.namespaceURI = namespaceURI; }
  get tagName() { return this.nodeName; }
  get localName() { return this.nodeName.toLowerCase(); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] ?? null : null; }
  get data() { return this.nodeValue ?? ""; }
  set data(v: string) { this.nodeValue = v; }
  get textContent(): string { return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v: string) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (v) this.appendChild(Object.assign(new FakeNode(3, "#text", this.ownerDocument), { nodeValue: v })); }
  appendChild<T extends FakeNode>(c: T): T { c.parentNode?.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  insertBefore<T extends FakeNode>(c: T, ref: FakeNode | null): T { if (!ref) return this.appendChild(c); c.parentNode?.removeChild(c); c.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); return c; }
  removeChild<T extends FakeNode>(c: T): T { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  contains(n: FakeNode | null): boolean { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { this.attrs.set(k, String(v)); }
  setAttributeNS(_ns: string | null, k: string, v: unknown) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  removeAttributeNS(_ns: string | null, k: string) { this.attrs.delete(k); }
  addEventListener() {} removeEventListener() {} dispatchEvent() { return true; } focus() {} blur() {} scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 390, bottom: 220, width: 390, height: 220, x: 0, y: 0 }; }
  querySelector() { return null; } querySelectorAll() { return []; }
  getRootNode() { let x: FakeNode = this; while (x.parentNode) x = x.parentNode; return x; }
}
class FakeDoc extends FakeNode {
  documentElement: FakeNode; body: FakeNode; head: FakeNode; activeElement: FakeNode | null = null; visibilityState = "visible";
  defaultView: unknown;
  constructor() { super(9, "#document", null); this.ownerDocument = null; this.documentElement = this.appendChild(this.createElement("html")); this.head = this.documentElement.appendChild(this.createElement("head")); this.body = this.documentElement.appendChild(this.createElement("body")); this.activeElement = this.body; }
  createElement(tag: string) { return new FakeNode(1, tag.toUpperCase(), this); }
  createElementNS(ns: string, tag: string) { return new FakeNode(1, tag, this, ns); }
  createTextNode(v: string) { return Object.assign(new FakeNode(3, "#text", this), { nodeValue: v }); }
  createComment(v: string) { return Object.assign(new FakeNode(8, "#comment", this), { nodeValue: v }); }
  getElementById() { return null; }
}

// ---- a stand-in chart library: what the real one does that matters here. After every draw it reports where the pointer
// is: nothing when it is off the chart, else the candle under it (the probe's click on Trade's first row leaves the mouse
// resting where the chart then opens, and each redraw reported that candle anew, a new object each time)
type Seen = { draws: number; reports: number; hover: boolean };
const lwc = `
const seen = (globalThis.__lwc ??= { draws: 0, reports: 0, hover: false });
const enumOf = (...ks) => Object.fromEntries(ks.map((k, i) => [k, i]));
export const ColorType = enumOf("Solid"), CrosshairMode = enumOf("Normal", "Magnet"), LineStyle = enumOf("Solid"), LineType = enumOf("Simple"), LastPriceAnimationMode = enumOf("Disabled", "Continuous", "OnDataUpdate");
export const AreaSeries = "area", CandlestickSeries = "candles", HistogramSeries = "histogram";
export function createChart() {
  const moved = new Set();
  let points = [];
  const report = () => {
    const at = points[Math.floor(points.length / 2)];
    for (const f of moved) { seen.reports++; f(seen.hover && at ? { time: at.time, point: { x: 195, y: 110 } } : {}); }
  };
  const series = () => ({ setData(d) { points = d; seen.draws++; report(); }, update(p) { points = [...points.slice(0, -1), p]; seen.draws++; report(); }, applyOptions() {} });
  return {
    addSeries: series, applyOptions() {}, remove() { moved.clear(); },
    priceScale: () => ({ applyOptions() {} }),
    timeScale: () => ({ fitContent() {}, coordinateToTime: () => null }),
    subscribeCrosshairMove: (f) => moved.add(f), setCrosshairPosition() {}, clearCrosshairPosition() {},
  };
}`;
const fakeCharts: Plugin = { name: "fake-lightweight-charts", enforce: "pre", resolveId: (id) => (id === "lightweight-charts" ? "\0fake-lwc" : undefined), load: (id) => (id === "\0fake-lwc" ? lwc : undefined) };

let server: ViteDevServer;
let mount: (el: ReactElement) => Promise<() => void>;
let depthErrors = 0;
const errorWas = console.error, fetchWas = globalThis.fetch;
// The coin page draws its price orders and standing buys on the page now (product decision, 5 Nov, no More sheet), so the order book
// opens its device lock, a BroadcastChannel in node, which would hold this file open after its last test: unref'd here.
const ChannelWas = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
if (ChannelWas) (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = class extends ChannelWas { constructor(name: string) { super(name); (this as unknown as { unref?: () => void }).unref?.(); } };
let coinPage: () => Promise<ReactElement>;

before(async () => {
  const doc = new FakeDoc();
  const g = globalThis as Record<string, unknown>;
  const win = { event: undefined, document: doc, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => new FakeStyle(), matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  doc.defaultView = win;
  Object.assign(g, { window: win, document: doc, getComputedStyle: win.getComputedStyle, matchMedia: win.matchMedia, addEventListener() {}, removeEventListener() {}, HTMLIFrameElement: win.HTMLIFrameElement, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: (f: () => void) => setTimeout(f, 16), cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: false });
  // ?demo reads no market from the network; the runtime's Solana mint reads (Buy's refusals) answer "offline" here
  g.fetch = () => Promise.reject(new TypeError("offline in this test"));
  console.error = (...a: unknown[]) => { if (/Maximum update depth/.test(String(a[0]))) depthErrors++; else errorWas(...a); };
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", plugins: [fakeCharts], ssr: { noExternal: ["lightweight-charts"] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  const { createRoot } = await import("react-dom/client");
  mount = async (el) => {
    const host = doc.body.appendChild(doc.createElement("div"));
    const root = createRoot(host as unknown as Element);
    root.render(el);
    return () => { root.unmount(); doc.body.removeChild(host); };
  };
  const [{ CoinPage }, { TradeProvider }, { ShellContext }, { createMockBridge }, { forApps }, { SAMPLE_OPENING, resetSampleWallets }] = await Promise.all([
    server.ssrLoadModule("./CoinPage.tsx"), server.ssrLoadModule("../runtime.tsx"), server.ssrLoadModule("@zerofee/shell-api/shell-context.ts"),
    server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts"), server.ssrLoadModule("@zerofee/core/bridge"), server.ssrLoadModule("../../demo-engine.ts"),
  ]);
  coinPage = async () => {
    resetSampleWallets();
    // ?demo's runtime: the shell's sample wallets, so the market is the recorded one (no network)
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING, moveMs: 10 } });
    const bridge = forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade");
    const no = () => { throw new Error("not on the coin page"); };
    const shell = { bridge, openApp: no, showProblem: no, showWaiting: no, openMoney: no, openSwitcher: no, openMenu: no, active: true, index: 0, count: 1 };
    // the first coin on Trade's list, as the person taps it (DOPE in ?demo)
    const { runtimeFor } = await server.ssrLoadModule("../../runtime.ts");
    const rows = await runtimeFor(bridge).market.trending();
    const seed = rows.find((r: { symbol: string }) => r.symbol === "DOPE") ?? rows[0];
    return createElement(ShellContext.Provider, { value: shell }, createElement(TradeProvider, { bridge, active: true }, createElement(CoinPage, { seed, onBuy: () => {}, onSell: () => {} })));
  };
});
after(async () => { console.error = errorWas; globalThis.fetch = fetchWas; if (ChannelWas) (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ChannelWas; await server?.close(); });

const lib = (): Seen => ((globalThis as { __lwc?: Seen }).__lwc ??= { draws: 0, reports: 0, hover: false });
const turns = async (n: number) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
/** Until `ok`, a turn of the event loop at a time (no clock): at most `n` turns. */
const until = async (ok: () => boolean, n = 20_000) => { for (let i = 0; i < n && !ok(); i++) await new Promise((r) => setImmediate(r)); return ok(); };

test("control: the detector sees a component that sets its state in an effect on every render", async () => {
  depthErrors = 0;
  function Loop() { const [n, setN] = useState(0); useEffect(() => { if (n < 120) setN(n + 1); }); return null; }
  const unmount = await mount(createElement(Loop));
  await until(() => depthErrors > 0, 2_000);
  unmount();
  assert.ok(depthErrors > 0, "a looping effect is counted");
});

for (const hover of [false, true]) {
  test(`the coin page (?demo, the first coin) draws its chart and never loops, the pointer ${hover ? "resting on" : "off"} the chart`, async () => {
    const page = await coinPage();
    Object.assign(lib(), { draws: 0, reports: 0, hover });
    depthErrors = 0;
    const unmount = await mount(page);
    assert.ok(await until(() => lib().draws > 0), "the chart drew");
    await turns(2_000);
    const { draws, reports } = lib();
    unmount();
    assert.ok(reports > 0, "the stand-in library reported the pointer after drawing, as the real one does");
    assert.equal(depthErrors, 0, `no "Maximum update depth" (draws ${draws})`);
    assert.ok(draws <= 10, `the chart drew once per real change, not once per render: ${draws}`);
  });
}
