// Home (the Home plan §1.1, D128, D129), and Swap on Home through NEAR Confidential:
// - one number (a tap hides every amount, remembered); four actions Add · Send · Swap · Move; the wallet bar All · Safe ·
//   SOL · ETH (RH) · NEAR (BNB only while open); All is the Safe on top, then each wallet with every holding (coins bought
//   in Trade among them); a wallet tab only that wallet, an empty one a line and Add; a read that failed keeps its last
//   figure under the rows, naming who failed (H6, §3); Hidden is no place on Home (D128); never "Spending" or "Private";
//   no account rows on the money screen (behind the menu glyph);
// - Swap is the one money sheet, "Swap $8.22 of NEAR for USDC", whose line after Approve is the swap service's own time,
//   never a spinner; it pays with the coin named, through Spending's Top up (the relay's confidential case d);
// - every new string reads at grade 5 or under and grades A or B on the voice guard, with a control.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";
import type { SpendingStatus } from "@zerofee/core/spending";
import { grade, onePot } from "../../../../tools/copy/voice.ts";
import { foldedInto } from "../shown-apps.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (p: string) => readFileSync(ROOT + p, "utf8");
/** Code and on-screen words only (comments may name what was removed). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void; pressNamed: (n: RegExp) => void };
let ShellContext: { Provider: unknown };
let walletRoot: FunctionComponent;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
type Row = { chain: string; name: string; amount: string | null; usd: string | null; coins: { symbol: string; amount: string; usd: string | null; address?: string }[] };
let home: { HOME_WORDS: Record<string, string>; ROW_NAME: Record<string, string>; emptyLine: (name: string) => string; walletCount: (n: number) => string; walletUsd: (r: Row) => string | null; homeRows: (s: SpendingStatus, held?: unknown[], inNear?: unknown[]) => Row[]; nearChainCoins: (coins: { tokenId: string; amount: string }[] | null, price: (id: string) => number | null) => { symbol: string; amount: string; usd: string | null }[] };
let view: { readLines: (r: { offline: boolean; safe?: { by: string; at: number | null }; oneClick?: { at: number | null }; chains?: { ids: string[]; at: number | null }; trade?: boolean }) => string[] };
let trading: { tradingUsd: (s: SpendingStatus, held: unknown[] | null, wallets: unknown[] | null) => { usd: string; partial: boolean } };
let swap: { plainLine: (p: { code: string; whatHappened: string }) => string; workingLine: (eta?: number) => string; swapWords: (usd: string, coin: "NEAR" | "USDT") => string; swapRows: (b: unknown[], c: "NEAR" | "USDT") => { tokenId: string }[] };

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ShellContext = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).ShellContext;
  walletRoot = (await server.ssrLoadModule("@zerofee/wallet/app/WalletApp.tsx")).walletApp.Root;
  // Home's readers (home-keep.ts) load at boot in the app; here, before the first mount
  await server.ssrLoadModule("@zerofee/wallet/app/home-keep.ts");
  home = (await server.ssrLoadModule("@zerofee/wallet/app/screens/Home.tsx")) as typeof home;
  trading = (await server.ssrLoadModule("@zerofee/wallet/app/trading.ts")) as typeof trading;
  view = (await server.ssrLoadModule("@zerofee/wallet/app/screens/read-lines.ts")) as typeof view;
  swap = (await server.ssrLoadModule("@zerofee/wallet/app/money/SwapSheet.tsx")) as typeof swap;
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => server?.close());

/** Spending as the engine answers in ?demo, with a held coin on Solana and a pump.fun wallet: the Trading parts. */
const SPENDING = { loaded: true, totalUsd: "212.54", reserveUsd: "40.00", cashUsd: "212.54", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "287.46", ready: true, firstTopUp: false, onItsWay: [],
  networks: [
    { network: "sol", name: "Solana", cashUsd: "144.37", coinsUsd: "0.00", readyUsd: "143.37", nativeAmount: "1.42" },
    { network: "hood", name: "Robinhood Chain", cashUsd: "28.17", coinsUsd: "0.00", readyUsd: "27.87", nativeAmount: "0.012" },
    { network: "bsc", name: "BNB Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0", closed: true },
  ] };
const HELD = [{ chain: "sol", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", amount: "125050", usd: "3.46" }];
const SITES = [{ id: "site-pump-sol-abc", role: "site", site: "pump", network: "sol", address: "x", label: "pump.fun wallet", current: true, inCap: false, cashUsd: "10.00", coinsUsd: "0.00", keyExported: false }];

const NEAR_DOWN = { problem: { code: "ledger.nodes.unreachable", service: "near", whatHappened: "NEAR didn't answer.", money: { state: "safe" }, next: { kind: "retry", label: "Try again" } } };
/** A Safe read on this phone at 10:52 (the copy Home paints from when NEAR doesn't answer). */
const KEPT_AT = new Date(2026, 10, 3, 10, 52).getTime();

async function homeShown(o: { fail?: Record<string, unknown>; problems?: unknown[]; tapMs?: number[]; spending?: boolean; waiting?: boolean; tap?: RegExp | RegExp[]; hidden?: string; positionsFail?: boolean; nearOnly?: boolean; status?: unknown; safeDown?: boolean; store?: Record<string, string>; sets?: [string, unknown][]; wait?: number; answers?: Record<string, unknown>; until?: RegExp; named?: RegExp } = {}): Promise<{ shown: string; asked: unknown[]; opened: string[] }> {
  const asked: unknown[] = [];
  const opened: string[] = [];
  const inner = mockBridge();
  const answers: Record<string, unknown> = o.spending === false ? {} : { "spending.status": SPENDING, "trade.positions": HELD, "spending.wallets": SITES };
  if (o.positionsFail) delete answers["trade.positions"];
  if (o.nearOnly) answers["spending.status"] = { ...SPENDING, networks: [] };
  if (o.status) answers["spending.status"] = o.status;
  Object.assign(answers, o.answers);
  if (o.hidden !== undefined) answers["ledger.private"] = { available: true, ready: true, defaultOn: false, rows: [{ tokenId: "nep141:usdc", symbol: "USDC", name: "USD Coin", chain: "near", amount: o.hidden, usd: o.hidden, held: "private", listed: true }] };
  let kept: unknown = null;
  const call = async (m: string, p?: Record<string, unknown>): Promise<unknown> => {
    if (m === "device.store.set") o.sets?.push([String(p?.key), p?.value]);
    if (m === "device.store.get" && o.store && String(p?.key) in o.store) return { ok: { value: o.store[String(p?.key)] } };
    if (m === "ledger.balances" && o.safeDown) {
      // the coins kept on this phone answer at once (as the real store does); NEAR doesn't
      kept ??= await inner.call("ledger.balances");
      return NEAR_DOWN;
    }
    // the copy of Home kept on this phone (home-cache.ts, D134): the Safe as read at 10:52
    if (m === "device.store.get" && o.safeDown && p?.key === "home-cache.v1") return { ok: { value: JSON.stringify({ v: 1, balances: { at: KEPT_AT, rows: ((kept ?? (kept = await inner.call("ledger.balances"))) as { ok: unknown }).ok } }) } };
    if (o.fail && m in o.fail) return o.fail[m];
    if (m in answers) return { ok: answers[m] };
    if (m === "trade.positions") return { problem: { code: "trade.market.busy", whatHappened: "x", money: { state: "safe" }, next: { kind: "nothing", label: "OK" } } };
    return inner.call(m, p);
  };
  const bridge: Bridge = { call: call as never, on: (e, h) => inner.on(e, h) };
  const ctx = { bridge: forApps(bridge, "wallet"), openApp: (app: string, tab?: string) => opened.push(`${app} ${tab ?? ""}`), openMoney: (a: unknown) => asked.push(a), showProblem: async (p: unknown) => (o.problems?.push(p), { kind: "nothing", label: "OK" }), showWaiting: () => {}, openSwitcher: () => {}, openMenu: () => {}, active: true, index: 0, count: 1 };
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(walletRoot)), { limit: 60 });
  // a part loaded after the first paint (the pulse): its module, then its answer
  const wait = async () => { if (o.wait) for (let i = 0; i < 20 && !(o.until ?? /Your coins (rose|fell)/).test(runtime.text()); i++) { await new Promise((r) => setTimeout(r, o.wait)); await runtime.settle(); } };
  await wait();
  for (const t of o.tap ? [o.tap].flat() : []) { const t0 = performance.now(); runtime.press(t); await runtime.settle(); o.tapMs?.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 50)); await runtime.settle(); }
  if (o.named) { runtime.pressNamed(o.named); await runtime.settle(); await new Promise((r) => setTimeout(r, 50)); await runtime.settle(); }
  if (o.tap || o.named) await wait();
  const shown = runtime.text();
  runtime.unmount();
  return { shown, asked, opened };
}

