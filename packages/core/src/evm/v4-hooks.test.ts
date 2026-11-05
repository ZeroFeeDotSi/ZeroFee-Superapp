// Gap 4 (coverage audit, the review's ruling 4 Nov): a Uniswap v4 pool with hooks is traded with no sheet only through a
// launchpad's hook pinned here, whose code two nodes have as the pinned codehash, with no proxy slot and no way to change
// what it runs; the test runs agree exactly; everything else as any trade. Read live 4 Nov (read-only, no key): frontier-fun's
// FOREVER and OUTLAW pass every core trade check; on main both were refused "It uses a pool with hooks."
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha2.js";
import { V4_HOOKS, V4_HOOKS_SHA256, hookCodeRefusal, hooksLines } from "./v4-hooks.ts";
import { evmSessionRefusal, type HookFacts } from "../evm.ts";
import { exactlyAgreed } from "../subwallets.ts";
import type { EvmDecoded } from "./decode.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const FRONTIER = "0xee588bcf2bd3e658f5160489f4199d1851bbf0cc";
const WALLET = "0x332904f151c62a1d8d2ccf42014040473219ec55";  // generated sample

test("the hook list is pinned by its sha256 (control: one codehash changed breaks the pin); every entry names its source", () => {
  assert.equal(hex(sha256(new TextEncoder().encode(hooksLines()))), V4_HOOKS_SHA256);
  const changed = { ...V4_HOOKS, hood: { ...V4_HOOKS.hood, [FRONTIER]: { ...V4_HOOKS.hood[FRONTIER]!, codehash: "0x" + "00".repeat(32) } } };
  assert.notEqual(hex(sha256(new TextEncoder().encode(hooksLines(changed)))), V4_HOOKS_SHA256, "control");
  for (const [h, p] of Object.entries(V4_HOOKS.hood)) {
    assert.match(h, /^0x[0-9a-f]{40}$/);
    assert.match(p.codehash, /^0x[0-9a-f]{64}$/);
    assert.ok(p.source.length > 40, `${p.launchpad}: its source is said`);
  }
  assert.ok(Object.isFrozen(V4_HOOKS) && Object.isFrozen(V4_HOOKS.hood));
});

test("hookCodeRefusal: SELFDESTRUCT, DELEGATECALL and CALLCODE refuse; PUSH data and the compiler's metadata don't (controls)", () => {
  const code = (...b: number[]) => Uint8Array.from(b);
  // a metadata tail (0xa2 …, then its length) that holds 0xf4 and 0xff as data, as frontier-fun's hook does
  const meta = [0xa2, 0x64, 0x69, 0x70, 0x66, 0x73, 0x58, 0x22, 0x12, 0x20, 0x29, 0x08, 0xf4, 0x83, 0xff];
  const withMeta = (...b: number[]) => code(...b, ...meta, 0x00, meta.length);
  assert.equal(hookCodeRefusal(withMeta(0x60, 0x01, 0x00, 0xfe)), null, "0xf4 and 0xff only in the metadata");
  assert.equal(hookCodeRefusal(code(0x73, ...new Array(20).fill(0xff), 0x00)), null, "0xff only as PUSH20 data");
  assert.equal(hookCodeRefusal(withMeta(0x60, 0x01, 0xf4, 0xfe)), "it can run other code as itself", "DELEGATECALL in the code");
  assert.equal(hookCodeRefusal(withMeta(0x60, 0x01, 0xf2)), "it can run other code as itself", "CALLCODE in the code");
  assert.equal(hookCodeRefusal(withMeta(0x60, 0x01, 0xff)), "it can destroy itself", "SELFDESTRUCT in the code");
  assert.equal(hookCodeRefusal(code()), "it has no code");
});

const hooked = (hooks: string, recipient?: string): EvmDecoded => ({
  chain: "hood", chainId: 4663, to: "0x8876789976decbfcbbbe364623c63652db8c0904", nonce: 0, value: "1000", gas: "300000", maxFee: "1", maxPriorityFee: "0", selector: "0x3593564c",
  swaps: [{ venue: "Uniswap v4", side: "buy", coin: "0xacc8de336f5d2366fa7334383d8fab73499f582a", inRaw: "1000", minOutRaw: "900", hooks, ...(recipient ? { recipient } : {}) }],
} as EvmDecoded);
const facts = (hook: HookFacts | null) => ({ balances: new Map<string, bigint>(), ponsCurve: null, hook });
const good: HookFacts = { codehash: V4_HOOKS.hood[FRONTIER]!.codehash, proxied: false, codeRefusal: null };

test("a pool with hooks: only a pinned hook, as two nodes have its pinned code, with no proxy slot and no way to change (controls for each)", () => {
  assert.equal(evmSessionRefusal(hooked(FRONTIER), WALLET, "hood", facts(good), 1), null, "frontier-fun's pinned hook, its code as pinned");
  assert.equal(evmSessionRefusal(hooked("0x" + "12".repeat(20)), WALLET, "hood", facts(good), 1), "It uses a pool with hooks ZeroFee doesn't know.", "an unlisted hook");
  assert.equal(evmSessionRefusal(hooked(FRONTIER), WALLET, "bsc" as never, facts(good), 1), "It is for another chain.", "the list is per chain");
  assert.equal(evmSessionRefusal(hooked(FRONTIER), WALLET, "hood", facts({ ...good, codehash: "0x" + "ab".repeat(32) }), 1), "Its pool's hooks aren't the code ZeroFee checked.", "a changed codehash");
  assert.equal(evmSessionRefusal(hooked(FRONTIER), WALLET, "hood", facts({ ...good, proxied: true }), 1), "Its pool's hooks can be changed.", "a proxy slot set");
  assert.equal(evmSessionRefusal(hooked(FRONTIER), WALLET, "hood", facts({ ...good, codeRefusal: "it can run other code as itself" }), 1), "Its pool's hooks can be changed.", "a delegatecall in its code");
  assert.equal(evmSessionRefusal(hooked(FRONTIER), WALLET, "hood", facts(null), 1), "Its pool's hooks couldn't be checked on two network servers.", "unread, or the nodes differ");
  assert.equal(evmSessionRefusal(hooked(FRONTIER, "0x" + "34".repeat(20)), WALLET, "hood", facts(good), 1), "It pays out to someone else.", "a pinned hook paying a third party");
  assert.equal(evmSessionRefusal(hooked("0x0000000000000000000000000000000000000000"), WALLET, "hood", facts(null), 1), null, "control: a pool without hooks needs no hook read");
});

test("exactlyAgreed: the two nodes' figures the very same (controls: a coin a wei apart, the chain's coin apart, nothing to compare)", () => {
  const m = (n: bigint) => new Map([["0xcoin", n]]);
  assert.equal(exactlyAgreed({ agreed: true, nativeIn: 0n, nativeInHigh: 0n, coinsIn: m(5n), coinsInHigh: m(5n) }), true);
  assert.equal(exactlyAgreed({ agreed: true, nativeIn: 0n, nativeInHigh: 0n, coinsIn: m(5n), coinsInHigh: m(6n) }), false);
  assert.equal(exactlyAgreed({ agreed: true, nativeIn: 7n, nativeInHigh: 8n, coinsIn: m(5n), coinsInHigh: m(5n) }), false);
  assert.equal(exactlyAgreed({ agreed: true, coinsIn: undefined, coinsInHigh: undefined }), false);
  assert.equal(exactlyAgreed({ agreed: false, nativeIn: 0n, nativeInHigh: 0n, coinsIn: m(5n), coinsInHigh: m(5n) }), false);
});
