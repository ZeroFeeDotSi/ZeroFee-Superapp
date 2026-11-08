// Home's Send reaches (the Home plan §1.3, bug 9): any NEAR name, and any address on Solana, Robinhood Chain, BNB
// Chain, Ethereum or Base; a 0x address asks which; a network it can't reach is one line naming it (never "try BNB");
// a new address that only looks like one the person paid is stopped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXCHANGE_LINE, LOOKALIKE_LINE, LOOK_ENDS, PAID_KINDS, PAID_READ, cantSendTo, groupAddress, knownAddress, lookalikeOf, paidOn, routeLines, sendNetworks, startNetwork, type Paid } from "./send-reach.ts";

const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D";
const name = (id: string) => ({ btc: "Bitcoin", ton: "TON", xrp: "XRP Ledger", tron: "Tron", arb: "Arbitrum", monad: "Monad" })[id] ?? id;

test("a network Send can't reach is one line naming it, and never suggests another (no BNB, bug 9)", () => {
  // S3 (5 Nov): Bitcoin and Tron are reached now (send-chains.test.ts); TON and XRP (a memo, a reserve) still aren't
  for (const [chain, address] of [["ton", "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2"], ["xrp", "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv"]] as const) {
    const line = cantSendTo({ kind: "address", chain, candidates: [chain], address }, name);
    assert.equal(line, `ZeroFee can't send to ${name(chain)} yet.`);
    assert.doesNotMatch(line!, /BNB|Try/);
  }
  // controls: NEAR names, Solana and a bare 0x address go
  assert.equal(cantSendTo({ kind: "ledger", accountId: "bob.near" }), null);
  assert.equal(cantSendTo({ kind: "near-wallet", accountId: "sam.near" }), null);
  assert.equal(cantSendTo({ kind: "address", chain: "sol", candidates: ["sol"], address: SOL }), null);
  assert.equal(cantSendTo({ kind: "address", chain: null, candidates: ["eth", "base", "arb"], address: EVM.toLowerCase() }), null);
  // a code that names a network Send doesn't reach is that network, never quietly another EVM one
  assert.equal(cantSendTo({ kind: "address", chain: "monad", candidates: ["monad"], address: EVM }, name), "ZeroFee can't send to Monad yet.");
});

test("security review M1: a 0x address could be Robinhood, BNB Chain, Ethereum or Base: a NEW one starts on none, whatever it is sent from; one paid before starts on the network it was paid on", () => {
  const nets = sendNetworks({ kind: "address", chain: null, candidates: ["eth", "base", "bsc"], address: EVM });
  assert.deepEqual(nets, ["hood", "bsc", "eth", "base", "arb", "op", "pol", "avax", "gnosis", "bera"]);
  const paid: Paid[] = [{ to: EVM.toLowerCase(), chain: "bsc" }, { to: "0x1234567890123456789012345678901234567890" }];
  assert.equal(startNetwork(nets, paidOn(EVM, paid)), "bsc", "paid on BNB Chain before (any case): BNB Chain to start");
  assert.equal(startNetwork(nets, paidOn("0x7D06e272B5305A4B9d40E872c7950D3437547e38".toLowerCase(), paid)), null, "control: a NEW address starts on none, even from the Robinhood wallet");
  assert.equal(startNetwork(nets, paidOn("0x1234567890123456789012345678901234567890", paid)), null, "paid before on a network not kept: still asked");
  assert.equal(EXCHANGE_LINE, "Exchanges often take only one network.");
  assert.deepEqual(sendNetworks({ kind: "address", chain: "sol", candidates: ["sol"], address: SOL }), ["sol"]);
  assert.equal(startNetwork(["sol"], "hood"), "sol", "one network: that one");
  assert.deepEqual(sendNetworks({ kind: "ledger", accountId: "bob.near" }), ["near"]);
  assert.deepEqual(sendNetworks({ kind: "address", chain: "bsc", candidates: ["bsc"], address: EVM }), ["bsc"], "a code's own network (EIP-681 @56) is taken as given");
  assert.deepEqual(sendNetworks({ kind: "address", chain: null, candidates: [], address: "0x7d06e272b5305a4b9D40e872C7950D3437547e3D" }), [], "a broken checksum reaches nothing");
});

test("the copy review's re-walk: the network line is the core sheet's \"Public on <network>.\" (was \"Lands as SOL on Solana.\"); a coin line only where it says more, after it; no wait of ours (D137)", async () => {
  const { OUTSIDE_WORDS } = await import("@zerofee/core/subwallets");
  assert.deepEqual(routeLines("sol"), ["Public on Solana."], "fails before: \"Lands as SOL on Solana.\"");
  assert.deepEqual(routeLines("hood"), ["Public on Robinhood Chain."]);
  assert.deepEqual(routeLines("bsc"), ["Public on BNB Chain."]);
  assert.deepEqual(routeLines("near"), ["Public on NEAR."], "NEAR lands as NEAR: \"Lands as NEAR.\" would say it twice");
  assert.deepEqual(routeLines("near", undefined, true), ["Public on NEAR.", "Lands as wNEAR, the NEAR Intents form of NEAR."], "control: a NEAR Intents balance is paid as wNEAR, said so, after the Public line");
  assert.deepEqual(routeLines("eth"), [OUTSIDE_WORDS.seen("Ethereum")], "control: the very line the core's sheet says");
  for (const n of ["hood", "sol", "bsc", "near", "eth"] as const) for (const l of routeLines(n)) assert.doesNotMatch(l, /Goes through|NEAR\. Lands|left/, "R3: never the machine's route");
});