test("Home (product decision, 5 Nov): two tabs, Safe first: the number is the Safe's ($5,254.15), the switch carries both totals, the Safe's coins only; Hot: its number, Trade's wallets one per chain, BONK bought in SOL, pump.fun's wallet; Safe + Hot = everything", async () => {
  const { shown } = await homeShown();
  assert.match(shown, /^Your Safe\n\$5,254\.15\nAdd\nSend\nSwap\nMove\nSafe\n\$5,254\.15\nHot\n\$226\.00\nGuarded by your rules\.\nSafe\n5 coins\n/m, "the Safe's number, the four, then the switch with each total");
  assert.match(shown, /Bitcoin\n0\.0123 BTC\n\$989\.60/, "the Safe's coins (BTC among them)");
  assert.doesNotMatch(shown, /BONK|1\.42 SOL|pump\.fun|Trade wallets|\$5,480\.15/, "control below: Hot money never shows on the Safe");
  const hot = (await homeShown({ tap: /^Hot/ })).shown;
  assert.match(hot, /^Hot\n\$226\.00\nAdd\n/m, "Hot's number: the wallets $212.54 + BONK's $3.46 in the SOL wallet + the pump.fun wallet's $10.00 (QA test: the sum of its rows)");
  // one unit per line (re-check, 5 Nov): the SOL line is 1.42 SOL and ITS dollars ($144.37, as Trade's SOL tab says it),
  // BONK its own line under it; Hot's number still counts both (control: never the whole wallet's $147.83 beside SOL alone)
  assert.match(hot, /Trade wallets\n(\S\n)*SOL wallet\n1\.42 SOL\n\$144\.37\n\+\n(\S\n)*BONK\n125,050 BONK\n\$3\.46\n/, "SOL: one row, its own coin in units and dollars, its Add (a quiet + disc, named Add SOL), then the coin bought in it");
  assert.doesNotMatch(hot, /1\.42 SOL\n\$147\.83/, "control: the whole wallet's dollars never sit beside SOL's units");
  assert.doesNotMatch(hot, /No Face ID per trade/, "the Trade card's Face ID note is gone: the tab line says what Hot is");
  assert.match(hot, /ETH \(RH\) wallet\n0\.012 ETH\n\$28\.17/);
  assert.match(hot, /NEAR wallet\nCash\n\$40\.00/, "the NEAR wallet's cash");
  assert.match(hot, /pump\.fun\n1 wallet · \$10\.00\n\$10\.00\n›/, "the site is one row in Hot, its figure the sum of its wallets (S14)");
  assert.doesNotMatch(hot, /SOL wallet\n\$10\.00/, "closed: its wallets are not drawn yet");
  const site = (await homeShown({ tap: [/^Hot/, /pump\.fun/] })).shown;
  assert.match(site, /pump\.fun\n1 wallet · \$10\.00\n\$10\.00\n›\n(\S\n)*SOL wallet\n\$10\.00/, "a tap opens it to its wallet: its network and its figure");
  assert.match(site, /^Hot\n\$226\.00\nAdd\n/m, "opening a site never changes Hot's number");
  assert.doesNotMatch(hot, /Bitcoin|0\.0123 BTC/, "control: no Safe coin on Hot");
  assert.equal((5254.15 + 226.00).toFixed(2), "5480.15", "the two tabs add up to everything (the old one number)");
  // Private is one place on Home: its door under the Safe's coins (gates re-crawl, 5 Nov, MUST), never Hot's, never a row's word
  assert.equal((shown.match(/Private/g) ?? []).length, 1, "Private's door, once, on the Safe");
  assert.doesNotMatch(hot, /Private/, "control: never on Hot");
  for (const gone of [/Hidden/, /Spending/, /Trading/, /ETH on Robinhood/, /protected by your NEAR contract/, /^Your account$/m, /^Top up$/m, /^Put away$/m, /^All$/m]) assert.doesNotMatch(shown + hot, gone, String(gone));
});

test("Safe | Hot: a site wallet's coins each at its own price (subwallet.coins): DOPE bought on pump.fun is a row and in the wallet's figure; control: coins not read, the wallet's own figure as one row", async () => {
  const sites = [{ ...SITES[0], cashUsd: "2.47", coinsUsd: "7.53" }];
  const coins = [{ token: "native", symbol: "SOL", decimals: 9, amount: "12400000", usd: 2.47 }, { token: "DopeMint11111111111111111111111111111111111", symbol: "DOPE", decimals: 6, amount: "1500000000", usd: 7.53 }];
  const hot = (await homeShown({ tap: [/^Hot/, /pump\.fun/], answers: { "spending.wallets": sites, "subwallet.coins": coins } })).shown;
  // test MUST 9: the SOL line's dollars are its SOL's own ($2.47 for 0.0124 SOL), never the whole wallet's $10.00 beside SOL units
  assert.match(hot, /pump\.fun\n1 wallet · \$10\.00\n\$10\.00\n›\n(\S\n)*SOL wallet\n0\.0124 SOL\n\$2\.47\n(\S\n)*DOPE\n1,500 DOPE\n\$7\.53/, "its SOL wallet (its SOL, its figure), then DOPE in it, as a Trade wallet's coins");
  assert.match(hot, /^Hot\n\$226\.00$/m, "a site buy never drops Hot's number: $2.47 + $7.53 = the $10.00 it was");
  const unread = (await homeShown({ tap: [/^Hot/, /pump\.fun/], answers: { "spending.wallets": sites } })).shown;
  assert.match(unread, /pump\.fun\n1 wallet · \$10\.00\n\$10\.00\n›\n(\S\n)*SOL wallet\n\$10\.00/, "control: coins not read, the wallet's one row at its figure");
});

test("S14, the copy review's ruling: GMGN is one row, \"2 wallets · $27.47\", that opens to its SOL and Base wallets (control: closed, no chain words)", async () => {
  const gmgn = (id: string, network: string, cashUsd: string) => ({ ...SITES[0], id, site: "gmgn", network, label: "GMGN wallet", cashUsd });
  const answers = { "spending.wallets": [...SITES, gmgn("site-gmgn-sol", "sol", "20.00"), gmgn("site-gmgn-base", "base", "7.47")] };
  const closed = (await homeShown({ tap: /^Hot/, answers })).shown;
  assert.match(closed, /GMGN\n2 wallets · \$27\.47\n\$27\.47\n›/);
  assert.equal((closed.match(/^GMGN$/gm) ?? []).length, 1, "one GMGN row");
  assert.doesNotMatch(closed, /Base wallet|SOL · Base/, "control: closed, no chain words");
  const open = (await homeShown({ tap: [/^Hot/, /GMGN/], answers })).shown;
  assert.match(open, /GMGN\n2 wallets · \$27\.47\n\$27\.47\n›\n(\S\n)*SOL wallet\n\$20\.00\n(\S\n)*Base wallet\n\$7\.47/);
});

