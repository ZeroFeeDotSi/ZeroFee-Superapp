// Which chain an address is on (D55: "send money to <address>" finds the chain). Every check is a checksum or a decoded
// length (addresses.ts), never a pattern alone; when the text fits several chains the person picks, never us.
//
//   0x + 40 hex        EVM (EIP-55 when mixed case): any of Wallet's EVM networks, so the network must be said ("on
//                      base", base:0x… (EIP-3770), ethereum:0x…@8453 (ERC-681)) or picked. NEAR's eth-implicit account
//                      (NEP-518) is the same string: NEAR only when the person says "on near".
//   64 lower-case hex  a NEAR implicit account          name.near, x.tg   a NEAR named account (a dot, NEAR's rule)
//   base58, 32 bytes   Solana                           bc1…, 1…, 3…      Bitcoin (bech32/bech32m, Base58Check)
//   t1…, t3…           Zcash (transparent)              4…, 8… (95/106)   Monero (its base58, Keccak checksum)
// Bitcoin, Zcash and Monero are recognised so the person hears the right chain, but Wallet's Send can't pay out there
// yet (send-reach.ts): the app says so in one line.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { EVM_CHAINS, nearAccountKind, validEvmAddress, validReceiveAddress, validSolanaAddress } from "@zerofee/wallet/addresses.ts";
import { CHAINS, chainByEvmId, chainName as payChainName } from "@zerofee/pay/chains";

export type Detected =
  /** One chain, settled: by the address itself or by what the person said. */
  | { kind: "one"; chain: string; address: string }
  /** An EVM address with no network said: the candidates, for the picker. */
  | { kind: "evm"; chains: string[]; address: string };

export type NotAddress = { reason: string };

/** Network words a person types after "on" (and EIP-3770's short names), to Wallet's chain ids. */
const WORDS: Record<string, string> = {
  near: "near", solana: "sol", sol: "sol", bitcoin: "btc", btc: "btc", zcash: "zec", zec: "zec", monero: "xmr", xmr: "xmr",
  ethereum: "eth", eth: "eth", mainnet: "eth", base: "base", arbitrum: "arb", arb: "arb", arb1: "arb", optimism: "op", op: "op", oeth: "op",
  polygon: "pol", pol: "pol", matic: "pol", bnb: "bsc", bsc: "bsc", "bnb chain": "bsc", "bnb smart chain": "bsc", binance: "bsc",
  gnosis: "gnosis", gno: "gnosis", xdai: "gnosis", avalanche: "avax", avax: "avax", scroll: "scroll", scr: "scroll", monad: "monad",
  berachain: "bera", bera: "bera", "x layer": "xlayer", xlayer: "xlayer", plasma: "plasma",
  // D111: Robinhood Chain (an EVM chain, Home's "ETH on Robinhood" row), so a request or a Tip can name it
  robinhood: "hood", "robinhood chain": "hood", hood: "hood",
};

/** "on Base", "BNB Chain", "arb1" → the chain id; null for a word that names no chain we know. */
export function chainFromWords(words: string): string | null {
  return WORDS[words.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** A chain's name as people read it ("Base", "BNB Chain", "Monero"). */
export function chainName(id: string): string {
  return payChainName(id);
}

const isEvm = (c: string) => EVM_CHAINS.has(c);
// home/words (3 Nov): Robinhood Chain is among a bare 0x address's networks too, last, once (Pay's list has it now). It is
// offered, never guessed: evmChoices never picks it by itself (review M1: never sent there unasked)
const EVM_IDS = [...CHAINS.filter((c) => c.kind === "evm" && EVM_CHAINS.has(c.id) && c.id !== "hood").map((c) => c.id), "hood"];

// Monero: its own base58 (8-byte blocks as 11 characters, the last block shorter), network byte, Keccak-256 checksum.
const XMR58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const XMR_BLOCK = [0, -1, 1, 2, -1, 3, 4, 5, -1, 6, 7, 8]; // encoded length → decoded bytes
function moneroBytes(s: string): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 11) {
    const block = s.slice(i, i + 11);
    const size = XMR_BLOCK[block.length];
    if (size === undefined || size < 0) return null;
    let n = 0n;
    for (const c of block) {
      const v = XMR58.indexOf(c);
      if (v < 0) return null;
      n = n * 58n + BigInt(v);
    }
    if (n >> BigInt(8 * size)) return null;
    for (let b = size - 1; b >= 0; b--) out.push(Number((n >> BigInt(8 * b)) & 0xffn));
  }
  return Uint8Array.from(out);
}
/** A Monero main-network address: standard (0x12), subaddress (0x2a) or integrated (0x13), checksum checked. */
export function validMoneroAddress(s: string): boolean {
  if (!/^[48][1-9A-HJ-NP-Za-km-z]{94}$|^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(s)) return false;
  const b = moneroBytes(s);
  if (!b || (b.length !== 69 && b.length !== 77)) return false;
  const net = b[0];
  if (!((b.length === 69 && (net === 0x12 || net === 0x2a)) || (b.length === 77 && net === 0x13))) return false;
  const sum = keccak_256(b.subarray(0, b.length - 4));
  return b.subarray(b.length - 4).every((x, i) => x === sum[i]);
}

/** Which chains the address alone could be on (checked), apart from EVM's network question and NEAR's names. */
function chainsOf(a: string): string[] {
  const found: string[] = [];
  if (validEvmAddress(a)) found.push(...EVM_IDS);
  const near = nearAccountKind(a);
  if (near === "implicit" || near === "named") found.push("near");
  if (validSolanaAddress(a)) found.push("sol");
  if (validReceiveAddress("btc", a)) found.push("btc");
  if (validReceiveAddress("zec", a)) found.push("zec");
  if (validMoneroAddress(a)) found.push("xmr");
  return found;
}

