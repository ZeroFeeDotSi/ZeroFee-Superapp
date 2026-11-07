// QA's crawl (4 Nov): a tap on an Add row copied the address, but "Copied" never showed. A page whose
// clipboard answers oddly (a hooked writeText, a web view's that returns nothing or throws at once) made the row's tap
// throw before it could say so. Now the row says "Copied" whatever the clipboard does.
// the audit's MUST + the copy review (6 Nov): the row carries the rule (coin, chain, least) and its end; Copy's flash repeats the rule.
// Owner's Bugs: (6 Nov): a kept key the core calls used (ADD_USED) is renewed at once, never "used up" on the row.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; pressNamed: (l: RegExp) => void; hasClass: (c: string) => boolean };
let AddressRow: FunctionComponent<Record<string, unknown>>;
let ADD_ROWS: { chain: string }[];

const ADDR = "3R36RM6qh7wRaUkFb59DGFDmw8DfcwnEqpNAUQtAcpE4";  // generated sample
const bridge: Bridge = {
  call: (async (method: string, p?: Record<string, unknown>) => method === "subwallet.add.quote"
    ? { ok: { key: String(p?.key), chain: "sol", to: "wallet", depositAddress: ADDR, tokenId: "nep141:sol.omft.near", symbol: "SOL", decimals: 9, minAmountIn: "1000000", amountIn: "100000000", untilIso: new Date(Date.now() + 86_400_000).toISOString() } }
    : { ok: {} }) as Bridge["call"],
  on: () => () => {},
};

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
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
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ AddressRow } = await server.ssrLoadModule("@zerofee/wallet/app/money/AddSheet.tsx"));
  ({ ADD_ROWS } = await server.ssrLoadModule("@zerofee/wallet/app/money/add-coins.ts"));
}, { timeout: 60_000 });
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 3_000).unref();
});

/** The row's lines as read (the copy review's grid draws each line phrase by phrase, a plain space between: the pieces joined back). */
const read = (s: string) => s.replace(/\n \n/g, " ");
async function rowAfterTap(writeText: (t: string) => unknown): Promise<{ before: string; text: string; copiedText: string[]; keptBefore: boolean }> {
  const copiedText: string[] = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: (t: string) => (copiedText.push(t), writeText(t)) } }, configurable: true });
  const row = ADD_ROWS.find((r) => r.chain === "sol");
  await runtime.mount(createElement(AddressRow, { bridge, row, to: "wallet", onQr() {} }));
  for (let i = 0; i < 100 && !/Only SOL/.test(runtime.text()); i++) { await new Promise((r) => setTimeout(r, 20)); await runtime.settle(); }
  const before = runtime.text();
  const keptBefore = runtime.hasClass("wl-keep");
  runtime.pressNamed(/^Copy address: your SOL wallet$/);
  await runtime.settle();
  const text = runtime.text();
  runtime.unmount();
  return { before, text, copiedText, keptBefore };
}

test("a tap shows Copied when the clipboard answers normally", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => Promise.resolve());
  assert.deepEqual(r.copiedText, [ADDR]);
  assert.match(r.text, /Copied/);
});

test("a tap shows Copied when the clipboard returns nothing (a hooked or web view's writeText)", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => undefined);
  assert.deepEqual(r.copiedText, [ADDR]);
  assert.match(r.text, /Copied/);
});

test("a tap shows Copied when the clipboard throws at once", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => { throw new Error("NotAllowedError"); });
  assert.match(r.text, /Copied/);
});


test("the audit's MUST + the copy review (6 Nov): the row carries the rule and its end; Copy's flash keeps the rule's words and puts Copied. where the end was (control: before the tap, no Copied)", { timeout: 30_000 }, async () => {
  const r0 = await rowAfterTap(() => Promise.resolve());
  const r = { before: read(r0.before), text: read(r0.text) };
  assert.match(r.before, /Only SOL on Solana, at least 0\.001 SOL\./);
  assert.match(r.before, /Until \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} [ap]m\./);
  assert.doesNotMatch(r.before, /Copied|tap to copy|used up|·/i, "control: before the tap");
  assert.match(r.text, /Only SOL on Solana, at least 0\.001 SOL\.\nCopied\./, "the rule's own words, then Copied. on the end's line");
  assert.doesNotMatch(r.text, /Copied\. Only|Until /, "no word added to the rule; the end steps aside for the flash");
});

/** A core whose `refused` keys answer ADD_USED (money reached them, or their shown day ran out); every other key its address. */
const usedCore = (refused: (key: string, n: number) => boolean) => {
  const asked: string[] = [];
  const b: Bridge = {
    call: (async (method: string, p?: Record<string, unknown>) => {
      if (method !== "subwallet.add.quote") return { ok: {} };
      const key = String(p?.key);
      asked.push(key);
      if (refused(key, asked.length)) return { problem: { code: "security.add.used", whatHappened: "That address was used or ran out. Here's a new one." } };
      return { ok: { key, chain: "sol", to: "safe", depositAddress: ADDR, tokenId: "nep141:sol.omft.near", symbol: "SOL", decimals: 9, minAmountIn: "1000000", amountIn: "100000000", untilIso: new Date(Date.now() + 86_400_000).toISOString() } };
    }) as Bridge["call"],
    on: () => () => {},
  };
  return { asked, b };
};
async function mountRow(b: Bridge, initialKey: string): Promise<string> {
  const row = ADD_ROWS.find((r) => r.chain === "sol");
  await runtime.mount(createElement(AddressRow, { bridge: b, row, to: "safe", initialKey, onQr() {} }));
  for (let i = 0; i < 100 && !/Only SOL|NEAR Intents gave no address/.test(runtime.text()); i++) { await new Promise((r) => setTimeout(r, 20)); await runtime.settle(); }
  const text = runtime.text();
  runtime.unmount();
  return text;
}