test("S17: Hot's site rows sit under ONE \"Social trading\" heading; AgentZero's row stays its own, after it (control: no heading without a site, none on the Safe)", async () => {
  const gmgn = { ...SITES[0], id: "site-gmgn-sol", site: "gmgn", network: "sol", label: "GMGN wallet", cashUsd: "20.00" };
  const az = { ...SITES[0], id: "az", role: "agent", site: "agentzero", label: "AgentZero's pocket", cashUsd: "12.00" };
  const hot = (await homeShown({ tap: /^Hot/, answers: { "spending.wallets": [...SITES, gmgn, az] } })).shown;
  assert.match(hot, /Trade wallets\n[\s\S]*\nSocial trading\n(\S\n)*pump\.fun\n1 wallet · \$10\.00\n\$10\.00\n›\n(\S\n)*GMGN\n1 wallet · \$20\.00\n\$20\.00\n›\n(\S\n)*AgentZero\nIts wallet · \$12\.00/, "the heading, then each site by its name, then AgentZero's row");
  assert.equal((hot.match(/^Social trading$/gm) ?? []).length, 1, "one heading");
  assert.doesNotMatch(hot, /pump\.fun app|GMGN app|^Sites$|^Apps$/m, "a site is named as a site");
  // control: a tap on a site under the heading still opens it to its wallet
  const open = (await homeShown({ tap: [/^Hot/, /GMGN/], answers: { "spending.wallets": [...SITES, gmgn] } })).shown;
  assert.match(open, /Social trading\n[\s\S]*GMGN\n1 wallet · \$20\.00\n\$20\.00\n›\n(\S\n)*SOL wallet\n\$20\.00/);
  // control: AgentZero's wallet alone: no Social trading heading over nothing
  const alone = (await homeShown({ tap: /^Hot/, answers: { "spending.wallets": [az] } })).shown;
  assert.doesNotMatch(alone, /Social trading/);
  assert.match(alone, /AgentZero\nIts wallet · \$12\.00/);
  assert.doesNotMatch((await homeShown()).shown, /Social trading/, "control: the Safe tab has none");
});

