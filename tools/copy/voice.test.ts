// The voice guard (the house style, section 5): no user-visible string in the app says a banned word. The words
// are read from the source by strings.ts: web screens, the core's sheets and Problems, and the iPhone's Swift screens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allStrings, fromSwift, fromTs } from "./strings.ts";
import { ALLOWED, bannedIn, grade } from "./voice.ts";

test("no user-visible string says a banned word (the house style, section 5)", () => {
  const bad = allStrings().flatMap((f) => bannedIn(f.file, f.text).map((b) => `${f.file}:${f.line} "${f.text}": ${b.word} (say: ${b.say})`));
  assert.deepEqual(bad, [], `\n${bad.join("\n")}`);
});

test("the reader finds the words people see, and leaves code alone", () => {
  const tsx = fromTs("x.tsx", `import "./a.css";
    const k = { className: "zf-btn zf-ghost", label: "Top up", code: "trade.float.low" };
    export const A = () => <div className="zf-x" aria-label="Back"><p>Your money is in your Safe.</p>{ok ? "Try again" : "Sending it…"}</div>;
    if (x === "Not shown") call("account.state");
    throw new Error("an engine reason");`);
  assert.deepEqual(tsx.map((f) => f.text).sort(), ["Back", "Sending it…", "Top up", "Try again", "Your money is in your Safe."]);
  const swift = fromSwift("x.swift", `Text("Write these down")\n// a comment "Not this one"\nprint("debug words here")\nlet s = "Your key stays on this phone."`);
  assert.deepEqual(swift.map((f) => f.text), ["Write these down", "Your key stays on this phone."]);
});

test("the guard can fail: each banned word is caught where a person would read it (controls)", () => {
  // One control per family, so a broken pattern can't pass the guard by finding nothing.
  for (const [text, word] of [
    ["Move it from your Trading balance.", "Trading (the money)"],
    // D88: an error line may name 1Click ("1Click said no."); any other line still may not
    ["Swap with 1Click today.", "1Click"],
    ["We can't reach 1Click.", "1Click"],
    ["We couldn't reach NEAR Intents.", "intents"],
    ["1Click can't see what you buy. Swap privately today.", "1Click"],
    ["NEAR Intents couldn't be faster, try it now", "intents"],
    ["It holds the float.", "float"],
    ["Your protection band is saved.", "band"],
    ["The quote ran out.", "quote"],
    ["Oops, try later!", "oops"],
    ["Paid with 500 units of nep141:usdc.near", "nep141"],
  ] as const) assert.ok(bannedIn("x.ts", text).some((b) => b.word === word), `${word} in "${text}"`);
  // B28 R5: the product F line and its kin each fail the guard; the named lines that replace them pass
  for (const bad of ["We can't reach the service that holds your coins right now.", "We couldn't read your money.", "NEAR didn't answer, so we couldn't read it.", "Something went wrong. Try again.", "We can’t reach the network right now."]) {
    assert.ok(bannedIn("x.ts", bad).some((b) => b.word.startsWith("we can't reach")), `R5 guard catches "${bad}"`);
  }
  for (const good of ["NEAR didn't answer.", "NEAR is slow right now.", "Solana hasn't confirmed it yet."]) assert.deepEqual(bannedIn("x.ts", good), [], good);
  // D98: a person's name is never asked for or shown; the receipt says the account (control: the account line passes)
  for (const bad of ["Paid $5 to kim.near through NEAR Intents. Your name isn't on it.", "Your name in chat", "It links your name to this payment."]) assert.ok(bannedIn("x.ts", bad).some((b) => b.word.startsWith("your name")), `D98 guard catches "${bad}"`);
  for (const good of ["Your account isn't on the public chain.", "Show my NEAR account", "pump.fun's name for this coin"]) assert.deepEqual(bannedIn("x.ts", good), [], good);
  for (const bad of ["Type your full name.", "Your legal name, as on your ID"]) assert.ok(bannedIn("x.ts", bad).length > 0, bad);
  // no file is exempt (QA, D98 + D77): the same words fail wherever they are
  for (const file of ["packages/agent/src/app/AgentApp.tsx", "packages/pay/src/partners/recipes.ts", "packages/chat/src/app/ChatApp.tsx"]) assert.ok(bannedIn(file, "Your name").length > 0, file);
  assert.ok(!ALLOWED.some((a) => /name/i.test(a.text.source)), "no allowance for a person's name");
  assert.deepEqual(bannedIn("packages/core/src/services.ts", "NEAR Intents' bridge"), [], "a failing service is named in services.ts");
  assert.deepEqual(bannedIn("packages/core/src/services.ts", "NEAR Intents"), [], "9a's downLine names it as people see it");
  assert.ok(bannedIn("packages/wallet/src/x.ts", "NEAR Intents' bridge").length > 0, "control: only there");
  assert.deepEqual(bannedIn("x.ts", "Your $20 is on its way to Spending."), []);
  // The product's F example (2 Nov) grades D or worse on its own, without the guard.
  assert.match(grade("x.ts", "Your protection was saved before it counted every coin, so it holds this as a big payment, and its price can't wait.").grade, /[DF]/);
  assert.equal(grade("x.ts", "NEAR didn't answer.").grade, "A");
  assert.equal(grade("x.ts", "We couldn't reach the network.").grade, "F", "B28 R5: blames ZeroFee and names nothing");
});