test("owner's Bugs: (6 Nov, his phone): a kept key past its day (the core's ADD_USED) shows a new live address at once, never \"used up\" or Change wallet; a renewed key refused too says so once, never a loop (control: a live kept key shows as it is)", { timeout: 30_000 }, async () => {
  const kept = "add-sol-safe-keptkeykeptkeykept";
  const one = usedCore((key) => key === kept);
  const t1 = await mountRow(one.b, kept);
  assert.match(t1, /Only SOL on Solana/, "a live address with its rule");
  assert.doesNotMatch(t1, /used up|Change wallet/i);
  assert.equal(one.asked.length, 2, "the kept key, then one new key");
  assert.notEqual(one.asked[1], kept, "the new key is a new one");
  assert.equal(new Set(one.asked).size, one.asked.length, "never a key asked twice");
  const all = usedCore(() => true);
  const t2 = await mountRow(all.b, kept);
  assert.match(t2, /NEAR Intents gave no address/, "a renewed key refused too: said");
  assert.match(t2, /Tap QR for a new address\./, "and the QR button asks again");
  assert.equal(all.asked.length, 2, "never a loop");
  const live = usedCore(() => false);
  const t3 = await mountRow(live.b, kept);
  assert.match(t3, /Only SOL on Solana/);
  assert.deepEqual(live.asked, [kept], "control: a live kept key is kept (row 16)");
});

test("the copy review's grid (6 Nov): each line is drawn phrase by phrase in nowrap spans, so it wraps only at its comma and no unit is left alone; the flash lights both lines (control: one piece per line is caught)", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => Promise.resolve());
  assert.ok(r.keptBefore, "the phrases are .wl-keep spans");
  const pieces = (s: string) => s.split("\n");
  const before = pieces(r.before);
  for (const whole of ["Only SOL on Solana,", "at least 0.001 SOL."]) assert.ok(before.includes(whole), `"${whole}" drawn whole`);
  assert.ok(before.some((p) => /^Until \d{1,2} [A-Z][a-z]{2},$/.test(p)) && before.some((p) => /^\d{1,2}:\d{2} [ap]m\.$/.test(p)), "the end's two phrases, each whole");
  for (const whole of ["Only SOL on Solana,", "at least 0.001 SOL.", "Copied."]) assert.ok(pieces(r.text).includes(whole), `"${whole}" drawn whole in the flash`);
  for (const p of [...before, ...pieces(r.text)]) assert.doesNotMatch(p, /\d$/, `no phrase ends on a number without its unit: "${p}"`);
  assert.ok(!pieces("Only SOL on Solana, at least 0.001 SOL.").includes("at least 0.001 SOL."), "control: a line drawn as one piece is caught");
  const src = readFileSync(fileURLToPath(new URL("../../../../packages/wallet/src/app/money/AddSheet.tsx", import.meta.url)), "utf8");
  for (const id of ["add-rule", "add-until"]) assert.match(src, new RegExp(`<span className=\\{\`wl-addline__addr\\$\\{lit \\? " is-copied" : ""\\}\`\\} data-testid="${id}">`), `${id}: lit in --up through the flash`);
  const css = readFileSync(fileURLToPath(new URL("../../../../packages/wallet/src/app/wallet.css", import.meta.url)), "utf8");
  assert.match(css, /\.wl-keep \{ white-space: nowrap; \}/);
});

test("the copy review (6 Nov): after Copy's 2.5 s the end's line comes back in place of Copied. (control: Copied. shows first)", { timeout: 30_000 }, async () => {
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
  const row = ADD_ROWS.find((r) => r.chain === "sol");
  await runtime.mount(createElement(AddressRow, { bridge, row, to: "wallet", onQr() {} }));
  for (let i = 0; i < 100 && !/Only SOL/.test(runtime.text()); i++) { await new Promise((r) => setTimeout(r, 20)); await runtime.settle(); }
  runtime.pressNamed(/^Copy address: your SOL wallet$/);
  await runtime.settle();
  const flash = read(runtime.text());
  assert.match(flash, /\nCopied\./, "control: the flash first");
  let back = flash;
  for (let i = 0; i < 100 && /\nCopied\./.test(back); i++) { await new Promise((r) => setTimeout(r, 50)); await runtime.settle(); back = read(runtime.text()); }
  runtime.unmount();
  assert.doesNotMatch(back, /Copied/, "the flash ends");
  assert.match(back, /Only SOL on Solana, at least 0\.001 SOL\.\nUntil \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} [ap]m\./, "the rule and the end, as before the tap");
});