test("\"we have no Pay\" (S17): Home's Send opens the one Send sheet over Home, never a Pay app (control: an old openApp(\"pay\", \"send\") lands on Home's Send)", async () => {
  const { asked, opened } = await homeShown({ tap: /^Send$/ });
  assert.deepEqual(asked.map((a) => (a as { kind: string }).kind), ["send"], "the money sheet's Send, in place");
  assert.equal(opened.some((o) => o.startsWith("pay")), false, "never another app");
  assert.deepEqual(foldedInto("pay", "send"), { id: "wallet", tab: "send" });
  const registry = readFileSync(new URL("../apps.ts", import.meta.url), "utf8");
  assert.doesNotMatch(registry, /\["pay",|payApp|"Pay"/, "no Pay app is registered");
  assert.match(registry, /\["trade", lazyApp\("trade", "Trade"/, "control: the registry is what this reads");
  const sheet = readFileSync(new URL("../../../../packages/wallet/src/app/money/SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<MoneySheet title="Send" /);
  assert.doesNotMatch(sheet, /title="Pay"|name="Pay"/, "control: nothing on it says Pay");
  // its Close goes back where the person was: the app that asked hears "back"
  assert.match(sheet, /onClose\(false\);\n    if \(b\) shell\.openApp\(b, "back"\);/);
});

test("the copy review's S14 words: AgentZero's Hot row is \"Its wallet · $12.00\", or \"Its wallet · empty\" at $0, its figure on the right, no count (control: never \"pocket money\")", async () => {
  const az = (cashUsd: string) => ({ ...SITES[0], id: "az", role: "agent", site: "agentzero", label: "AgentZero's pocket", cashUsd });
  const full = (await homeShown({ tap: /^Hot/, answers: { "spending.wallets": [...SITES, az("12.00")] } })).shown;
  assert.match(full, /AgentZero\nIts wallet · \$12\.00\n\$12\.00\n›/);
  assert.doesNotMatch(full, /pocket money|1 wallet · \$12/i, "control: no count, no banned words");
  // the core's own row (agent-row.ts agentRow: role "agent", no site), at $0: still its row, saying empty
  const empty = (await homeShown({ tap: /^Hot/, answers: { "spending.wallets": [...SITES, { id: "agentzero", role: "agent", network: "near", address: "", label: "AgentZero", current: true, inCap: false, keyExported: false, cashUsd: "0.00", coinsUsd: "0.00" }] } })).shown;
  assert.match(empty, /AgentZero\nIts wallet · empty\n\$0\.00\n›/);
});

test("D128: Hidden is no place on Home: no figure, line or row says it; its money counts in the Safe's number", async () => {
  const withHidden = (await homeShown({ hidden: "25" })).shown;
  assert.doesNotMatch(withHidden, /Hidden/);
  assert.match(withHidden, /^Your Safe\n\$5,279\.15$/m, "$5,254.15 + its $25.00");
  assert.match(withHidden, /USD Coin\n1,385\.60 USDC\n\$1,385\.60/, "its USDC with the Safe's");
  assert.match((await homeShown({ hidden: "0" })).shown, /^Your Safe\n\$5,254\.15$/m, "control: an empty pocket adds nothing");
});

test("control: the same mount finds a word that is on Home, so the absences above are real", async () => {
  const { shown } = await homeShown();
  assert.match(shown, /^Swap$/m);
  assert.match(shown, /^Hot$/m);
  assert.match(shown, /^Safe$/m);
});

test("a Trade wallet's row opens its market; a coin bought in it opens its page; its Add opens Move set to it; Show all lists every Safe coin", async () => {
  assert.deepEqual((await homeShown({ tap: [/^Hot/, /SOL wallet 1\.42 SOL/] })).opened, ["trade market:sol"]);
  assert.deepEqual((await homeShown({ tap: [/^Hot/, /NEAR wallet Cash \$40\.00/] })).opened, ["trade market:near"]);
  assert.deepEqual((await homeShown({ tap: [/^Hot/, /BONK .*\$3\.46/] })).opened, ["trade coin:sol:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:BONK"]);
  assert.deepEqual((await homeShown({ tap: /^Hot/, named: /^Add SOL$/ })).asked.map((x) => JSON.stringify(x)), [JSON.stringify({ kind: "move", wallet: "sol" })], "Add SOL opens Move from the Safe, set to the SOL wallet");
  const safe = (await homeShown()).shown;
  assert.doesNotMatch(safe, /keeps these rules|NEAR account/, "HOME-VISUAL §3.5: no rules line (Protection says it)");
  assert.doesNotMatch(safe, /^Buy$/m, "control: no Buy until Trade's native coins are on (NATIVE_COINS)");
  const fifth = safe.includes("Show all") ? (await homeShown({ tap: /^Show all$/ })).shown : safe;
  assert.ok(fifth.split("\n").filter((l) => /^\$[\d,]+\.\d\d$/.test(l)).length > safe.split("\n").filter((l) => /^\$[\d,]+\.\d\d$/.test(l)).length, "Show all: one more coin");
  assert.doesNotMatch(fifth, /Show all/);
});

test("an empty Trade wallet is one quiet row, Empty, with its Add (control: one with money has no Empty)", async () => {
  const empty = { ...SPENDING, reserveUsd: "0.00", networks: [...SPENDING.networks.slice(0, 1), { network: "hood", name: "Robinhood Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0", nativeAmount: "0" }, SPENDING.networks[2]] };
  const hot = (await homeShown({ status: empty, tap: /^Hot/ })).shown;
  assert.match(hot, /ETH \(RH\) wallet\nEmpty\n\$0\.00\n\+\n/);
  assert.match(read("packages/wallet/src/app/screens/Home.tsx"), /className="wl-hw-add" data-testid=\{`add-\$\{c\}`\} aria-label=\{`Add \$\{NATIVE\[c\]\}`\}/, "its Add is named Add ETH (a + disc, no words)");
  assert.doesNotMatch((await homeShown({ tap: /^Hot/ })).shown, /^Empty$/m, "control: wallets with money");
});

test("the day's change shows under the tab's number once every part is read: SOL from $90 this morning to $101.67 now, on Hot (home/shell2)", async () => {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const kept = JSON.stringify({ day, first: { "row:sol": { p: 90, a: 1.42, f: 90 } } });
  const shown = (await homeShown({ store: { "pulse.day": kept }, wait: 100, tap: /^Hot/ })).shown;
  assert.match(shown, /^\$226\.00\n\+\$16\.57 \(\+7\.91%\)\nToday\nAdd\n/m, "one line, one idea: 1.42 SOL × ($144.37 / 1.42 − $90), of Hot's own number");
  assert.doesNotMatch(shown, /SOL is up/, "a second idea isn't on Home's one line");
  assert.doesNotMatch((await homeShown({ store: { "pulse.day": kept, "hide-amounts": "1" }, wait: 100, tap: /^Hot/ })).shown, /^Up$/m, "hidden amounts hide it too");
  assert.doesNotMatch((await homeShown({ wait: 100, tap: /^Hot/ })).shown, /^\+\$/m, "control: the first read of the day has nothing to say");
});

test("the number is the tab's own (look, 5 Nov): the Safe's on Safe, Hot's on Hot, said once; ONE row of four, pre-set to the Safe on its tab", async () => {
  const safe = (await homeShown()).shown;
  assert.equal(safe.match(/^Add$/gm)?.length, 1, "one row of four, said once");
  assert.equal(safe.match(/^Your Safe$/gm)?.length, 1);
  const hot = (await homeShown({ tap: /^Hot/ })).shown;
  assert.equal(hot.match(/^Add$/gm)?.length, 1);
  assert.match((await homeShown({ store: { "hide-amounts": "1" } })).shown, /^Safe\n\u2022+\nHot\n\u2022+$/m, "hidden amounts hide the switch's totals too");
  const src = code(read("packages/wallet/src/app/screens/Home.tsx"));
  assert.match(src, /<Actions a=\{a\} buzz=\{buzz\} \{\.\.\.\(tab === "safe" && !kid \? \{ wallet: "safe" as const, name: "your Safe" \} : \{\}\)\} \/>/, "the one four, pre-set to the Safe on its tab");
  assert.match(src, /\{ word: "Send", icon: <ActSend \/>, on: \(\) => a\.onSend\(wallet\) \}/);
  assert.doesNotMatch(src, /small name=|wl-wtop/, "no wallet's own smaller four");
  assert.doesNotMatch(src, /a\.addressCard\?\.\(/);
});

test("the day's change follows the tab: SOL's move on Hot; none on the Safe's, whose prices didn't move (home/shell2)", async () => {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const kept = JSON.stringify({ day, first: { "row:sol": { p: 90, a: 1.42, f: 90 } } });
  assert.match((await homeShown({ store: { "pulse.day": kept }, wait: 100, tap: /^Hot/ })).shown, /^\+\$16\.57/m);
  assert.doesNotMatch((await homeShown({ store: { "pulse.day": kept }, wait: 100 })).shown, /^\+\$16\.57/m, "control: not the Safe's");
});

test("BNB is a Trade wallet only while it holds money, and has no Add while its network is closed to Move (control: the fixture's empty BNB, no row)", async () => {
  const open = { ...SPENDING, networks: [...SPENDING.networks.slice(0, 2), { network: "bsc", name: "BNB Chain", cashUsd: "5.00", coinsUsd: "0.00", readyUsd: "0", nativeAmount: "0.008" }] };
  const hot = (await homeShown({ status: open, tap: /^Hot/ })).shown;
  assert.match(hot, /BNB wallet\n0\.008 BNB\n\$5\.00/);
  assert.doesNotMatch(hot, /Add BNB/);
  assert.doesNotMatch((await homeShown({ tap: /^Hot/ })).shown, /BNB/, "control: closed and empty, no row");
});

test("the number hides every amount on a tap, and the phone remembers", async () => {
  const sets: [string, unknown][] = [];
  const hidden = (await homeShown({ tap: /^\$5,254\.15$/, sets })).shown;
  assert.deepEqual(sets.filter(([k]) => k === "hide-amounts"), [["hide-amounts", "1"]]);
  assert.doesNotMatch(hidden, /\$\d/, "no dollar figure anywhere");
  assert.doesNotMatch(hidden, /0\.0123 BTC/, "no coin amount either");
  assert.match(hidden, /••••/);
  const hot = (await homeShown({ store: { "hide-amounts": "1" }, tap: /^Hot/ })).shown;
  assert.doesNotMatch(hot, /\$\d|1\.42 SOL|125,050/, "a new open: still hidden, on Hot too");
  assert.match((await homeShown({ store: { "hide-amounts": "" } })).shown, /^\$5,254\.15$/m, "control: not hidden, the number");
});

test("home/add2: SOL or ETH the NEAR wallet holds (an Add's forward that stopped, a refund) is its own line by name, never hidden in Cash; the totals don't change (control: before, it was in Cash)", () => {
  const s = { ...SPENDING, reserveUsd: "37.90", networks: [] } as unknown as SpendingStatus;
  // 0.15 SOL ($22.50) and dust; ETH unpriced; USDC is Cash
  const inNear = home.nearChainCoins([{ tokenId: "nep141:sol.omft.near", amount: "150000000" }, { tokenId: "nep141:hood.omft.near", amount: "1000000000000000" }, { tokenId: "nep141:sol.omft.near", amount: "10" }, { tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "15400000" }], (id) => (id === "nep141:sol.omft.near" ? 150 : null));
  assert.deepEqual(inNear.map((c) => [c.symbol, c.amount, c.usd]), [["SOL", "0.15", "22.50"], ["ETH", "0.001", null]], "SOL and ETH by name, dust and USDC left out");
  const near = home.homeRows(s, [], inNear).find((r) => r.chain === "near")!;
  assert.equal(near.usd, "37.90", "the NEAR wallet's figure is the same");
  assert.deepEqual(near.coins.map((c) => [c.symbol, c.usd]), [["Cash", "15.40"], ["SOL", "22.50"], ["ETH", null]], "Cash is its USDC, then each coin by name");
  // control: with nothing listed, it all reads as one Cash line (the NEAR wallet's own dollars, no sub-row)
  assert.deepEqual(home.homeRows(s, []).find((r) => r.chain === "near")!.coins, []);
});

test("bug hunt, 4 Nov item 1: a coin bought in place is a row of the NEAR wallet with its dollars, added to its figure (not in reserveUsd); no price: its amount, and the row says it left it out", () => {
  const s = { ...SPENDING, reserveUsd: "40.00", networks: [] } as unknown as SpendingStatus;
  const own = [
    { key: "near:nep141:zec.omft.near", tokenId: "nep141:zec.omft.near", address: "zec.omft.near", symbol: "ZEC", amount: "0.01", raw: "1000000", usd: "10.00" },
    { key: "near:nep141:np.near", tokenId: "nep141:np.near", address: "np.near", symbol: "NP", amount: "2.5", raw: "250", usd: null },
  ];
  const near = home.homeRows(s, [{ chain: "near", address: "zec.omft.near", symbol: "ZEC", amount: "0.01", usd: "10.00" }], [], own).find((r) => r.chain === "near")!;
  assert.equal(near.usd, "50.00", "$40.00 cash + $10.00 of ZEC: the swap's dollars stay in the total");
  assert.deepEqual(near.coins.map((c) => [c.symbol, c.amount, c.usd]), [["Cash", "", "40.00"], ["ZEC", "0.01", "10.00"], ["NP", "2.5", null]], "Trade's ZEC position is the same coin: listed once");
  assert.equal(near.uncounted, true);
  // control: the balance unread, Trade's positions as before (the bug: a coin bought in place was in neither)
  const before = home.homeRows(s, [], []).find((r) => r.chain === "near")!;
  assert.deepEqual([before.usd, before.coins, before.uncounted], ["40.00", [], undefined]);
});

test("the rows: SOL, ETH (RH) and NEAR always ($0.00 too); BNB only open and funded; a row is its native coin, a held coin its own sub-row (never counted twice); NEAR in dollars with what it holds under it, never a NEAR amount made from USDC", () => {
  const s = { ...SPENDING, reserveUsd: "37.90", networks: [
    { network: "sol", name: "Solana", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0", nativeAmount: "0" },
    { network: "hood", name: "Robinhood Chain", cashUsd: "2.10", coinsUsd: "0.00", readyUsd: "1.80", nativeAmount: "0.0007" },
    { network: "bsc", name: "BNB Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0", closed: true },
  ] } as unknown as SpendingStatus;
  const held = [{ chain: "near", address: "token.v2.ref-finance.near", symbol: "REF", amount: "10", usd: "2.10" }, { chain: "near", address: "noprice.near", symbol: "NOPE", amount: "5" }];
  const rows = home.homeRows(s, held);
  assert.deepEqual(rows.map((r) => [r.name, r.amount, r.usd]), [["SOL", "0 SOL", "0.00"], ["ETH (RH)", "0.0007 ETH", "2.10"], ["NEAR", null, "40.00"]]);
  assert.deepEqual(rows[2]!.coins.map((c) => [c.symbol, c.usd]), [["Cash", "37.90"], ["REF", "2.10"], ["NOPE", null]], "its cash (review L7: not \"USDC\"), then the NEAR coins; an unpriced coin has no dollars, never $0");
  // e2e walk 3 Nov ("Cash $0.11" under NEAR $0.11 during a move): with no NEAR coin, the row's own dollars are the cash
  // and no sub-row says them twice (control above: with coins, Cash is the first sub-row)
  const cashOnly = home.homeRows({ ...s, reserveUsd: "0.11" } as SpendingStatus, []);
  assert.deepEqual([cashOnly[2]!.usd, cashOnly[2]!.coins], ["0.11", []]);
  // SOL holding $119.37 of SOL and $24.92 of BIRB: the row is the SOL, BIRB its own sub-row (the walk's 3 Nov shot had $144.29 on SOL)
  const bought = { ...s, networks: [{ network: "sol", name: "Solana", cashUsd: "119.37", coinsUsd: "24.92", readyUsd: "118.37", nativeAmount: "1.174" }, ...s.networks.slice(1)] } as unknown as SpendingStatus;
  const sol = home.homeRows(bought, [{ chain: "sol", address: "BirbMint1111111111111111111111111111111111", symbol: "BIRB", amount: "313.35", usd: "24.92" }])[0]!;
  assert.deepEqual([sol.amount, sol.usd, sol.coins.map((c) => [c.symbol, c.usd])], ["1.174 SOL", "119.37", [["BIRB", "24.92"]]]);
  assert.equal(home.walletUsd(sol), "144.29", "the wallet's figure: its own coin and the coin in it");
  const open = { ...s, networks: [...s.networks.slice(0, 2), { network: "bsc", name: "BNB Chain", cashUsd: "3.00", coinsUsd: "0.00", readyUsd: "2.7", nativeAmount: "0.005" }] } as unknown as SpendingStatus;
  assert.deepEqual(home.homeRows(open).map((r) => r.name), ["SOL", "ETH (RH)", "NEAR", "BNB"], "BNB open and funded: a row");
  const empty = { ...open, networks: [...s.networks.slice(0, 2), { network: "bsc", name: "BNB Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0" }] } as unknown as SpendingStatus;
  assert.ok(!home.homeRows(empty).some((r) => r.name === "BNB"), "BNB open but empty: no row");
  const closedFunded = { ...open, networks: [...s.networks.slice(0, 2), { network: "bsc", name: "BNB Chain", cashUsd: "3.00", coinsUsd: "0.00", readyUsd: "0", closed: true }] } as unknown as SpendingStatus;
  assert.ok(home.homeRows(closedFunded).some((r) => r.name === "BNB" && r.usd === "3.00"), "BNB closed but holding money: a row, never money off Home (review L6)");
});


test("Trading is everything outside the Safe and Hidden: Spending, a closed chain's money, the NEAR coins held in it and every site wallet (the gap where a pump.fun wallet was in no total)", () => {
  const s = SPENDING as unknown as SpendingStatus;
  assert.deepEqual(trading.tradingUsd(s, HELD, SITES), { usd: "226.00", partial: false }, "$212.54 + BONK's $3.46 on SOL (trade.positions, shown in the SOL wallet's row; the engine counts no coins) + the pump.fun wallet's $10.00");
  assert.equal(trading.tradingUsd(s, [{ chain: "near", address: "r", symbol: "REF", amount: "1", usd: "2.10" }], []).usd, "214.64", "a NEAR coin held in Trading (D96) counts");
  const closed = { ...SPENDING, networks: [...SPENDING.networks.slice(0, 2), { network: "bsc", name: "BNB Chain", cashUsd: "3.00", coinsUsd: "1.00", readyUsd: "0", closed: true }] } as unknown as SpendingStatus;
  assert.equal(trading.tradingUsd(closed, [], []).usd, "216.54", "BNB closed still counts its $4.00 (review L6)");
  assert.deepEqual(trading.tradingUsd(s, [], []), { usd: "212.54", partial: false }, "control: nothing outside Trading, Trading alone");
  // unread is never $0 (review M2): a part not read, or a site wallet unread, makes it partial
  assert.equal(trading.tradingUsd(s, null, SITES).partial, true);
  assert.equal(trading.tradingUsd(s, HELD, null).partial, true);
  assert.equal(trading.tradingUsd(s, HELD, [{ ...SITES[0], cashUsd: undefined, unread: true }]).partial, true);
  // re-review High: a coin or a site wallet with no price is known, left out as the Safe leaves out unpriced coins,
  // never "updating…" for good (the demo's GMGN wallets on other chains hold "0 ETH" with no dollars)
  assert.equal(trading.tradingUsd(s, [{ chain: "near", address: "x", symbol: "NOPE", amount: "5" }], [{ ...SITES[0], cashUsd: undefined, holds: "0 ETH" }]).partial, false);
});

test("QA (4 Nov): a SOL wallet whose read failed is updating…, never $0.00, through the engine, Spending and Home; another chain's failure leaves SOL read (control: an answered read is its figure)", async () => {
  const { createCoreFloat, bridgeWallets } = await server.ssrLoadModule("@zerofee/trade/float-core.ts");
  const { createSpendingService } = await server.ssrLoadModule("@zerofee/core/spending");
  const list = [{ id: "trade-sol", kind: "trade", chain: "sol", current: true, address: "4evu965G3hf2AxLWjBUh2SZ415VapgP8DnDiNUR1biVs" }, { id: "trade-hood", kind: "trade", chain: "hood", current: true, address: "0x01" }];
  const rowsWhen = async (fail: { sol?: boolean; hood?: boolean }) => {
    const call = async (m: string, p: { id?: string }) => {
      if (m === "subwallet.list") return list;
      if (m === "subwallet.balances") { if (p.id === "trade-sol" ? fail.sol : fail.hood) throw new Error("node busy"); return p.id === "trade-sol" ? [{ token: "native", decimals: 9, amount: "50000000" }] : [{ token: "native", decimals: 18, amount: "0" }]; }
      if (m === "subwallet.float.balance") return { usd: 0.11 };
      return m === "subwallet.float.limits" ? { movesLeftToday: 20 } : [];
    };
    const px = async (c: string) => (c === "sol" ? 97 : 3000);
    const f = createCoreFloat({ offered: () => true, call, nativeUsd: px, wallets: () => bridgeWallets(call, px), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
    await f.refresh();
    const r = await createSpendingService({ engine: () => f, call: async () => ({ value: null }) }).call("spending.status", {});
    return home.homeRows((r as { ok: SpendingStatus }).ok).map((x) => [x.chain, home.walletUsd(x)]);
  };
  assert.deepEqual(await rowsWhen({ sol: true }), [["sol", null], ["hood", "0.00"], ["near", "0.11"]], "SOL's read failed: updating…, never $0.00");
  assert.deepEqual(await rowsWhen({ hood: true }), [["sol", "4.85"], ["hood", null], ["near", "0.11"]], "Robinhood's read failed: SOL still read");
  assert.deepEqual(await rowsWhen({}), [["sol", "4.85"], ["hood", "0.00"], ["near", "0.11"]], "control: every read answered");
});

test("QA (4 Nov): 0.04 SOL read while the price read 429s is \"0.04 SOL\" through the engine, Spending and Home, never Empty or $0.00 (control: priced, it is dollars)", async () => {
  const { createCoreFloat, bridgeWallets } = await server.ssrLoadModule("@zerofee/trade/float-core.ts");
  const { createSpendingService } = await server.ssrLoadModule("@zerofee/core/spending");
  const list = [{ id: "trade-sol", kind: "trade", chain: "sol", current: true, address: "4evu965G3hf2AxLWjBUh2SZ415VapgP8DnDiNUR1biVs" }, { id: "trade-hood", kind: "trade", chain: "hood", current: true, address: "0x01" }];
  const statusWhen = async (priced: boolean) => {
    const call = async (m: string, p: { id?: string }) => {
      if (m === "subwallet.list") return list;
      if (m === "subwallet.balances") return p.id === "trade-sol" ? [{ token: "native", decimals: 9, amount: "40000000" }] : [{ token: "native", decimals: 18, amount: "0" }];
      if (m === "subwallet.float.balance") return { usd: 0 };
      return m === "subwallet.float.limits" ? { movesLeftToday: 20 } : [];
    };
    const px = async (c: string) => { if (c === "sol" && !priced) throw new Error("429"); return c === "sol" ? 150 : 3000; };
    const f = createCoreFloat({ offered: () => true, call, nativeUsd: px, wallets: () => bridgeWallets(call, px), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
    await f.refresh();
    return ((await createSpendingService({ engine: () => f, call: async () => ({ value: null }) }).call("spending.status", {})) as { ok: SpendingStatus }).ok;
  };
  const bare = await statusWhen(false);
  assert.deepEqual(bare.unpriced, [{ network: "sol", nativeAmount: "0.04" }]);
  assert.ok(!bare.networks.some((n) => n.network === "sol"), "no $ figure for SOL: never \"$0.00\" to any other screen");
  const row = home.homeRows(bare).find((r) => r.chain === "sol")!;
  assert.deepEqual([row.amount, home.walletUsd(row), (row as { unpriced?: true }).unpriced], ["0.04 SOL", null, true]);
  const shown = (await homeShown({ status: bare, tap: /^Hot/ })).shown;
  const sol = shown.slice(shown.indexOf("Trade wallets"), shown.indexOf("ETH (RH) wallet"));
  assert.match(sol, /SOL wallet\n0\.04 SOL\n0\.04 SOL\n/, "its row says the amount where the dollars go");
  assert.doesNotMatch(sol, /Empty|\$0\.00|is empty/, "never Empty, never $0.00");
  const priced = await statusWhen(true);
  assert.equal(priced.unpriced, undefined, "control: priced, nothing unpriced");
  const p = home.homeRows(priced).find((r) => r.chain === "sol")!;
  assert.deepEqual([p.amount, home.walletUsd(p)], ["0.04 SOL", "6.00"], "control: its dollars");
});

test("§0 proof row (D111): each row reads its own chain; an answer with NEAR alone is never a whole Home: SOL and ETH (RH) say updating…, and the line names Solana and Robinhood Chain, never NEAR", async () => {
  const s = { ...SPENDING, reserveUsd: "7.00", networks: [
    { network: "sol", name: "Solana", cashUsd: "1.00", coinsUsd: "0.00", readyUsd: "0", nativeAmount: "0.0067" },
    { network: "hood", name: "Robinhood Chain", cashUsd: "2.00", coinsUsd: "0.00", readyUsd: "0", nativeAmount: "0.0008" },
    { network: "bsc", name: "BNB Chain", cashUsd: "3.00", coinsUsd: "0.00", readyUsd: "0", nativeAmount: "0.005" },
  ] } as unknown as SpendingStatus;
  assert.deepEqual(home.homeRows(s).map((r) => [r.chain, r.usd, r.amount]), [["sol", "1.00", "0.0067 SOL"], ["hood", "2.00", "0.0008 ETH"], ["near", "7.00", null], ["bsc", "3.00", "0.005 BNB"]], "SOL from Solana's wallet, ETH from Robinhood's, NEAR from Trading on NEAR, BNB from BNB Chain's");
  const nearOnly = { ...s, networks: [] } as unknown as SpendingStatus;
  assert.deepEqual(home.homeRows(nearOnly).map((r) => [r.chain, r.usd]), [["sol", null], ["hood", null], ["near", "7.00"]], "SOL and ETH say updating, never vanish");
  assert.equal(trading.tradingUsd(nearOnly, [], []).partial, true, "a NEAR-only answer is never a final figure");
  assert.equal(trading.tradingUsd(s, [], []).partial, false, "control: every chain answered");
  const shown = (await homeShown({ nearOnly: true, tap: /^Hot/ })).shown;
  assert.match(shown, /SOL wallet\n\n?updating…[\s\S]*ETH \(RH\) wallet\n\n?updating…/);
  assert.match(shown, /Solana and Robinhood Chain didn't answer\. SOL and ETH \(RH\) show when they do\./);
  assert.doesNotMatch(shown, /Solana and NEAR/, "never the old line, whatever failed");
});

test("a failed Safe read keeps its last figure \"as of 10:52\" and names NEAR, with Retry; never $0", async () => {
  const shown = (await homeShown({ safeDown: true })).shown;
  const at = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(KEPT_AT);
  assert.ok(shown.includes(`NEAR didn't answer. Your Safe is as of ${at}. Your money is still in it.\nRetry`), shown);
  assert.match(shown, /\nSafe\n\$5,254\.15\n/, "the Safe's figure as last read");
  assert.doesNotMatch(shown, /\$0\.00/);
  assert.doesNotMatch((await homeShown()).shown, /didn't answer/, "control: every read answered, no line");
});

test("unread is \"updating…\", never $0: Trade's positions not answering says Trade didn't, and the number waits", async () => {
  const shown = (await homeShown({ positionsFail: true })).shown;
  assert.match(shown, /Trade didn't answer\. Coins you bought show when it does\./);
  assert.doesNotMatch(shown, /^\$5,4\d\d\.\d\d$/m, "the number waits for Trade's coins (never a figure short by them)");
  assert.doesNotMatch(shown, /BONK/);
});

test("1Click not answering (Trading's balance unread) names 1Click, never NEAR, and shows no $0 wallet", async () => {
  const shown = (await homeShown({ status: { ...SPENDING, loaded: false, unread: true, networks: [] } })).shown;
  assert.match(shown, /NEAR Intents didn't answer, so your wallets show when it does\./);
  assert.doesNotMatch(shown, /NEAR didn't answer|\$0\.00/);
});

test("H6: the read-failed line sits under the rows with Retry at its end, never beside the number", () => {
  const src = code(read("packages/wallet/src/app/screens/Home.tsx"));
  const hero = src.slice(src.indexOf('className="wl-hero"'), src.indexOf("</div>", src.indexOf('className="wl-hero"')));
  assert.doesNotMatch(hero, /readFailed|reads/, "nothing about a failed read beside the number");
  assert.ok(src.indexOf("{!web && readLine}") > src.indexOf('className="wl-rows wl-list"'), "the line comes after the rows (the phone; the web's is over them, home-web.test.ts)");
  assert.match(src, /const readLine = reads\.length > 0 && \(!web \|\| webPart\) && <ReadLine text=\{reads\.join/);
});

test("motion is CSS (transform and opacity) and Reduce Motion snaps it; a tab and a button are a light tap on the phone", () => {
  const css = read("packages/wallet/src/app/wallet.css");
  const src = code(read("packages/wallet/src/app/screens/Home.tsx"));
  for (const k of ["wl-rise", "wl-shimmer", "wl-breathe", "wl-roll__d::before", "wl-bar__line"]) assert.ok(css.includes(k), k);
  assert.match(css, /\.wl-rise \{[^}]*animation-delay: calc\(var\(--i, 0\) \* 30ms\)/, "rows rise 30 ms apart");
  assert.match(css, /\.wl-bar__line \{[^}]*transform: translateX\(calc\(var\(--at\) \* 100%\)\); transition: transform/, "the underline slides");
  const reduce = css.split("@media (prefers-reduced-motion: reduce)").slice(1).join("");
  for (const k of [".wl-roll__d::before", ".wl-bar__line", ".wl-act__dot::after", ".wl-rise", ".wl-safe::before", ".wl-shimmer::after"]) assert.ok(reduce.includes(k), `Reduce Motion snaps ${k}`);
  // every keyframe moves only transform and opacity
  for (const m of css.matchAll(/@keyframes wl-(rise|breathe|shimmer) \{([^}]*\})/g)) assert.doesNotMatch(m[2]!, /(width|height|top|left|margin|box-shadow)\s*:/, m[1]!);
  assert.match(src, /bridge\.call\("device\.haptic", \{ kind: "tap" \}\)/);
  assert.match(src, /const pick = \(t: HomeTab\) => \{ if \(t !== tab\) \{ buzz\(\); setTab\(t\); \} \};/);
});


test("no cards with buttons inside: Home's code has no pot cards, no pill buttons, no account part, no Safe | Spending toggle", () => {
  const src = code(read("packages/wallet/src/app/screens/Home.tsx"));
  for (const gone of ["wl-pot-btn", "wl-pots", "AccountPart", "NavRow title=", "Under your account", "Segmented"]) assert.ok(!src.includes(gone), gone);
  // the menu glyph opens the account's rows, said "Your account"
  assert.match(code(read("packages/wallet/src/app/WalletApp.tsx")), /menu=\{\{ label: "Your account"/);
});

test("Swap: the sheet's words, its line with the swap service's own time, and only the coin named pays", () => {
  assert.equal(swap.swapWords("8.22", "NEAR"), "Swap $8.22 of NEAR for USDC");
  assert.equal(swap.swapWords("25", "NEAR"), "Swap $25.00 of NEAR for USDC", "two decimals always (copy review, 6 Nov)");
  assert.equal(swap.swapWords("5", "USDC", "BTC"), "Swap $5.00 of USDC for BTC", "any coin to any coin (D111)");
  // review M3: a refusal while pricing is the sheet's own words, never the core's "Spending"/"Private" or a raw tail
  assert.equal(swap.plainLine({ code: "security.subwallet.refused", whatHappened: "Trading doesn't have that much cash." }), "The swap service can't price this swap right now. Nothing moved.");
  assert.equal(swap.plainLine({ code: "security.partner.unreachable", whatHappened: "x" }), "NEAR Intents didn't answer. Nothing moved. Try again.");
  assert.equal(swap.plainLine({ code: "wallet.amount", whatHappened: "Choose less." }), "Choose less.");
  assert.equal(swap.workingLine(20), "The swap service is working on it · about 20 s");
  assert.equal(swap.workingLine(), "The swap service is working on it", "no estimate given: no time made up");
  const safe = [
    { tokenId: "near", held: "account", usd: "40" }, { tokenId: "nep141:wrap.near", held: "ledger", usd: "900" },
    { tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", held: "ledger", usd: "1000" },
    { tokenId: "nep141:usdt.tether-token.near", held: "ledger", usd: "30" }, { tokenId: "nep141:wrap.near", held: "private", usd: "5" },
  ];
  assert.deepEqual(swap.swapRows(safe, "NEAR").map((b) => b.tokenId), ["near", "nep141:wrap.near"], "NEAR on the account and in the Safe, never Private's");
  assert.deepEqual(swap.swapRows(safe, "USDT").map((b) => b.tokenId), ["nep141:usdt.tether-token.near"]);
});

test("Swap never falls back to a public swap: every corridor is NEAR Intents' confidential path (V4 step 5, D111)", () => {
  const src = code(read("packages/wallet/src/app/money/SwapSheet.tsx"));
  // the Home plan §1.4: every pair is the one private engine: wallet ↔ wallet (spending.move, E5), the Safe's coin named on
  // its Approve (spending.topUp), a wallet home (spending.putAway), the Safe's NEAR → its USDC (E7, home: true)
  assert.match(src, /method: "spending\.move", params: \{ from: r\.from, to: r\.to, usd: all && r\.from !== "near" \? "all" : usd, key \}/);
  assert.match(src, /method: "spending\.topUp", params: \{ usd, swap: r\.coin, legs: \[\{ network: r\.to, usd \}\], key \}/);
  assert.match(src, /method: "spending\.putAway", params: \{ legs: \[\{ network: r\.from, usd: all \? "all" : usd \}\] \}/);
  assert.match(src, /method: "spending\.topUp", params: \{ usd, swap: "NEAR", home: true, key \}/);
  // review M2: one key per swap as asked, reused on a retry (control: a fresh key on every call is gone)
  assert.match(src, /askOf\(route, amount, keyFor\(`\$\{pay\.place\} \$\{get\} \$\{amount\}`\), amount >= most - 0\.004 && !pay\.place\.startsWith\("safe"\)\)/);
  assert.doesNotMatch(src, /askOf\(route, amount, swapKey\(\)\)/);
  // control: Hidden's public-address paths and pick-then-refuse are gone
  for (const gone of ["ledger.pay", "ledger.quotePay", "subwallet.float.swap\"", "corridor("]) assert.ok(!src.includes(gone), gone);
  for (const publicRoute of ["ledger.convert", "ledger.quoteConvert", "ledger.transfer", "ledger.withdraw", "CONVERT_ROUTES"]) assert.ok(!src.includes(publicRoute), publicRoute);
  // and no spinner: the waiting is a line
  assert.ok(!src.includes("<Waiting"), "no spinner in the Swap sheet");
});

/** Flesch-Kincaid grade, the audit's D7 measure (as nothing-blocks.test.ts). */
function fkGrade(text: string): number {
  const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length === 0) return 0;
  const syll = (w: string) => {
    const s = w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "");
    return Math.max(1, (s.match(/[aeiouy]+/g) ?? []).length);
  };
  return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
}

test("every word Home and Swap put on screen reads at grade 5 or under and grades A or B on the voice guard", () => {
  const words = [
    ...Object.values(home.HOME_WORDS), ...Object.values(home.ROW_NAME), home.walletCount(1), home.walletCount(2), "Safe", "All", "Add", "Send", "Swap", "Move", "Your account",
    // Home's wallet bar, its empty wallet and its honest reads (home-view.ts)
    home.emptyLine("ETH (RH)"), "Add SOL", ...view.readLines({ offline: false, safe: { by: "NEAR Intents' bridge", at: 1 }, oneClick: { at: 1 }, chains: { ids: ["sol", "hood"], at: 1 }, trade: true }),
    ...view.readLines({ offline: false, oneClick: { at: null }, chains: { ids: ["hood"], at: null } }), ...view.readLines({ offline: true, safe: { by: "NEAR", at: 1 } }),
    "What you did", "Your address on each network", "Colors, passwords, Face ID, lock", "Colors, backup words, lock", "Colors, start over", "Colors, lock", "Move to Spending", "Move to your Safe", "Move it all", "Move some",
    "Swap NEAR for USDC", "From your Safe. The USDC lands in Spending.", "About 73.92 NEAR", "Swap $8.22 of NEAR for USDC", "Swapped $8.22 of NEAR for USDC",
    "The swap service is working on it · about 20 s", "Your Safe has no NEAR or USDT to swap yet. A swap needs $2.06 or more.", "Spending has room for $2.64 more.", "Still on its way. Activity shows where it is.",
    "The swap didn't happen. Activity shows where the money is.", "Add a second device",
    "Your rules on NEAR are an older kind, so this would wait. Save them once and it goes with Face ID.",
    "Your new rules are saved on NEAR. Finish them, then this moves with Face ID.", "Your new rules on NEAR start in a moment. Then this moves with Face ID.",
    "Your rules make this wait, and the swap service's price lasts only minutes. We stopped.", "Save my rules",
  ];
  const EXCEPT = new Set<string>();
  const hard = words.filter((s) => s.split(/\s+/).length > 3 && !EXCEPT.has(s)).map((s) => ({ s, fk: fkGrade(s) })).filter((x) => x.fk > 5);
  assert.deepEqual(hard.map((x) => `${x.s} (grade ${x.fk.toFixed(1)})`), []);
  const graded = words.map((s) => ({ s, g: grade("spine", s) })).filter((x) => x.g.grade !== "A" && x.g.grade !== "B");
  assert.deepEqual(graded.map((x) => `${x.s}: ${x.g.grade} ${x.g.problems.join("; ")}`), []);
  // Home's own words never say Spending or Private (QA 3 Nov; D108: Hidden), and name the pot once (voice.ts onePot)
  assert.deepEqual([...Object.values(home.HOME_WORDS), ...Object.values(home.ROW_NAME)].filter((w) => /Trading|Private/.test(w)), []);
  assert.deepEqual(onePot([...Object.values(home.HOME_WORDS), ...Object.values(home.ROW_NAME)]), []);
});

test("control: the measure fails the old line the review removed", () => {
  assert.ok(fkGrade("Starting it cancels every payment or change still waiting, unless a second device old enough to count said yes to it.") > 5);
});

test("D137 live steps, HOME-VISUAL §3.7: a Move from the Safe to the SOL wallet is ONE row under Now, titled as asked, at the top of the wallets it touches; a tap opens the whole-screen tracker", async () => {
  const at = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const move = { id: "mv1", kind: "top-up", usd: "20.00", status: "done", shown: true, atIso: at(0), words: "Moving $20.00 to your SOL wallet", goesTo: ["sol"] };
  const leg = { id: "mv2", of: "mv1", kind: "ready", usd: "19.70", status: "on-its-way", shown: true, atIso: at(41), words: "Moving $19.70 to Solana", network: "sol" };
  const answers = { "spending.activity": [move, leg], "spending.status": { ...SPENDING, onItsWay: [{ ...leg, id: "mv2" }] } };
  // Home's "Jobs" (product decision, 5 Nov); the step names who does the work; the time LEFT (the HARD RULE, Jobs hunt B3)
  const row = /^Jobs\nMove \$20\.00 to your SOL wallet\nNEAR Intents is moving it to Solana\n\d+ (s|min) left$/m; // a16: the time left is the row's own right column (as the Hot row); the label keeps the one sentence
  const until = /NEAR\n \nIntents\n \nis\n \nmoving\n \nit\n \nto Solana\n\d+ (s|min) left/;
  // the step line is drawn piece by piece (job-face linePhrases, 7 Nov): its pieces joined again read the one sentence
  const all = (await homeShown({ answers, wait: 50, until })).shown.replace(/\n \n/g, " "); // the Safe, where it left from
  assert.match(all, row, "the row: what the person asked, the step now and how long, in words (never a clock)");
  assert.ok(all.indexOf("\nJobs\n") < all.lastIndexOf("\nSafe\n"), "at the top of the list");
  assert.doesNotMatch(all, /^On its way\nMoving \$19\.70 to Solana$/m, "the leg the row stands for isn't drawn twice");
  assert.doesNotMatch(all, /Top(ped)? up|✓ 0:00/, "no Top up, no ticked-steps line on Home (the tracker has the steps)");
  assert.match((await homeShown({ answers, wait: 50, until, tap: /^Hot/ })).shown.replace(/\n \n/g, " "), row, "on Hot too, where it goes");
  const open = (await homeShown({ answers, wait: 50, until, tap: /^Move \$20\.00 to your SOL wallet / })).shown.replace(/\n \n/g, " ");
  // the job page (the copy review's spec Part 2 and rulings, 6 Nov; fix/move-job): the title once, the figure and what it is, the four
  // checkpoints, where the money is by Home's names, the time left, From and To, then each step on its line with its one word
  assert.match(open, /^Move\n\$20\.00\nMove \$20\.00 to your SOL wallet\nSigned\nMoving\nLanding\nDone\nYour money is on its way to \nyour SOL wallet\n\d+ (s|min) left\nFrom\nSafe\nTo\nSOL wallet\nApproved\nDone\nIn your NEAR wallet\nDone\nNEAR Intents is moving it to Solana…\n\nThen Solana lands it in your SOL wallet\.\nNot yet\nEach step shows the moment it's done\./m, "the job page: the title once, checkpoints, the money line, each step on its line with its one word");
  assert.doesNotMatch(open, /^Stopped$|keeps checking/m, "a going job: no stop words");
  const none = (await homeShown({ wait: 50, until })).shown;
  assert.doesNotMatch(none, /^Jobs$/m, "control: nothing in flight, no Jobs");
  const failed = { "spending.activity": [{ ...move, status: "failed", note: "1Click sent it back. It's in your Safe." }] };
  // this phone saw it going (its own record), then it failed
  const seen = { "live-seen": JSON.stringify({ "move:mv1": { start: Date.now() - 60_000, done: {} } }) };
  assert.doesNotMatch((await homeShown({ answers: failed, wait: 50, until: /didn't finish/ })).shown, /didn't finish/, "control: a failure this phone never saw going is Activity's row, not a live row");
  assert.match((await homeShown({ answers: failed, store: seen, wait: 50, until: /didn.t\n \nfinish/ })).shown.replace(/\n \n/g, " "), /^Move stopped\nNEAR Intents didn't finish moving it to your NEAR wallet\. 1Click sent it back\. It's in your Safe\.$/m, "a failure names the step and where the money is");
});

const NEAR_DEAD = { problem: { code: "ledger.nodes.unreachable", service: "near", whatHappened: "NEAR didn't answer.", money: { state: "safe" }, next: { kind: "retry", label: "Try again" } } };

test("Private's door is instant (rule 2): set up behind when Home opens, the tap shows Private's screen in under 100 ms; control: before the set-up behind is read, the door offers it", async () => {
  const tapMs: number[] = [];
  const r = await homeShown({ tap: /^Private/, tapMs });
  assert.equal(r.shown, "Private", "Private's screen (copy review, 7 Nov: \"Private\", never \"private balance\")");
  assert.doesNotMatch(r.shown, /Not set up yet/, "set up behind before the tap: ready on arrival");
  assert.ok(tapMs[0]! < 100, `tap → Private's screen ${tapMs[0]!.toFixed(1)} ms`);
  console.log(`tap → Private's screen: ${tapMs[0]!.toFixed(1)} ms`);
  assert.match((await homeShown({ fail: { "ledger.privateSetup": NEAR_DEAD } })).shown, /Private\nOne tap\. Nothing leaves your Safe\./, "control: not set up, the door offers it");
  const home = await homeShown({ wait: 20, until: /what's in it/ });
  assert.match(home.shown, /Private\nThe public can't see what's in it\./, "the door says what it is, once set up");
});


test("Private's set-up on a dead node (rule 8): behind, it stays quiet; the tap opens Private and says what failed, where the money is and the next tap; control: a live node, no problem", async () => {
  const problems: unknown[] = [];
  const r = await homeShown({ fail: { "ledger.privateSetup": NEAR_DEAD }, tap: /^Private/, problems });
  assert.equal(problems.length, 1, "one problem, from the tap's own try");
  const p = problems[0] as { whatHappened: string; money: unknown; next: { label: string } };
  assert.deepEqual([p.whatHappened, p.money, p.next.label], ["NEAR didn't answer.", { state: "safe" }, "Try again"]);
  const quiet: unknown[] = [];
  await homeShown({ fail: { "ledger.privateSetup": NEAR_DEAD }, problems: quiet });
  assert.equal(quiet.length, 0, "before any tap, a failed set-up behind says nothing");
  const ok: unknown[] = [];
  await homeShown({ tap: /^Private/, problems: ok });
  assert.equal(ok.length, 0, "control: a live node");
});

test("Private's read on a dead node: no door (nothing to open truly), Home still shows the Safe; control: read, the door", async () => {
  const r = await homeShown({ fail: { "ledger.private": NEAR_DEAD } });
  assert.doesNotMatch(r.shown, /^Private$/m);
  assert.match(r.shown, /Your Safe/);
  assert.match((await homeShown({})).shown, /^Private$/m, "control");
});
