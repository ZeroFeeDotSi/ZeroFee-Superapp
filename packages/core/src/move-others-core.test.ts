// C2 on the phone (the audit's required shape, 7 Nov): the Move's wallet parts cross to the core (subwallet.moveOthers) only well
// formed, and the core keeps them by ITS OWN read of each wallet (on the phone, the isolated core, where the Safe's sheet
// is built): a page part above that read is refused (the Safe's side only), a malformed one is dropped, an honest one is
// said on the sheet the core builds. Fails on b5f0022f9: no othersWellFormed, othersToCross, keepInCore or
// SubWallets.moveOthers, so on the phone the parts the page kept never reach the core's sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as door from "./spending-move.ts";
import { othersForSheet } from "./move-plan.ts";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import type { PrivateLegRecord } from "./private-route.ts";
import type { TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";

const D = door as unknown as Record<string, any>;
const has = (name: string) => assert.equal(typeof D[name], "function", `the core exports ${name}`);
/** The phone: the page's realm and the isolated core's are two, so nothing the page kept is the core's. */
const coreRealm = () => (globalThis as Record<symbol, Map<string, unknown> | undefined>)[Symbol.for("zerofee.move-others")]?.clear();

test("the allow-list (the core's own, and the phone's IsolatedCore.swift says the same): only well-formed parts pass; a malformed part drops them all", () => {
  has("othersWellFormed"); has("othersToCross");
  const ok = [{ from: "hood", to: "sol", cents: "394" }, { from: "hood", to: "near", cents: "552" }];
  assert.deepEqual(D.othersWellFormed(ok), ok, "control: place keys, whole cents");
  const six = Array.from({ length: 6 }, () => ({ from: "sol", to: "near", cents: "1" }));
  assert.deepEqual(D.othersWellFormed(six), six, "control: six");
  const bad: [string, unknown][] = [
    ["a figure not in whole cents", [{ from: "hood", to: "sol", cents: "3.94" }]],
    ["no cents", [{ from: "hood", to: "sol", cents: "0" }]],
    ["a number, not text", [{ from: "hood", to: "sol", cents: 394 }]],
    ["a sign", [{ from: "hood", to: "sol", cents: "-1" }]],
    ["13 digits", [{ from: "hood", to: "sol", cents: "1234567890123" }]],
    ["the Safe is not a wallet part", [{ from: "hood", to: "safe", cents: "1" }]],
    ["the same wallet", [{ from: "hood", to: "hood", cents: "1" }]],
    ["a field more", [{ from: "hood", to: "sol", cents: "1", usd: 50 }]],
    ["one good, one bad", [...ok, { from: "mars", to: "sol", cents: "1" }]],
    ["seven", [...six, { from: "sol", to: "near", cents: "1" }]],
    ["none", []], ["not a list", "x"], ["nothing", undefined],
  ];
  for (const [name, raw] of bad) assert.equal(D.othersWellFormed(raw), null, name);
  // the page's side: its figures in whole cents as they cross; one not a figure, none cross
  assert.deepEqual(D.othersToCross([{ from: "hood", to: "sol", usd: 3.94 }, { from: "hood", to: "near", usd: 5.52 }]), ok);
  assert.equal(D.othersToCross([{ from: "hood", to: "sol", usd: "all" }]), null);
  assert.equal(D.othersToCross([{ from: "hood", to: "sol", usd: 0.001 }]), null);
});

test("IsolatedCore.swift: subwallet.moveOthers's parts pass only well formed (else removed); the page can't reach a spending.* core family", () => {
  const src = readFileSync(new URL("../../../apps/ios/ZeroFee/IsolatedCore.swift", import.meta.url), "utf8");
  assert.match(src, /if method == "subwallet\.moveOthers", !Self\.othersWellFormed\(params\["others"\]\) \{ params\.removeValue\(forKey: "others"\) \}/);
  const fn = src.slice(src.indexOf("static func othersWellFormed"), src.indexOf("/** The exact hosts"));
  for (const want of [`["sol", "hood", "near", "bsc"]`, "parts.count <= 6", "d.count == 3", "from != to", "(1...12).contains(cents.count)", `("0"..."9").contains($0)`, `cents.contains(where: { $0 != "0" })`]) assert.ok(fn.includes(want), want);
  // the check sits before the call reaches the core (every path below the params read)
  assert.ok(src.indexOf(`if method == "subwallet.moveOthers"`) < src.indexOf(`if method == "subwallet.site.forHost"`));
  assert.match(src, /coreFamilies: Set<String> = \[[^\]]*"subwallet"[^\]]*\]/);
  assert.doesNotMatch(src.match(/coreFamilies: Set<String> = \[[^\]]*\]/)![0], /"spending"/);
});

