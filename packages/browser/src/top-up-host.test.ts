// The Browser thesis, part 2: a Browser tab's Top up. The phone's event read strictly, the ask Home's sheet gets (D160:
// "host:<host>"; a listed site's own wallet by its id), and the handler: only while the Browser is on screen (D146), the
// tab shown again after, and told only when the money went.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MoneyAsk, MoneyEnd } from "@zerofee/shell-api/money.ts";
import { TOPUP_HOST_EVENT, topUpAsk, topUpHandler, topUpHostOf, type TopUpDeps, type WalletRow } from "./top-up-host.ts";

const TAB = "0F8E6A2C-3B1D-4C5E-9A7F-112233445566";

test("the phone's event: a plain host and its tab (controls: a port, a user, capitals, a site id, junk)", () => {
  assert.equal(TOPUP_HOST_EVENT, "device.site.topupHost");
  assert.deepEqual(topUpHostOf({ host: "some-dex.example", tab: TAB }), { host: "some-dex.example", tab: TAB });
  assert.deepEqual(topUpHostOf({ host: "app.uniswap.org" }), { host: "app.uniswap.org" });
  assert.deepEqual(topUpHostOf({ host: "app.uniswap.org", tab: "../../x" }), { host: "app.uniswap.org" }, "a bad tab id is left out");
  for (const host of ["example.com:8443", "me@example.com", "Example.com", "host:example.com", "localhost", "", "a b.com", "https://example.com"]) {
    assert.equal(topUpHostOf({ host, tab: TAB }), null, host);
  }
  for (const raw of [null, undefined, "example.com", 42, { tab: TAB }, { host: 7 }]) assert.equal(topUpHostOf(raw), null);
});

test("the ask: any host's own wallet by its site id, \"host:<host>\" (D160)", () => {
  assert.deepEqual(topUpAsk("some-dex.example", null), { kind: "siteadd", wallet: "host:some-dex.example", name: "some-dex.example" });
  assert.deepEqual(topUpAsk("app.uniswap.org", []), { kind: "siteadd", wallet: "host:app.uniswap.org", name: "app.uniswap.org" });
});

test("the ask: a listed site's host in a Browser tab is its own fixed wallet, by its id and name (controls)", () => {
  const rows: WalletRow[] = [
    { id: "site-pump-old", role: "site", site: "pump", network: "sol", current: false },
    { id: "site-gmgn-sol", role: "site", site: "gmgn", network: "sol", current: true },
    { id: "site-pump-sol", role: "site", site: "pump", network: "sol", current: true },
    { id: "trading-sol", role: "trading", network: "sol", current: true },
  ];
  assert.deepEqual(topUpAsk("pump.fun", rows), { kind: "siteadd", wallet: "site-pump-sol", name: "pump.fun" });
  assert.deepEqual(topUpAsk("gmgn.ai", rows), { kind: "siteadd", wallet: "site-gmgn-sol", name: "GMGN", network: "Solana" });
  // no wallet of its own yet (or Spending's list unread): the site id, so the sheet says to connect there first
  assert.deepEqual(topUpAsk("pump.fun", null), { kind: "siteadd", wallet: "host:pump.fun", name: "pump.fun" });
  assert.deepEqual(topUpAsk("pump.fun", rows.filter((r) => r.id !== "site-pump-sol")), { kind: "siteadd", wallet: "host:pump.fun", name: "pump.fun" }, "never an old wallet or another site's");
});

