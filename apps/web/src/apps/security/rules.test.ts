import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROTECTION, contractBands, defaultBands, keepUntouched, usdBands } from "@zerofee/core/demo-core";
import { levelWords as sheetLevelWords } from "@zerofee/core/known-contracts";
import { PHONE_WORDS, WEB_WORDS, onPhone } from "@zerofee/shell-api/approval-words.ts";
import { readFileSync } from "node:fs";
import { ruleChangeWait } from "./rules.ts";
import { ruleChangeFoot } from "./rules-lines.ts";
import { DAY, FEW_COINS_LINE, HOUR, SAVED_STATUS, SAVING_STATUS, saveLabel, strengthWords, changeRuleLine, changeRuleWords, countsFewCoins, changeWaitSeconds, changed, fromCore, keepOrder, levelWords, rangeWords, toCore, usd, waitChoices, waitLabel, waitPlain, whenWords, type Band } from "./rules.ts";
import { openOn, rulesNow } from "./rules-now.ts";

const SAMPLE: Band[] = [
  { upToUsd: 1000, level: "faceid", waitSeconds: DAY },
  { upToUsd: 10000, level: "wait", waitSeconds: DAY },
  { upToUsd: null, level: "wait", waitSeconds: DAY },
];

test("bigger amounts never get less care: raising a band raises every band above it", () => {
  const bands: Band[] = [
    { upToUsd: 1000, level: "device", waitSeconds: DAY },
    { upToUsd: 10000, level: "faceid", waitSeconds: DAY },
    { upToUsd: null, level: "wait", waitSeconds: HOUR },
  ];
  assert.deepEqual(keepOrder(bands).map((b) => b.level), ["device", "device", "device"]);
  // A longer wait below is matched above too.
  const waits: Band[] = [{ upToUsd: 100, level: "wait", waitSeconds: 3 * DAY }, { upToUsd: null, level: "wait", waitSeconds: HOUR }];
  assert.equal(keepOrder(waits)[1].waitSeconds, 3 * DAY);
  // Already in order: unchanged.
  assert.deepEqual(keepOrder(SAMPLE), SAMPLE);
});

test("the Protection note says the real wait of any change: a change's wait (lib.rs floor_ns), or the strictest band's if longer", () => {
  // 48 hours (the default): 48 h + min(48 h, 1 day) = 3 days, the wait the approval sheet then shows
  assert.equal(changeWaitSeconds(2 * DAY), 3 * DAY);
  assert.equal(changeWaitSeconds(DAY), 2 * DAY);
  assert.equal(changeWaitSeconds(7 * DAY), 8 * DAY);
  const note = changeRuleWords(SAMPLE, 2 * DAY, PHONE_WORDS);
  assert.equal(note, "Every change here needs Face ID and waits 3 days. So you can stop one you didn't make.");
  assert.ok(!/1-day/.test(note), "never the band's 1-day wait in place of the 3 days the change takes");
  // a band's own longer wait wins, and a second device is named
  assert.match(changeRuleWords([{ upToUsd: null, level: "both", waitSeconds: 5 * DAY }], 2 * DAY, PHONE_WORDS), /needs Face ID and your second device and waits 5 days/);
});

test("grade 01d Q7: the page says the wait of the rules the account holds, the same wait the approval sheet says", () => {
  // The account: up to $490 Approve, above a 1-hour wait; a 1-minute recovery wait (testnet). The person picks 1 day.
  const held: Band[] = [{ upToUsd: 490, level: "faceid", waitSeconds: HOUR }, { upToUsd: null, level: "wait", waitSeconds: HOUR }];
  const picked: Band[] = [held[0], { ...held[1], waitSeconds: DAY }];
  assert.match(changeRuleWords(held, 60, WEB_WORDS), /waits 1 hour\./);
  assert.notEqual(changeRuleWords(picked, 60, WEB_WORDS), changeRuleWords(held, 60, WEB_WORDS), "control: the picked rules would say 1 day");
  // the sheet's line for the same change, from the contract's placement (its current last band: a 1-hour wait)
  assert.match(sheetLevelWords({ Wait: { seconds: "3600" } }), /^It waits 1 hour\./);
  // Protection.tsx hands the account's rules (`from`), never the ones on screen
  assert.match(readFileSync(new URL("./Protection.tsx", import.meta.url), "utf8"), /strictestWait\(from\)/);
});

