// Private's page, walk (8 Nov): the copy review's A2-2 (D) and follow-ups, QA QA's SHOULD and the audit's SHOULD.
// - Move opens Private's own one-slider sheet ("Move money from Private to your Safe"), never the all-wallets Move.
// - "Private" once (the frame's title): no "Private · up to $10,000", no "In Private" heading; the one line under the
//   figure is "A wallet for private payments, up to $10,000 each."; rows dollars first, units mute under.
// - One lit button: Move while Private holds money, Add to Private when it's empty; the other quiet.
// - After Approve, "$33.86 on its way to your Safe" while its job goes, never "$0.00 / Nothing here yet." alone.
// - the audit's SHOULD: Approve moves at most what the sheet showed (the ledger's `upTo`, private.test.ts has the ledger side).
// Drawn with React's server renderer through vite's loader (as private-home-sheet.test.ts does), inside the wallet's and
// the shell's own contexts.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import type { Balance } from "../../types.ts";

type Mod = typeof import("./Private.tsx");
let server: ViteDevServer;
let P: Mod;
let R: typeof import("../runtime.tsx");
let S: typeof import("@zerofee/shell-api/shell-context.ts");
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL(".", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  P = (await server.ssrLoadModule("./Private.tsx")) as Mod;
  R = (await server.ssrLoadModule("../runtime.tsx")) as typeof R;
  S = (await server.ssrLoadModule("@zerofee/shell-api/shell-context.ts")) as typeof S;
});
after(async () => { await server?.close(); });