test("D124: no Send or Swap line a person reads says \"on Robinhood Chain\" after Robinhood (controls: another coin there, or ETH on Base, keeps its network)", async () => {
  const { onNetwork } = await import("@zerofee/core/send-words");
  assert.equal(onNetwork("0.0019 Robinhood", "nep141:hood.omft.near"), "", "the core's sheets: Robinhood alone");
  assert.equal(onNetwork("3.1 SOL", "nep141:sol.omft.near"), " on Solana", "control: SOL names Solana");
  assert.equal(onNetwork("0.001 ETH on Base", "nep141:base.omft.near"), "", "control: a network the words already name");
  assert.equal(onNetwork("0.1 ETH", "nep141:eth.omft.near"), " on Ethereum", "control: ETH on Ethereum");
  const code = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
  for (const p of ["./send-reach.ts", "./app/money/SendForm.tsx", "./app/money/SendSheet.tsx", "./app/money/SwapSheet.tsx", "./app/money/swap-corridor.ts", "../../core/src/send-words.ts", "../../shell-api/src/MockBridge.ts"]) {
    assert.doesNotMatch(code(p), /ETH(?: \(RH\))? on Robinhood Chain|"on Robinhood Chain"/, `${p}: never spelled out`);
  }
  assert.match(code("../../shell-api/src/MockBridge.ts"), /\$\{lands\.coin\.endsWith\("\(RH\)"\) \? "" : ` on \$\{lands\.network\}`\}/, "the demo's sheets too");
});

test("address poisoning: a NEW address with the same first and last four as one paid is stopped; the real one, or a different one, isn't", () => {
  const paid: Paid[] = [{ to: "0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39" }, { to: "bob.near" }, { to: SOL }];
  const fake = "0xAB5e0000020010000001008c0100000000d53E39"; // same Ab5e…3e39
  assert.equal(lookalikeOf(fake, paid), paid[0]!.to);
  assert.equal(LOOKALIKE_LINE, "This only looks like an address you paid before. Check it.");
  assert.equal(lookalikeOf(paid[0]!.to.toLowerCase(), paid), null, "control: the very address paid, in any case, is known");
  assert.equal(lookalikeOf("0x1111000000000000000000000000000000002222", paid), null, "control: nothing like it in the history");
  assert.equal(lookalikeOf(`${SOL.slice(0, 4)}${"x".repeat(36)}${SOL.slice(-4)}`, paid), SOL, "Solana too");
  assert.equal(knownAddress(paid[0]!.to.toUpperCase().replace("0X", "0x"), paid), true);
  assert.equal(knownAddress(fake, paid), false, "so it is a New address");
  assert.equal(groupAddress("0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39"), "0xAb 5e68 8E42 cE07 Fc83 e0AD 8ca0 486b 96a5 D53e 39");
});

test("security review L1: three and three at the ends is enough (3+4, 4+3 too); a 64-hex NEAR account is checked; names never are; older kinds and 200 movements count", () => {
  const real = "0xAb5e688E42cE07Fc83e0AD8ca0486b96a5D53e39";
  const implicit = "a".repeat(10) + "0123456789abcdef".repeat(3) + "b".repeat(6);
  const paid: Paid[] = [{ to: real }, { to: implicit }, { to: "shop-wallet.near" }];
  assert.equal(LOOK_ENDS, 3);
  assert.equal(lookalikeOf(real.slice(0, 5) + "0".repeat(34) + real.slice(-3), paid), real, "3+3 is stopped");
  assert.equal(lookalikeOf(real.slice(0, 5) + "0".repeat(33) + real.slice(-4), paid), real, "3+4");
  assert.equal(lookalikeOf(real.slice(0, 6) + "0".repeat(33) + real.slice(-3), paid), real, "4+3");
  assert.equal(lookalikeOf("aaa" + "f".repeat(58) + "bbb", paid), implicit, "a 64-hex NEAR account too");
  assert.equal(lookalikeOf(real.slice(0, 4) + "0".repeat(36) + real.slice(-2), paid), null, "control: two and two is a different address");
  assert.equal(lookalikeOf(real.slice(0, 5) + "0".repeat(34) + real.slice(-3, -2) + (real.slice(-2, -1) === "9" ? "8" : "9") + real.slice(-1), paid), null, "control: the last three differ");
  assert.equal(lookalikeOf("shop-wallet2.near", paid), null, "control: a name is read whole, never matched by its ends");
  assert.equal(lookalikeOf("0xaaa" + "0".repeat(34) + "bbb", [{ to: implicit }]), null, "control: a 0x-shaped body never matches a NEAR account (kinds apart)");
  assert.deepEqual([...PAID_KINDS], ["pay", "transfer", "withdraw"]);
  assert.equal(PAID_READ, 200);
  const sheet = readFileSync(new URL("./app/money/SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /"ledger\.activity", \{ limit: PAID_READ \}/);
  assert.match(sheet, /PAID_KINDS\.includes\(m\.kind\)/);
  assert.doesNotMatch(sheet, /m\.kind === "pay" && typeof m\.to/, "control: not only Send's own kind");
  const form = readFileSync(new URL("./app/money/SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /const lookalike = who \? lookalikeOf\(target, history\) : null;/, "every recipient is checked, not only a chain address");
});
