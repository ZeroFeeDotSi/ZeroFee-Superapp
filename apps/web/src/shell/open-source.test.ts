// Settings > Open source: the row opens the screen, TradingView's notice opens through the shell's browser sheet, and
// the notices file is exactly what tools/shell/notices.mjs makes from the lockfile today (so a package that ships
// without its notice fails here). The components are TSX, so vite's own loader loads them (as in problem-view.test.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { CODE_FALLBACK, CODE_LABEL, NOTICES, POSITIONING, licencesLabel, noticeMeta, openInBrowserSheet, plainName, type Notices } from "./open-source.ts";
// @ts-expect-error: a plain .mjs build script, no types
import { buildNotices, importedPackages, OUT, render, repositoryUrl, TRADINGVIEW } from "../../../../tools/shell/notices.mjs";

type Node = { type?: unknown; props?: { children?: unknown; onClick?: () => void; className?: string } };

let server: ViteDevServer;
let MoreRows: (p: { onOpenSource: () => void }) => ReactElement;
let OpenSourceScreen: (p: { onClose: () => void; onOpenUrl?: (url: string) => void; notices?: Notices; codeUrl?: string }) => ReactElement;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  MoreRows = (await server.ssrLoadModule("./SettingsPanel.tsx")).MoreRows;
  OpenSourceScreen = (await server.ssrLoadModule("./OpenSourceScreen.tsx")).OpenSourceScreen;
});
after(async () => server?.close());

/** Every element in the tree (fragments and arrays included). */
function all(el: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(el)) {
    for (const k of el) all(k, out);
    return out;
  }
  const n = el as Node | null;
  if (!n || typeof n !== "object" || !n.props) return out;
  out.push(n);
  all(n.props.children, out);
  return out;
}
const words = (n: Node): string => all(n).map((k) => (typeof k.props?.children === "string" ? k.props.children : "")).join(" ") + (typeof n.props?.children === "string" ? n.props.children : "");

test("Settings: the Open source row is a button, and tapping it opens the Open source screen", () => {
  let opened = 0;
  const row = all(MoreRows({ onOpenSource: () => opened++ })).find((n) => n.type === "button" && /Open source/.test(words(n)));
  assert.ok(row, "an Open source button");
  row.props!.onClick!();
  assert.equal(opened, 1);
});

