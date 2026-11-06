// Decision C (4 Nov 2026): the trading wallets stay instant for trades and inside the cap; Wallet's own Send to an
// outside address past the cap asks Face ID (the sheet with no `tap`, which the phone answers only through the chip's
// approval pass). To the person's own wallet past the cap it stays one tap; under the cap it stays instant either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvmChain } from "./evm.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { hotRoot } from "./hot-keys.ts";
import { buy, pocketNode, send } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

const STRANGER = "0x00000000000000000000000000000000000000aa";
const SOL_STRANGER = "8JVZpqUZfQMEc8kMduTS9SkVxP9v8rgunJNcV4qNYGYZ";

async function wallet(answer = false) {
  const shown: PlainWords[] = [];
  const sent: string[] = [];
  const evm: EvmChain = {
    simulate: async () => ({ ok: true, agreed: true, balance: 0n }),
    nonce: async () => 7,
    tokenBalance: async () => 0n,
    token: async () => undefined,
    ponsCurve: async () => null,
    fees: async () => ({ tip: 1_000_000n, maxFee: 5_000_000n }),
    estimateGas: async () => 23_300n,
    send: async (_c, signed) => (sent.push(signed), true),
    receipt: async () => ["ok", "ok"],
    read: async (_c, method) => (method === "eth_getBalance" ? `0x${(10n ** 18n).toString(16)}` : `0x${"0".repeat(64)}`),
  } as EvmChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm, usdPrice: async (c) => (c === "hood" ? 3000 : null), approve: async (words) => (shown.push(words), answer), emit: () => {}, confirm: { everyMs: 1, forMs: 5 } });
  await w.create("chain", "hood");
  return { w, shown, sent };
}
const plain = (w: SubWallets, to: string, eth: string) => w.sendPlain("hood", to, eth, undefined, "ZeroFee", "wallet");

test("decision C: Wallet's Send past the cap to an outside address asks Face ID (no tap); a no sends nothing", async () => {
  const { w, shown, sent } = await wallet(false);
  assert.equal((await plain(w, STRANGER, "0.05")).status, "declined", "$150, over the $100 cap");
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.tap, undefined, "Face ID, not one tap");
  assert.equal(sent.length, 0);
});

test("decision C controls: past the cap to the person's own wallet stays one tap; under the cap no sheet at all", async () => {
  const { w, shown } = await wallet(false);
  const own = await w.create("browser", "hood");
  assert.equal((await plain(w, own.address, "0.05")).status, "declined");
  assert.equal(shown.at(-1)!.tap, true, "their own wallet: one tap");
  // QA's ruling (5 Nov): under the cap to their own wallet, no sheet at all (to an outside one: Face ID, below)
  const under = await wallet(true);
  const mine = await under.w.create("browser", "hood");
  assert.notEqual((await plain(under.w, mine.address, "0.001")).status, "declined", "$3 to their own wallet: instant");
  assert.equal(under.shown.length, 0);
});

test("QA's ruling: a Send to an outside address asks Face ID every time, at any amount; declined, nothing is sent", async () => {
  const yes = await wallet(true);
  assert.notEqual((await plain(yes.w, STRANGER, "0.001")).status, "declined", "$3 out, approved");
  assert.equal(yes.shown.length, 1, "$3, under the cap: still the sheet");
  assert.equal(yes.shown[0]!.tap, undefined, "Face ID, never one tap");
  assert.ok(yes.shown[0]!.lines.includes(`To ${STRANGER}`), "the full address on the sheet");
  assert.equal(yes.shown[0]!.amount, "$3.00 (0.001 ETH)");
  const no = await wallet(false);
  assert.equal((await plain(no.w, STRANGER, "0.001")).status, "declined");
  assert.equal(no.sent.length, 0, "declined: nothing sent");
  // an exported-key wallet counts as outside, at $3 too
  const ex = await wallet(true);
  const other = await ex.w.create("browser", "hood");
  await ex.w.export(other.id);
  ex.shown.length = 0;
  await plain(ex.w, other.address, "0.001");
  assert.equal(ex.shown.length, 1);
  assert.equal(ex.shown[0]!.tap, undefined, "its key was shown: Face ID");
});

