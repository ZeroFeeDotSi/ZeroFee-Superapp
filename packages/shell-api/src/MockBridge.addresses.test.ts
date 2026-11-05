// The web demo shows its addresses, QR codes and a key like the real app, with no "sample" tag, so each must be unusable:
// every one fails its own chain's check, and nothing the demo offers as a deposit target is one a person could fund.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createMockBridge, PUBLIC_SAMPLE_ACCOUNT_ID, SAMPLE_BTC, SAMPLE_EVM, SAMPLE_FLOAT, SAMPLE_KEY, SAMPLE_POCKET, SAMPLE_SOL, SAMPLE_SOL_SOCIAL, SAMPLE_XLM } from "./MockBridge.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** base58 decode, as Solana's wallets do: null when a letter isn't base58. */
function base58(s: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
const solanaAddress = (s: string) => base58(s)?.length === 32;
/** EIP-55: a mixed-case address must carry its checksum; all one case carries none (and is accepted as is). */
function evmAccepted(a: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const hex = a.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const h = Buffer.from(keccak_256(new TextEncoder().encode(hex.toLowerCase()))).toString("hex");
  return [...hex].every((c, i) => (/[a-f]/i.test(c) ? (parseInt(h[i], 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase()) : true));
}
/** BIP-173/350 bech32(m) checksum, as a Bitcoin wallet checks a bc1 address. */
function bech32Valid(addr: string): boolean {
  const CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const a = addr.toLowerCase();
  const sep = a.lastIndexOf("1");
  if (sep < 1 || sep + 7 > a.length) return false;
  const hrp = a.slice(0, sep), data = [...a.slice(sep + 1)].map((c) => CH.indexOf(c));
  if (data.some((d) => d < 0)) return false;
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data]) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= G[i];
  }
  return chk === 1 || chk === 0x2bc830a3;
}
/** Stellar's StrKey: base32 (A-Z, 2-7), 56 letters for an account. */
const stellarAccount = (s: string) => /^G[A-Z2-7]{55}$/.test(s);
/** A NEAR account anyone could receive at: an implicit (64 lowercase hex) or an EVM-style (0x + 40 hex) one, or a valid
 *  name someone can create (with a dot under a parent, or a top-level name of 32 letters or more). */
function nearFundable(id: string): boolean {
  const valid = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id) && id.length >= 2 && id.length <= 64;
  if (!valid) return false;
  if (/^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id)) return true;
  return id.includes(".") || id.length >= 32;
}

test("Solana: the demo's address isn't base58, so no wallet takes it", () => {
  assert.equal(base58(SAMPLE_SOL), null);
  assert.equal(solanaAddress(SAMPLE_SOL), false);
  // the apps wallet's: unusable too, and no words a person could read as a message (grade 1 Nov, item 5)
  assert.equal(base58(SAMPLE_SOL_SOCIAL), null);
  assert.equal(solanaAddress(SAMPLE_SOL_SOCIAL), false);
  assert.doesNotMatch(SAMPLE_SOL_SOCIAL, /sample|social|wallet|sent|only/i);
  assert.equal(solanaAddress("So11111111111111111111111111111111111111112"), true, "control: a real address passes this check");
});

test("EVM: the demo's address is mixed case with the wrong EIP-55 checksum, so every EVM wallet refuses it", () => {
  assert.equal(evmAccepted(SAMPLE_EVM), false);
  assert.equal(evmAccepted("0xab5e688E42cE07Fc83e0AD8ca0486b96a5D53e39"), true, "control: the same address with its right checksum passes");
  assert.equal(evmAccepted(SAMPLE_EVM.toLowerCase()), true, "control: all one case would pass, which is why the demo's isn't");
});

test("Bitcoin: the demo's bc1 address fails bech32", () => {
  assert.equal(bech32Valid(SAMPLE_BTC), false);
  assert.equal(bech32Valid("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"), true, "control: BIP-173's own example passes");
});

test("Stellar: the demo's account has a 0, which base32 has no letter for", () => {
  assert.equal(stellarAccount(SAMPLE_XLM), false);
});

test("NEAR: the demo's account and its wallets can't receive: no one can create the name, and the ids are in capitals", () => {
  for (const id of [PUBLIC_SAMPLE_ACCOUNT_ID, SAMPLE_FLOAT, SAMPLE_POCKET]) assert.equal(nearFundable(id), false, id);
  for (const id of [SAMPLE_FLOAT, SAMPLE_POCKET]) assert.equal(nearFundable(id.toLowerCase()), false, `${id} lowercased: 66 characters, no account`);
  assert.equal(nearFundable(SAMPLE_FLOAT.toLowerCase().slice(0, 64)), true, "control: 64 lowercase hex would be fundable");
  assert.equal(nearFundable("f1".repeat(32)), true, "control: the old lowercase float id was fundable");
  assert.equal(nearFundable("sample-account.near"), true, "control: a name with a parent is");
});

test("Show its key: key-shaped, but no chain's wallet can read it", () => {
  assert.equal(base58(SAMPLE_KEY), null, "not base58 (a Solana secret key)");
  assert.ok(!/^(0x)?[0-9a-fA-F]{64}$/.test(SAMPLE_KEY), "not 64 hex (an EVM or NEAR ed25519 seed)");
  assert.ok(!/^ed25519:/.test(SAMPLE_KEY), "not a NEAR key");
  assert.ok(!SAMPLE_KEY.split(/\s+/).every((w) => wordlist.includes(w)), "not backup words");
  assert.ok(SAMPLE_KEY.length >= 80, "it looks like a key");
});

