// B27, Chat for a first-time person, rendered (phone test, 2 Nov: "the location prompt opens, and then
// nothing tells me what happens or how to text someone"). Chat's own Root on the sample bridge, on the fake React
// runtime (effects run, nothing is drawn):
// 1. the first screen is "Chat", the three lines, Nearby and Pick a city, and nothing else;
// 2. Nearby answered: the city's place is on screen at once (no "Anyone can post here" sheet in front of it), with its
//    one line "You're …", the empty place's line, and the field;
// 3. a place with a chat in it: Back shows the list of chats with its "+", not the first screen again.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: (o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let ShellContext: { Provider: unknown };
let chatRoot: FunctionComponent;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;

/** Chat's message servers are never reached from a unit test: a socket that opens and stays quiet. */
class QuietSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: unknown = null;
  onclose: unknown = null;
  onerror: unknown = null;
  constructor() {
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }
  send() {}
  close() { this.readyState = 3; }
  addEventListener() {}
  removeEventListener() {}
}

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.WebSocket = QuietSocket;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    css: { postcss: { plugins: [] } },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ShellContext = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).ShellContext;
  chatRoot = (await server.ssrLoadModule("@zerofee/chat/app/ChatApp.tsx")).chatApp.Root;
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => server?.close());

/** The browser's own ask, answering at once with Zurich's centre. */
function browserAt(lat: number, lon: number) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { geolocation: { getCurrentPosition: (ok: PositionCallback) => setTimeout(() => ok({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition), 0) } },
  });
}

async function mountChat() {
  const bridge = forApps(mockBridge(), "chat");
  const problems: unknown[] = [];
  const ctx = { bridge, openApp: () => {}, openMoney: () => {}, showProblem: async (p: unknown) => (problems.push(p), { kind: "nothing", label: "OK" }), showWaiting: () => {}, openSwitcher: () => {}, openMenu: () => {}, active: true, index: 0, count: 1 };
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(chatRoot)), { limit: 80 });
  return problems;
}

test("a first-time person: three lines and the two ways in; Nearby opens the city's place at once, with the field", async () => {
  browserAt(47.3769, 8.5417);
  const problems = await mountChat();
  const first = runtime.text();
  assert.deepEqual(first.split("\n"), ["Chat", "Pick a city or tap Nearby.", "Say hi.", "Tap a name to message them.", "Nearby", "Pick a city"], "the first screen and nothing else on it");
  runtime.press(/^Nearby$/);
  await runtime.settle({ limit: 80 });
  const place = runtime.text();
  assert.match(place, /^Zurich/m, "the city's place opened by itself");
  assert.match(place, /You're \nanon\d{4}/, "its one line under the title");
  assert.match(place, /Say hello\. Anyone here can see it\./, "the empty place's line");
  assert.match(place, /\$\nPost/, "the field: the round $, then Post");
  assert.doesNotMatch(place, /Anyone can post here|I understand|Private messages|Connected ·|Request money/, "nothing in front of the place, and no strip over it");
  assert.deepEqual(problems, []);
  // Back: the person has a chat now, so Chat is the list with its "+", never the first screen again
  runtime.press(/^$/); // the Back glyph is the first drawn button with no words
  await runtime.settle({ limit: 40 });
  const list = runtime.text();
  assert.match(list, /^Chat\n\+\nZ\nZurich\nCity chat/m, "a row for Zurich under the + ");
  assert.doesNotMatch(list, /Pick a city or tap Nearby/, "control: the first screen is gone once there is a chat");
  runtime.unmount();
});

test("finding 41: location refused, Pick a city lists every city, and one tap opens it, no location needed", async () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { geolocation: { getCurrentPosition: (_ok: PositionCallback, no: PositionErrorCallback) => setTimeout(() => no({ code: 1 } as GeolocationPositionError), 0) } },
  });
  const problems = await mountChat();
  runtime.press(/^Nearby$/);
  await runtime.settle({ limit: 80 });
  assert.match(runtime.text(), /This browser didn't share your location\.\n \nPick a city$/, "the refusal names the way in without location");
  runtime.press(/^Pick a city$/);
  await runtime.settle({ limit: 40 });
  const sheet = runtime.text();
  assert.match(sheet, /Start a chat/);
  assert.match(sheet, /Lisbon\nPortugal/, "the cities are on the sheet with nothing typed");
  assert.match(sheet, /Zurich\nSwitzerland/);
  runtime.press(/^Lisbon Portugal$/);
  await runtime.settle({ limit: 80 });
  assert.match(runtime.text(), /^Lisbon/m, "Lisbon's place opened");
  assert.deepEqual(problems, []);
  runtime.unmount();
});