test("the screen says what ZeroFee is (the positioning line), then the notices, TradingView's first", () => {
  const html = renderToString(OpenSourceScreen({ onClose: () => {}, onOpenUrl: () => {} }));
  assert.ok(html.includes(">Open source<"));
  assert.ok(html.includes(POSITIONING.replace(/'/g, "&#x27;")));
  assert.ok(html.indexOf("Third-party notices") > html.indexOf("ZeroFee is built in the open"));
  assert.ok(html.indexOf("Charts by TradingView") < html.indexOf(">react<"));
  for (const p of NOTICES.packages) assert.ok(html.includes(`>${plainName(p.name)}<`), p.name);
  assert.doesNotMatch(POSITIONING, /safe|guarantee|unhackable|recommend/i);
});

test("Get the code (product decision, 5 Nov late): the phone opens the code in the browser sheet; a browser gets a new-tab link; the build's VITE_CODE_URL wins", () => {
  assert.equal(CODE_LABEL, "Get the code");
  const urls: string[] = [];
  const btn = all(OpenSourceScreen({ onClose: () => {}, onOpenUrl: (u) => urls.push(u) })).find((n) => n.type === "button" && n.props?.className === "os__link os__code");
  assert.ok(btn, "a button on the phone");
  assert.equal(btn.props!.children, CODE_LABEL);
  btn.props!.onClick!();
  assert.deepEqual(urls, [CODE_FALLBACK], "the self-host guide while no code address is set");
  const set: string[] = [];
  all(OpenSourceScreen({ onClose: () => {}, onOpenUrl: (u) => set.push(u), codeUrl: "https://code.example/zf" })).find((n) => n.props?.className === "os__link os__code")!.props!.onClick!();
  assert.deepEqual(set, ["https://code.example/zf"], "control: the build's address when set");
  const html = renderToString(OpenSourceScreen({ onClose: () => {} }));
  assert.ok(html.includes(`<a class="os__link os__code" href="${CODE_FALLBACK}" target="_blank" rel="noopener noreferrer">Get the code</a>`), "a plain link without the shell");
  assert.ok(html.indexOf("Get the code") < html.indexOf("Third-party notices"), "under the line, before the notices");
  const css = readFileSync(new URL("./open-source.css", import.meta.url), "utf8");
  assert.match(css, /\.os__link\.os__code \{[^}]*min-height: 44px/, "a 44 px target");
});

test("TradingView's notice opens its site through the shell's browser sheet (device.openUrl, sheet)", async () => {
  const urls: string[] = [];
  const tv = all(OpenSourceScreen({ onClose: () => {}, onOpenUrl: (u) => urls.push(u) })).find((n) => n.type === "button" && n.props?.className === "os__tv");
  assert.ok(tv, "the TradingView entry is a button");
  assert.match(words(tv), /Charts by TradingView/);
  assert.ok(words(tv).includes(NOTICES.tradingview.noticeText), "the NOTICE text, verbatim, under the label");
  tv.props!.onClick!();
  assert.deepEqual(urls, ["https://www.tradingview.com/"]);
  const calls: [string, unknown][] = [];
  const bridge: Bridge = { call: async <T,>(m: string, p?: Record<string, unknown>) => (calls.push([m, p]), { ok: { ok: true } } as BridgeResult<T>), on: () => () => {} };
  await openInBrowserSheet(bridge, urls[0]);
  assert.deepEqual(calls, [["device.openUrl", { url: "https://www.tradingview.com/", mode: "sheet", app: "wallet" }]]);
});

test("an MIT package that ships no licence file links to its repository, opened through the browser sheet", () => {
  const bare = NOTICES.packages.filter((p) => p.licence && !p.licenceText).map((p) => p.name).filter((n) => n !== "lightweight-charts");
  // fancy-canvas (lightweight-charts' one dependency) is listed once Trade's charts bring it into the lockfile.
  const fancy = NOTICES.packages.some((p) => p.name === "fancy-canvas") ? ["fancy-canvas"] : [];
  assert.deepEqual(bare, ["@fastnear/borsh", "@fastnear/ml-dsa-65", ...fancy, "qrcode-generator", "standardwebhooks"]);
  for (const p of NOTICES.packages.filter((p) => bare.includes(p.name))) assert.match(p.licenceUrl ?? "", /^https:\/\/github\.com\/[^\s]+[^.]$/, p.name);
  const urls: string[] = [];
  const links = all(OpenSourceScreen({ onClose: () => {}, onOpenUrl: (u) => urls.push(u) })).filter((n) => n.type === "button" && n.props?.className === "os__link");
  assert.equal(links.length, bare.length);
  for (const l of links) {
    assert.equal(l.props?.children, "Licence text");
    l.props!.onClick!();
  }
  assert.deepEqual(urls, NOTICES.packages.filter((p) => bare.includes(p.name)).map((p) => p.licenceUrl));
  assert.equal(repositoryUrl({ url: "git+https://github.com/a/b.git" }), "https://github.com/a/b");
  assert.equal(repositoryUrl("git://github.com/a/b.git"), null);
});

test("notices are plain text: a licence with markup shows as text, never as HTML", () => {
  const notices: Notices = { tradingview: TRADINGVIEW, packages: [{ name: "x", version: "1.0.0", licence: "MIT", licenceText: "<img src=x onerror=alert(1)>", noticeText: null, licenceUrl: null }] };
  const html = renderToString(OpenSourceScreen({ onClose: () => {}, notices }));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x"));
});

test("the notices file is what the lockfile says ships today: every imported package, its version and licence", () => {
  assert.equal(readFileSync(OUT, "utf8"), render(buildNotices()), "run: node tools/shell/notices.mjs");
  const names = new Set(NOTICES.packages.map((p) => p.name));
  for (const name of (importedPackages() as Map<string, string>).keys()) assert.ok(names.has(name), `${name} has no notice`);
  for (const name of ["react", "react-dom", "scheduler", "vite", "lightweight-charts"]) assert.ok(names.has(name), name);
  assert.equal(NOTICES.tradingview.notice, "Charts by TradingView");
  assert.equal(NOTICES.tradingview.noticeText, "TradingView Lightweight Charts™\nCopyright (c) 2025 TradingView, Inc. https://www.tradingview.com/");
  assert.equal(NOTICES.tradingview.url, "https://www.tradingview.com/");
  for (const p of NOTICES.packages) assert.match(noticeMeta(p), /Licence|No licence stated/);
});

test("nothing personal or local in the notices: no machine paths", () => {
  const text = readFileSync(OUT, "utf8");
  assert.ok(!text.includes(homedir()));
  assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z]|[A-Z]:\\\\/);
});

// the copy review's S6 (7 Nov): the list folds under "Licences (N)", each package by its plain name, and "Licence text" is a 44 px
// target (it was 75x32). Failed on main (plainName and licencesLabel did not exist; .os__link was min-height 32px).
test("Licences (N) folds the list; plain names, never a raw scoped id; Licence text is 44 px (control: an unscoped name is itself)", () => {
  assert.equal(plainName("@anthropic-ai/sdk"), "sdk (anthropic-ai)");
  assert.equal(plainName("@fastnear/borsh-schema"), "borsh-schema (fastnear)");
  assert.equal(plainName("react"), "react", "control");
  assert.equal(licencesLabel(3), "Licences (3)");
  const html = renderToString(OpenSourceScreen({ onClose: () => {}, onOpenUrl: () => {} }));
  assert.ok(html.includes(`>${licencesLabel(NOTICES.packages.length)}<`));
  for (const p of NOTICES.packages.filter((p) => p.name.startsWith("@"))) assert.ok(!html.includes(`>${p.name}<`), `${p.name} raw on screen`);
  assert.ok(html.indexOf('class="os__all"') < html.indexOf('class="os__list"'), "the list sits inside the one row");
  const css = readFileSync(new URL("./open-source.css", import.meta.url), "utf8");
  assert.match(css, /\.os__link \{[^}]*min-height: 44px/);
  assert.doesNotMatch(css, /\.os__link \{[^}]*min-height: 32px/);
});
