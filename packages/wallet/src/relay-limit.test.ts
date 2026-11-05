// D132 (product decision, 3 Nov): a private send goes up to $10,000 (the quote server's POCKET_USD and the core's mirror). Until the
// operator redeploys the server, it still refuses a real quote over $100 with its old words; the sheet then says so by
// name ("ZeroFee's server takes up to $100 a trade right now. Nothing moved."), never "1Click gave no price" and
// never a made-up figure. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POCKET_MAX_TEXT, POCKET_PAYMENT_MAX_USD } from "@zerofee/core/private-pocket";
import { RELAY_OLD_LIMIT, relayOldLimit } from "@zerofee/core/services";
import { QuoteRefused, createApis } from "./apis.ts";
import { HIDDEN_MAX_TEXT, HIDDEN_MAX_USD } from "./app/money/add-coins.ts";

const RELAY = "https://relay.example/v0";
const answer = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
const OLD = { code: "quotes.request.too-big", message: "Hidden is for payments up to $100." };
const NEW = { code: "quotes.request.too-big", message: "A private send goes up to $10,000." };

test("D132: $10,000 a send, the same in the quote server, the core and Wallet", () => {
  const relay = readFileSync(new URL("../../../apps/quotes/relay.mjs", import.meta.url), "utf8");
  assert.match(relay, /^const POCKET_USD = 10_000;$/m);
  assert.equal(POCKET_PAYMENT_MAX_USD, 10_000);
  assert.equal(HIDDEN_MAX_USD, 10_000);
  assert.deepEqual([POCKET_MAX_TEXT, HIDDEN_MAX_TEXT], ["$10,000", "$10,000"]);
  assert.match(relay, /"quotes\.request\.too-big", "A private send goes up to \$10,000\."/, "the server's own words, no \"Hidden\"");
});

test("the server before its update (its $100 refusal) is said by name on the sheet; nothing moved", async () => {
  const apis = createApis(answer(400, OLD));
  await assert.rejects(apis.quote({} as never, RELAY), (e: any) => e.problem?.code === "quotes.relay.limit" && e.problem.whatHappened === RELAY_OLD_LIMIT && e.problem.service === "relay");
  await assert.rejects(apis.generateIntent(RELAY, "a".repeat(64), "b".repeat(64)), (e: any) => e.problem?.code === "quotes.relay.limit", "the same through its other doors");
  assert.equal(RELAY_OLD_LIMIT, "ZeroFee's server takes up to $100 a trade right now. Nothing moved.");
});

test("control: the updated server's refusal, another too-big (a new account's few dollars), and 1Click itself stay as they were", async () => {
  await assert.rejects(createApis(answer(400, NEW)).quote({} as never, RELAY), (e) => e instanceof QuoteRefused && /\$10,000/.test(e.message));
  await assert.rejects(createApis(answer(400, { code: "quotes.request.too-big", message: "A new account opens with a few dollars only." })).quote({} as never, RELAY), (e) => e instanceof QuoteRefused);
  await assert.rejects(createApis(answer(400, OLD)).quote({} as never), (e) => e instanceof QuoteRefused, "straight to 1Click (no server): not the server's limit");
  assert.equal(relayOldLimit(OLD), true);
  assert.equal(relayOldLimit(NEW), false);
  assert.equal(relayOldLimit({ code: "quotes.request.refused", message: "up to $100" }), false);
});
