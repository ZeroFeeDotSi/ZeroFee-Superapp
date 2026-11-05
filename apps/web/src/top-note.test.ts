// The web app's top note (product decision, 5 Nov; words redone 5 Nov late: "professional", no demo, no normal): shown on every
// screen of the public web build, Sim and Real (never the extension or the phone app), first above the app, its words from top-note-words.ts, its self-host link from
// VITE_CODE_URL with a live fallback, closed for this page load only, and every target 44 px.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import * as W from "./top-note-words.ts";
import { savedWebMode } from "./mode.ts";

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
type Mod = {
  TopNote: (p: { onClose: () => void; codeUrl: string | undefined }) => ReactElement;
  TopNotePage: ComponentType<{ children: ReactNode; codeUrl: string | undefined }>;
  topNoteView: (open: boolean, close: () => void, codeUrl: string | undefined, app: ReactNode) => ReactElement;
  topNoteOn: (publicBuild: boolean, extensionBuild: boolean) => boolean;
};
let server: ViteDevServer;
let M: Mod;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  M = (await server.ssrLoadModule("./top-note.tsx")) as unknown as Mod;
});
after(async () => server?.close());

const APP = createElement("i", { id: "app" }, "Home");
const page = (codeUrl?: string) => renderToStaticMarkup(createElement(M.TopNotePage, { codeUrl }, APP));
/** Every element in a tree (a function component without hooks, as TopNote is, is called to see what it draws). */
function walk(n: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(n)) n.forEach((k) => walk(k, out));
  else if (isValidElement(n)) {
    out.push(n);
    const p = n.props as { children?: ReactNode };
    if (n.type === M.TopNote) walk(M.TopNote(n.props as Parameters<Mod["TopNote"]>[0]), out);
    walk(p.children, out);
  }
  return out;
}

test("the gate: the public web build, Sim and Real; the extension and the phone build never (controls)", () => {
  assert.equal(M.topNoteOn(true, false), true, "the public web build, whichever tab (the first visit is the Sim)");
  assert.equal(M.topNoteOn(false, false), false, "control: the phone build (not public)");
  assert.equal(M.topNoteOn(true, true), false, "control: the extension");
  // a first visit is the Sim (mode.ts): the note is there too now (the UI lead, 5 Nov late)
  const kv = (v: string | null) => ({ getItem: () => v, setItem: () => undefined });
  assert.equal(savedWebMode(kv(null), kv(null)), "sim");
  assert.doesNotMatch(src("./full-app.tsx"), /topNoteOn\([^)]*WEB_WALLET/, "the gate no longer asks for the web wallet");
});

test("the words (the UI lead, 5 Nov late): professional, never demo, normal or try; Got it is its own name", () => {
  assert.equal(W.TOP_NOTE_TITLE, "ZeroFee on the web");
  assert.equal(W.TOP_NOTE_LINE_1, "Trade fast, send in private, one account for every chain. Fees go to the network, not to ZeroFee.");
  assert.equal(W.TOP_NOTE_LINE_2, "On iPhone, your account is a smart contract on NEAR, with a second approval from your laptop.");
  assert.equal(W.TOP_NOTE_LINE_3, "The iPhone app is coming to the App Store. Run the beta today from the open source code.");
  assert.equal(W.TOP_NOTE_LAPTOP_LABEL, "Laptop approval");
  assert.equal(W.TOP_NOTE_SELFHOST_LABEL, "Get the code");
  assert.equal(W.TOP_NOTE_CLOSE_NAME, W.TOP_NOTE_CLOSE_LABEL, "what the person reads is what a reader says");
  const all = [W.TOP_NOTE_TITLE, W.TOP_NOTE_LINE_1, W.TOP_NOTE_LINE_2, W.TOP_NOTE_LINE_3, W.TOP_NOTE_LAPTOP_LABEL, W.TOP_NOTE_SELFHOST_LABEL].join(" ");
  assert.doesNotMatch(all, /\bdemo\b|\bnormal\b|\btry\b/i);
  assert.match("This is the demo wallet. It's a normal wallet", /\bdemo\b|\bnormal\b/i, "control: the old words would be caught");
});

