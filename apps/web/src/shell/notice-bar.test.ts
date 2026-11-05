// Product decision, 3 Nov One notice at a
// time (the most important first), one line at the bottom just above the app row, never over it, never over the app's
// top bar, hidden while a full-screen sheet is open, × until it changes. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RANK, pickNotice, type NoticeItem } from "./notices.ts";

const css = readFileSync(new URL("./notice-bar.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");
const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[^]*?\*\/\}/g, "");
const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.()*+?[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[2] ?? "";

test("one notice at a time: the most important first; × hides that one and the next shows; one that changed shows again (controls)", () => {
  const freeze: NoticeItem = { key: "freeze:a", rank: RANK.freeze, line: "Payments wait." };
  const service: NoticeItem = { key: "service:bridge:slow:t1", rank: RANK.service, line: "NEAR Intents' bridge is slow since 2:05." };
  const went: NoticeItem = { key: "went:went:$5", rank: RANK.went, line: "$5.00 went." };
  assert.equal(pickNotice([service, went, null, freeze], new Set())?.key, "freeze:a", "the freeze first, whatever the order given");
  assert.equal(pickNotice([service, went], new Set())?.key, "went:went:$5", "a move that went before a service's line");
  assert.equal(pickNotice([service, went], new Set(["went:went:$5"]))?.key, service.key, "× on it: the next one shows");
  assert.equal(pickNotice([service], new Set([service.key])), null, "× on the last: nothing");
  assert.equal(pickNotice([{ ...service, key: "service:bridge:down:t2" }], new Set([service.key]))?.key, "service:bridge:down:t2", "control: its state changed, it shows again");
  assert.ok(RANK.freeze > RANK.agent && RANK.agent > RANK.went && RANK.went > RANK.service && RANK.service > RANK.back);
});

test("the payment freeze (a move to a new device, a possible takeover) is never dismissible and always first; every other line keeps its × (control: the same item unpinned is hidden by ×)", () => {
  const freeze: NoticeItem = { key: "freeze:a", rank: RANK.freeze, alert: true, pinned: true, line: "Payments wait." };
  const service: NoticeItem = { key: "service:bridge:slow:t1", rank: RANK.service, line: "NEAR Intents' bridge is slow since 2:05." };
  assert.equal(pickNotice([service, freeze], new Set(["freeze:a"]))?.key, "freeze:a", "an × can't hide it, even if one were pressed");
  const { pinned: _p, ...unpinned } = freeze;
  assert.equal(pickNotice([service, unpinned], new Set(["freeze:a"]))?.key, service.key, "control: unpinned, × would hide it");
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /notice=\{freeze \? freezeNoticeItem\(freeze, <FreezeBanner/, "the app's freeze line is the shared item (freeze.ts: pinned while a move is under way)");
  const bar = readFileSync(new URL("./NoticeBar.tsx", import.meta.url), "utf8");
  assert.match(bar, /\{!n\.pinned && <button className="zf-notice__x"/, "a pinned line draws no ×");
});

test("at the bottom, above the app row, never at the top; hidden while a sheet or a Problem screen is open; the page's end stays clear (controls: the old top banner is caught)", () => {
  const base = rule(".zf-notice");
  assert.match(base, /position: absolute/);
  assert.match(base, /bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 10px\)/, "at the bottom");
  assert.doesNotMatch(base, /(^|[;\s])top:/, "never at the top");
  assert.match(rule(".ah--bar .zf-notice"), /bottom: calc\(var\(--bar-h\) \+ env\(safe-area-inset-bottom, 0px\) \+ 8px\)/, "just above the app row, never over it");
  assert.match(base, /z-index: 26/, "over the page, under every sheet (45), the tray (40) and a Problem screen (46)");
  assert.match(css, /\.ah:has\(\.zf-sheet:not\(\[data-under\]\)\) \.zf-notice, \.ah:has\(\.ah-problem\) \.zf-notice \{ display: none; \}/, "a full-screen sheet says its own line");
  assert.match(css, /\.ah--bar:has\(> \.zf-notice\) \.ah-page \{ --zf-safe-bottom: calc\(var\(--bar-h\) \+ env\(safe-area-inset-bottom, 0px\) \+ 62px\); \}/, "a page's end is never under it");
  assert.match(rule(".zf-notice__line"), /white-space: nowrap; overflow: hidden; text-overflow: ellipsis/, "one line");
  assert.match(rule(".zf-notice__x"), /width: 44px; height: 44px/, "an × a finger can hit");
  const oldBanner = ".zf-status { position: absolute; left: 12px; right: 12px; top: calc(env(safe-area-inset-top, 0px) + 6px); z-index: 43; }";
  assert.match(oldBanner, /(^|[;\s{])top:/, "control: the old banner at the top is caught by the same check");
});

test("the shell draws one NoticeBar for every notice: no strip on top, no second line anywhere (control: the old mounts are caught)", () => {
  assert.equal((host.match(/<NoticeBar /g) ?? []).length, 1, "one notice place");
  for (const old of [/<StatusBanner /, /<WentLine /, /<AgentZeroDot /, /className="ah-notice"/, /style=\{\{ top: notice \? stripHeight/]) assert.doesNotMatch(host, old, String(old));
  assert.match(host, /noticeItem,[^]*agentNotice,[^]*RANK\.went[^]*serviceNotice,/, "the freeze, AgentZero, a move that went and a service, in one queue");
  assert.match('{walletBridge && <StatusBanner bridge={walletBridge} />}', /<StatusBanner /, "control: the old mount is caught");
});