test("QA's ruling: the outside sheet's lines say what they get and the fee from 1Click's signed dollars, and warn over 5 %", async () => {
  const { outsideLines, OUTSIDE_WORDS } = await import("./subwallets.ts");
  const nine = outsideLines(STRANGER, "3.00", "2.71");
  assert.deepEqual(nine.lines, [`To ${STRANGER}`, "They get about $2.71", "Fees · about $0.29", "NEAR Intents and the network keep this. ZeroFee takes nothing.", "Anyone can see it land."]);
  assert.deepEqual(nine.warnings, [{ kind: "large-amount", text: "9.7% goes to fees. On a bigger send, fees are a smaller part." }]);
  // controls: 2 % warns nothing; no signed figure says only the address (never a made-up one)
  assert.deepEqual(outsideLines(STRANGER, "100", "98").warnings, []);
  assert.deepEqual(outsideLines(STRANGER, "3", undefined), { lines: [`To ${STRANGER}`, "Anyone can see it land."], warnings: [] });
  assert.deepEqual(outsideLines(STRANGER, "3", "4"), { lines: [`To ${STRANGER}`, "Anyone can see it land."], warnings: [] }, "out over in: not a fee, said as nothing");
  assert.equal(OUTSIDE_WORDS.declined("SOL wallet"), "You said no. Nothing left your SOL wallet.");
  // the copy review's ruling (5 Nov): the payee's side said by its network; the full address stays on the sheet (security)
  assert.deepEqual(outsideLines(STRANGER, "3", "2.71", "Ethereum").lines, [`To ${STRANGER}`, "They get about $2.71", "Fees · about $0.29", "NEAR Intents and the network keep this. ZeroFee takes nothing.", "Public on Ethereum."]);
  assert.deepEqual(outsideLines(STRANGER, "3", undefined, "Solana").lines, [`To ${STRANGER}`, "Public on Solana."]);
  assert.equal(OUTSIDE_WORDS.seen(null), "Anyone can see it land.", "control: a network not known, the plain form");
  // a payee paid into their private balance: "Private.", never "Public on NEAR." (the copy review's ruling, 5 Nov)
  assert.equal(OUTSIDE_WORDS.seen("private"), "Private.");
  const core = (await import("node:fs")).readFileSync(new URL("./subwallets.ts", import.meta.url), "utf8");
  assert.match(core, /q\.recipientType === "CONFIDENTIAL_INTENTS" \? PRIVATE_LANDS : landsOn\(q\.destinationAsset, q\.recipientType\)/);
  assert.equal((core.match(/landsWords\((quote|q2|q)!\)/g) ?? []).length, 3, "every 1Click outside sheet reads it");
  // QA's condition (5 Nov, D37): the 6+6 payee words stand only while every outside sheet keeps the FULL address
  // line, unfolded, first: whatever the network line says (Private, Public on…, the plain form)
  for (const net of ["private", "Solana", "Ethereum", null] as const) {
    for (const out of [undefined, "2.71"]) assert.equal(outsideLines(STRANGER, "3", out, net).lines[0], `To ${STRANGER}`, `the full address first (${net}, ${out})`);
  }
  // and all three 1Click sheets hand the core the quote's full recipient (or the asked address), never a short form
  assert.match(core, /outsideSheet\("private balance", quote!\.recipient,/);
  assert.match(core, /outsideSheet\(row\.row, q2!\.recipient,/);
  assert.match(core, /outsideSheet\(row\.row, to, usd, q!\.amountOutUsd,/);
  assert.ok(!/outsideSheet\([^)]*(outsideShort|shortId)\(/.test(core), "control: no sheet is handed a short address");
});

test("QA's filing (5 Nov), the copy review's words: the real outside sheet says \"Public on <network>.\"; a send to the person's own wallet never does", async () => {
  const out = await wallet(true);
  await plain(out.w, STRANGER, "0.001");
  assert.equal(out.shown.length, 1, "the outside sheet");
  const seen = /^Public on (Solana|Ethereum|Base|Arbitrum|Gnosis|BNB Chain|Robinhood Chain|NEAR)\.$/;
  assert.ok(out.shown[0]!.lines.some((l) => seen.test(l)), `an outside send: said on the core's own sheet (${out.shown[0]!.lines.join(" | ")})`);
  assert.ok(!out.shown[0]!.lines.includes("Anyone can see it land."), "the network is known: never the plain form");
  // control: past the cap to their own wallet, its one-tap sheet (not the outside one) never says it
  const own = await wallet(false);
  const mine = await own.w.create("browser", "hood");
  await plain(own.w, mine.address, "0.05");
  assert.equal(own.shown.length, 1, "the cap sheet");
  assert.equal(own.shown[0]!.tap, true, "their own wallet: one tap, not the outside sheet");
  assert.ok(!own.shown[0]!.lines.some((l) => seen.test(l) || l === "Anyone can see it land."), "an own-wallet send: not said");
});

test("decision C: a wallet whose key was shown counts as outside: Wallet's Send to it past the cap asks Face ID", async () => {
  const { w, shown } = await wallet(true);
  const other = await w.create("browser", "hood");
  assert.ok("secretKey" in (await w.export(other.id)), "the key was shown");
  shown.length = 0;
  await plain(w, other.address, "0.05");
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.tap, undefined, "its key was shown: Face ID");
});

test("decision C on a site's Solana request: a plain send out of the site's own wallet past the cap asks Face ID; inside the cap, to the person's own wallet, or a trade past the cap, one tap", async () => {
  const vault = new MemoryVault();
  await vault.put("hot-root", hotRoot(new Uint8Array(32).fill(7)));
  const shown: PlainWords[] = [];
  const w = new SubWallets({ vault, sol: pocketNode(), evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), approve: async (words) => (shown.push(words), false), emit: () => {}, agentWallet: { on: false } });
  const pump = await w.create("site", "sol", undefined, "pump");
  const mine = await w.create("chain", "sol");
  const site = { origin: "https://pump.fun" };
  const ask = (tx: string) => w.signTx(pump.id, tx, "", undefined, "Browser", site, "browser");
  assert.deepEqual(await ask(send(pump.address, SOL_STRANGER, 150)), { declined: true });
  assert.equal(shown.at(-1)!.tap, undefined, "$150 to a stranger: Face ID");
  await ask(send(pump.address, SOL_STRANGER, 50));
  assert.equal(shown.at(-1)!.tap, true, "$50: inside the cap, one tap");
  await ask(send(pump.address, mine.address, 150));
  assert.equal(shown.at(-1)!.tap, true, "the person's own chain wallet: one tap");
  await ask(buy(pump.address, 150));
  assert.equal(shown.at(-1)!.tap, true, "a trade past the cap: one tap");
});
