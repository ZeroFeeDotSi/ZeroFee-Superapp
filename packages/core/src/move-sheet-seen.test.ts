// QA's MUST (7 Nov, privacy honesty on the signing sheet): the Safe's leg 1 is a public NEAR tx every time the
// Safe signs, so "Anyone can see the Safe's part." is on every Move fill's sheet, whatever stays in Private. With nothing
// staying, the public figure is what the wallets get: the most revealing case, never the one the line drops. Fails on
// deb6c02f3: moveSheet's `seen: stays > 0n` with intents.ts legsBlock dropped the line when nothing stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS, PRIVATE_POCKET, TRADING_BALANCE } from "./intents.ts";
import type { PrivateLegRecord } from "./private-route.ts";
import type { TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const POCKET = "a1".repeat(32), SOLW = "So1aWa11et1111111111111111111111111111111111", FLOAT = "f1oat.near";
const SEEN = "Anyone can see the Safe's part.";
const u = (usd: number) => String(Math.round(usd * 100) * 10_000);

/** The real core's sheet (DevSigner.describe) for a Move's one fill of `safeUsd`, its parts as the core's plan keeps them. */
async function sheet(safeUsd: number, parts: { to: string; privUsd: number; payUsd: number }[]) {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: ({ token_id }) => (token_id === `nep141:${USDC}` ? "900000000" : "0") });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const step = u(safeUsd);
  const quote = { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
    quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${USDC}`, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", depositType: "ORIGIN_CHAIN", deadline: soon },
    quote: { depositAddress: DEPOSIT, amountIn: step, minAmountOut: step, amountOut: step, deadline: soon },
  }) };
  const move = parts.map((p) => ({ recipient: p.to, own: true, units: u(p.privUsd), payUnits: u(p.payUsd), toTokenId: `nep141:${USDC}` }));
  const leg: PrivateLegRecord = { tokenId: `nep141:${USDC}`, payUnits: u(parts[0]!.payUsd), recipient: parts[0]!.to, own: true, move } as PrivateLegRecord;
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async () => true, oneClick: async (a) => (a === DEPOSIT ? quote : null), quoteKey: TEST_QUOTE_KEY, privateLeg: async () => leg, ownWallets: async () => new Map([[POCKET, PRIVATE_POCKET], [SOLW, "your SOL wallet"], [FLOAT, TRADING_BALANCE]]) });
  return signer.describe({ receiverId: "intents.near", actions: [{ kind: "call", method: "ft_withdraw", args: { token: USDC, receiver_id: DEPOSIT, amount: step }, depositYocto: "1", gas: "30000000000000" }], why: "", from: "wallet", moveFill: true } as TxRequest);
}

test("the audit's MUST: nothing stays in Private, the Safe still signs a public leg: the quiet line still shows; Stays shows only above $0 (QA's layout)", async () => {
  const rows: [string, number, { to: string; privUsd: number; payUsd: number }[], boolean][] = [
    ["nothing stays, one wallet: the Safe's $40.00 is what the SOL wallet gets", 40, [{ to: SOLW, privUsd: 0, payUsd: 40 }], false],
    ["nothing stays, two wallets", 150, [{ to: SOLW, privUsd: 0, payUsd: 140 }, { to: FLOAT, privUsd: 8.39, payUsd: 10 }], false],
    ["control: something stays", 150, [{ to: SOLW, privUsd: 0, payUsd: 101.48 }, { to: FLOAT, privUsd: 8.39, payUsd: 0 }], true],
  ];
  for (const [name, safe, parts, stays] of rows) {
    const w = await sheet(safe, parts);
    const all = w.lines.join(" | ");
    assert.ok(w.lines.includes(SEEN), `${name}: ${all}`);
    assert.equal(w.lines.some((l) => l.startsWith("Private keeps the rest · ")), stays, `${name}: ${all}`);
    // the line sits right under the rows, once; the copy review's Face ID line (B21), when some part sends on its own, comes between
    assert.equal(w.lines.filter((l) => l === SEEN).length, 1, name);
    const at = w.lines.indexOf(SEEN), above = w.lines[at - 1]!;
    const hot = /^(Face ID approves the Safe's part\.|No Face ID\.) /.test(above);
    assert.equal((hot ? w.lines[at - 2]! : above).includes(" · "), true, `${name}: ${all}`);
  }
});
