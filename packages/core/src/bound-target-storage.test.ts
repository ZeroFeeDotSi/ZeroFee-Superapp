// the audit (6 Nov): under a Swap's or a Move's tag, the storage_deposit for the quote's deposit address (a target) has the same
// bounds as the account's own wrap.near step: registration_only true, args exactly { account_id, registration_only },
// attached at most STORAGE_DEPOSIT_MAX_YOCTO (0.01 NEAR, the wallet's cap), once per target in the whole request. Before, any storage_deposit
// for a target passed, at any deposit, with or without registration_only; without it the excess stays as that address's
// storage balance (1Click's). Table: the allowed cases, each bound broken alone (refused), and the controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBoundIntent, PRIVATE_POCKET, targetStorage, type IntentsFacts, type QuoteFacts } from "./intents.ts";
import { NEAR_STORAGE_MAX_YOCTO, STORAGE_DEPOSIT_MAX_YOCTO } from "./near-gate.ts";
import { ProblemError } from "./problem.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";

const ME = "kid.near";
const DEP = `${"0a".repeat(32)}`;
const DEP2 = `${"0c".repeat(32)}`;
const POCKET = `${"0b".repeat(32)}`;
const UNITS = (45n * 10n ** 23n).toString();
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const call = (method: string, args: Record<string, unknown>, depositYocto = 1n): DecodedAction => ({ kind: "call", method, args: enc(args), gas: 10n ** 13n, depositYocto });
const room = (o: { args?: Record<string, unknown>; yocto?: bigint; to?: string } = {}) => call("storage_deposit", o.args ?? { account_id: o.to ?? DEP, registration_only: true }, o.yocto ?? NEAR_STORAGE_MAX_YOCTO);
const wrap = call("near_deposit", {}, BigInt(UNITS));
const pay = call("ft_transfer", { receiver_id: DEP, amount: UNITS });
const tx = (actions: DecodedAction[], receiverId = "wrap.near"): DecodedTx => ({ signerId: ME, publicKey: { type: "ed25519", bytes: new Uint8Array(32) } as never, nonce: 1n, receiverId, blockHash: "11111111111111111111111111111111", actions });
const quote: QuoteFacts = {
  status: "PENDING_DEPOSIT", originAsset: "nep141:wrap.near", amountIn: UNITS, refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS",
  destinationAsset: "nep141:wrap.near", minAmountOut: UNITS, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", deadline: "2999-01-01T00:00:00.000Z", depositType: "ORIGIN_CHAIN",
};
const facts = (): IntentsFacts => ({ codeMatches: true, tokens: new Map(), balances: new Map(), quotes: new Map([[DEP, quote]]), ownWallets: new Map([[POCKET, PRIVATE_POCKET]]) });
const TARGETS = new Set([DEP, DEP2]);
/** One request: its transactions checked in order with one `stored`, as dev-signer does. */
const verdict = (...txs: DecodedTx[]): string => {
  try {
    const stored = new Set<string>();
    return `paid ${txs.reduce((n, t) => n + checkBoundIntent(t, facts(), ME, "move", TARGETS, stored), 0)}`;
  } catch (e) {
    return e instanceof ProblemError ? e.problem.code : String(e);
  }
};
const REFUSED = "security.intent.changed";

