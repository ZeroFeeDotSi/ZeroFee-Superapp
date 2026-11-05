// Audit property (money paths, fork EVM, 28 Oct, at 18ad8d6; kept here, FIXED): the core signs a swap (D143: with no
// sheet, ever) only if what it brings back is paid to this wallet. Random venues x payees x amounts, built with Trade's
// own encoders, read by the core's decoder and judged by evmSessionRefusal (pure). It failed for payee address(2)
// (EVM-2); now every other payee is refused, and a KyberSwap route whose executor ZeroFee doesn't know is never signed (EVM-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { evmSessionRefusal, unsignedEvmTx } from "./evm.ts";
import { decodeEvmTx } from "./evm/decode.ts";
import { buildClassicCall } from "../../trade/src/evm/classic.ts";
import { fourBuyWithEthData, ponsBuyData, ponsSellData } from "../../trade/src/evm/launchpads.ts";
import { encodeCall } from "../../trade/src/evm/abi.ts";
import { SWAP } from "../../trade/src/evm/kyber.ts";

const WALLET = "0x1111111111111111111111111111111111111111";
const COIN = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const KYBER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const KN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const HELPER3 = "0xf251f83e40a78868fcfa3fa4599dad6494e46034";
const CURVE = "0x00000000000000000000000000000000000c0e5e";
const PAYEES = [WALLET, "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "0x2222222222222222222222222222222222222222"];

let seed = 0x5eed;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;

type Built = { chain: "bsc" | "hood"; to: string; value: bigint; data: string; coin?: string; pons?: boolean };
const venues: Record<string, (payee: string, amt: bigint, min: bigint) => Built> = {
  "pancake v2 buy": (p, a, m) => ({ chain: "bsc", ...buildClassicCall("bsc", { kind: "v2", address: "0x01", fee: 0, router: "0x10ed43c718714eb63d5aa57b78b54704e256024e", name: "v2" }, COIN, true, p, a, m, 2_000_000_000) }),
  "pancake v2 sell": (p, a, m) => ({ chain: "bsc", ...buildClassicCall("bsc", { kind: "v2", address: "0x01", fee: 0, router: "0x10ed43c718714eb63d5aa57b78b54704e256024e", name: "v2" }, COIN, false, p, a, m, 2_000_000_000) }),
  "pancake v3 buy": (p, a, m) => ({ chain: "bsc", ...buildClassicCall("bsc", { kind: "v3", address: "0x01", fee: 2500, router: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4", name: "v3" }, COIN, true, p, a, m, 2_000_000_000) }),
  "pancake v3 sell": (p, a, m) => ({ chain: "bsc", ...buildClassicCall("bsc", { kind: "v3", address: "0x01", fee: 2500, router: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4", name: "v3" }, COIN, false, p, a, m, 2_000_000_000) }),
  "kyber buy": (p, a, m) => ({ chain: "bsc", to: KYBER, value: a, data: encodeCall(SWAP, [[KYBER, KYBER, "0x", [KN, COIN, [], [], [], [], p, a, m, 0n, "0x"], "0x"]]) }),
  "kyber sell": (p, a, m) => ({ chain: "bsc", to: KYBER, value: 0n, data: encodeCall(SWAP, [[KYBER, KYBER, "0x", [COIN, KN, [KYBER], [a], [], [], p, a, m, 0n, "0x"], "0x"]]) }),
  "four.meme Helper3 buy": (p, a, m) => ({ chain: "bsc", to: HELPER3, value: a, data: fourBuyWithEthData(COIN, p, a, m) }),
  "Pons buy": (p, a, m) => ({ chain: "hood", to: CURVE, value: a, data: ponsBuyData(a, m, p), coin: COIN, pons: true }),
  "Pons sell": (p, a, m) => ({ chain: "hood", to: CURVE, value: 0n, data: ponsSellData(a, m, p), coin: COIN, pons: true }),
};

test("PROPERTY: the core never signs a swap that pays out to anyone but this wallet (random venue x payee x amount, 2,000 runs)", () => {
  const bad = new Set<string>();
  for (let i = 0; i < 2_000; i++) {
    const name = pick(Object.keys(venues)), payee = pick(PAYEES);
    const amt = BigInt(1 + Math.floor(rnd() * 1e9)) * 10n ** 9n, min = 1n + BigInt(Math.floor(rnd() * 1e6));
    const b = venues[name]!(payee, amt, min);
    const tx = unsignedEvmTx({ chainId: b.chain === "bsc" ? 56 : 4663, nonce: 0, tip: 1n, fee: 2n, gas: 300_000n, to: b.to, value: b.value, data: b.data });
    const d = decodeEvmTx(tx, b.coin ? { coin: b.coin } : {});
    // The v3 venues' pool (2500) is the coin's deepest here: this property is about the payee alone.
    const refusal = evmSessionRefusal(d, WALLET, b.chain, { balances: new Map(), ponsCurve: b.pons ? CURVE : null, v3Deepest: 2500 }, 1_800_000_000);
    const covered = refusal === null;
    // KyberSwap's executor here is the router itself, not the executor ZeroFee knows (audit EVM-1): always refused.
    if (payee === WALLET && name.startsWith("kyber")) assert.equal(refusal, "It goes through an app ZeroFee doesn't know.", name);
    else if (payee === WALLET) assert.equal(refusal, null, `${name} to the wallet should be signable: ${refusal}`);
    else if (covered) bad.add(`${name} -> ${payee}`);
  }
  assert.deepEqual([...bad].sort(), [], "signable although they pay someone else");
});
