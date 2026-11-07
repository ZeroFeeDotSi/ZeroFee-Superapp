// the audit's ruling (6 Nov, T-F): under a Swap's or a Move's tag, the core allows exactly ONE more step: a storage_deposit on
// wrap.near for the signing account itself, args exactly { account_id: the signer, registration_only: true }, attached
// at most wrap.near's storage (NEAR_STORAGE_MAX_YOCTO, 0.00125 NEAR). It pays no one but the account's own refundable
// storage, so the Safe's NEAR on its account can wrap and fill Private (wallet moves.ts nearAsWnearTo). Everything else
// under the tag stays as it was. Table: the allowed case, each bound broken alone (refused), and the controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBoundIntent, ownWrapStorage, PRIVATE_POCKET, type IntentsFacts, type QuoteFacts } from "./intents.ts";
import { NEAR_STORAGE_MAX_YOCTO } from "./near-gate.ts";
import { ProblemError } from "./problem.ts";
import type { DecodedAction, DecodedTx } from "./tx-decode.ts";

const ME = "kid.near";
const DEP = `${"0a".repeat(32)}`;
const POCKET = `${"0b".repeat(32)}`;
const UNITS = (45n * 10n ** 23n).toString();
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const call = (method: string, args: Record<string, unknown>, depositYocto = 1n): DecodedAction => ({ kind: "call", method, args: enc(args), gas: 10n ** 13n, depositYocto });
const self = (o: { args?: Record<string, unknown>; yocto?: bigint } = {}) => call("storage_deposit", o.args ?? { account_id: ME, registration_only: true }, o.yocto ?? NEAR_STORAGE_MAX_YOCTO);
const wrap = call("near_deposit", {}, BigInt(UNITS));
const pay = call("ft_transfer", { receiver_id: DEP, amount: UNITS });
const tx = (actions: DecodedAction[], receiverId = "wrap.near"): DecodedTx => ({ signerId: ME, publicKey: { type: "ed25519", bytes: new Uint8Array(32) } as never, nonce: 1n, receiverId, blockHash: "11111111111111111111111111111111", actions });
const quote: QuoteFacts = {
  status: "PENDING_DEPOSIT", originAsset: "nep141:wrap.near", amountIn: UNITS, refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS",
  destinationAsset: "nep141:wrap.near", minAmountOut: UNITS, recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", deadline: "2999-01-01T00:00:00.000Z", depositType: "ORIGIN_CHAIN",
};
const facts = (): IntentsFacts => ({ codeMatches: true, tokens: new Map(), balances: new Map(), quotes: new Map([[DEP, quote]]), ownWallets: new Map([[POCKET, PRIVATE_POCKET]]) });
const verdict = (t: DecodedTx): string => {
  try {
    return `paid ${checkBoundIntent(t, facts(), ME, "move", new Set([DEP]))}`;
  } catch (e) {
    return e instanceof ProblemError ? e.problem.code : String(e);
  }
};
const REFUSED = "security.intent.changed";

test("checkBoundIntent, the Safe's own wrap.near storage under the move tag: one allowed case, each bound broken alone refused (audit, 6 Nov)", () => {
  const rows: [string, DecodedTx, string][] = [
    ["allowed: the signer's own storage, registration_only, 0.00125 NEAR, then wrap and pay", tx([self(), wrap, pay]), "paid 1"],
    ["allowed: less than the bound attached", tx([self({ yocto: NEAR_STORAGE_MAX_YOCTO - 1n }), wrap, pay]), "paid 1"],
    ["allowed: with the deposit address's own storage too (the rule before)", tx([self(), call("storage_deposit", { account_id: DEP, registration_only: true }, NEAR_STORAGE_MAX_YOCTO), wrap, pay]), "paid 1"],
    ["control: no storage step at all (the Safe already set up)", tx([wrap, pay]), "paid 1"],
    ["refused: account_id someone else", tx([call("storage_deposit", { account_id: "someone-else.near", registration_only: true }, NEAR_STORAGE_MAX_YOCTO), wrap, pay]), REFUSED],
    ["refused: a larger deposit (one yocto over)", tx([self({ yocto: NEAR_STORAGE_MAX_YOCTO + 1n }), wrap, pay]), REFUSED],
    ["refused: a larger deposit (0.01 NEAR)", tx([self({ yocto: 10n ** 22n }), wrap, pay]), REFUSED],
    ["refused: registration_only missing", tx([self({ args: { account_id: ME } }), wrap, pay]), REFUSED],
    ["refused: registration_only false", tx([self({ args: { account_id: ME, registration_only: false } }), wrap, pay]), REFUSED],
    ["refused: registration_only \"true\" (a string)", tx([self({ args: { account_id: ME, registration_only: "true" } }), wrap, pay]), REFUSED],
    ["refused: another arg beside the two", tx([self({ args: { account_id: ME, registration_only: true, msg: "x" } }), wrap, pay]), REFUSED],
    ["refused: another contract (usdt.tether-token.near)", tx([self(), pay], "usdt.tether-token.near"), REFUSED],
    ["refused: on intents.near", tx([self(), call("mt_transfer", { receiver_id: DEP, token_id: "nep141:wrap.near", amount: UNITS })], "intents.near"), REFUSED],
    ["refused: a second storage step for the signer", tx([self(), self(), wrap, pay]), REFUSED],
  ];
  for (const [name, t, want] of rows) assert.equal(verdict(t), want, name);
});

test("ownWrapStorage: ok only on wrap.near for the signer, exactly; none for any other account or method", () => {
  const rows: [string, string, DecodedAction, string][] = [
    ["the rule", "wrap.near", self(), "ok"],
    ["another account: not this rule's (the tag's own rule decides)", "wrap.near", call("storage_deposit", { account_id: DEP, registration_only: true }, NEAR_STORAGE_MAX_YOCTO), "none"],
    ["not a storage_deposit", "wrap.near", wrap, "none"],
    ["over the bound", "wrap.near", self({ yocto: NEAR_STORAGE_MAX_YOCTO + 1n }), "bad"],
    ["another contract", "usdt.tether-token.near", self(), "bad"],
    ["registration_only missing", "wrap.near", self({ args: { account_id: ME } }), "bad"],
  ];
  const argsOf = (a: DecodedAction) => (a.kind === "call" ? JSON.parse(new TextDecoder().decode(a.args)) : null);
  for (const [name, receiver, a, want] of rows) assert.equal(ownWrapStorage(receiver, a, argsOf(a), ME), want, name);
  assert.equal(NEAR_STORAGE_MAX_YOCTO, 1_250_000_000_000_000_000_000n, "wrap.near's storage, 0.00125 NEAR (the wallet's WRAP_STORAGE_YOCTO)");
});
