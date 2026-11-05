// Pay's journey script (Alpha metric 9, D29): every Pay path in ?demo, light and dark, in headless Chrome, with the
// set-up taps counted against the rubric (≤ 5) and zero console errors. Exit 0 only if every check passes.
//
//   node tools/pay/journey.mjs http://127.0.0.1:5180   (a running `npm run -w @zerofee/web dev`; any port)
//   SHOTS=/some/dir node tools/pay/journey.mjs <url>   (also saves a screenshot per step)
//
// Uses the Chrome installed on this Mac through its DevTools protocol; nothing is installed. Always the fake camera
// and fake permission prompt: Scan never asks this Mac for its real camera. What the person "copied" in a partner's
// page is put on the clipboard by the script, the one thing a partner's own screens would do.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("usage: node tools/pay/journey.mjs <web app url, e.g. http://127.0.0.1:5180>");
  process.exit(2);
}
const origin = new URL(base).origin;
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** A port nothing is listening on, so this never drives another session's Chrome. */
const port = await new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "pay-journey-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=393,852", "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The demo's sample Gnosis Pay card (MockBridge SAMPLE_CARD), a sample IBAN, an exchange's address, a PIX code. */
const SAMPLE_CARD = "0x2527" + "0".repeat(32) + "f10d";
const IBAN = "CH93 0076 2011 6238 5295 7";
const DEPOSIT = "0x7c1a00000000000000000000000000000000009e";
/** Home shows Wallet's own total (D12: one balance, useBalanceTotal), no second total; the figure is Wallet's sum. */
const TOTAL = ["Your balance", "one balance"];
const NEAR_NAME = "friend.near";
/** A sample ether.fi deposit address (an address on Base). */
const ETHERFI = "0x1144fBbD23cEc7A43A0BdA8682ed842c4E035F81";  // generated sample
/** An exchange's Solana deposit address (a sample: 32 bytes in base58). */
const SOL_DEPOSIT = "So11111111111111111111111111111111111111112";
/** Home's big figure, shown (useBalanceTotal is null, and the figure hidden, until every part has answered). */
const SHOWN_TOTAL = `[...document.querySelectorAll(".py-big")].some((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== "hidden" && /^\\$[\\d,]+\\.\\d\\d$/.test(b.textContent.trim()))`;
/** The welcome screen's "Later", visible. */
const LATER = `[...document.querySelectorAll("button")].some((b) => b.offsetParent !== null && b.textContent.trim() === "Later")`;
const PIX = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

