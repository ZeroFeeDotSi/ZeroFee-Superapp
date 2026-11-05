// D85: a send Chat asks for goes from Private only; short, it stops with one line that says by how much. The words read
// at grade 5 and pass the voice guard; only a Private quote may go on (never the Safe's transfer, never the switch off).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grade } from "../../../../../tools/copy/voice.ts";
import { CANT_PRIVATE, FEE_ROOM, FIRST_MODE, MODE_WORDS, MOVE_TO_PRIVATE, OPEN_AMOUNT_LINE, PLAIN_LINE, SEND_PLAIN, SET_UP_PRIVATE, hiddenCantLine, privateOnly, privateShortUsd, shortLine } from "./chat-private.ts";

test("the short line says by how much, in dollars first", () => {
  assert.equal(shortLine(3), "Your private balance is $3 short. Move money to it first.");
  assert.equal(shortLine(0.034), "Your private balance is $0.04 short. Move money to it first.", "rounded up: moving that much covers it");
  assert.equal(shortLine(null), "Your private balance is short. Move money to it first.");
  const near = (x: number) => Math.round(x * 1e6) / 1e6;
  assert.equal(near(privateShortUsd({ amount: "5", symbol: "USDC", chain: "near" }, [{ symbol: "USDC", amount: "2", usd: "2", chain: "near" }])!), near(5 * FEE_ROOM - 2), "the fee's room counted");
  assert.equal(near(privateShortUsd({ amount: "0.01", symbol: "NEAR", priceUsd: "4.2" }, [])!), near(0.042 * FEE_ROOM));
  assert.equal(near(privateShortUsd({ amount: "5", symbol: "USDC", chain: "base" }, [{ symbol: "USDC", amount: "9", usd: "9", chain: "near" }])!), near(5 * FEE_ROOM), "USDC on NEAR doesn't pay USDC on Base (review L3)");
  assert.equal(privateShortUsd({ amount: "1", symbol: "NEAR" }, []), null, "no price: no figure");
  assert.equal(near(privateShortUsd({ amount: "5", symbol: "USDC" }, [{ symbol: "USDT", amount: "9", usd: "9", chain: "near" }])!), near(5 * FEE_ROOM), "another coin doesn't count (Private pays the coin asked)");
});

test("only a quote paid from Private goes on; control: the Safe's transfer and the switch off stop", () => {
  assert.equal(privateOnly({ privacy: { on: true }, quote: { id: "pp-1" } }), true);
  assert.equal(privateOnly({ privacy: { on: false }, quote: { id: "q-1" } }), false, "the Safe's quote");
  assert.equal(privateOnly({ quote: { id: "q-1" } }), false, "Private can't pay this route");
  assert.equal(privateOnly({ privacy: { on: true } }), false, "a transfer, no quote");
});

test("D128: every Send from Home goes privately (Chat's too, G5): no Plain choice, no public send path left on the sheet", () => {
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const code = sheet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.equal(FIRST_MODE, "hidden", "Hidden stays the default where the mode still exists (D70)");
  // the only two ways a Send leaves: a wallet's one-Approve private route, or the Safe's (pocket first, then the Safe)
  assert.deepEqual([...code.matchAll(/shell\.bridge\.call<[^>]+>\("(ledger|subwallet)\.([a-zA-Z.]+)"/g)].map((m) => `${m[1]}.${m[2]}`).filter((m) => !/^ledger\.(private|activity|sendFee)$/.test(m)), ["ledger.hiddenFromRow", "ledger.sendFromSafe"]);   // sendFee: two dry quotes, a read
  // control: the plain ways the sheet had are gone
  assert.doesNotMatch(code, /subwallet\.send"|ledger\.transfer|ledger\.withdraw|flow\.send\(|flow\.setPrivate|SEND_PLAIN|setMode\(/);
  assert.match(code, /back\.current = asked && "ok" in asked && asked\.ok\.back === "chat" \? "chat" : null;/, "Chat's ask read from the link itself (review L4)");
});

test("D85's words read at grade 5 or under and grade A or B on the voice guard", () => {
  const fk = (text: string) => {
    const sentences = Math.max(1, text.split(/[.?!]+/).filter((s) => s.trim()).length);
    const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
    const syll = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length);
    return 0.39 * (words.length / sentences) + 11.8 * (words.reduce((n, w) => n + syll(w), 0) / words.length) - 15.59;
  };
  const all = [OPEN_AMOUNT_LINE, MOVE_TO_PRIVATE, CANT_PRIVATE, SET_UP_PRIVATE, shortLine(3), shortLine(null), PLAIN_LINE, SEND_PLAIN, hiddenCantLine("DOGE")];
  assert.deepEqual(Object.values(MODE_WORDS), ["Private", "Plain"], "the toggle's two words (home/words2: never Hidden)");
  assert.doesNotMatch(all.join(" "), /\bHidden\b|Trading|Spending/, "home/words2: never Hidden, Trading or Spending");
  assert.deepEqual(all.filter((s) => fk(s) > 5), []);
  assert.deepEqual(all.map((s) => ({ s, g: grade("send", s) })).filter((x) => x.g.grade !== "A" && x.g.grade !== "B").map((x) => x.s), []);
  assert.doesNotMatch(all.join(" "), /public on NEAR|no one can see|your name/i, "never an overclaim, never a person's name (D98)");
  // control: the guard catches a passive line
  assert.notEqual(grade("send", "Private can't pay this yet, so it was refused.").grade, "A"); // "Nothing was sent." is the money line (copy review rule 1), not a passive
});

test("privacy audit (4 Nov): Chat's private-send words never say the account isn't on the public chain (the step in is public); the unused HIDDEN_LINE is gone", async () => {
  const mod = await import("./chat-private.ts");
  assert.equal("HIDDEN_LINE" in mod, false);
  assert.doesNotMatch(Object.values(mod).filter((v) => typeof v === "string").join(" "), /isn't on the public chain/);
});