function harness(o: { onScreen?: () => boolean; rows?: WalletRow[] | null; shown?: boolean } = {}) {
  const asks: MoneyAsk[] = [], ends: ((e: MoneyEnd) => void)[] = [], tabs: string[] = [], went: string[] = [];
  let reads = 0;
  const deps: TopUpDeps = {
    onScreen: o.onScreen ?? (() => true),
    wallets: async () => { reads++; return o.rows ?? null; },
    openMoney: (ask, onEnd) => { asks.push(ask); ends.push(onEnd); },
    showTab: async (id) => { tabs.push(id); return o.shown ?? true; },
    went: (host) => void went.push(host),
  };
  return { handle: topUpHandler(deps), asks, ends, tabs, went, reads: () => reads };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("the handler opens Home's Put money in with \"host:<host>\", then shows the tab again and tells it the money went", async () => {
  const h = harness();
  assert.equal(await h.handle({ host: "some-dex.example", tab: TAB }), true);
  assert.deepEqual(h.asks, [{ kind: "siteadd", wallet: "host:some-dex.example", name: "some-dex.example" }]);
  assert.equal(h.reads(), 0, "a host that isn't listed needs no read");
  h.ends[0]!({ went: true });
  await flush();
  assert.deepEqual(h.tabs, [TAB]);
  assert.deepEqual(h.went, ["some-dex.example"]);
});

test("closed without moving: the tab comes back, and is told nothing (control)", async () => {
  const h = harness();
  await h.handle({ host: "some-dex.example", tab: TAB });
  h.ends[0]!({ went: false });
  await flush();
  assert.deepEqual(h.tabs, [TAB]);
  assert.deepEqual(h.went, []);
});

test("a listed site's host reads Spending's list for its own wallet", async () => {
  const h = harness({ rows: [{ id: "site-pump-sol", role: "site", site: "pump", network: "sol", current: true }] });
  await h.handle({ host: "pump.fun", tab: TAB });
  assert.equal(h.reads(), 1);
  assert.deepEqual(h.asks, [{ kind: "siteadd", wallet: "site-pump-sol", name: "pump.fun" }]);
});

test("D146: never while the Browser isn't on screen, and the tab isn't pulled over another app after (controls)", async () => {
  const off = harness({ onScreen: () => false });
  assert.equal(await off.handle({ host: "some-dex.example", tab: TAB }), false);
  assert.deepEqual(off.asks, []);
  let screen = true;
  const left = harness({ onScreen: () => screen });
  await left.handle({ host: "some-dex.example", tab: TAB });
  screen = false;
  left.ends[0]!({ went: true });
  await flush();
  assert.deepEqual(left.tabs, [], "the person left: the tab stays in the back");
  assert.deepEqual(left.went, []);
});

test("a bad event or none opens nothing; a tab the phone didn't show isn't told; no tab id, nothing to show (controls)", async () => {
  const h = harness({ shown: false });
  assert.equal(await h.handle({ host: "example.com:8443", tab: TAB }), false);
  assert.equal(await h.handle(null), false);
  assert.equal(h.asks.length, 0);
  assert.equal(await h.handle({ host: "some-dex.example", tab: TAB }), true);
  h.ends[0]!({ went: true });
  await flush();
  assert.deepEqual(h.tabs, [TAB]);
  assert.deepEqual(h.went, [], "the tab didn't come back: nothing to tell");
  assert.equal(await h.handle({ host: "other.example" }), true);
  h.ends[1]!({ went: true });
  await flush();
  assert.deepEqual(h.tabs, [TAB], "no tab id: nothing to show");
});

// Bug report (4 Nov, pump.fun/GMGN top-ups broken end to end): a Browser tab's Top up on pump.fun with Spending's list
// unread asked Home for "host:pump.fun", a wallet of its own the page never signs with, so Home's sheet said "connect
// first" while the person was on pump.fun. The listed site's fixed wallet now comes from the core (subwallet.site.forHost).
test("bug: a listed site's Top up with Spending's list unread asks the core for its fixed wallet (controls: an unlisted host never asks; a refusal keeps the site id)", async () => {
  const asked: string[] = [];
  const asks: MoneyAsk[] = [];
  const base: TopUpDeps = { onScreen: () => true, wallets: async () => null, openMoney: (ask) => void asks.push(ask), showTab: async () => true, went: () => undefined };
  await topUpHandler({ ...base, siteWallet: async (host) => { asked.push(host); return "site-pump-sol-abc123"; } })({ host: "pump.fun", tab: TAB });
  assert.deepEqual(asks.at(-1), { kind: "siteadd", wallet: "site-pump-sol-abc123", name: "pump.fun" });
  await topUpHandler({ ...base, siteWallet: async () => "site-gmgn-sol-def456" })({ host: "gmgn.ai" });
  assert.deepEqual(asks.at(-1), { kind: "siteadd", wallet: "site-gmgn-sol-def456", name: "GMGN", network: "Solana" });
  await topUpHandler({ ...base, siteWallet: async (host) => { asked.push(host); return "x"; } })({ host: "some-dex.example" });
  assert.deepEqual(asks.at(-1), { kind: "siteadd", wallet: "host:some-dex.example", name: "some-dex.example" }, "an unlisted host is its own site id");
  assert.deepEqual(asked, ["pump.fun"], "only a listed host asks the core");
  await topUpHandler({ ...base, siteWallet: async () => { throw new Error("refused"); } })({ host: "pump.fun" });
  assert.deepEqual(asks.at(-1), { kind: "siteadd", wallet: "host:pump.fun", name: "pump.fun" }, "a refusal keeps the site id, as before");
  await topUpHandler({ ...base, wallets: async () => [{ id: "site-pump-sol", role: "site", site: "pump", network: "sol", current: true }], siteWallet: async (host) => { asked.push(host); return "never"; } })({ host: "pump.fun" });
  assert.deepEqual(asks.at(-1), { kind: "siteadd", wallet: "site-pump-sol", name: "pump.fun" }, "a list that names it needs no ask");
  assert.deepEqual(asked, ["pump.fun"]);
});
