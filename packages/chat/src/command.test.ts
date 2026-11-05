// The send command (test T2): read from the person's own composer text only, never sends, a plain line when it can't
// be read. That nothing else ever reaches readSend is held by messages.test.ts (incoming text) and the ChatApp check
// below (the composer is the only caller).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readSend } from "./command.ts";
import { detect } from "./detect.ts";

const EVM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ok = (t: string) => {
  const r = readSend(t);
  assert.ok(r && "ok" in r, `${t}: ${JSON.stringify(r)}`);
  return r.ok;
};
const problem = (t: string) => {
  const r = readSend(t);
  assert.ok(r && "problem" in r, `${t}: ${JSON.stringify(r)}`);
  return r.problem;
};

test("the forms the product named, and the research's", () => {
  assert.deepEqual(ok(`send 5 USDC to ${EVM}`), { amount: "5", coin: "USDC", to: EVM });
  assert.deepEqual(ok(`send 5 usdc to ${EVM} on base`), { amount: "5", coin: "USDC", to: EVM, on: "base" });
  assert.deepEqual(ok(`Send money to ${SOL}`), { to: SOL });
  assert.deepEqual(ok(`send money to ${EVM} on BNB Chain`), { to: EVM, on: "BNB Chain" });
  assert.deepEqual(ok(`pay $5 to ${EVM} on base`), { amount: "5", coin: "USDC", to: EVM, on: "base" });
  assert.deepEqual(ok(`pay 0.25 sol to ${SOL}`), { amount: "0.25", coin: "SOL", to: SOL });
  assert.deepEqual(ok(`send USDC to alice.near`), { coin: "USDC", to: "alice.near" });
  assert.deepEqual(ok(`send 1 NEAR to alice.near`), { amount: "1", coin: "NEAR", to: "alice.near" });
  assert.deepEqual(ok(`send 2 usdc to base:${EVM}`), { amount: "2", coin: "USDC", to: `base:${EVM}` });
});

test("what can't be read is said plainly, and nothing is sent", () => {
  assert.match(problem(`send 5 to ${EVM}`), /Say which coin/);
  assert.match(problem(`send 5 USDC to ${EVM} now`), /isn't a payment ZeroFee can read/);
  assert.match(problem(`send 5 USDC to ${EVM} and ${SOL}`), /more than one address/);
  assert.match(problem(`send 5 USDC to https://evil.example/${EVM}`), /web link/);
  assert.match(problem(`send 0 USDC to ${EVM}`), /more than 0/);
  assert.match(problem(`send $5 USDC to ${EVM}`), /amount once/);
  assert.match(problem(`send ${"9".repeat(500)} USDC to ${EVM}`), /too long/);
  // Words after the network are the network's name as far as the parser knows; the detector then refuses it.
  const tail = ok(`send 5 USDC to ${EVM} on base please`);
  assert.ok("problem" in detect(tail.to, tail.on));
});

test("ordinary chat is not a command (posted as a message)", () => {
  for (const t of ["hello", "send nudes lol", "I will send it tomorrow", "pay attention", "who wants to trade", "to be or not to be", "send it to me later", "send to", "pay it to the bar"]) assert.equal(readSend(t), null, t);
});

test("the composer is the only place readSend is called: incoming messages never reach it", () => {
  const dir = new URL("./", import.meta.url);
  const callers: string[] = [];
  const walk = (u: URL) => {
    for (const e of readdirSync(u, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, u));
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== "command.ts" && /\breadSend\(/.test(readFileSync(new URL(e.name, u), "utf8"))) callers.push(e.name);
    }
  };
  walk(dir);
  assert.deepEqual(callers, ["ChatApp.tsx"]);
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  const calls = [...app.matchAll(/readSend\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ["typed"], "only the composer's own typed text");
  // and `typed` is the composer's input value, read in its submit handler
  assert.match(app, /const submit = async \(e: FormEvent\) => \{\n\s+e\.preventDefault\(\);\n\s+const typed = text\.trim\(\);/);
  assert.doesNotMatch(app, /readSend\(m\.|readSend\(e\.content|readSend\(.*\.text\)/);
});
