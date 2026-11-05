// Dead ends rows 5 and 12 (3 Nov). Row 5: Chat dropped the bridge's least, so a request (or a split share) under it was
// posted and its payment was never credited. Row 12: a refused coin or network went to the Problem screen, whose
// "Choose another network" opened nothing in Chat, and the sheet had closed with the amount. Each rule with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestRefusal, underBridgeMinimum } from "./request-coin.ts";

test("row 5: under the bridge's least is refused with the least in one line; at or over it passes", () => {
  assert.equal(underBridgeMinimum("2", "2.1", "USDC"), "At least $2.10 for NEAR's bridge.");
  assert.equal(underBridgeMinimum("2.099999", "2.1", "USDT"), "At least $2.10 for NEAR's bridge.");
  assert.equal(underBridgeMinimum("0.5", "1", "USDC"), "At least $1.00 for NEAR's bridge.");
  // a dollar least between cents is rounded UP, so asking what the line says always passes
  assert.equal(underBridgeMinimum("2.10", "2.105", "USDC"), "At least $2.11 for NEAR's bridge.");
  assert.equal(underBridgeMinimum("2.11", "2.105", "USDC"), null);
  assert.equal(underBridgeMinimum("0.0005", "0.0010", "ETH"), "At least 0.001 ETH for NEAR's bridge.");
  assert.equal(underBridgeMinimum("0.01", "0.02", "SOL"), "At least 0.02 SOL for NEAR's bridge.");
  // controls: enough, exactly the least, no least (NEAR's own "0"), or none given
  assert.equal(underBridgeMinimum("2.1", "2.1", "USDC"), null, "exactly the least is credited (Trade's H07: have < min)");
  assert.equal(underBridgeMinimum("5", "2.1", "USDC"), null);
  assert.equal(underBridgeMinimum("0.0010", "0.001", "ETH"), null);
  assert.equal(underBridgeMinimum("0.01", "0", "NEAR"), null);
  assert.equal(underBridgeMinimum("0.01", undefined, "NEAR"), null);
  // no float edge: 0.1 + 0.2 style amounts compare exactly
  assert.equal(underBridgeMinimum("0.3", "0.30000000000000001", "SOL"), "At least 0.30000000000000001 SOL for NEAR's bridge.");
});

const P = (code: string, whatHappened: string, next: { kind: string; screen?: string }, more?: string) => ({ code, whatHappened, next, ...(more ? { more } : {}) });

test("row 12: a refusal fixed by another coin or network stays on the sheet as one line, and says nothing was asked", () => {
  const shown = { coin: "USDC", network: "Solana" };
  assert.equal(requestRefusal(P("ledger.token.unsupported", "That coin can't come to your Safe on that network yet.", { kind: "open", screen: "receive" }, "USDC on Solana"), shown),
    "USDC can't come to you on Solana yet. Pick another coin or network. Nothing was asked.");
  assert.equal(requestRefusal(P("ledger.chain.unsupported", "That network can't send coins to your Safe yet.", { kind: "open", screen: "receive" }, "Solana: raw bridge words"), shown),
    "Solana can't send coins to you yet. Pick another network. Nothing was asked.", "never the bridge's raw words");
  assert.equal(requestRefusal(P("ledger.deposit.address-invalid", "NEAR Intents gave a Solana address that isn't real, so it's hidden.", { kind: "open", screen: "receive" }), shown),
    "NEAR Intents gave a Solana address that isn't real, so it's hidden. Pick another network. Nothing was asked.");
  assert.equal(requestRefusal(P("chat.request.test-account", "A test account can ask only for test NEAR, on NEAR.", { kind: "nothing" }, "The coin says USDC. Change it to NEAR."), shown),
    "A test account can ask only for test NEAR, on NEAR. The coin says USDC. Change it to NEAR. Nothing was asked.");
  assert.equal(requestRefusal(P("chat.request.address", "Your NEAR account didn't match this ask, so nothing was posted.", { kind: "nothing" }), shown),
    "Your NEAR account didn't match this ask, so nothing was posted.", "the money line once, never twice");
  // controls: anything else (a security step, a retry) goes to the Problem screen as before
  assert.equal(requestRefusal(P("security.backup.needed", "Save your words first.", { kind: "open", screen: "security/backup" }), shown), null);
  assert.equal(requestRefusal(P("ledger.unavailable", "NEAR didn't answer.", { kind: "retry" }), shown), null);
});

test("the sheet: the least is checked after the address is read and before anything is posted; refusals stay on it", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  const sheet = app.slice(app.indexOf("export function RequestSheet"), app.indexOf("export const chatApp"));
  const make = sheet.slice(sheet.indexOf("const make = async"), sheet.indexOf("  return (\n    <Sheet"));
  const checked = (src: string) => {
    const least = src.indexOf("underBridgeMinimum(asked, r.ok.minAmount");
    const posted = Math.min(...["onSplit(", "onPost("].map((w) => src.indexOf(w)).filter((i) => i >= 0));
    return least > src.indexOf('"ledger.depositAddress"') && least < posted;
  };
  assert.ok(checked(make), "the least sits between the address read and the post");
  assert.doesNotMatch(make, /onProblem\(/, "every refusal in make goes through refuse(): never straight to a screen that can't act");
  assert.match(sheet, /data-testid="chat-request-refused"/);
  // control: the sheet as it was on main (no least check) fails the same test
  assert.ok(!checked(make.replace(/underBridgeMinimum\(asked, r\.ok\.minAmount[^;]*;/, "null;")), "control: without the check the test fails");
});