test("grade 01d Q7: a save keeps an untouched limit's stored NEAR; a changed one is priced today", () => {
  const now = [{ up_to: [["near", "114416400000000000000000000"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "3600" } } }];
  const nowUsd = usdBands(now, 4.28, new Map([["114416400000000000000000000", 490]]))!;
  const prices = { near: 4.32 } as never;
  const same = keepUntouched(contractBands([{ upToUsd: 490, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: DAY }], prices, "testnet"), [{ upToUsd: 490, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: DAY }], now, nowUsd);
  assert.deepEqual((same[0] as { up_to: unknown }).up_to, now[0].up_to, "the $490 band the person didn't touch keeps 114.4164 NEAR");
  assert.deepEqual((same[1] as { level: unknown }).level, { Wait: { seconds: "86400" } }, "the band they changed changes");
  const moved = keepUntouched(contractBands([{ upToUsd: 1000, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: HOUR }], prices, "testnet"), [{ upToUsd: 1000, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: HOUR }], now, nowUsd);
  assert.notDeepEqual((moved[0] as { up_to: unknown }).up_to, now[0].up_to, "control: a new limit is priced afresh");
  // a different coin list (H01's "count every coin") is written new, even at the same dollars
  const more = [{ up_to: [["near", "1"], ["nep141:wrap.near", "1"]], level: "FaceId" }, { up_to: null, level: "FaceId" }];
  assert.deepEqual(keepUntouched(more, [{ upToUsd: 490, level: "faceid" }, { upToUsd: null, level: "faceid" }], now, nowUsd), more);
});

test("the bands read in plain words, naming the approval this device really asks for", () => {
  // QA sd-security (j): one form everywhere (rule-words.ts needWords), the same as Protection's rows
  assert.deepEqual(SAMPLE.map((b) => levelWords(b, PHONE_WORDS)), ["Your face", "Your face, then a 1-day wait", "Your face, then a 1-day wait"]);
  assert.equal(levelWords({ upToUsd: null, level: "both", waitSeconds: 3 * DAY }, PHONE_WORDS), "Your face, a 3-day wait and your second device");
  // A browser has no Face ID: its sheet's Approve is the approval.
  assert.deepEqual(SAMPLE.map((b) => levelWords(b, WEB_WORDS)), ["Your yes", "Your yes, then a 1-day wait", "Your yes, then a 1-day wait"]);
  assert.equal(levelWords({ upToUsd: null, level: "wait", waitSeconds: 120 }, WEB_WORDS), "Your yes, then a 2-minute wait");
  assert.deepEqual(SAMPLE.map((_, i) => rangeWords(SAMPLE, i)), ["Up to $1,000", "$1,000 to $10,000", "Over $10,000"]);
  assert.equal(rangeWords([{ upToUsd: null, level: "faceid", waitSeconds: DAY }], 0), "Any amount", "a child's one band");
  assert.equal(usd(487.25), "$487.25");
  assert.equal(usd(500), "$500");
  assert.equal(waitLabel(120), "2 minutes");
  assert.equal(waitLabel(3 * DAY), "3 days");
  assert.deepEqual(waitChoices(DAY), [HOUR, DAY, 3 * DAY]);
  assert.deepEqual(waitChoices(120), [120, HOUR, DAY, 3 * DAY], "the account's own wait is offered, so it shows as picked");
  // N8: the account's 2 minutes stays a choice after "1 hour" is picked.
  assert.deepEqual(waitChoices(HOUR, [120]), [120, HOUR, DAY, 3 * DAY]);
  assert.deepEqual(waitChoices(DAY, [120]), waitChoices(120, [120]), "the list never changes with the pick");
});

test("N3: Save says what it's doing from the tap, and is off while it does", () => {
  assert.equal(saveLabel({ first: false, edited: true, fewCoins: false, saving: false }), "Save my rules");
  assert.equal(saveLabel({ first: false, edited: true, fewCoins: false, saving: true }), "Saving…");
  assert.equal(saveLabel({ first: true, edited: false, fewCoins: false, saving: false }), "Turn on");
  assert.match(SAVING_STATUS, /approve/);
  const src = readFileSync(new URL("./Protection.tsx", import.meta.url), "utf8");
  assert.match(src, /setSaving\(true\);\s*const res = await bridge\.call/, "the status is set before the core is asked");
  assert.match(src, /disabled=\{!fresh \|\| !dirty \|\| saving \|\| \(!!fewCoins && !edited && !pendingRead\)\}/);
  // UX walk 2 Nov: rules that count every coin already saved and held are finished, never saved a second time
  assert.ok(src.includes(`onClick={() => onWaiting(finishSaved)}>{finishSaved.ready ? "Finish my new rules" : "See my new rules"}`));
  assert.ok(src.includes(`role="status">{approved ? SAVED_STATUS : SAVING_STATUS}`));
  // Q10: Approve switches it to saving at once, from the shell's own word that the sheet was answered
  assert.ok(src.includes("onApprovalAnswered((yes) => yes && setApproved(true))"));
  assert.match(SAVED_STATUS, /^Approved\. Saving/);
});

