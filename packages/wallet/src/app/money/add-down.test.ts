// Audit 13's D5 (8 Nov): with the bridge, NEAR Intents or NEAR Confidential down, Add showed its deposit addresses with no
// word under a banner that said adding can't go now. Now the sheet says what is down, where money sent before waits and
// when to send, and shows no address to send to. Fails on main: no addDown, and AddList drew the rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADD_NEEDS, addDown } from "../services.ts";

const sheet = readFileSync(new URL("./AddSheet.tsx", import.meta.url), "utf8");

test("D5: a service Add needs is down: what, where money sent before waits, when to send", () => {
  assert.deepEqual([...ADD_NEEDS], ["bridge", "oneclick", "confidential"]);
  assert.deepEqual(addDown([{ service: "oneclick", state: "down", seen: "both" }])?.lines, ["NEAR Intents is down, so Add can't go now.", "Money you sent before goes to NEAR Intents and waits there.", "Send money when it's back. The addresses come back then."]);
  assert.deepEqual(addDown([{ service: "bridge", state: "down", seen: "both" }])?.lines.slice(0, 2), ["NEAR Intents' bridge is down, so Add can't go now.", "Money you sent before goes to NEAR Intents' bridge and waits there."]);
  assert.equal(addDown([{ service: "confidential", state: "down", seen: "both" }])?.lines[0], "NEAR Confidential is down, so Add can't go now.");
  // controls: one source alone, slow, or a service Add doesn't need is no stop
  assert.equal(addDown([{ service: "oneclick", state: "down", seen: "device" }]), null);
  assert.equal(addDown([{ service: "bridge", state: "slow", seen: "both" }]), null);
  assert.equal(addDown([{ service: "solana", state: "down", seen: "both" }]), null);
  assert.equal(addDown([]), null);
});

test("D5: the sheet says it on top and draws no address row while it is down", () => {
  assert.match(sheet, /const down = addDown\(useHealth\(bridge\)\);/);
  assert.match(sheet, /if \(down && !asking\) return <Sheet title=\{W\.title\} onClose=\{onClose\}><AddDownLines lines=\{down\.lines\} \/><\/Sheet>;\n\s+if \(direct && !asking\) return <CoinPage/, "before any address page or row");
  assert.match(sheet, /<div role="alert" data-testid="add-down"/);
});