test("D88: an error line naming the failing service keeps every other ban (it lifts only the service's own name)", async () => {
  const { bannedIn } = await import("./voice.ts");
  assert.deepEqual(bannedIn("x.ts", "1Click isn't answering right now. Nothing moved."), []);
  assert.deepEqual(bannedIn("x.ts", "1Click refused your transaction. Check your seed phrase.").map((b) => b.word), ["transaction", "seed phrase"]);
});

test("one pot, one name: a line or a screen that says both Trading and Spending fails; either alone passes (controls)", async () => {
  const { grade, onePot } = await import("./voice.ts");
  const both = grade("x.tsx", "Spending and Trading hold $5.");
  assert.equal(both.grade, "D", both.problems.join("; "));
  assert.ok(both.problems.some((p) => /two names for one pot/.test(p)));
  assert.notEqual(grade("x.tsx", "Safe $5,254.15 · Trading $172.54").grade, "D");
  assert.notEqual(grade("x.tsx", "Move to Spending").grade, "D");
  assert.deepEqual(onePot(["Safe $1 · Trading $2", "Move to Spending"]), ["Safe $1 · Trading $2", "Move to Spending"]);
  assert.deepEqual(onePot(["Safe $1 · Trading $2", "Reading your trading rows…"]), []);
});

test("product decision, 5 Nov is never on screen (control: the wallet's own name passes)", () => {
  assert.ok(bannedIn("packages/agent/src/x.ts", "Top up AgentZero's pocket money").length > 0);
  assert.ok(bannedIn("packages/agent/src/x.ts", "Pocket-money limit").length > 0);
  assert.deepEqual(bannedIn("packages/agent/src/x.ts", "Top up AgentZero's wallet"), []);
});

test("D111/D108: \"confidential\" is never on screen; the app says Hidden (control: Hidden passes)", () => {
  assert.ok(bannedIn("x.ts", "Move it to your confidential balance.").some((b) => b.word === "confidential"));
  assert.ok(bannedIn("x.ts", "Paid confidentially.").some((b) => b.word === "confidential"));
  assert.deepEqual(bannedIn("x.ts", "Move it to Hidden."), []);
});

test("D111: NEAR on screen only as the NEAR row, \"Your NEAR account keeps these rules.\" or a cause line (REPORT-ONLY count; controls)", async () => {
  const { nearOffRow } = await import("./voice.ts");
  for (const ok of ["NEAR", "Your NEAR account keeps these rules.", "NEAR is down.", "NEAR didn't answer. Nothing moved.", "NEAR isn't answering right now."]) assert.equal(nearOffRow(ok), false, ok);
  for (const off of ["Send NEAR to kim.near", "Your NEAR wallet", "A NEAR name"]) assert.equal(nearOffRow(off), true, off);
  for (const amount of ["{n} NEAR", "Sent $5.00 (1.18 NEAR)"]) assert.equal(nearOffRow(amount), false, `a coin amount: ${amount}`);
  const hits = allStrings().filter((f) => nearOffRow(f.text));
  const byPackage: Record<string, number> = {};
  for (const f of hits) byPackage[f.file.split("/").slice(0, 2).join("/")] = (byPackage[f.file.split("/").slice(0, 2).join("/")] ?? 0) + 1;
  // report-only (QA): the copy pass fixes these package by package; the build fails on them only once a package is done
  console.log(`D111 NEAR-off-row (report only): ${hits.length} strings`, JSON.stringify(byPackage));
});

test("the protocol's own name, NEAR Confidential, may be on screen (product decision, 5 Nov: name the protocol); the plain word stays Hidden (controls)", () => {
  const f = "packages/wallet/src/app/money/x.tsx";
  for (const ok of ["Through NEAR Confidential", "It goes through NEAR Confidential."]) assert.deepEqual(bannedIn(f, ok).map((b) => b.word), [], ok);
  for (const bad of ["A confidential move.", "Sent confidentially.", "Your NEAR confidential wallet.", "near Confidential", "Confidential"]) assert.ok(bannedIn(f, bad).some((b) => b.word === "confidential"), bad);
});

test("the product Perps tile line may say Confidential, only that exact line in locked-apps.tsx (copy review, 5 Nov); anywhere else, or any other wording, stays banned (controls)", () => {
  const line = "Confidential perps. Trade with leverage, in private.";
  assert.deepEqual(bannedIn("apps/web/src/shell/locked-apps.tsx", line).map((b) => b.word), [], "the tile's own line");
  assert.ok(bannedIn("apps/web/src/shell/other.tsx", line).some((b) => b.word === "confidential"), "control: the same line in another file");
  assert.ok(bannedIn("apps/web/src/shell/locked-apps.tsx", "Confidential trading.").some((b) => b.word === "confidential"), "control: other words in the tile's file");
});

test("the protocols' own names, 1Click and NEAR Intents, may be on screen (product decision, 5 Nov: name who is paid); other spellings and the bare word stay banned (controls)", () => {
  const f = "packages/wallet/src/app/money/x.tsx";
  for (const ok of ["1Click prices it.", "NEAR Intents doesn't swap one of these coins.", "Paid to NEAR Intents' solver directly.", "1Click didn't sign this price. Nothing moved.", "1Click priced different coins. Nothing moved.", "NEAR Intents", "1Click"]) assert.deepEqual(bannedIn(f, ok).filter((b) => b.word === "1Click" || b.word === "intents").map((b) => b.word), [], ok);
  for (const bad of ["Your intents balance.", "Intents is fast.", "Swap with 1Click today.", "NEAR Intents couldn't be faster, try it now", "1Click can't see what you buy."]) assert.ok(bannedIn(f, bad).some((b) => b.word === "1Click" || b.word === "intents"), bad);
});