test("whole path: full-app.tsx draws the note above the app when the public flag (inline) and the web wallet say so", () => {
  const full = src("./full-app.tsx");
  assert.match(full, /const TOP_NOTE = import\.meta\.env\.VITE_ZEROFEE_PUBLIC === "1" && topNoteOn\(true, EXTENSION_BUILD\) && !\("refused" in MODE\);/, "the build flag read inline, so other builds drop it");
  assert.match(full, /TOP_NOTE \? <TopNotePage codeUrl=\{import\.meta\.env\.VITE_CODE_URL\}>\{withMark\}<\/TopNotePage> : withMark/, "the whole page (app and mode mark) under the note");
  assert.match(src("./mode.ts"), /export const WEB_WALLET: boolean = PUBLIC_BUILD && savedWebMode\(\) === "web";/);
  // the web build sets the flag; the phone's build never does (control)
  assert.match(src("../deploy-app.sh"), /VITE_ZEROFEE_PUBLIC=1 /);
  assert.doesNotMatch(src("../../ios/build-web.sh"), /VITE_ZEROFEE_PUBLIC/, "control: the phone bundle is not the public build");
  // the main.tsx public branch is the one that marks the web wallet, and mounts full-app.tsx (startPublic)
  assert.match(src("./main.tsx"), /dataset\.public = SIM \? "sim" : WEB_WALLET \? "web" : "real";/);
});