const no = (reason: string): { problem: NotAddress } => ({ problem: { reason } });

/**
 * The chain of one address as typed, with the network the person named (`onWords`, from "… on <words>"), if any.
 * Also reads EIP-3770 (`base:0x…`), ERC-681 (`ethereum:0x…@8453`), `solana:<address>` and `near:<account>`.
 */
export function detect(raw: string, onWords?: string): { ok: Detected } | { problem: NotAddress } {
  let text = raw.trim();
  let said: string | null = null;
  if (onWords !== undefined) {
    said = chainFromWords(onWords);
    if (!said) return no(`ZeroFee doesn't know a network called "${onWords.trim()}".`);
  }
  // ERC-681: ethereum:<address>[@chainId][/…]; only a plain address target, never a function call.
  const erc681 = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?$/i.exec(text);
  const prefixed = /^([a-z][a-z0-9-]{1,15}):(\S+)$/i.exec(text);
  if (erc681) {
    const c = chainByEvmId(Number(erc681[2] ?? "1"))?.id;
    if (!c || !isEvm(c)) return no("That link names a network ZeroFee can't send on.");
    if (said && said !== c) return no(`That link is for ${chainName(c)}, not ${chainName(said)}.`);
    said = c;
    text = erc681[1]!;
  } else if (/^ethereum:/i.test(text)) {
    return no("That link asks for more than a payment to an address.");
  } else if (prefixed) {
    const c = prefixed[1]!.toLowerCase() === "solana" ? "sol" : chainFromWords(prefixed[1]!);
    if (!c) return no(`ZeroFee doesn't know a network called "${prefixed[1]}".`);
    if (said && said !== c) return no(`That address says ${chainName(c)}, not ${chainName(said)}.`);
    said = c;
    text = prefixed[2]!;
  }
  if (/\s/.test(text) || !text) return no("That isn't one address.");

  // ENS names (vitalik.eth) read like NEAR names: refused unless the person said NEAR.
  if (/\.eth$/i.test(text) && said !== "near") return no("ZeroFee can't pay a .eth address yet. Paste the 0x address instead.");

  // NEAR, said: a named or implicit account, or an eth-implicit one (0x… is the same account in lower case).
  if (said === "near") {
    // A mixed-case 0x must pass EIP-55 like anywhere else (security review 2 Nov, Low): lower-casing it first would let
    // a typo through as some other eth-implicit account.
    if (/^0x[0-9a-fA-F]{40}$/.test(text) && !validEvmAddress(text)) return no("That 0x address looks mistyped: its capital letters don't match. Copy it again.");
    if (validEvmAddress(text)) return { ok: { kind: "one", chain: "near", address: text.toLowerCase() } };
    const lower = text.toLowerCase();
    if (nearAccountKind(lower)) return { ok: { kind: "one", chain: "near", address: lower } };
    return no("That isn't a NEAR account.");
  }

  // Robinhood Chain (D111, C-4), said ("on Robinhood", a request's own words): settled. Unsaid, a bare 0x address lists it
  // among its networks, and the person picks it (evmChoices never picks it alone: review M1).
  if (said === "hood") return validEvmAddress(text) ? { ok: { kind: "one", chain: "hood", address: text } } : no(`That isn't a ${chainName(said)} address.`);

  const chains = chainsOf(text);
  if (chains.length === 0) {
    if (/^0x[0-9a-fA-F]{40}$/.test(text)) return no("That 0x address looks mistyped: its capital letters don't match. Copy it again.");
    if (/^[0-9a-fA-F]{64}$/.test(text)) return no("NEAR accounts are lower case. Check the address.");
    return no("That isn't an address ZeroFee knows.");
  }
  if (said) {
    if (!chains.includes(said)) return no(`That isn't a ${chainName(said)} address.`);
    return { ok: { kind: "one", chain: said, address: text } };
  }
  if (chains.every(isEvm)) return chains.length === 1 ? { ok: { kind: "one", chain: chains[0]!, address: text } } : { ok: { kind: "evm", chains, address: text } };
  // Not EVM: the checks never overlap (a Solana key is 32 bytes, a Bitcoin payload 21 with its checksum, …).
  if (chains.length !== 1) return no("That address fits more than one network. Say which: add \"on <network>\".");
  return { ok: { kind: "one", chain: chains[0]!, address: text } };
}

/**
 * The EVM networks to offer for an address with no network said: only those where the person holds `coin` (any coin
 * when none is named). Picks nothing when there is more than one; the one, when there is exactly one.
 */
export function evmChoices(candidates: readonly string[], balances: readonly { chain: string; symbol: string; amount: string; listed?: boolean }[], coin?: string): { chains: string[]; picked: string | null } {
  const held = new Set(balances.filter((b) => b.listed !== false && Number(b.amount) > 0 && (!coin || b.symbol.toUpperCase() === coin.toUpperCase())).map((b) => b.chain));
  // Robinhood Chain (ETH) is always offered for ETH or no coin named: its ETH is in your ETH (RH) wallet, not the Safe these
  // balances read; and offered only, so with it in the list nothing is picked unasked (review M1)
  const hood = candidates.includes("hood") && (!coin || coin.toUpperCase() === "ETH");
  const chains = candidates.filter((c) => held.has(c) || (c === "hood" && hood));
  return { chains, picked: chains.length === 1 && chains[0] !== "hood" ? chains[0]! : null };
}
