// Audit 15 FB1 + FB2 (8 Nov), Solana down (?demo&fault=solana:521): the site wallet's top figure turned to "…" while its
// coin rows kept theirs, Add stayed live, Browser's Recent dropped the figure to "Signed in"; the Add sheet said two
// figures for what can pay and buried the down notice under them with a live keypad. Fail on main ea3017f8a.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keptHub, saveHub, type HubRow } from "./hub-state.ts";
import { SOLANA_DOWN_ADD, solanaDownOf, walletView } from "./site-wallet.ts";
import { siteLine } from "./recent.ts";

const repo = new URL("../../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, repo), "utf8");
const T = Date.UTC(2026, 10, 8, 3, 52);
const time = (at: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);
const box = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const row = (usd: number | null): HubRow => ({ site: "pump", name: "pump.fun", usd, wallet: "site-pump-sol-a", address: "So1Addr", wallets: [{ network: "sol", usd, id: "site-pump-sol-a", address: "So1Addr" }] } as HubRow);

test("FB1: a read Solana can't answer keeps the last figure and its time (kept on this device), never \"…\"", () => {
  const store = box();
  saveHub([row(27.47)], store, T);
  saveHub([row(null)], store, T + 60_000);
  assert.deepEqual(keptHub(store).pump, { usd: 27.47, at: T }, "an unread wallet never saves over its last figure");
  const v = walletView({ site: "pump", name: "pump.fun", row: row(null), read: "ok", now: T + 60_000, kept: keptHub(store).pump! });
  assert.equal(v.dollars, "$27.47");
  assert.equal(v.asOf, `As of ${time(T)}`);
  const never = walletView({ site: "pump", name: "pump.fun", row: row(null), read: "ok", now: T });
  assert.equal(never.dollars, "Can't see it now", "never read: said so, never an ellipsis");
  const fresh = walletView({ site: "pump", name: "pump.fun", row: row(30), read: "ok", now: T, kept: { usd: 27.47, at: T } });
  assert.deepEqual([fresh.dollars, fresh.asOf], ["$30.00", undefined], "control: a fresh figure has no time under it");
  // Recent: the same kept figure with its time
  assert.equal(siteLine({ site: "pump", name: "pump.fun", usd: null, wallet: "w", hosts: [], kept: { usd: 27.47, at: T } }), `Signed in · wallet $27.47 · As of ${time(T)}`);
  assert.equal(siteLine({ site: "pump", name: "pump.fun", usd: 25, wallet: "w", hosts: [] }), "Signed in · wallet $25.00", "control");
  const page = read("packages/browser/src/social/SiteWalletApp.tsx");
  assert.doesNotMatch(page, /Looking…/);
  assert.match(page, /\{v\.asOf && <p className="zf-small sw-total-note" data-testid="sw-as-of">\{v\.asOf\}<\/p>\}/);
  assert.match(read("packages/browser/src/social/SocialHub.tsx"), /kept: keptHub\(\)\[r\.site\]!/);
});

test("FB1: Solana down (this phone and the relay agree), the wallet page's Add is off and says why once; Open stays", () => {
  const down = [{ service: "solana", state: "down", seen: "both" }] as const;
  assert.equal(solanaDownOf(down as never), true);
  assert.equal(solanaDownOf([{ service: "solana", state: "down", seen: "device" }] as never), false, "one source alone is not down");
  const v = walletView({ site: "pump", name: "pump.fun", row: row(null), read: "ok", now: T, kept: { usd: 27.47, at: T }, solanaDown: true });
  assert.equal(v.canAdd, false);
  assert.equal(v.lines.filter((l) => l === SOLANA_DOWN_ADD).length, 1);
  assert.equal(SOLANA_DOWN_ADD, "Solana is down, so Add waits. It checks again by itself.");
  assert.equal(v.open, "Open pump.fun", "reading the site is fine");
  const up = walletView({ site: "pump", name: "pump.fun", row: row(30), read: "ok", now: T });
  assert.equal(up.canAdd, true, "control");
});

test("FB2: the site Add sheet says what can pay once, puts a down service's line first, and rests its keypad and Max", () => {
  const sheet = read("packages/wallet/src/app/money/SiteMoney.tsx");
  assert.doesNotMatch(sheet, /site-add-part/, "no second figure");
  const add = sheet.slice(sheet.indexOf("const rests = services.down"), sheet.indexOf("/** The sheet's one line for the way it goes"));
  // audit 16's G4: the core's line itself says "It checks again by itself." (waitsLine), so no rewrite here
  assert.match(add, /const downTop = rests && services\.line \? services\.line : null;/);
  assert.ok(add.indexOf('data-testid="site-add-down"') < add.indexOf('className="zf-money__amount"'), "the problem on top, above the figure");
  assert.match(add, /<div \{\.\.\.restsProps\(rests\)\} data-testid="site-add-pad"><Keypad /, "audit 16's G1: the one rest helper");
  assert.match(add, /disabled=\{busy \|\| rests\}/, "Max rests too");
  assert.match(add, /<SheetLine text=\{line \?\? \(downTop \? null : services\.line\)\} \/>/, "said once");
});
