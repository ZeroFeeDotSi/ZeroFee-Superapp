import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { EURE, GNOSIS_PAY, RpcGnosis, checkGnosisPayAccount, readCardBalance } from "./gnosis-pay.ts";
import type { GnosisReader } from "./gnosis-pay.ts";

const SAFE = "0x6ffb4efabb44261dfd5732e146d85b6e83f3a4e2";  // generated sample
const DELAY = "0xff97ed94c389a2ec58f77f4593691d08a162549f";  // generated sample
const ROLES = "0x9bcc7736fabad9a5bf763b4a4d1aa85872207c2b";  // generated sample
const word = (a: string | bigint) => (typeof a === "bigint" ? a.toString(16) : a.slice(2)).padStart(64, "0");
const minimal = (impl: string) => `0x363d3d373d3d3d363d73${impl.slice(2)}5af43d82803e903d91602b57fd5bf3`;

const CODE = "0x6080";
/** The real pins, except the proxy's code hash: the fake Safe's code here is a stand-in. */
const PINS = { ...GNOSIS_PAY, proxyCodeHash: `0x${Buffer.from(keccak_256(Buffer.from(CODE.slice(2), "hex"))).toString("hex")}` };

function chain(over: { owners?: string[]; impls?: string[]; code?: string; avatar?: string } = {}): GnosisReader {
  const impls = over.impls ?? [GNOSIS_PAY.delayModule, GNOSIS_PAY.rolesModule];
  const owners = over.owners ?? [GNOSIS_PAY.owner];
  return {
    async read(method, params: any[]) {
      if (method === "eth_chainId") return "0x64";
      if (method === "eth_getCode") return params[0] === SAFE ? (over.code ?? CODE) : params[0] === DELAY ? minimal(impls[0]) : params[0] === ROLES ? minimal(impls[1]) : "0x";
      if (method === "eth_getStorageAt") return `0x${word(GNOSIS_PAY.singleton)}`;
      const { to, data } = params[0];
      if (to === SAFE && data === "0xa0e67e2b") return `0x${word(32n)}${word(BigInt(owners.length))}${owners.map(word).join("")}`;
      if (to === SAFE && data === "0xe75235b8") return `0x${word(1n)}`;
      if (to === SAFE && data.startsWith("0xcc2f8452")) return `0x${word(64n)}${word(1n)}${word(2n)}${word(DELAY)}${word(ROLES)}`;
      if ((to === DELAY || to === ROLES) && (data === "0x5aef7de6" || data === "0xd4b83992")) return `0x${word(over.avatar ?? SAFE)}`;
      throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
    },
  };
}

test("a Safe set up the Gnosis Pay way is a card account; anything else says why not", async () => {
  assert.deepEqual(await checkGnosisPayAccount(SAFE, chain(), PINS), { isCard: true });
  assert.match((await checkGnosisPayAccount("0x00000000000000000000000000000000000000aa", chain(), PINS)).why!, /^This is an ordinary wallet address/);
  assert.equal((await checkGnosisPayAccount(SAFE, chain({ owners: ["0x00000000000000000000000000000000000000bb"] }), PINS)).isCard, false, "a real owner: not Gnosis Pay's setup");
  assert.equal((await checkGnosisPayAccount(SAFE, chain({ impls: [GNOSIS_PAY.delayModule, "0x00000000000000000000000000000000000000cc"] }), PINS)).isCard, false, "another module");
  assert.equal((await checkGnosisPayAccount(SAFE, chain({ avatar: "0x00000000000000000000000000000000000000dd" }), PINS)).isCard, false, "modules guarding another Safe");
  assert.deepEqual(await checkGnosisPayAccount(SAFE, chain({ code: "0x6081" }), PINS), { isCard: false, why: "This address isn't a Gnosis Pay account." });
  assert.match((await checkGnosisPayAccount("not an address", chain(), PINS)).why!, /isn't a Gnosis Chain address/);
});

test("card.balance reads the card's EURe from the coin, exactly, on Gnosis Chain only", async () => {
  const CARD = "0x2527000000000000000000000000000000000f10";
  const asked: unknown[] = [];
  const reader = (chainId: string, balance: bigint): GnosisReader => ({
    async read(method, params) {
      if (method === "eth_chainId") return chainId;
      asked.push(params[0]);
      return `0x${word(balance)}`;
    },
  });
  const got = await readCardBalance(CARD.toUpperCase().replace("0X", "0x"), reader("0x64", 248_500_000_000_000_000_001n), Date.UTC(2026, 9, 26, 12));
  assert.deepEqual(got, { amount: "248.500000000000000001", symbol: "EURe", readAtIso: "2026-10-26T12:00:00.000Z" });
  assert.deepEqual(asked[0], { to: EURE.token, data: `0x70a08231${word(CARD)}` }, "balanceOf(card) on the EURe coin");
  assert.equal((await readCardBalance(CARD, reader("0x64", 0n))).amount, "0");
  assert.equal((await readCardBalance(CARD, reader("0x64", 5n * 10n ** 18n))).amount, "5");
  await assert.rejects(readCardBalance(CARD, reader("0x1", 1n)), (e: any) => e.problem.code === "security.nodes.unreachable", "another chain's nodes");
  await assert.rejects(readCardBalance("0x12", reader("0x64", 1n)), (e: any) => e.problem.code === "security.request.invalid");
});

test("card.balance stops when the two nodes disagree", async () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body);
    const result = method === "eth_chainId" ? "0x64" : `0x${word(BigInt(++n))}`;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  try {
    await assert.rejects(readCardBalance("0x2527000000000000000000000000000000000f10", new RpcGnosis()), (e: any) => e.problem.code === "security.nodes.disagree");
  } finally {
    globalThis.fetch = realFetch;
  }
});
