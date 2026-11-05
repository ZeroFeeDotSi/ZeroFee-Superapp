// Uniswap v4 pools with hooks (coverage audit gap 4; the review's ruling, 4 Nov). A v4 pool's hook runs its own code on
// every swap, so a no-sheet trade through one is allowed only when ALL hold:
//   (a) the hook is on this list, pinned by its sha256 (V4_HOOKS_SHA256), each address with where it was read;
//   (b) its code can't change: on two nodes at the test run's block its code hashes to the pinned codehash, its EIP-1967
//       implementation / beacon / admin slots are empty, and the code itself has no SELFDESTRUCT, DELEGATECALL or
//       CALLCODE (hookCodeRefusal, the compiler's metadata skipped);
//   (c) the two nodes' test runs agree exactly, pay only this wallet at least the floor, move no other coin of the
//       wallet, and pass the 85 % reference band (subwallets.ts tradeRefusal);
//   (d) inside the one cap like every no-sheet trade; past it, the one-tap sheet, never Face ID (D143).
// A change to this list is a reviewed commit with its reads, never a fetch at run time.
// Residual risk, accepted (a code review, 4 Nov): a pinned hook may CALL another contract that is itself
// upgradeable, so what the hook does can change while its own codehash stays the pinned one. Accepted because every
// trade through it is still held to the exact two-node test run, the floor, the coin check, the 85 % reference band and
// the one cap: a changed callee can make a trade refused or asked, never paid out silently past those.
// Base (Zora, Clanker on Base) stays out until Base is a chain the core trades on.
import type { EvmChainName } from "./decode.ts";

export interface PinnedHook {
  /** The launchpad whose pools use it. */
  launchpad: string;
  /** keccak256 of the hook's runtime code, read on two nodes (the same answer on both). */
  codehash: string;
  /** Where the address was read: the pools' Initialize logs and the contract that made them. */
  source: string;
}

/**
 * Robinhood Chain, read 4 Nov 2026 at block 105,247,797 on rpc.mainnet.chain.robinhood.com and robinhood.drpc.org (both
 * the same code). Each hook is what the launchpad's own pools were made with: the hooks field of the pool's Initialize log
 * on Uniswap v4's PoolManager 0x8366a39cc670b4001a1121b8f6a443a643e40951, and the contract each Initialize transaction
 * called. GeckoTerminal lists these pools under the launchpad's name ("frontier-fun", "clanker-robinhood").
 * BNB Chain: none yet. Base (Zora, Clanker on Base): not a chain this core trades on yet.
 */
export const V4_HOOKS: Readonly<Record<EvmChainName, Readonly<Record<string, PinnedHook>>>> = Object.freeze({
  bsc: Object.freeze({}),
  hood: Object.freeze({
    "0xee588bcf2bd3e658f5160489f4199d1851bbf0cc": Object.freeze({
      launchpad: "frontier-fun",
      codehash: "0xd42637625bef18b3977d0e90bab2ffa4940ae4a61fbfb21776b23938f2edeee4",
      source: "FOREVER's pool 0x5132006c…2edb0 (Initialize tx 0xbdb45ef5…85575aa4, block 100,955,790, made through 0xa3308c0b…d4e1eef8) and OUTLAW's pool 0x8103691a…a2299eb (tx 0x60956158…128f50, block 59,385,678, through 0xe3a826c0…5c0c17a5): both pools' hooks",
    }),
    "0x48b8f6ad3a1b4aa477314c9a23035b8f84dde8cc": Object.freeze({
      launchpad: "Clanker",
      codehash: "0x0883056c4856f8fe464ff49f9c1c028455459dad8ceddcc6d5159259fe51e07f",
      source: "0xZAPS's pool 0xb040f18a…87c01573 (Initialize tx 0x2e706273…bf32cb05, block 15,636,414) and SHINTAI's pool 0x18d684cd…d9b2b2 (tx 0xe1a4d308…740403b, block 105,044,677), both made through Clanker's factory 0xd3f2cc1731b7fd17f28798835c2e02f0a1839a94: both pools' hooks",
    }),
  }),
});

/** sha256 of every pinned hook, one line each, "chain|hook|launchpad|codehash", sorted. */
export const V4_HOOKS_SHA256 = "e738ff43cd958a26452e708d457b2574795c7fd3e1650a44530718fe5dfb1eab";

/** The EIP-1967 slots a proxy keeps its implementation, beacon and admin in: any of them set, the code can change. */
export const PROXY_SLOTS = [
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
] as const;

/**
 * Why a hook's runtime code could change what it does, or null. SELFDESTRUCT, DELEGATECALL and CALLCODE anywhere in the
 * executable part refuse it (a delegatecall's target could be read from storage; one that can't be ruled out is refused).
 * PUSH data is skipped, and so is the compiler's metadata at the end (CBOR, its length in the last two bytes), where these
 * bytes appear as data, never as code.
 */
export function hookCodeRefusal(code: Uint8Array): string | null {
  if (code.length === 0) return "it has no code";
  let end = code.length;
  if (code.length >= 2) {
    const meta = (code[code.length - 2]! << 8) | code[code.length - 1]!;
    const start = code.length - 2 - meta;
    // CBOR map with 1 to 4 entries ("ipfs", "solc", "bzzr0", "experimental") right after the code
    if (meta > 0 && start > 0 && code[start]! >= 0xa1 && code[start]! <= 0xa4) end = start;
  }
  for (let i = 0; i < end; i++) {
    const op = code[i]!;
    if (op >= 0x60 && op <= 0x7f) { i += op - 0x5f; continue; }
    if (op === 0xff) return "it can destroy itself";
    if (op === 0xf4 || op === 0xf2) return "it can run other code as itself";
  }
  return null;
}

/** The pin over the list: sha256 of its lines (chain|hook|launchpad|codehash), sorted, joined with "\n". */
export function hooksLines(list: typeof V4_HOOKS = V4_HOOKS): string {
  return Object.entries(list).flatMap(([chain, hooks]) => Object.entries(hooks).map(([h, p]) => `${chain}|${h}|${p.launchpad}|${p.codehash}`)).sort().join("\n");
}