test("checkBoundIntent, the deposit address's storage under the move tag: the allowed cases, each bound broken alone refused (audit, 6 Nov)", () => {
  const rows: [string, DecodedTx[], string][] = [
    ["allowed: the deposit address's storage, registration_only, 0.00125 NEAR, then wrap and pay", [tx([room(), wrap, pay])], "paid 1"],
    ["allowed: less than the bound attached", [tx([room({ yocto: NEAR_STORAGE_MAX_YOCTO - 1n }), wrap, pay])], "paid 1"],
    ["allowed: on a coin contract, its own transaction, then the payment (convert.ts near-ledger: registerOn, then the pay)", [tx([room()], "usdt.tether-token.near"), tx([pay], "usdt.tether-token.near")], "paid 1"],
    ["allowed: with the account's own wrap.near storage too (ownWrapStorage)", [tx([call("storage_deposit", { account_id: ME, registration_only: true }, NEAR_STORAGE_MAX_YOCTO), room(), wrap, pay])], "paid 1"],
    ["control: two targets, each once (once per target, not once per transaction)", [tx([room(), room({ to: DEP2 }), wrap, pay])], "paid 1"],
    ["control: no storage step at all (the address already set up)", [tx([wrap, pay])], "paid 1"],
    ["refused: registration_only missing", [tx([room({ args: { account_id: DEP } }), wrap, pay])], REFUSED],
    ["refused: registration_only false", [tx([room({ args: { account_id: DEP, registration_only: false } }), wrap, pay])], REFUSED],
    ["refused: registration_only \"true\" (a string)", [tx([room({ args: { account_id: DEP, registration_only: "true" } }), wrap, pay])], REFUSED],
    ["refused: another key beside the two", [tx([room({ args: { account_id: DEP, registration_only: true, msg: "x" } }), wrap, pay])], REFUSED],
    // the audit (6 Nov): the cap is the wallet's own 0.01 NEAR (a coin whose storage min is over wrap.near's is no "changed")
    ["allowed: a coin whose min is between 0.00125 and 0.01 NEAR", [tx([room({ yocto: NEAR_STORAGE_MAX_YOCTO + 1n }), wrap, pay])], "paid 1"],
    ["allowed: 0.01 NEAR, the wallet's cap", [tx([room({ yocto: STORAGE_DEPOSIT_MAX_YOCTO }), wrap, pay])], "paid 1"],
    ["refused: one yocto over the 0.01 NEAR cap", [tx([room({ yocto: STORAGE_DEPOSIT_MAX_YOCTO + 1n }), wrap, pay])], REFUSED],
    ["refused: a second one for the same target, same transaction", [tx([room(), room(), wrap, pay])], REFUSED],
    ["refused: a second one for the same target, in the request's next transaction", [tx([room()], "usdt.tether-token.near"), tx([room(), pay], "usdt.tether-token.near")], REFUSED],
    ["control: on intents.near, refused (as before)", [tx([room(), call("mt_transfer", { receiver_id: DEP, token_id: "nep141:wrap.near", amount: UNITS })], "intents.near")], REFUSED],
    ["control: storage for an address that is no target, refused (as before)", [tx([room({ to: "someone-else.near" }), wrap, pay])], REFUSED],
  ];
  for (const [name, txs, want] of rows) assert.equal(verdict(...txs), want, name);
});

test("targetStorage: ok only for a target, exactly; none for any other account or method", () => {
  const rows: [string, string, DecodedAction, string][] = [
    ["the rule", "wrap.near", room(), "ok"],
    ["the rule, on a coin contract", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", room(), "ok"],
    ["the account itself: not this rule's (ownWrapStorage decides)", "wrap.near", call("storage_deposit", { account_id: ME, registration_only: true }, NEAR_STORAGE_MAX_YOCTO), "none"],
    ["not a target", "wrap.near", room({ to: "someone-else.near" }), "none"],
    ["not a storage_deposit", "wrap.near", wrap, "none"],
    ["over the 0.01 NEAR bound (audit, 6 Nov)", "wrap.near", room({ yocto: STORAGE_DEPOSIT_MAX_YOCTO + 1n }), "bad"],
    ["over wrap.near's 0.00125 but under 0.01: a coin's own min", "wrap.near", room({ yocto: NEAR_STORAGE_MAX_YOCTO + 1n }), "ok"],
    ["on intents.near", "intents.near", room(), "bad"],
    ["registration_only missing", "wrap.near", room({ args: { account_id: DEP } }), "bad"],
    ["another key", "wrap.near", room({ args: { account_id: DEP, registration_only: true, extra: 1 } }), "bad"],
  ];
  const argsOf = (a: DecodedAction) => (a.kind === "call" ? JSON.parse(new TextDecoder().decode(a.args)) : null);
  for (const [name, receiver, a, want] of rows) assert.equal(targetStorage(receiver, a, argsOf(a), new Set([DEP])), want, name);
});