test("a call the demo's bridge has no answer for is a calm product Problem: never \"mock\", never a method name", async () => {
  const mock = createMockBridge({ latencyMs: 0, mainnetRules: {} });
  for (const method of ["guardian.code", "anything.new", "subwallet.nothing"]) {
    const r = await mock.call(method, {});
    assert.ok("problem" in r, method);
    const shown = JSON.stringify({ w: r.problem.whatHappened, m: r.problem.money, n: r.problem.next, more: r.problem.more });
    assert.doesNotMatch(shown, /mock|doesn't know|preview|sample|demo|guardian|anything|subwallet/i, `${method}: ${shown}`);
    assert.equal(r.problem.whatHappened, "This isn't available yet. Nothing was sent.");
    assert.equal(r.problem.money.state, "safe");
  }
});

test("a recovery started in the demo is the account's own: recovery.status and account.state say it while the banner does", async () => {
  const mock = createMockBridge({ latencyMs: 0, mainnetRules: {} });
  const readyAtIso = new Date(Date.now() + 7 * 86400e3).toISOString();
  mock.freeze(readyAtIso, { readyAtIso });
  const st = await mock.call<{ pending: { readyAtIso: string } | null }>("recovery.status");
  assert.ok("ok" in st && st.ok.pending?.readyAtIso === readyAtIso);
  const acct = await mock.call<{ account: { recovery: { pending: unknown } } }>("account.state");
  assert.ok("ok" in acct && acct.ok.account.recovery.pending !== null, "the Recovery tab reads this: never 'Added and quiet' beside the banner");
  mock.freeze(new Date(Date.now() + 8 * 86400e3).toISOString(), null);
  const stopped = await mock.call<{ pending: unknown; frozenUntilIso?: string }>("recovery.status");
  assert.ok("ok" in stopped && stopped.ok.pending === null && stopped.ok.frozenUntilIso, "stopped: no new phone waiting, payments still frozen");
});

test("every deposit target the demo hands out fails its chain's check, and nothing links to an explorer", async () => {
  const mock = createMockBridge({ latencyMs: 0, mainnetRules: {}, account: { accountId: PUBLIC_SAMPLE_ACCOUNT_ID, network: "mainnet" }, tradeChains: ["sol", "hood", "bsc"] });
  const chains = await mock.call<{ id: string }[]>("ledger.chains");
  assert.ok("ok" in chains);
  for (const c of chains.ok) {
    const r = await mock.call<{ address: string; qr: string }>("ledger.depositAddress", { chain: c.id });
    assert.ok("ok" in r, c.id);
    const a = r.ok.address;
    const usable = c.id === "near" ? nearFundable(a) : c.id === "sol" ? solanaAddress(a) : c.id === "btc" ? bech32Valid(a) : c.id === "stellar" ? stellarAccount(a) : evmAccepted(a);
    assert.equal(usable, false, `${c.id}: ${a}`);
    assert.equal(r.ok.qr, a, "the QR says the same unusable address");
  }
  const wallets = await mock.call<{ chain: string; address: string }[]>("subwallet.list");
  assert.ok("ok" in wallets);
  for (const w of wallets.ok) {
    const usable = w.chain === "sol" ? solanaAddress(w.address) : w.chain === "near" ? nearFundable(w.address) : evmAccepted(w.address);
    assert.equal(usable, false, `${w.chain} trading wallet: ${w.address}`);
  }
  const said = JSON.stringify(await Promise.all(["account.activity", "ledger.activity"].map((m) => mock.call(m))));
  assert.doesNotMatch(said, /https?:\/\//, "no explorer links");
});

test("the demo's EVM and NEAR addresses read as addresses, not placeholders (3 Nov e2e walk, 144: \"0x5a 3E00 0000 … 005a 3E\", \"F1F1 … F1F1\")", () => {
  const varied = (a: string) => new Set(a.replace(/^0x/, "").toLowerCase()).size >= 10 && !/(.)\1{4}|(..)\2{3}/i.test(a.replace(/^0x/, ""));
  assert.ok(varied(SAMPLE_EVM), SAMPLE_EVM);
  assert.ok(varied(SAMPLE_FLOAT), SAMPLE_FLOAT);
  assert.ok(varied(SAMPLE_POCKET), SAMPLE_POCKET);
  assert.equal(varied("0x5a3E000000000000000000000000000000005a3E"), false, "control: the old EVM sample");
  assert.equal(varied("F1".repeat(32)), false, "control: the old float id");
});

test("Trade picks its demo engine only for the demo's own addresses, exactly: never a lowercase or rechecksummed copy, which a real wallet could hold", async () => {
  const { isSampleAddress, SAMPLE_EVM_ADDRESS } = await import("@zerofee/trade/demo-engine.ts");
  assert.equal(SAMPLE_EVM_ADDRESS, SAMPLE_EVM, "one string in both places");
  assert.equal(isSampleAddress(SAMPLE_EVM), true);
  assert.equal(isSampleAddress(SAMPLE_SOL), true);
  // controls: the lowercase form and the right checksum are valid addresses a person could own
  assert.equal(isSampleAddress(SAMPLE_EVM.toLowerCase()), false);
  assert.equal(isSampleAddress("0xab5e688E42cE07Fc83e0AD8ca0486b96a5D53e39"), false);
  assert.equal(isSampleAddress(SAMPLE_EVM.toUpperCase().replace(/^0X/, "0x")), false);
});