test("it renders first, above the app: the title, three lines, two links in a new tab, Got it named Got it; all from the words file", () => {
  const html = page();
  assert.ok(html.indexOf('class="zf-top-note"') >= 0 && html.indexOf('class="zf-top-note"') < html.indexOf('id="app"'), "the note is before the app");
  assert.ok(html.startsWith('<div class="zf-top-note-page"><section class="zf-top-note" role="note"'), "the first thing on the page");
  for (const w of [W.TOP_NOTE_TITLE, W.TOP_NOTE_LINE_1, W.TOP_NOTE_LINE_2, W.TOP_NOTE_LINE_3, W.TOP_NOTE_LAPTOP_LABEL, W.TOP_NOTE_SELFHOST_LABEL, W.TOP_NOTE_CLOSE_LABEL]) {
    assert.ok(html.includes(w.replace(/'/g, "&#x27;")), `says "${w}"`);
  }
  assert.match(html, /<button type="button" class="zf-btn zf-top-note__close" aria-label="Got it">Got it<\/button>/);
  assert.match(html, /<a class="zf-top-note__link" href="https:\/\/laptop\.zerofee\.si" target="_blank" rel="noopener noreferrer">Laptop approval<\/a>/);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 2, "both links open a new tab, without the opener");
  assert.equal(W.TOP_NOTE_LAPTOP_URL, "https://laptop.zerofee.si", "never zerofee.si/laptop (a 404)");
  // every string the note shows lives in the words file: top-note.tsx has no text of its own
  const code = src("./top-note.tsx").replace(/\/\/.*$|\/\*\*[\s\S]*?\*\//gm, "");
  assert.doesNotMatch(code, /<\/?[a-z][^>]*>\s*[A-Za-z]/, "no inline words in the note's markup");
  assert.doesNotMatch(code, /aria-label="/, "its names come from the words file too");
  assert.match("<p>Inline</p>", /<\/?[a-z][^>]*>\s*[A-Za-z]/, "control: inline words would be caught");
});

test("the code link: VITE_CODE_URL when set, else zerofee.si/docs/self-host, never empty or dead (control: set); Settings' the same", async () => {
  for (const v of [undefined, "", "   ", "http://github.com/x", "javascript:alert(1)", "https://", "github.com/x"]) {
    assert.equal(W.selfHostHref(v), "https://zerofee.si/docs/self-host", `fallback for ${JSON.stringify(v)}`);
  }
  assert.equal(W.selfHostHref("https://github.com/zerofee/app"), "https://github.com/zerofee/app", "control: the build's address when set");
  assert.match(page(), /href="https:\/\/zerofee\.si\/docs\/self-host" target="_blank" rel="noopener noreferrer">Get the code</);
  assert.match(page("https://code.example/zf"), /href="https:\/\/code\.example\/zf" target="_blank" rel="noopener noreferrer">Get the code</);
  // Settings → Open source (every build, the phone's too) goes to the same address
  const O = (await server.ssrLoadModule("./shell/open-source.ts")) as unknown as { CODE_FALLBACK: string; codeHref: (u: string | undefined) => string };
  assert.equal(O.CODE_FALLBACK, W.TOP_NOTE_SELFHOST_FALLBACK);
  for (const v of [undefined, "", "javascript:alert(1)", "https://code.example/zf"]) assert.equal(O.codeHref(v), W.selfHostHref(v), `same for ${JSON.stringify(v)}`);
});

test("Got it closes it (the app stays in place, not mounted again); a fresh mount shows it again; nothing is kept", () => {
  let closed = 0;
  const open = M.topNoteView(true, () => void closed++, undefined, APP);
  const button = walk(open).find((e) => e.type === "button")!;
  assert.equal((button.props as { "aria-label": string })["aria-label"], "Got it");
  (button.props as { onClick: () => void }).onClick();
  assert.equal(closed, 1, "Got it calls close");
  const shut = renderToStaticMarkup(M.topNoteView(false, () => undefined, undefined, APP));
  assert.equal(shut, '<div class="zf-top-note-page"><div class="zf-top-note-rest"><i id="app">Home</i></div></div>', "closed: the app alone");
  const kids = (v: ReactElement) => (v.props as { children: ReactNode[] }).children;
  assert.equal(kids(M.topNoteView(false, () => undefined, undefined, APP)).length, kids(open).length, "the app keeps its index: closing never remounts it");
  assert.match(page(), /class="zf-top-note"/, "a fresh mount: open");
  assert.match(page(), /class="zf-top-note"/, "and again");
  const code = src("./top-note.tsx");
  assert.match(code, /const \[open, setOpen\] = useState\(true\);/, "open on every mount, closed in memory only");
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|document\.cookie/, "nothing kept: each fresh load shows it");
});

test("every target is 44 px: Got it, and each text link (its padding taken back by its margin); tokens only, no new colour", () => {
  const css = src("./app.css");
  const rule = (sel: string) => {
    const m = css.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "m"));
    assert.ok(m, `${sel} has a rule`);
    return m[1]!;
  };
  const px = (body: string, prop: string) => {
    const m = body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*(-?\\d+)px`));
    assert.ok(m, `${prop} is set`);
    return Number(m[1]);
  };
  const close = rule(".zf-btn.zf-top-note__close");
  assert.ok(px(close, "height") >= 44 && px(close, "min-height") >= 44 && px(close, "min-width") >= 44, "Got it: 44 px");
  const link = rule(".zf-top-note__link");
  assert.match(link, /display: inline-block;/);
  assert.ok(px(link, "min-height") >= 44, "a link's target: 44 px");
  assert.ok(px(link, "line-height") + 2 * Number(link.match(/padding: (\d+)px 0;/)![1]) >= 44, "its line plus its padding: 44 px");
  assert.match(link, /margin: -12px 0;/, "the padding is taken back, so the line keeps its height");
  // control: a smaller target fails the same check
  assert.ok(!(px("min-height: 32px", "min-height") >= 44));
  const note = [".zf-top-note", ".zf-top-note__title", ".zf-small.zf-top-note__line", ".zf-top-note__link", ".zf-btn.zf-top-note__close"].map(rule).join("\n");
  assert.doesNotMatch(note, /#[0-9a-f]{3,8}\b|rgba?\(/i, "no new colour: tokens only (they flip with the theme)");
  assert.match(rule(".zf-top-note"), /background: var\(--fill, var\(--raise\)\); border-bottom: var\(--hairline/);
});
