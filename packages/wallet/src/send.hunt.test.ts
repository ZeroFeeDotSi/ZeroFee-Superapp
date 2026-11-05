// Core hunt 5 Nov (QA): a payee that is the sender's own account. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSend } from "./send.ts";
import { NATIVE_NEAR, type Catalogue } from "./catalogue.ts";
import { walletProblems } from "./wallet-problems.ts";

const ME = "alice.near";
const USDC = "nep141:usdc.near";
const cat = { coin: (id: string) => (id === USDC ? { tokenId: USDC, symbol: "USDC", decimals: 6, route: "near", chain: "near", priceUsd: "1" } : undefined), network: () => ({ name: "NEAR" }) } as unknown as Catalogue;
const self = walletProblems.recipientSelf().code;
const codeOf = (f: () => unknown): string => { try { f(); return "no throw"; } catch (e) { return (e as { problem?: { code?: string } }).problem?.code ?? String(e); } };
const input = (tokenId: string, to: unknown, ledger: bigint) => ({ cat, me: ME, tokenId, amount: "1", to, held: { ledger, account: 0n }, nearSpendable: 10n ** 25n, why: () => "" }) as never;

test("control: NEAR to the sender's own account, and a coin into the sender's own Intents balance, are refused as self-sends", () => {
  assert.equal(codeOf(() => planSend(input(NATIVE_NEAR, { kind: "chain", chain: "near", address: ME }, 0n))), self);
  assert.equal(codeOf(() => planSend(input(USDC, { kind: "ledger", accountId: ME }, 10_000_000n))), self);
});

test("send.ts (was core hunt BUG 131-134): a coin in NEAR Intents, or on the account, sent to the sender's own NEAR account is refused as a self-send, as NEAR is", () => {
  const got = codeOf(() => planSend(input(USDC, { kind: "chain", chain: "near", address: ME }, 10_000_000n)));
  assert.equal(got, self, `got ${got}`);
  // from the account too (an ft_transfer to oneself)
  const fromAccount = { ...(input(USDC, { kind: "chain", chain: "near", address: ME }, 0n) as object), held: { ledger: 0n, account: 10_000_000n } } as never;
  assert.equal(codeOf(() => planSend(fromAccount)), self);
});

test("control: the same coin to someone else's NEAR account is still planned, from the ledger or the account", () => {
  const ledger = planSend(input(USDC, { kind: "chain", chain: "near", address: "bob.near" }, 10_000_000n));
  assert.equal(ledger.steps.length, 1);
  const fromAccount = { ...(input(USDC, { kind: "chain", chain: "near", address: "bob.near" }, 0n) as object), held: { ledger: 0n, account: 10_000_000n } } as never;
  assert.equal(planSend(fromAccount).steps.length, 1);
});