const src = readFileSync(new URL("./Private.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
const rows: Balance[] = [
  { tokenId: "usdc", symbol: "USDC", icon: "usdc", amount: "25", usd: "25.00", held: "private", chain: "near" } as unknown as Balance,
  { tokenId: "near", symbol: "NEAR", icon: "near", amount: "2", usd: "8.86", held: "private", chain: "near" } as unknown as Balance,
];

/** The page as the wallet draws it: Private's pocket (`rows`), set up. */
function page(held: Balance[], ready = true): string {
  const rt = { pocket: { available: true, ready, rows: held, defaultOn: false }, bridge: { call: async () => ({ ok: [] }) }, refresh: () => {} };
  const el = createElement(P.PrivateScreen, { onAdd: () => {}, onSetUp: () => {}, onDefault: () => {}, onProblem: () => {} });
  const wrap = (c: ReactNode) => createElement(S.ShellContext.Provider, { value: { tasks: createTaskStore().forApp("wallet") } as never }, createElement(R.WalletRuntimeContext.Provider, { value: rt as never }, c));
  return renderToStaticMarkup(wrap(el));
}

test("A2-2: Private's Move opens its own one-slider sheet, \"Move money from Private to your Safe\", never the all-wallets Move [before: shell.openMoney({kind: move, source: private})]", () => {
  // the page's Move opens the sheet in place (with the slider); the app no longer hands it to the all-wallets Move
  assert.match(src, /data-testid="private-move" onClick=\{\(\) => openSheet\(true\)\}>Move<\/button>/);
  assert.doesNotMatch(app, /<PrivateScreen [^\n]*source: "private"/, "fails before: Move opened MoveSheet (\"All your wallets\")");
  assert.ok(P.PRIVATE_MOVE_WORDS, "fails before: no one-slider sheet");
  const html = renderToStaticMarkup(createElement(P.MoveAllSheet, { usd: "$20.00", stays: "$13.86", slide: { value: 20, max: 33.86, onChange: () => {} }, onApprove: () => {}, onClose: () => {} }));
  // the copy review's trim (8 Nov): the one-slider sheet is a Check this too (was "Move")
  assert.match(html, /<div class="zf-label zf-sheet__title">Check this<\/div>/);
  assert.match(html, /data-testid="private-home-head">Move money from Private to your Safe<\/h2>/);
  assert.equal((html.match(/type="range"/g) ?? []).length, 1, "one slider");
  assert.match(html, /aria-label="How much to move"/);
  assert.doesNotMatch(html, /All your wallets/);
  assert.match(html, /<span>Your Safe gets<\/span><span>\$20\.00<\/span>/);
  assert.match(html, /<span>Private keeps the rest<\/span><span>about \$13\.86<\/span>/);
  // the copy review: the privacy line right under the rows, then Approve; no void (the floor no longer pushed down)
  assert.match(html, /about \$13\.86<\/span><\/div><p class="zf-small wl-moveall__seen" data-testid="private-home-seen">Anyone can see what reaches your Safe\.<\/p><div class="wl-moveall__foot">/);
  const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-moveall__foot \{ padding-top: 24px;/);
  assert.doesNotMatch(css, /\.wl-moveall__foot \{[^}]*margin-top: auto/, "fails before: the foot sat on the floor under a void");
  // control: move-all's sheet is still Check this with its own head and no slider
  const all = renderToStaticMarkup(createElement(P.MoveAllSheet, { usd: "$33.86", stays: "$0.00", onApprove: () => {}, onClose: () => {} }));
  assert.match(all, />Check this<\/div>/);
  assert.match(all, />Move \$33\.86 from Private to your Safe<\/h2>/);
  assert.doesNotMatch(all, /type="range"|keeps the rest/);
});

test("A2-2: \"Private\" once: no \"Private · up to $10,000\", no \"In Private\" heading; the one line under the figure is the wallet's sentence; rows dollars first, units mute under [before: subtitle + heading]", () => {
  const html = page(rows);
  assert.doesNotMatch(html, /Private · up to \$10,000/, "fails before: the subtitle");
  assert.doesNotMatch(html, /<div class="zf-label">In Private<\/div>/, "fails before: the heading");
  assert.match(html, /<p class="wl-display">\$33\.86<\/p><p class="zf-small">A wallet for private payments, up to \$10,000 each\.<\/p><\/div>/, "the one line under the figure");
  assert.equal(html.split("A wallet for private payments, up to $10,000 each.").length - 1, 1, "said once");
  assert.match(html, /<span class="wl-private-coin"><span>USDC · \$25\.00<\/span><span class="zf-small">25\.00 USDC<\/span><\/span>/);
  assert.match(html, /<span>NEAR · \$8\.86<\/span><span class="zf-small">2 NEAR<\/span>/);
  // control: a coin with no price says its name alone, never "$0.00"
  assert.equal(P.coinRowLine({ symbol: "XYZ", amount: "1" } as Balance), "XYZ");
});

test("A2-2: one lit button by state: Move lit and Add to Private quiet while Private holds money; Add to Private lit and no Move when empty [before: both lit]", () => {
  const full = page(rows);
  assert.match(full, /<button class="zf-btn" data-testid="private-move">Move<\/button><button class="zf-btn zf-btn--quiet" data-testid="private-add">Add to Private<\/button>/, "fails before: two lit buttons");
  const empty = page([]);
  assert.doesNotMatch(empty, /data-testid="private-move"/);
  assert.match(empty, /<button class="zf-btn" data-testid="private-add">Add to Private<\/button>/);
  assert.match(empty, /Nothing here yet\./, "control: empty with nothing on its way");
  // control: not set up, the one lit Set up Private
  assert.match(page([], false), /<button class="zf-btn" data-testid="private-add">Set up Private<\/button>/);
});

test("QA QA's SHOULD: after Approve the page says \"$33.86 on its way to your Safe\" (the sheet's figure) until Activity reads its moves ended, not \"Nothing here yet.\" [before: no such line]", async () => {
  assert.ok(P.OnItsWay, "fails before: no on-its-way line");
  const html = renderToStaticMarkup(createElement(P.OnItsWay, { away: { usd: "$33.86", ids: null }, activity: null, onEnd: () => {} }));
  assert.equal(html, '<p class="zf-small wl-explain" role="status" data-testid="private-on-way">$33.86 on its way to your Safe</p>');
  // going until the core answered, then while any of its moves is unread or still moving; the Safe has it: the line goes
  assert.equal(P.stillOnWay(null, []), true);
  assert.equal(P.stillOnWay(["home:a", "home:b"], [{ id: "home:a", status: "done" }]), true, "one not read yet");
  assert.equal(P.stillOnWay(["home:a", "home:b"], [{ id: "home:a", status: "done" }, { id: "home:b", status: "moving" }]), true);
  assert.equal(P.stillOnWay(["home:a", "home:b"], [{ id: "home:a", status: "done" }, { id: "home:b", status: "done" }]), false, "landed: gone");
  assert.equal(renderToStaticMarkup(createElement(P.OnItsWay, { away: { usd: "$33.86", ids: ["home:a"] }, activity: [{ id: "home:a", status: "done" }], onEnd: () => {} })), "");
  // the page: the line while `away`, and "Nothing here yet." only with nothing on its way
  // QA 20 (8 Nov): right under the figure, the slot "Landed in your Safe." then holds for 60 s
  assert.match(src, /<p className="wl-display">[^\n]*<\/p>\n[^\n]*\n\s*\{away && <OnItsWay away=\{away\} activity=\{activity\} onEnd=\{onEnd\} \/>\}/);
  assert.match(src, /rows\.length === 0 && !pocket\?\.oldWords && !away && <p className="zf-small wl-explain">\{ready \? "Nothing here yet\." : "Not set up yet\."\}<\/p>/);
  // Approve hands the page the sheet's own figure at once, then the core's moves
  const store = createTaskStore();
  const said: unknown[] = [];
  let step: import("./Private.tsx").HomeStep = "check";
  await P.homeFromPrivate({ tasks: store.forApp("wallet"), caps: { usdc: "25", near: "2" }, usd: "$33.86", bridge: { call: async () => ({ ok: [{ id: "home:mv-1", kind: "private", status: "moving" }] }) as never }, set: (s) => { step = s; }, onProblem: () => {}, refresh: () => {}, onMade: (o) => said.push(o) });
  assert.equal(step, "sent");
  assert.deepEqual(said, [{ usd: "$33.86", ids: null }, { usd: "$33.86", ids: ["home:mv-1"] }]);
  // control: refused after the job was made: no line (its job's row says it)
  const no: unknown[] = [];
  await P.homeFromPrivate({ tasks: createTaskStore().forApp("wallet"), caps: {}, usd: "$33.86", bridge: { call: async () => ({ problem: { code: "x.refused", whatHappened: "No.", money: { state: "safe", where: "" }, next: { kind: "nothing" } } }) as never }, set: () => {}, onProblem: () => {}, refresh: () => {}, onMade: (o) => no.push(o) });
  assert.deepEqual(no, [{ usd: "$33.86", ids: null }, null]);
  // "Job created." its own block, 16 px above and below (copy review)
  const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");
  assert.match(css, /\.wl-explain\.wl-private-made \{ margin: 16px 0; \}/);
});

test("the audit's SHOULD: Approve asks the core for at most what the sheet showed (upTo, the rows as it opened), not \"all\"; Private grown since moves no more [before: ledger.fromPrivate {}]", async () => {
  // the sheet opened on $33.86 (25 USDC, 2 NEAR); by Approve a refund put 10 more USDC in Private
  const asked: unknown[] = [];
  await P.homeFromPrivate({ tasks: createTaskStore().forApp("wallet"), caps: P.homePlan(rows, 33.86).caps, usd: "$33.86", bridge: { call: async (_m: string, p?: unknown) => { asked.push(p); return { ok: [] } as never; } }, set: () => {}, onProblem: () => {}, refresh: () => {} });
  assert.deepEqual(asked, [{ upTo: { usdc: "25", near: "2" } }], "fails before: {} (all of each coin)");
  // the page snapshots the rows as the sheet opens, and the plan is worked from that snapshot, never the rows re-read
  assert.match(src, /setShown\(\{ rows: \[\.\.\.rows\], slide \}\)/);
  assert.match(src, /const plan = homePlan\(shown\?\.rows \?\? \[\], shown\?\.slide \? pick : shownTotal\);/);
  // the slider's plan: the dearest coin first, whole while it fits, then a part of the next, rounded down
  assert.deepEqual(P.homePlan(rows, 20), { caps: { usdc: "20" }, usd: 20 });
  assert.deepEqual(P.homePlan(rows, 29.43), { caps: { usdc: "25", near: "1" }, usd: 29.43 });
  assert.deepEqual(P.homePlan(rows, 0), { caps: {}, usd: 0 });
  // control: the whole figure moves every coin whole, as the rows say it
  assert.deepEqual(P.homePlan(rows, 33.86), { caps: { usdc: "25", near: "2" }, usd: 33.86 });
});