const failures = [];
const errors = [];
let ws;
try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let n = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const cdp = (method, params = {}) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
  const shot = async (name) => {
    if (!shots) return;
    await sleep(400);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  /** One tap on the first visible element with this text (inside `selector`). False if there's none. */
  const tap = async (text, selector = "button") => {
    const ok = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.offsetParent !== null && b.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
    await sleep(900);
    return ok;
  };
  const has = (...texts) => js(`(() => { const t = document.body.textContent; return ${JSON.stringify(texts)}.every((x) => t.includes(x)); })()`);
  /** Wait (up to 4 s) for texts that arrive with a read, such as Earn's positions behind Home's two numbers. */
  const until = async (...texts) => {
    for (let i = 0; i < 20; i++) {
      if (await has(...texts)) return true;
      await sleep(200);
    }
    return false;
  };
  const copy = (text) => js(`navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => true, () => false)`);
  const back = async () => {
    // The Back on screen: the shell keeps neighbouring apps mounted, each with its own Back.
    await js(`[...document.querySelectorAll('[aria-label="Back"]')].find((b) => { const r = b.getBoundingClientRect(); return b.offsetParent !== null && r.left >= 0 && r.left < window.innerWidth; })?.click()`);
    await sleep(900);
  };
  const tray = (label) => tap(label, 'nav[aria-label="Pay"] button');
  const check = (ok, what) => {
    if (!ok) failures.push(what);
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  };
  const open = async (theme, query = "") => {
    // A first open every time: this origin's storage cleared, so the welcome screen and empty tiles show.
    await cdp("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    await cdp("Page.navigate", { url: `${base.replace(/\/$/, "")}/?demo${query}` });
    await sleep(5000);
    if (theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    // The app opens on Wallet (D31b); Pay is one app to its right (Security, Wallet, Pay).
    for (let i = 0; i < 1; i++) {
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
      await sleep(1500);
    }
  };

  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  for (const theme of ["light", "dark"]) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    console.log(`— ${theme}`);
    await open(theme);

    // D36: Pay's one question at first open, "Where is your bank?" (light walks TH, dark walks the EU). Places are named
    // in the person's own language (Intl), never written in the repo.
    const place = theme === "light" ? "TH" : "EU";
    const row = async (text) => {
      const ok = await js(`(() => { const b = [...document.querySelectorAll("button.py-row")].find((x) => x.offsetParent !== null && x.textContent.includes(${JSON.stringify(text)})); b?.click(); return Boolean(b); })()`);
      await sleep(900);
      return ok;
    };
    const people = (text) => js(`[...document.querySelectorAll('[aria-label="People"] button')].filter((b) => b.offsetParent !== null && b.textContent.includes(${JSON.stringify(text)})).length`);
    const says = async (name) => {
      const ok = await row(`What ${name} says`);
      return ok;
    };
    const closeSheet = async () => {
      await js(`[...document.querySelectorAll(".zf-sheet__scrim")].at(-1)?.click()`);
      await sleep(500);
    };
    /**
     * A test's payment (the robot's pass 3): the Paid screen, never the question by itself; Done goes Home, where the
     * tile says "On its way · did it arrive?" and a tap on it asks.
     */
    const paidThenAsk = async (tile, question) => {
      let done = false;
      for (let i = 0; i < 40 && !done; i++) {
        await sleep(250);
        done = (await pill()).split(" | ").includes("Done");
      }
      await sleep(2500);
      const popped = await has(question);
      await tap("Done");
      await sleep(900);
      const line = await until("On its way · did it arrive?");
      await tap(tile, ".py-tile");
      await sleep(800);
      return { done, popped, line, asked: await has(question) };
    };
    const pill = () => js(`[...document.querySelectorAll("button.zf-btn")].filter((b) => { const r = b.getBoundingClientRect(); return b.offsetParent !== null && r.left >= 0 && r.left < window.innerWidth; }).map((b) => b.textContent).join(" | ")`);
    const sections = () => js(`[...document.querySelectorAll("section[aria-label]")].filter((s) => s.offsetParent !== null).map((s) => s.getAttribute("aria-label")).join(",")`);
    await shot(`${theme}-1-country`);
    check((await has("Where is your bank?", "Somewhere else", "Skip")) && (await js(`(() => { const r = [...document.querySelectorAll('[role="radiogroup"] [data-code]')]; return r.length === 11 && r.every((b) => b.textContent.trim().length > 2); })()`)), `${theme}: first open asks the one question, each place named in the person's own language`);
    await js(`document.querySelector('[data-code="${place}"]')?.click()`);
    await sleep(1200);

    // The gate (D38): a new Pay opens on "What's available", never Home, until a card or another provider exists. The
    // tray stays (Receive to add money, Scan, Send).
    await shot(`${theme}-2-gate`);
    check((await until("What's available", "Listed A–Z.")) && !(await has("Your balance")) && !(await js(LATER)), `${theme} (${place}): with nothing set up, Pay opens on What's available, never Home (and no "Later")`);
    check(await js(`[...document.querySelectorAll('nav[aria-label="Pay"] button')].map((b) => b.textContent.trim()).join(",") === "Send,Receive,Scan"`), `${theme}: the tray is Send · Receive · Scan`);

    // What's available (D36/D37 step 2): every provider of each section, A–Z (ZeroFee ranks and endorses none), one made
    // only in its own app said so in its row.
    let taps = 0;
    // Something that fits is already copied: nothing is read until the person taps Paste (D33).
    await copy(SAMPLE_CARD);
    await shot(`${theme}-2b-available`);
    const listed = (section) => js(`[...document.querySelector('section[aria-label="${section}"]')?.querySelectorAll("button.py-row .t") ?? []].map((t) => t.firstChild.textContent.trim()).join(",")`);
    if (place === "TH") {
      check((await sections()) === "No ID check,With an ID check,Pay a code" && (await listed("No ID check")) === "SolCard,Bitrefill" && (await listed("With an ID check")) === "ether.fi,Mt Pelerin,Binance TH" && (await has("www.ether.fi", "solcard.cc", "www.bitrefill.com")) && (await has("Listed A–Z. ZeroFee isn't in the middle.", "Scan reads PromptPay codes.", "No ID check", "With an ID check", "4 steps: an account, a $10 deposit, its ID check, add the card", "1 step: pick a gift card and pay")) && !(await has("RedotPay")) && !(await has("See all")), `${theme} (TH): no ID check on top, the rest under it, each by section A–Z with its domain and its steps; RedotPay (5 steps) not listed; PromptPay codes`);
    } else {
      check((await sections()) === "No ID check,With an ID check,Pay a code" && (await listed("No ID check")) === "SolCard,Bitrefill" && (await listed("With an ID check")) === "Bleap,ether.fi,MetaMask Card,Kraken" && (await has("Scan reads SEPA transfer codes.", "In its own app.", "4 steps: a MetaMask wallet, a card account, its ID check, a spending limit")) && !(await has("Mt Pelerin")), `${theme} (EU): no ID check on top, the rest under it, by section A–Z, each with its steps; SEPA codes; no Mt Pelerin in the EU (until a product decision)`);
    }

    // SolCard (D38): listed as what it is, in its own words, with Security's no-ID lines; Pay doesn't send to it, since its
    // own page names no coin or network.
    if (place === "TH") {
      await row("SolCard");
      await says("SolCard");
      check((await has("solcard.cc", "SolCard says: Top-ups cost 5%, plus $10 for each new card", "Run by SC Payments Ltd (Hong Kong). The card's issuer isn't named.", "it may take 10% a month of what's left", "It can suspend a card without notice.", "No ID check also means no one can unfreeze or recover this card for you.", "Check that prepaid cards are allowed where you live.", "Its own page doesn't say which coin and network it takes, so ZeroFee only opens its page.")) && !(await has("A small network fee.")), `${theme} (TH): SolCard's cost screen says what it is in its own words, Security's no-ID lines, and that ZeroFee only opens its page`);
      await closeSheet();
      check((await pill()) === "Open SolCard" && (await has("You set it up on its own page. ZeroFee only opens it.")), `${theme} (TH): a provider Pay only opens says so on its pill: "Open SolCard", never a Start that leads back (robot pass 4)`);
      await back();
    }

    // Card: first what it costs (D37 step 3), then ether.fi's own sign-up in Pay's window; back, the field has focus and
    // the pill pastes (D33).
    if (await row("ether.fi")) taps += 1;
    await shot(`${theme}-2c-cost`);
    // At most three lines before the pill (what it is, its costs, whose customer); the rest behind "What ether.fi says".
    const beforePill = await js(`[...document.querySelectorAll(".py-col > p")].filter((p) => p.offsetParent !== null && !p.closest(".py-floor")).length`);
    check(beforePill === 3 && !(await has("ether.fi: A Visa card")) && !(await has("you see its exact cost before you say yes")) && (await until("Sending $5 there from ZeroFee costs", "now and takes about a minute (an estimate).")) && (await has("What ether.fi says")), `${theme}: Before you start: exactly three lines before the pill, its name said once, Pay's own move priced from a live quote in dollars, the facts behind "What ether.fi says" (${beforePill} lines)`);
    await says("ether.fi");
    check((await has("Before you start", "ether.fi says: Core members normally get one free virtual card; in some regions the first one costs $10", "Its own page has the current costs.", "Sending money there: you see its exact cost before you say yes.", "ether.fi is its own company. You're its customer, not ZeroFee's. ZeroFee isn't in the middle")) && (await pill()) === "Start", `${theme}: before ether.fi opens, what it costs and how long, and that the person is ether.fi's customer`);
    await closeSheet();
    if (await tap("Start")) taps += 1;
    // One start, not two (the robot's walk): Start leads straight to the address, the pill opening ether.fi first.
    check(!(await has("card wallet")) && !(await has("Get a debit card")) && (await has("Your card's address", "Get a card in the ether.fi app", "I already have one", "Top up a Gnosis Pay card")) && (await pill()) === "Open ether.fi", `${theme}: Start leads straight to the card's address, "Open ether.fi" first, "I already have one" beside it`);
    if (await tap("Open ether.fi")) taps += 1;
    // Coming back from ether.fi's window (the demo bridge hears the page come back, like the phone's Done).
    await copy(ETHERFI);
    await js(`document.dispatchEvent(new Event("visibilitychange"))`);
    await sleep(900);
    check(!(await has("Use the address you copied?")) && (await js(`document.activeElement?.getAttribute("aria-label") ?? ""`)).includes("card's address") && (await pill()) === "Paste the address you copied", `${theme}: back from ether.fi, nothing is read: the field has focus and the pill is "Paste the address you copied"`);
    // Not an address: the Problem screen at once, and "Copy it again" brings back an empty field (robot pass 5).
    await copy("hello world");
    await tap("Paste the address you copied");
    await sleep(600);
    check((await has("That isn't a Base address, and ether.fi tops up on Base.", "Copy it again")) && !(await has("starts hello")), `${theme}: a pasted non-address is the Problem screen at once, never shown as an address`);
    await tap("Copy it again");
    await sleep(600);
    check((await pill()) === "Paste the address you copied" && (await js(`[...document.querySelectorAll("input")].find((i) => i.offsetParent !== null && (i.getAttribute("aria-label") ?? "").includes("card's address"))?.value ?? "gone"`)) === "", `${theme}: "Copy it again" comes back to an empty field and the paste pill (no Save/Problem loop)`);
    await copy(ETHERFI);
    if (await tap("Paste the address you copied")) taps += 1;
    check((await has("We'll check it with your first top-up.", "On Base. Check the start and end match the ether.fi app.", "tap Deposit, pick USDC, then Base")) && (await pill()) === "Save", `${theme}: a hand-off card says which address to copy, shows it in full on Base, and is checked by its first top-up`);
    if (await tap("Save")) taps += 1;
    await sleep(800);
    await shot(`${theme}-3-card`);
    check(taps === 5 && (await has("Top up $5", "Your ether.fi card", "First top-up: a test, up to $5.")), `${theme}: card set up in ${taps} taps from Pay's first screen, nothing typed; its first top-up is small`);
    // Its first top-up, a test: the sheet, then "did it arrive?"; Home then says what was sent so far (Pay's receipts).
    await tap("Top up $5");
    await sleep(1500);
    // Straight to the approval sheet, the amount said once, the address in full on its Details line (the robot's walk).
    await sleep(900);
    await shot(`${theme}-3a-topup-sheet`);
    check(!(await has("Top up 5")) && (await has("Approve", "Details: ")), `${theme}: the first top-up goes from its amount straight to the approval sheet, with the full address under Details`);
    await tap("Approve");
    const first = await paidThenAsk("ether.fi", "Yes, it arrived");
    await shot(`${theme}-3c-arrived`);
    check(first.done && !first.popped, `${theme}: after the first top-up, the Paid screen; the question never pops up by itself`);
    check(first.line, `${theme}: after Done, its tile says "On its way · did it arrive?" at once`);
    check(first.asked && (await has("Did 5.00 USDC arrive", "Not yet? Pay asks again next time you open it.")), `${theme}: tapping that tile asks whether it arrived ("5.00 USDC", one format)`);
    await tap("Yes, it arrived");
    await sleep(900);
    // Back on Home, the last total paints at once: never "$0.00" while the fresh read comes (the product rule).
    await js(`[...document.querySelectorAll('[aria-label="Back"]')].find((b) => { const r = b.getBoundingClientRect(); return b.offsetParent !== null && r.left >= 0 && r.left < window.innerWidth; })?.click()`);
    const firstPaint = await js(`new Promise((done) => requestAnimationFrame(() => done([...document.querySelectorAll(".py-big")].find((b) => b.offsetParent !== null)?.textContent ?? "")))`);
    check(firstPaint !== "$0.00" && (firstPaint === "" || /^\$[\d,]+\.\d\d$/.test(firstPaint)), `${theme}: Home's first frame never shows $0.00 (${firstPaint || "nothing yet"})`);
    await sleep(900);
    await shot(`${theme}-3b-home`);
    // Home's first time on screen: Wallet's total arrives with its read (never $0.00 meanwhile).
    let totalShown = false;
    for (let i = 0; i < 20 && !totalShown; i++) {
      totalShown = await js(SHOWN_TOTAL);
      if (!totalShown) await sleep(200);
    }
    const homeOk = (await until(...TOTAL, "ether.fi", "Sent so far: $5")) && totalShown;
    check(homeOk, `${theme}: now Home: Wallet's own total, the card, and what Pay sent it so far ($5, Pay's own receipt)${homeOk ? "" : ` (tile: ${await js(`[...document.querySelectorAll(".py-tile")].filter((t) => t.offsetParent !== null).map((t) => t.textContent).join(" | ")`)})`}`);

    // Bank (TH; never in the EU): the IBAN copied in Mt Pelerin, pasted by the pill and saved. An empty paste says so.
    if (place === "TH") {
      taps = 0;
      await copy(IBAN);
      if (await row("Add a card, bank or exchange")) taps += 1;
      check(await js(`[...document.querySelectorAll("button.py-row")].some((b) => b.offsetParent !== null && b.textContent.includes("ether.fi") && b.querySelector(".v")?.textContent.includes("Added"))`), `${theme} (TH): What's available marks the ether.fi card already set up as "Added"`);
      if (await row("Mt Pelerin")) taps += 1;
      if (await tap("Start")) taps += 1;
      check(await has("bank account number (IBAN) in your own name", "Mt Pelerin is its own company, and you're its customer, not ZeroFee's."), `${theme}: the bank tile says what you get, and whose customer the person is`);
      if (await tap("I already have one")) taps += 1;
      await copy("");
      await tap("Paste the account number you copied");
      check(await has("Nothing copied yet"), `${theme}: an empty paste on the bank says "Nothing copied yet"`);
      await copy(IBAN);
      if (await tap("Paste the account number you copied")) taps += 1;
      if (await tap("Save")) taps += 1;
      await shot(`${theme}-4-bank`);
      check(taps === 6 && (await has("Your account number (IBAN)", "Add money", "Pay a bank bill", "Scan a bank bill", "Send money to this account from your bank")) && !(await has("Fill login")) && !(await has("SEPA or Swiss")) && !(await has("Inside ZeroFee")), `${theme}: bank set up in ${taps} taps, nothing typed; plain words, no greyed Fill login`);
      await back();
    }

    // Your exchange: the place's own (Binance TH, Kraken), its name already there; one paste field; network from the address.
    const clearAddress = async () => {
      await js(`(() => { const i = [...document.querySelectorAll('input[aria-label$="deposit address"]')].find((x) => x.offsetParent !== null); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(300);
    };
    const ex = place === "TH" ? "Binance TH" : "Kraken";
    // Counted from What's available, like the card's (the Home row only opens the list).
    await row("Add a card, bank or exchange");
    taps = 0;
    if (await row(ex)) taps += 1;
    check(await has("Before you start", place === "TH" ? "฿20" : "about €1 by SEPA Instant"), `${theme}: ${ex}'s own payout cost before it opens`);
    if (await tap("Start")) taps += 1;
    const exName = `[...document.querySelectorAll('input[aria-label="Your exchange\\'s name"]')].find((i) => i.offsetParent !== null)?.value`;
    check((await js(exName)) === ex && (await has(`In ${ex}, open Deposit, pick USDC`, `${ex} is its own company, and you're its customer, not ZeroFee's.`, "You sign up on its page, in your own name.")) && (await pill()) === `Open ${ex}`, `${theme}: ${ex} opens with its name, where its address is, and whose customer the person is; the pill pastes it`);
    check((await pill()) === `Open ${ex}` && (await has("I already have one")) && !(await has("Open its page")), `${theme}: like the card, the pill opens ${ex}'s page first, "I already have one" beside it (robot pass 4)`);
    if (await tap(`Open ${ex}`)) taps += 1;
    await js(`document.dispatchEvent(new Event("visibilitychange"))`);
    await sleep(600);
    await copy("not an address");
    await tap("Paste the address you copied");
    await tap("Save my exchange");
    await sleep(600);
    check((await has(`That doesn't read as a USDC deposit address ${ex} takes.`, "Copy it again")), `${theme}: a bad address is a Problem screen, like the card's (robot pass 4)`);
    await tap("Copy it again");
    await sleep(600);
    check((await pill()) === "Paste the address you copied", `${theme}: "Copy it again" comes back to an empty field and the paste pill`);
    await clearAddress();
    if (place === "TH") {
      await copy(DEPOSIT);
      if (await tap("Paste the address you copied")) taps += 1;
      // ?demo lists USDC on Base among the EVM networks Binance TH takes, so its 0x address reads as Base; with more, Change shows.
      check((await has("USDC on Base")) && (await has("read from the address") || await has("works on several networks")), `${theme}: a 0x address reads as USDC on Base (or asks which network when it can't tell)`);
    } else {
      await copy(SOL_DEPOSIT);
      if (await tap("Paste the address you copied")) taps += 1;
      check((await has("USDC on Solana: read from the address.")) && (await js(exName)) === ex, `${theme}: a Solana address says its network; ${ex}'s name stays`);
    }
    if (await tap("Save my exchange")) taps += 1;
    await shot(`${theme}-5-exchange`);
    check(taps === 5 && (await has(`${ex} · an exchange`, "Choose an amount", `Then, in ${ex}, sell the USDC and send the money to your bank.`, `Your first send to ${ex}: a test, up to $25.`)), `${theme}: ${ex} saved in ${taps} taps; the payout is made in ${ex}'s own app; a first send is a test, up to $25`);
    await back();
    await shot(`${theme}-6-home`);
    check((await has("ether.fi", "Sent so far: $5", `${ex} · an exchange`, "Add a card, bank or exchange")), `${theme}: Home shows the ether.fi card (sent so far $5) and the ${ex} tile, and its one fixed add row`);

    // Gift cards and top-ups (D38 kind "voucher", Security's MUSTs): Bitrefill's own checkout in Pay's window; the person
    // pastes its address and exact amount; a first purchase is a test up to $25; then "did it arrive?"; refund words.
    await row("Add a card, bank or exchange");
    await row("Bitrefill");
    await says("Bitrefill");
    check((await has("Before you start", "www.bitrefill.com", "No account needed: the code is sent to your email.")), `${theme}: Bitrefill's cost screen says what it is, in its own words`);
    await closeSheet();
    await tap("Start");
    await shot(`${theme}-5b-checkout`);
    check((await has("Your first Bitrefill purchase: a test, up to $25.", "ZeroFee can't get the money back: payments can't be undone.", "Bitrefill's refund page", "Bitrefill is its own company, and you're its customer")) && !(await has("Remove Bitrefill from Pay")) && (await pill()) === "Open Bitrefill", `${theme}: the checkout screen says the first purchase is a test, that ZeroFee can't undo a payment, and links Bitrefill's refund page`);
    await tap("Open Bitrefill");
    await copy(SOL_DEPOSIT);
    await tap("Paste the address you copied");
    check((await has("On Solana. Check the start and end match Bitrefill's checkout.", "Pay within 10 minutes of copying it, or Bitrefill may not count it.")) && (await pill()) === "Paste the amount you copied", `${theme}: a Solana address reads as Solana; the window from the paste is said before paying`);
    await copy("30");
    await tap("Paste the amount you copied");
    await tap("Pay 30 USDC");
    await sleep(600);
    check(await has("Test purchases at Bitrefill have $25 left. We sent nothing."), `${theme}: more than the test's $25 in total is refused, nothing sent`);
    await tap("Pick something smaller");
    await sleep(600);
    check((await pill()) === "Paste the amount you copied" && (await js(`[...document.querySelectorAll('input[aria-label="Bitrefill\\'s exact amount"]')].find((x) => x.offsetParent !== null)?.value ?? "gone"`)) === "", `${theme}: "Pick something smaller" comes back to an empty amount and the paste pill (robot pass 4: no loop)`);
    await js(`(() => { const i = [...document.querySelectorAll('input[aria-label="Bitrefill\\'s exact amount"]')].find((x) => x.offsetParent !== null); if (!i) return; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(300);
    await copy("12.34 USDC");
    await tap("Paste the amount you copied");
    await tap("Pay 12.34 USDC");
    await sleep(1500);
    const payWords = await js(`[...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null && /Pay 12\\.34/.test(b.textContent)).length`);
    check(payWords === 0 && (await has("Approve")), `${theme}: the checkout's amount goes straight to the sheet, never "Pay 12.34 USDC" on a second screen`);
    await tap("Approve");
    const shop = await paidThenAsk("Bitrefill", "Did your Bitrefill code arrive, and does it work?");
    check(shop.done && !shop.popped && shop.line && shop.asked, `${theme}: after paying the checkout, the Paid screen; Home's Bitrefill tile asks whether the code arrived and works`);
    // Exactly "No" (tap() matches by "contains", and "Not yet" contains it), once the question has settled.
    await sleep(600);
    await js(`[...document.querySelectorAll("button")].find((b) => b.offsetParent !== null && b.textContent.trim() === "No")?.click()`);
    await sleep(600);
    await shot(`${theme}-5c-refund`);
    const refundWords = ["Only Bitrefill can give it back", "ZeroFee can't get the money back: payments can't be undone.", "Bitrefill says: A failed order is refunded; a code you've opened isn't.", "Open Bitrefill's refund page"];
    // The answer is kept first (a few store calls), then the refund screen shows.
    await until("Only Bitrefill can give it back");
    const missing = [];
    for (const w of refundWords) if (!(await has(w))) missing.push(w);
    check(missing.length === 0, `${theme}: "No" shows Bitrefill's own refund words and its refund page, never a promise from ZeroFee${missing.length ? ` (missing: ${missing.join(" | ")})` : ""}`);
    await tap("Back to Pay");
    await sleep(900);
    check(await until("Gift cards", "Bitrefill", "Sent so far: $12.34"), `${theme}: Home shows Bitrefill with what was sent so far`);

    // Money back from a provider (D38): Receive on its network, what to do there, and its own page one tap away.
    await tap("ether.fi", ".py-tile");
    await sleep(800);
    await row("Take money out");
    await shot(`${theme}-5d-take-out`);
    check((await has("Your ZeroFee address, to use in ether.fi", "Copy it below. In ether.fi, send USDC to it on Base, the same network as here.", "Open ether.fi", "Receive on Base")) && !(await has("0.001 ETH")), `${theme}: "Take money out" opens Receive on the card's network, says what to do in ether.fi, and opens it in one tap`);
    await back();
    check(await has("Manage this card", "Your ether.fi card"), `${theme}: Back from "Take money out" returns to the card, not Home`);
    if (place !== "TH") await back();

    // TH: remove a card (its receipts go with it), then a card with a closing notice moves to another one (migration).
    if (place === "TH") {
      check(!(await has("Remove this card")) && (await pill()).startsWith("Top up"), `${theme} (TH): the card screen has one pill, Top up; changing or removing it is behind "Manage this card"`);
      await tap("Manage this card");
      await tap("Remove this card");
      check((await has("Pay forgets its address and what it sent there.")) && (await pill()).includes("Remove your ether.fi card"), `${theme} (TH): Remove asks once, in one sheet`);
      await tap("Remove your ether.fi card");
      await sleep(900);
      check(!(await has("Sent so far: $5.00")) && (await has("Add a card, bank or exchange")), `${theme} (TH): removing the card forgets what Pay sent it; the add row offers a card again`);
      await row("from other companies");
      await row("ether.fi");
      await tap("Start");
      await tap("Top up a Gnosis Pay card");
      await copy(SAMPLE_CARD);
      await tap("Paste the address you copied");
      await tap("Check and save");
      await sleep(900);
      await shot(`${theme}-5e-closing`);
      check(await has("Move to another card", "Gnosis Pay cards stop working on 20 December 2026"), `${theme} (TH): a card with a closing notice offers to move to another one, with its date`);
      // Security's MUSTs 1–2 (61fcaef): money back only where Receive takes that coin on that network; else no address.
      await row("Take money out");
      check((await has("ZeroFee can't take EURe on Gnosis right now. Your money stays in Gnosis Pay.", "Open Gnosis Pay")) && !(await has("Receive on")), `${theme} (TH): a card whose coin and network Receive can't take shows only why and "Open Gnosis Pay", never an address`);
      await back();
      await row("Move to another card");
      check(await has("What's available", "ether.fi"), `${theme} (TH): moving opens what's available, the card section first`);
      // Several cards side by side (D38): ether.fi again, beside the Gnosis Pay card.
      await row("ether.fi");
      await tap("Start");
      await tap("Open ether.fi");
      await copy(ETHERFI);
      await js(`document.dispatchEvent(new Event("visibilitychange"))`);
      await sleep(600);
      await tap("Paste the address you copied");
      await tap("Save");
      await sleep(800);
      await back();
      await sleep(900);
      await shot(`${theme}-5f-two-cards`);
      const cardTiles = await js(`[...document.querySelectorAll(".py-tile")].filter((t) => t.offsetParent !== null && t.querySelector(".zf-label")?.textContent === "Card").map((t) => t.querySelector(".py-tile-line")?.firstChild?.textContent).join(",")`);
      check(cardTiles === "Gnosis Pay,ether.fi", `${theme} (TH): two cards side by side on Home (${cardTiles})`);
    }

    // A bank code Pay can't pay itself: your exchange, or your card.
    await tray("Scan");
    await copy(PIX);
    await tap("Paste a code");
    await sleep(1200);
    await shot(`${theme}-7-bank-code`);
    check(await has("This is a PIX bank code.", "Send to my exchange", "Pay with my card"), `${theme}: a PIX code offers your exchange, or your card`);
    await back();
    await back();

    // Home's Recent: a send's row is the person, with its address; one tap opens Send with them picked (the robot's pass 2).
    // An address on Base is paid from the USDC on Base, and more than it holds says the exact gap (pass 3: never a loop).
    const recentHex = await js(`[...document.querySelectorAll(".py-row")].some((r) => r.offsetParent !== null && r.textContent.includes("0x5a3e…5a3e"))`);
    check(!recentHex && (await row("Someone on Base")), `${theme}: a send out to another chain is a Recent person, named, never its hex`);
    await sleep(900);
    check(await has("0x5a3e…5a3e", "18.00 USDC) on Base ready to send"), `${theme}: …and opens Send with that address picked, from the USDC on Base`);
    await tap("2", '[aria-label="Amount"] button');
    await tap("0", '[aria-label="Amount"] button');
    const pills = await js(`[...document.querySelectorAll("button.zf-btn")].filter((b) => { const r = b.getBoundingClientRect(); return b.offsetParent !== null && r.left >= 0 && r.left < window.innerWidth; }).map((b) => b.textContent)`);
    check((await has("You have 18.00 USDC on Base; this needs 2.00 more.")) && pills.length === 1 && pills[0] === "Add 2.00 USDC on Base", `${theme}: 20 to Base says the exact gap, and the one pill is the way out (${pills.join(" | ")})`);
    await tap("Add 2.00 USDC on Base");
    await sleep(800);
    check(await has("Add 2.00 USDC on Base. Come back and send.", "Add money on Base", "Asking for 2.00 USDC"), `${theme}: …it opens Add money on Base, already asking for 2.00 USDC, and says to come back`);
    await back();
    await row("Someone on Base");
    await tap("5", '[aria-label="Amount"] button');
    await tap("Send 5");
    await sleep(800);
    await shot(`${theme}-7b-base-sheet`);
    check((await has("Pay 5 USDC to 0x5a3e", "On Base.", "Pay says: Someone on Base")) && !(await has("We can't pay this")), `${theme}: 5 to Base goes straight to the approval sheet: the amount, the address, its network, the name; no "can't pay"`);
    await tap("Approve");
    await sleep(2500);
    await back();
    await back();
    await sleep(600);

    // Send and Receive from the tray.
    await tray("Send");
    await sleep(600);
    // The shell keeps neighbouring apps mounted: only the header on screen counts.
    const headers = await js(`[...document.querySelectorAll('.af-top .zf-label')].filter((l) => l.offsetParent !== null && l.getBoundingClientRect().left >= 0 && l.getBoundingClientRect().left < window.innerWidth).map((l) => l.textContent.trim().toLowerCase())`);
    check(headers.includes("send"), `${theme}: tray Send opens Send${headers.includes("send") ? "" : ` (on screen: ${headers.join(", ")})`}`);
    // One field: paste or scan, nothing else to fill in (UI's robot walk). A paste goes straight on to the amount.
    const field = `[...document.querySelectorAll('input[aria-label="Who to send to"]')].find((i) => i.offsetParent !== null)`;
    const inField = (word) => js(`[...(${field})?.closest("label").querySelectorAll("button") ?? []].find((b) => b.textContent === ${JSON.stringify(word)})?.click()`);
    const onScreen = () => js(`[...document.querySelectorAll('.af-top .zf-label')].filter((l) => l.offsetParent !== null && l.getBoundingClientRect().left >= 0 && l.getBoundingClientRect().left < window.innerWidth).map((l) => l.textContent.trim().toLowerCase())`);
    // The last person paid is already picked; New is the field.
    const openField = async () => {
      if (!(await js(`Boolean(${field})`))) await js(`[...document.querySelectorAll('[aria-label="People"] button')].filter((b) => b.offsetParent !== null).at(-1)?.click()`);
      await sleep(600);
    };
    await openField();
    check((await js(`(() => { const i = ${field}; return Boolean(i) && i.placeholder === "Paste an address or scan a code" && [...i.closest("label").querySelectorAll("button")].map((b) => b.textContent).join() === "Scan"; })()`)) && (await pill()) === "Paste the address you copied", `${theme}: Send's one field has Scan in it, and the pill pastes (read on that tap only)`);
    check((await people("Someone on Base")) === 1 && (await people("0x5a3e")) === 0, `${theme}: Send's people row shows the Base person once, named "Someone on Base", never 0x…`);
    await copy("");
    await tap("Paste the address you copied");
    await sleep(700);
    check(await has("Nothing copied yet"), `${theme}: Paste with nothing copied says so, right under the field`);
    await inField("Scan");
    await sleep(900);
    check((await onScreen()).includes("scan"), `${theme}: Scan in the field opens Scan`);
    await back();
    await tray("Send");
    await sleep(600);
    await openField();
    await copy(NEAR_NAME);
    await tap("Paste the address you copied");
    await sleep(1500);
    await shot(`${theme}-8-send`);
    check(await has(NEAR_NAME, "ready to send", " in all"), `${theme}: a pasted name goes straight on to the amount; the keypad says the coin's whole too`);
    // One confirmation: the pill goes straight to the approval sheet, which names the amount, the coin and who.
    await tap("5", '[aria-label="Amount"] button');
    await tap("Send 5");
    await sleep(800);
    await shot(`${theme}-8b-sheet`);
    check((await has(`Send 5.00 USDC to ${NEAR_NAME}`)) && !(await has("You pay")) && !(await has(`says: ${NEAR_NAME}`)), `${theme}: Send 5 goes straight to the approval sheet (no review page first), with no hint that only repeats the account`);
    await tap("Approve");
    await sleep(2500);
    await back();
    await back();
    await sleep(600);
    check(await row(NEAR_NAME), `${theme}: Home's Recent shows the new send with who it went to`);
    await sleep(900);
    check((await onScreen()).includes("send") && (await has(NEAR_NAME, "ready to send")) && (await js(`Boolean(document.querySelector('[aria-label="Amount"]'))`)), `${theme}: tapping them opens Send with them picked, on the keypad`);
    await back();
    await tray("Receive");
    await sleep(800);
    await shot(`${theme}-9-receive`);
    check(await has("Receive on NEAR", "Ask for an amount"), `${theme}: tray Receive is Wallet's Receive in place, "Receive on NEAR", with Ask for an amount`);
    await back();
    check(!(await js(`document.documentElement.scrollWidth > window.innerWidth`)), `${theme}: no sideways overflow`);

    // TH, last (it adds a Recent row): "No, it didn't" is one plain screen, what happened, where the money is, one step.
    if (place === "TH") {
      // "No, it didn't": one plain screen, what happened, where the money is, one step (the robot's walk).
      await tap("ether.fi", ".py-tile");
      await sleep(800);
      await tap("Top up $5");
      await sleep(1500);
      await tap("Approve");
      await paidThenAsk("ether.fi", "No, it didn't");
      await tap("No, it didn't");
      await sleep(900);
      await shot(`${theme}-5g-not-arrived`);
      const notArrivedButtons = await js(`[...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null && !b.closest("[aria-label='Back']") && b.getAttribute("aria-label") !== "Back" && b.textContent.trim()).map((b) => b.textContent.trim()).join(" | ")`);
      check((await has("Your money didn't show in ether.fi.", "It went to the address you pasted. If that was your ether.fi address, the money may still show there. If not, ZeroFee can't get it back.", "Compare it with the address in ether.fi.", "Try another address")) && (await pill()) === "Open ether.fi" && !(await has("Copy the address again")) && !(await has("Top up a Gnosis Pay card")), `${theme} (TH): "No, it didn't" is one plain screen: the address to compare (never copied back), "Open ether.fi", "Try another address" (${notArrivedButtons})`);
      await tap("Try another address");
      check((await has("Your card's address")) && (await pill()) === "Paste the address you copied" && !(await has("Get a card in the ether.fi app")) && !(await has("Top up a Gnosis Pay card")), `${theme} (TH): "Try another address" goes straight to the same card's paste step, nothing else on it`);
      await copy(ETHERFI);
      await tap("Paste the address you copied");
      await sleep(500);
      check(await has("This is the address your money didn't show at."), `${theme} (TH): the same address pasted again is recognised before it's saved`);
      await back();
    }

  }
  check(errors.length === 0, `no console errors${errors.length ? `: ${[...new Set(errors)].join(" | ")}` : ""}`);
} finally {
  ws?.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left in the system's temp folder, which it clears by itself.
  }
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall passed");
process.exit(failures.length ? 1 : 0);
