import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentView } from "../src/types.ts";
import { verdict } from "./mainnet-check.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const view = (orderYocto: string, usdcPerDay: string): AgentView => ({
  paused: false,
  budget: { coins: [{ coin: USDC, per_day: usdcPerDay, per_month: usdcPerDay, convert_per_day: usdcPerDay }], recipients: [], ends_at_ns: "1", max_spends_per_day: 4 },
  orders: [{ id: "1", payout: "Near", to: "second.near", amount: orderYocto, slots: [{ due_ns: "1", state: "Paid" }, { due_ns: "2", state: "Waiting" }], grace_ns: "1" }],
  spent: [],
  spends_today: 0,
  keyAllowanceYocto: null,
  renewSuggested: false,
  keyOnThisPhone: true,
});

test("the mainnet check passes only when Agent's rules stay within the proof's dust caps", () => {
  const ok = verdict(view("10000000000000000000000", "4000000"));
  assert.equal(ok.pass, true);
  assert.match(ok.lines[0], /^ok: order 1 to second\.near: 1 of 2 paid/);
  assert.equal(verdict(view("100000000000000000000000", "4000000")).pass, false, "an order of 0.1 NEAR is over the cap");
  assert.equal(verdict(view("10000000000000000000000", "6000000")).pass, false, "6 USDC a day is over the cap");
  assert.equal(verdict(null).pass, false, "no Agent yet is no pass");
});