/** A real core's SubWallets with Trade's SOL wallet holding `lamports`, SOL at $150 (its own price). */
async function core(lamports: bigint, price: number | null = 150) {
  const w = new SubWallets({ vault: new MemoryVault(), sol: { balance: async () => lamports } as never, evm: {} as never, usdPrice: async () => price, approve: async () => true, emit: () => {} });
  await w.create("trade", "sol");
  return w;
}
// 0.0631 SOL: $9.465 at $150, less its 5,000-lamport fee: $9.46425 the core reads it can move
const SOL_946 = 63_100_000n;

test("the core keeps a part only by its own read: a forged part over it refused (none kept), a malformed one dropped, an unread wallet none; control: an honest part kept", async () => {
  coreRealm();
  const w = await core(SOL_946);
  const job = (n: string) => `phone-move-${n}-0123456789`;
  assert.deepEqual(await w.moveOthers(job("a"), [{ from: "sol", to: "near", cents: "946" }], false), { kept: 1 }, "control: at the core's read");
  assert.deepEqual(othersForSheet(job("a"), "dep-a"), [{ from: "sol", to: "near", cents: "946" }]);
  assert.deepEqual(await w.moveOthers(job("b"), [{ from: "sol", to: "near", cents: "947" }], false), { kept: 0 }, "a cent over the core's own read");
  assert.equal(othersForSheet(job("b"), "dep-b"), undefined);
  assert.deepEqual(await w.moveOthers(job("c"), [{ from: "sol", to: "near", cents: "9.46" }], false), { kept: 0 }, "malformed: dropped");
  assert.equal(othersForSheet(job("c"), "dep-c"), undefined);
  assert.deepEqual(await w.moveOthers(job("d"), [{ from: "hood", to: "near", cents: "100" }], false), { kept: 0 }, "a wallet this core can't read (no ETH (RH) wallet here)");
  assert.deepEqual(await (await core(SOL_946, null)).moveOthers(job("e"), [{ from: "sol", to: "near", cents: "100" }], false), { kept: 0 }, "no price of its own: none");
  assert.deepEqual(await w.moveOthers(job("f"), [{ from: "near", to: "sol", cents: "100" }], false), { kept: 0 }, "the NEAR wallet's cash unread here: none");
  await assert.rejects(w.moveOthers("short", [{ from: "sol", to: "near", cents: "1" }], false), (e: any) => e?.problem?.code === "security.request.invalid");
  // the page's figure can only lower: a lower part is said as the page said it
  assert.deepEqual(await w.moveOthers(job("g"), [{ from: "sol", to: "near", cents: "500" }], false), { kept: 1 });
  assert.deepEqual(othersForSheet(job("g"), "dep-g"), [{ from: "sol", to: "near", cents: "500" }]);
  // Not now: ended here, and a leg still carrying the key is refused in this core's own store
  await w.moveOthers(job("g"), undefined, true);
  assert.equal(othersForSheet(job("g"), "dep-g"), undefined);
  assert.match(door.legCap(job("g"), "sol", "near", 5) ?? "", /no longer has this Move's plan/);
});

test("ended while the core reads (Not now before the read came back): it stays ended", async () => {
  coreRealm();
  let land!: () => void;
  const late = new Promise<void>((r) => (land = r));
  const w = new SubWallets({ vault: new MemoryVault(), sol: { balance: async () => (await late, SOL_946) } as never, evm: {} as never, usdPrice: async () => 150, approve: async () => true, emit: () => {} });
  await w.create("trade", "sol");
  const job = "phone-move-late-0123456789";
  const kept = w.moveOthers(job, [{ from: "sol", to: "near", cents: "500" }], false);
  await new Promise((r) => setImmediate(r));
  await w.moveOthers(job, undefined, true);
  land();
  assert.deepEqual(await kept, { kept: 0 });
  assert.equal(othersForSheet(job, "dep"), undefined);
  assert.match(door.legCap(job, "sol", "near", 5) ?? "", /no longer has this Move's plan/);
});

/** The core's sheet for the owner's Move (the Safe's $150.00 fill, NEAR wallet $101.48 from it, SOL wallet $8.39 from
 *  Private), its wallet parts read from THIS core's store by the fill's own key (subwallets privateLeg). */
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111", FLOAT = "f1oat.near";
const u = (usd: number) => String(Math.round(usd * 100) * 10_000);
async function sheet(job: string) {
  const fc = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  fc.fund("alice.near", key.publicKey);
  fc.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => (token_id === `nep141:${USDC}` ? "900000000" : "0") });
  fc.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const step = u(150);
  const quote = { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN", deadline: soon },
    quote: { depositAddress: DEPOSIT, amountIn: step, minAmountOut: step, amountOut: step, deadline: soon },
  }) };
  const move = [{ recipient: SOLW, own: true, units: u(8.39), payUnits: "0" }, { recipient: FLOAT, own: true, units: "0", payUnits: u(101.48) }];
  const others = othersForSheet(job, DEPOSIT);
  const leg: PrivateLegRecord = { tokenId: `nep141:${USDC}`, payUnits: u(101.48), recipient: FLOAT, own: true, move, ...(others ? { others } : {}) };
  const signer = new DevSigner({ accountId: "alice.near", chain: fc, key, approve: async () => true, oneClick: async (a) => (a === DEPOSIT ? quote : null), quoteKey: TEST_QUOTE_KEY, privateLeg: async () => leg, ownWallets: async () => new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"], [FLOAT, TRADING_BALANCE]]) });
  const req = { receiverId: "intents.near", actions: [{ kind: "call", method: "ft_withdraw", args: { token: USDC, receiver_id: DEPOSIT, amount: step }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", moveFill: true } as TxRequest;
  return signer.describe(req);
}

test("the isolated core's path end to end: the page's keep is not the core's; the core's own keep is what its sheet says. A forged part over its read: the Safe's side only; malformed: the Safe's side only; control: the honest part on the sheet", async () => {
  // the owner's Move: $9.46 from the SOL wallet to the NEAR wallet beside the Safe's fill
  const honest = [{ from: "sol", to: "near", cents: "946" }];
  // the page kept it in its own realm (C2's keepFor): the core's realm never sees that
  door.keepOthers("phone-sheet-page-0123456789", honest);
  coreRealm();
  assert.equal((await sheet("phone-sheet-page-0123456789")).title, "Move $109.87 to your SOL and NEAR wallets", "the page's keep alone: the core's sheet has the Safe's side only (b5f0022f9 on the phone)");
  const w = await core(SOL_946);
  await w.moveOthers("phone-sheet-ok-0123456789", honest, false);
  const ok = await sheet("phone-sheet-ok-0123456789");
  assert.equal(ok.title, "Move $119.33 to your SOL and NEAR wallets");
  assert.ok(ok.lines.includes("From your SOL wallet · about $9.46"), ok.lines.join(" | "));
  assert.ok(ok.lines.includes("Your NEAR wallet gets · about $110.94"), ok.lines.join(" | "));
  await w.moveOthers("phone-sheet-forged-0123456789", [{ from: "sol", to: "near", cents: "5000" }], false);
  const forged = await sheet("phone-sheet-forged-0123456789");
  assert.equal(forged.title, "Move $109.87 to your SOL and NEAR wallets");
  assert.ok(!forged.lines.some((l) => /From your SOL wallet/.test(l)), forged.lines.join(" | "));
  await w.moveOthers("phone-sheet-bad-0123456789", [{ from: "sol", to: "near", cents: "946", usd: 50 }], false);
  assert.equal((await sheet("phone-sheet-bad-0123456789")).title, "Move $109.87 to your SOL and NEAR wallets");
  assert.equal(ok.amount, forged.amount, "the bound amount never moves");
});
