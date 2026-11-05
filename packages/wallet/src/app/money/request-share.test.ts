// Test (5 Nov, Request): Share handed over a raw "zerofee:pay?v=1&to=…&hidden=1" line, no words, no web
// link. Share now hands over words and ZeroFee's https link; no link says "hidden"; ZeroFee's Send reads the https link
// (and every link made before). Controls: the old line, and the old field, still read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAY_HOST, readRequest, requestLink } from "@zerofee/pay/request";
import { prefillFromLink } from "@zerofee/pay/app/links.ts";
import { REQUEST_WORDS, requestLinkFor, shareTextFor } from "./request-money.ts";

const NOW = 1_762_300_000_000;
const SOL_ADDR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const made = () => {
  const l = requestLinkFor({ target: SOL_ADDR, coin: { chain: "sol", assetId: "nep141:sol.omft.near", decimals: 9 }, units: "147400000", usd: "15.00", hidden: true, untilMs: NOW + 86_400_000, nowMs: NOW });
  if ("problem" in l) throw new Error(l.problem.whatHappened);
  return l;
};

test("Share hands over words and ZeroFee's https link, never the raw zerofee: line or \"hidden\" (control: the old Share text was the raw line)", () => {
  const l = made();
  const text = shareTextFor("15.00", l.request);
  assert.match(text, new RegExp(`^Pay me \\$15\\.00 on ZeroFee: https://${PAY_HOST.replace(".", "\\.")}/pay#v=1&to=${SOL_ADDR}&`));
  assert.match(text, /\nIn ZeroFee, tap Send and paste this link\.$/);
  assert.doesNotMatch(text, /hidden|zerofee:pay/);
  assert.match(text, /&once=1/, "the one-time address is still marked");
  // every form of the link drops the word: the QR's and Copy link's too
  assert.doesNotMatch(l.link, /hidden/);
  const sheet = readFileSync(new URL("./RequestSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /navigator\.share\(\{ text: shareTextFor\(made\.usd, made\.request\) \}\)/);
  assert.doesNotMatch(sheet, /navigator\.share\(\{ text: made\.link \}\)/, "control: the old Share");
  assert.equal(REQUEST_WORDS.shareText("1.00", "L"), "Pay me $1.00 on ZeroFee: L\nIn ZeroFee, tap Send and paste this link.");
});

test("the shared https link reads back as the same request, one-time address and all; a link made before (\"hidden=1\") still reads", () => {
  const l = made();
  const web = shareTextFor("15.00", l.request).split(": ")[1]!.split("\n")[0]!;
  const back = readRequest(web, [PAY_HOST], NOW);
  assert.ok(back && "ok" in back);
  assert.deepEqual(back.ok, l.request);
  assert.equal(back.ok.hidden, true);
  // Send's paste takes it (the zerofee.si host is ZeroFee's own)
  const tokens = { find: () => undefined, byAsset: () => undefined } as never;
  const pre = prefillFromLink(web, tokens, undefined, NOW);
  assert.ok(!("problem" in pre && pre.problem.code === "pay.request.invalid"), "Send reads the shared link");
  // controls: an old link with hidden=1 reads the same; another host is no request
  const old = requestLink(l.request).replace("once=1", "hidden=1");
  assert.match(old, /hidden=1/);
  const oldBack = readRequest(old, [], NOW);
  assert.ok(oldBack && "ok" in oldBack && oldBack.ok.hidden === true);
  assert.equal(readRequest(web.replace(PAY_HOST, "evil.example"), [PAY_HOST], NOW), null);
});

test("zerofee.si/pay opens the app, never a 404 (control: the laptop page's rewrite stays)", () => {
  const v = JSON.parse(readFileSync(new URL("../../../../../apps/web/vercel.json", import.meta.url), "utf8")) as { rewrites: { source: string; destination: string }[] };
  assert.ok(v.rewrites.some((r) => r.source === "/pay" && r.destination === "/index.html"));
  assert.ok(v.rewrites.some((r) => r.source === "/laptop"));
});