test("onPhone is the iPhone app's message channel only", () => {
  assert.equal(onPhone(undefined), false);
  assert.equal(onPhone({}), false);
  assert.equal(onPhone({ webkit: { messageHandlers: {} } }), false);
  assert.equal(onPhone({ webkit: { messageHandlers: { zerofee: {} } } }), true);
});

test("the rules on chain are shown as what is true: coin limits rounded down, never bigger than they are", () => {
  const onChain = [
    { up_to: [["near", "5123456789000000000000000"]], level: "FaceId" },
    { up_to: [["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "2500000000"]], level: { Wait: { seconds: "86400" } } },
    { up_to: null, level: { Both: { seconds: "259200" } } },
  ];
  assert.deepEqual(rulesNow(onChain, PHONE_WORDS), ["Up to 5.1234 NEAR, NEAR only: Your face", "Up to $2,500 in USDC: Your face, then a 1-day wait", "Anything bigger: Your face, a 3-day wait and your second device"]);
  assert.deepEqual(rulesNow(onChain, WEB_WORDS)[0], "Up to 5.1234 NEAR, NEAR only: Your yes");
  assert.deepEqual(rulesNow("nonsense"), []);
  // D8: dollars first when the account's limit is in NEAR only (testnet); said once, "today" as it moves with NEAR.
  const nearOnly = [{ up_to: [["near", "113895200000000000000000000"]], level: "FaceId" }, { up_to: null, level: "FaceId" }];
  assert.deepEqual(rulesNow(nearOnly, WEB_WORDS, [{ upToUsd: 500, about: true }, { upToUsd: null }])[0], "Up to about $500 today, NEAR only: Your yes");
  // 02e, E3: a limit that carries the dollars chosen says them as its sheet does, with no "about".
  assert.deepEqual(rulesNow(nearOnly, WEB_WORDS, [{ upToUsd: 500 }, { upToUsd: null }])[0], "Up to $500 today, NEAR only: Your yes");
  assert.deepEqual(rulesNow([{ up_to: null, level: "Mystery" }]), ["Anything bigger: your strictest level"]);
});

test("RELEASE BLOCKER: the Protection screen's first render is exactly what set-up wrote, on mainnet and on testnet", () => {
  for (const network of ["mainnet", "testnet"] as const) {
    // What set-up writes to the contract (the core's DEFAULT_PROTECTION at a price), and what protection.get reads back.
    const price = 3.17;
    const onChain = contractBands(defaultBands(network), { near: price }, network);
    const usdNow = usdBands(onChain, network === "mainnet" ? null : price);
    const shown = openOn({ bands: onChain, usd: usdNow }, network, PHONE_WORDS);
    assert.equal(shown.k, "bands");
    if (shown.k !== "bands") return;
    assert.equal(shown.first, false, "the rules are on: no 'Turn on'");
    const wait = DEFAULT_PROTECTION.waitSeconds[network];
    assert.deepEqual(toCore(shown.bands), defaultBands(network));
    assert.deepEqual(shown.bands.map((_, i) => rangeWords(shown.bands, i)), ["Up to $500", "Over $500"]);
    assert.deepEqual(shown.bands.map((b) => levelWords(b, PHONE_WORDS)), ["Your face", network === "mainnet" ? "Your face, then a 1-day wait" : "Your face, then a 2-minute wait"]);
    assert.equal(shown.bands[1].waitSeconds, wait);
    // Saving with nothing changed is not offered; what a save would send is the account's own rules, nothing else.
    assert.equal(changed(shown.bands, shown.from), false);
    assert.deepEqual(toCore(shown.bands), [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: wait }]);
  }
});

test("Protection opens on the account's rules, whatever they are; never on a number of its own", () => {
  // The person's own (a laptop above $250, a 1-hour wait): shown as they are.
  const usdNow = [{ upToUsd: 250, level: "faceid" as const }, { upToUsd: null, level: "both" as const, waitSeconds: HOUR }];
  const shown = openOn({ bands: [{}, {}], usd: usdNow }, "mainnet");
  assert.ok(shown.k === "bands");
  assert.deepEqual(toCore(shown.bands), usdNow);
  // A band with no wait carries the account's own wait, used only if the person picks a wait for it.
  assert.deepEqual(fromCore(usdNow)![0], { upToUsd: 250, level: "faceid", waitSeconds: HOUR });
  // Changing one band keeps every other band exactly as the account holds it.
  const edited = shown.bands.map((b, i) => (i === 0 ? { ...b, upToUsd: 100 } : b));
  assert.equal(changed(edited, shown.from), true);
  assert.deepEqual(toCore(edited)[1], usdNow[1]);
  // Bands the core couldn't say in dollars, or no answer: the coin rules only, and nothing to save.
  assert.deepEqual(openOn({ bands: [{ up_to: [["near", "1"]], level: "FaceId" }], usd: null }, "testnet", PHONE_WORDS), { k: "unread", now: ["Up to 0 NEAR, NEAR only: Your face"] });
  assert.deepEqual(openOn(null, "mainnet"), { k: "unread", now: [] });
  // An account with no bands yet (made before protection): set-up's own defaults, offered with "Turn on".
  const none = openOn({ bands: [], usd: null }, "mainnet");
  assert.ok(none.k === "bands" && none.first);
  assert.deepEqual(toCore(none.bands), defaultBands("mainnet"));
});

test("the Recovery tab's wait reads as people say it", () => {
  assert.equal(waitPlain(7 * DAY), "7 days");
  assert.equal(waitPlain(DAY), "1 day");
  assert.equal(waitPlain(HOUR), "1 hour");
  assert.equal(waitPlain(120), "2 minutes");
  assert.equal(waitPlain(60), "1 minute");
  assert.equal(waitPlain(0), "1 minute");
});

test("a moment reads without seconds, and with the year only when it isn't this year", () => {
  const now = new Date("2026-10-26T01:00:00Z");
  const same = whenWords("2026-11-01T15:27:44Z", now, "en-GB");
  assert.doesNotMatch(same, /44|2026/);
  assert.match(same, /Nov/);
  assert.match(whenWords("2027-01-02T10:00:00Z", now, "en-GB"), /2027/);
  assert.equal(whenWords("not a date", now), "soon");
});

test("H01: rules that count only NEAR, USDC and USDT open with 'count every coin'; rules written today don't, and say the other coins as a count", () => {
  const old = [
    { up_to: [["near", `200${"0".repeat(24)}`], ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "500000000"], ["nep141:usdt.tether-token.near", "500000000"]], level: "FaceId" },
    { up_to: null, level: { Wait: { seconds: "86400" } } },
  ];
  assert.ok(countsFewCoins(old));
  const o = openOn({ bands: old, usd: usdBands(old, null) }, "mainnet");
  assert.ok(o.k === "bands" && o.fewCoins === true && !changed(o.bands, o.from), "nothing edited, yet it can be saved");
  const t = openOn({ bands: old, usd: usdBands(old, null) }, "testnet");
  assert.ok(t.k === "bands" && !t.fewCoins, "testnet counts NEAR only by design");
  const today = contractBands(defaultBands("mainnet"), { near: 2.5 }, "mainnet");
  assert.ok(!countsFewCoins(today));
  const n = openOn({ bands: today, usd: usdBands(today, null) }, "mainnet");
  assert.ok(n.k === "bands" && !n.fewCoins);
  const line = rulesNow(today, PHONE_WORDS)[0]!;
  assert.equal(line, "Up to $500 in any coin with a price: Your face");
  assert.doesNotMatch(line, /nep141/, "never an id on screen");
  assert.match(FEW_COINS_LINE, /Save them once to fix it/);
});

test("02e, E9: the score is never 'strong for big money' while the words take the account in under 48 hours", () => {
  assert.equal(strengthWords(4, 60, "testnet"), "1-minute test wait, not real protection");
  assert.equal(strengthWords(5, 120, "testnet"), "2-minute test wait, not real protection");
  assert.equal(strengthWords(5, DAY, "mainnet"), "strong");
  assert.equal(strengthWords(4, 2 * DAY, "mainnet"), "strong");
  assert.equal(strengthWords(3, 7 * DAY, "mainnet"), "stronger with more steps");
});

test("round 3: Protection says the rule-change wait in one line; the full rule is its disclosure, never dropped", () => {
  assert.deepEqual(changeRuleLine(SAMPLE, 2 * DAY, PHONE_WORDS), { line: "A change to these rules takes 3 days.", waits: true });
  // the "Why changes wait" disclosure left with the design review (§3: "the one line says it"); the line still reads the account's rules (`from`)
  assert.match(readFileSync(new URL("./Protection.tsx", import.meta.url), "utf8"), /rule\.waits \? ruleChangeFoot\(strictestWait\(from\), recoveryDelaySeconds\) : rule\.line/);
  // S10a (the copy review's Sim walk): three waits, each named, each the contract's (lib.rs 1408: delay + min(delay, a day))
  assert.equal(ruleChangeFoot(DAY, 7 * DAY), "A change to these rules takes 8 days.", "the copy review's S5: the figure, no arithmetic");
  assert.equal(ruleChangeWait(DAY, 7 * DAY), 8 * DAY, "the figure is the contract's own");
  assert.equal(ruleChangeFoot(10 * DAY, 7 * DAY), "A change to these rules takes 10 days.", "control: a longer band wait is the figure");
  assert.equal(ruleChangeFoot(0, 0), "A change to these rules takes 1 minute.", "control: no recovery wait");
  const account = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  // the copy review's S3 (7 Nov): the Recovery row says "Backup words" and no wait (the wait lives on Recovery): account-rows.ts
  assert.match(account, /value=\{says\.recovery\.value\}/, "Account's Recovery row takes its words from accountRowWords");
  // No wait at all: the full sentence is already one short line, and nothing goes behind a tap.
  const none = changeRuleLine([{ upToUsd: null, level: "faceid", waitSeconds: 0 }], 0, PHONE_WORDS);
  assert.equal(none.waits, false);
  assert.equal(none.line, changeRuleWords([{ upToUsd: null, level: "faceid", waitSeconds: 0 }], 0, PHONE_WORDS));
});

test("5 Nov: a rule says one figure and which coins can use it, never \"the same in 1 other coin\" (control: the old line is gone)", () => {
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", USDT = "nep141:usdt.tether-token.near";
  const NEAR = (n: string) => `${n}000000000000000000000000`;
  const rest = { up_to: null, level: "FaceId" };
  // today's rules: every priced coin listed, the dollar coins' figure is the limit
  const every = [{ up_to: [["near", NEAR("200")], [USDC, "500000000"], [USDT, "500000000"], ["nep141:wrap.near", NEAR("200")]], level: "FaceId" }, rest];
  assert.equal(rulesNow(every, PHONE_WORDS)[0], "Up to $500 in any coin with a price: Your face");
  // one other coin only: the same line, no count
  const one = [{ up_to: [[USDC, "500000000"], ["nep141:wrap.near", NEAR("200")]], level: "FaceId" }, rest];
  assert.equal(rulesNow(one, PHONE_WORDS)[0], "Up to $500 in any coin with a price: Your face");
  // older rules: the three coins named, so every other coin takes the strictest rule
  const three = [{ up_to: [["near", NEAR("200")], [USDC, "500000000"], [USDT, "500000000"]], level: "FaceId" }, rest];
  assert.equal(rulesNow(three, PHONE_WORDS)[0], "Up to $500 in NEAR, USDC or USDT: Your face");
  assert.equal(rulesNow([{ up_to: [["near", NEAR("200")], [USDC, "500000000"]], level: "FaceId" }, rest], PHONE_WORDS)[0], "Up to $500 in NEAR or USDC: Your face");
  // every coin, the figure read in dollars at today's price (no dollar coin listed)
  const noDollar = [{ up_to: [["near", NEAR("100")], ["nep141:wrap.near", NEAR("100")]], level: "FaceId" }, rest];
  assert.equal(rulesNow(noDollar, PHONE_WORDS, [{ upToUsd: 500, about: true }, { upToUsd: null }])[0], "Up to about $500 today in any coin with a price: Your face");
  for (const bands of [every, one, three, noDollar]) {
    const line = rulesNow(bands, PHONE_WORDS)[0]!;
    assert.doesNotMatch(line, /other coin|the same in|nep141|wrap\.near/, line);
    assert.ok((line.match(/\$?\d[\d,.]*/g) ?? []).length === 1, `one figure: ${line}`);
  }
  // control: the line before the fix, on the same bands, would fail the check above
  assert.match("Up to $500, or the same in 1 other coin: Face ID", /other coin|the same in/);
  // the last band reads as it did
  assert.equal(rulesNow(every, PHONE_WORDS)[1], "Anything bigger: Your face");
});