test("F41 re-test (k-chat 13:57): the refusal on Start a chat has its own Pick a city, and it goes to the cities", async () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { geolocation: { getCurrentPosition: (_ok: PositionCallback, no: PositionErrorCallback) => setTimeout(() => no({ code: 1 } as GeolocationPositionError), 0) } },
  });
  // Start a chat (the list's + or Pick a city: one sheet), then Nearby on the sheet, refused
  const problems = await mountChat();
  runtime.press(/^$/); // Back from the place the test above opened
  await runtime.settle({ limit: 40 });
  runtime.press(/^Pick a city$/);
  await runtime.settle({ limit: 40 });
  runtime.press(/^Nearby finds your city once$/);
  await runtime.settle({ limit: 80 });
  const text = runtime.text();
  const sheet = text.slice(text.indexOf("Start a chat"));
  assert.match(sheet, /This browser didn't share your location\.\n \nPick a city\n/, "the sheet's refusal line carries the link it promises");
  const app = readFileSync(new URL("../../../../packages/chat/src/app/ChatApp.tsx", import.meta.url), "utf8");
  const start = app.slice(app.indexOf("function StartSheet("), app.indexOf("function NickForm("));
  assert.match(start, /<div className="ch-picks" ref=\{cities\} role="group" aria-label="Cities">/);
  assert.match(start, /scrollIntoView/, "the link goes to the cities");
  assert.deepEqual(problems, []);
  runtime.unmount();
});

test("S3 (k-chat 13:57): the header's + and the Activity icon each have their own 44 px target, no overlap", () => {
  const css = readFileSync(new URL("../../../../packages/chat/src/app/chat.css", import.meta.url), "utf8");
  const frame = readFileSync(new URL("../../../../packages/shell-api/src/appframe.css", import.meta.url), "utf8");
  const rule = (src: string, sel: string) => new RegExp(`^${sel.replace(".", "\\.")} \\{([^}]*)\\}`, "m").exec(src)?.[1] ?? "";
  const px = (r: string, prop: string) => Number(new RegExp(`(?:^|;)\\s*${prop}: (\\d+)px`).exec(r)?.[1] ?? NaN);
  const plus = rule(css, ".ch-plus");
  const bell = rule(frame, ".af-tasks");
  assert.match(plus, /box-sizing: border-box/, "44 px is the whole target, its border inside it");
  assert.match(bell, /box-sizing: border-box/);
  // From the screen's right edge, with the gutter at 24 px. The bell is a zf-icon-btn: 8 px padding and -8 px margin.
  const gutter = 24;
  const plusRight = gutter + Number(/right: calc\(var\(--gutter, 24px\) \+ (\d+)px\)/.exec(plus)?.[1] ?? NaN);
  const plusW = px(plus, "width");
  assert.ok(plusW >= 44 && px(plus, "height") >= 44, `+ is ${plusW} px`);
  const bellW = Math.max(px(bell, "min-width"), 40);
  assert.ok(bellW >= 44 && px(bell, "min-height") >= 44, `Activity is ${bellW} px`);
  const bellRight = gutter - 8 - 8; // right: gutter - 8, margin-right -8
  assert.ok(plusRight >= bellRight + bellW, `+ spans ${plusRight}-${plusRight + plusW} px, Activity ${bellRight}-${bellRight + bellW} px from the right`);
});
