// The end-to-end link test (D13: the panel offers Link because this passes). One Chrome holds both sides:
//   the phone   the ZeroFee web app on the real core (NEAR testnet), restored from an e2e account's 24 words
//               (tools/testnet/make-account.ts makes one; the words are read from its private file and never printed);
//   the laptop  the panel's build, loaded unpacked, in Chrome's side panel, set up through its
//               first-run journey (the wallet, "Later" on trading money, then linking the phone as its last step).
// The phone shows its one-time code; the panel takes it and shows its QR; the QR is drawn into the video Chrome's fake
// camera plays (it reads the file each time a camera starts); the phone scans it and the core imports it. Then the two
// ways it must fail: a wrong code (security.link.wrong) and a code that runs out (extension-app.code.ran-out). The core
// asks on an approval sheet before it imports (its address, and "only say yes if you just typed this phone's code into
// your own laptop"); a "Not now" there is security.link.declined.
// The log has steps and checks only: no words, passcode, code or seed; every line is guarded (cdp.ts, makeLog), so
// anything shaped like a code reads "(code)".
// The web app runs from source under vite, so don't edit apps/web or the packages it serves during a run: a hot reload
// sends the phone back to its first app.
// The shell renders the apps beside the one on screen (inert); every phone check skips those, and a Problem is read
// only from the shell's Problem layer (.ah-problem).
// The phone's restore runs in a Chrome profile that stays where it is (mode 700, beside the e2e words). A run that stops
// halfway (after "Bring back my account", before the bank opens) leaves it there with a marker, and the next run opens the
// same profile and finishes that restore, so no move is left standing on the account. A run that gets past it deletes
// the profile.
//
//   npm run -w @zerofee/extension build
//   node apps/extension/tools/link-e2e.ts [--words <e2e file>] [--chrome <path>] [--port 5198]
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Cdp, chromeFlags, live, makeLog, openPanel, page, sleep, stopWorker } from "./cdp.ts";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const repo = resolve(import.meta.dirname, "../../..");
const panelBuild = join(repo, "apps/extension/build");
const chromePath = arg("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")!;
const port = Number(arg("port", "5198"));
const secrets = join(process.env.ZEROFEE_HOME ?? join(homedir(), ".config", "zerofee"), "testnet");
const wordsFile = arg("words") ?? join(secrets, readdirSync(secrets).filter((f) => f.startsWith("e2e-") && f.endsWith(".json")).sort((a, b) => statSync(join(secrets, b)).mtimeMs - statSync(join(secrets, a)).mtimeMs)[0]!);
const account = JSON.parse(readFileSync(wordsFile, "utf8")) as { accountId: string; recoveryWords: string };
const passcode = `e2e ${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
const { log, check, failed } = makeLog();   // every line goes through a guard that takes out anything shaped like a code

// ---- The fake camera: the panel's QR drawn into a one-frame Y4M video (4:2:0, 640x480) ----
function writeCamera(file: string, dark: Set<string> | null, n: number) {
  const W = 640, H = 480, Y = new Uint8Array(W * H).fill(235);
  if (dark) {
    const cell = Math.floor((Math.min(W, H) * 0.86) / n), x0 = Math.floor((W - cell * n) / 2), y0 = Math.floor((H - cell * n) / 2);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark.has(`${c},${r}`))
      for (let y = 0; y < cell; y++) Y.fill(16, (y0 + r * cell + y) * W + x0 + c * cell, (y0 + r * cell + y) * W + x0 + (c + 1) * cell);
  }
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame = Buffer.from("FRAME\n");
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  writeFileSync(`${file}.next`, Buffer.concat([header, frame, Buffer.from(Y), chroma]));
  renameSync(`${file}.next`, file);
}
/** The QR's dark cells, read back from the panel's SVG (QrCode draws "M{x} {y}h1v1h-1z" per cell, 4 cells of quiet zone). */
function qrCells(svg: { d: string; size: number }): { dark: Set<string>; n: number } {
  const dark = new Set<string>();
  for (const m of svg.d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${m[1]},${m[2]}`);
  return { dark, n: svg.size };
}

// ---- The run ----
const work = mkdtempSync(join(tmpdir(), "zf-link-e2e-"));
const camera = join(work, "camera.y4m");
writeCamera(camera, null, 1);
const kept = join(secrets, "link-e2e-chrome"), marker = join(secrets, "link-e2e-halfway");
const resuming = existsSync(marker) && existsSync(kept);
if (!resuming) { rmSync(kept, { recursive: true, force: true }); rmSync(marker, { force: true }); }
mkdirSync(kept, { recursive: true, mode: 0o700 });
let halfway = resuming, stopped = false;
const children: ChildProcess[] = [];
const stopAll = () => {
  if (stopped) return;
  stopped = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  if (halfway) {
    writeFileSync(marker, new Date().toISOString(), { mode: 0o600 });
    log(`the restore stopped halfway: its profile stays at ${kept}; run again to finish it there`);
  } else {
    try { rmSync(kept, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); rmSync(marker, { force: true }); } catch { /* still closing */ }
  }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the OS's temp folder clears it */ }
};
process.on("exit", stopAll);

log(`e2e account ${account.accountId} (words read from its private file, not printed)`);
const web = spawn(join(repo, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: join(repo, "apps/web"), stdio: "ignore" });
children.push(web);
for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok, () => false)) break; await sleep(500); }
log(`web app on the real core: http://127.0.0.1:${port}/`);

const chrome = spawn(chromePath, chromeFlags(kept, [`--use-file-for-fake-video-capture=${camera}`]), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
children.push(chrome);
const cdp = new Cdp(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);

let onPhone = async () => "";
try {
  const { id: extId } = await cdp.send("Extensions.loadUnpacked", { path: panelBuild });
  log(`panel loaded unpacked from apps/extension/build (id ${extId})`);
  if (resuming) {
    // the kept profile has the last run's panel wallet: the panel starts from its first run again
    for (const storageArea of ["local", "session"]) await cdp.send("Extensions.clearStorageItems", { id: extId, storageArea });
    log("panel: the kept profile's panel storage cleared, so the panel starts from its first run");
  }

  // the laptop first, as a person does: the toolbar button opens the side panel, and the panel's first run goes to its
  // link step; then the phone (about 90 s), while the panel waits there
  const panelTarget = await openPanel(cdp, extId);
  const { sessionId: pps } = await cdp.send("Target.attachToTarget", { targetId: panelTarget.targetId, flatten: true });
  const panel = page(cdp, pps);
  log("panel: open in Chrome's side panel");

  // the first-run journey (D21): Welcome, 1 of 3 the wallet, 2 of 3 trading money ("Later"), 3 of 3 the phone
  await panel.waitFor(`document.body.textContent.includes("Trade from this browser")`, "the panel's Welcome");
  await panel.press("Set up now");
  await panel.waitFor(`document.querySelector("#new-pass")`, "1 of 3, the trading wallet");
  await panel.type("#new-pass", passcode);
  await panel.press("Make my trading wallet");
  await panel.waitFor(`document.body.textContent.includes("Add trading money")`, "2 of 3, trading money", 60_000);
  const sol = await panel.js<string>(`chrome.runtime.sendMessage({ t: "vault.status" }).then((r) => r.ok.sol)`);
  log(`panel: trading wallet made, ${sol}`);
  check(await panel.has("From another wallet") && !(await panel.has("From my ZeroFee balance")), "panel: trading money offers another wallet, and not the ZeroFee balance before a phone is linked");
  await panel.press("Later");
  await panel.waitFor(`document.querySelector("#link-code") && document.body.textContent.includes("3 of 3")`, "3 of 3, linking the phone");
  log("panel: on the journey's last step, linking the phone");

  // the phone
  const { targetId: phoneTarget } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId: ps } = await cdp.send("Target.attachToTarget", { targetId: phoneTarget, flatten: true });
  await cdp.send("Page.enable", {}, ps);
  // The phone's console errors and exceptions go to the log, cut short (the app never writes words or keys there).
  cdp.on((m) => {
    if (m.sessionId !== ps) return;
    if (m.method === "Runtime.exceptionThrown") log(`phone exception: ${String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 240)}`);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) log(`phone console.${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ").slice(0, 240)}`);
  });
  await cdp.send("Runtime.enable", {}, ps);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 2, mobile: true }, ps);
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, ps);
  const phone = page(cdp, ps);
  // What the phone shows, for a stopped run: the app on screen and the Problem layer; before the bank opens, the screen's
  // headings and labels (never on the words screen).
  onPhone = () => phone.js<string>(`(() => { const on = document.querySelector('section.ah-page[aria-hidden="false"]'); const p = document.querySelector(".ah-problem"); const flat = (e) => e.innerText.replace(/\\s+/g, " ").slice(0, 200);
    const before = document.querySelector("#rc-word") ? "(the words screen)" : [...document.querySelectorAll("h1, .zf-label, .rc-count, .zf-title")].filter((e) => e.offsetParent).map(flat).join(" | ").slice(0, 200);
    return "on screen: " + (on ? flat(on) : "(no app) " + before) + " || Problem layer: " + (p ? flat(p) : "(none)"); })()`);

  // The restore, step by step as the web app's own restore test walks it: the terms, the words, the approval sheet, the
  // 60 s recovery wait, Finish and its sheet, then "Your account is open." and into the bank.
  const enabled = (text: string) => `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent && !b.disabled && !b.closest("[inert]"))`;
  const approveSheet = async (what: string, ms: number) => {
    const shown = await phone.waitFor(`document.querySelector(".approval__sheet")`, what, ms).catch(() => false);
    if (shown) { await sleep(600); await phone.js(`[...document.querySelectorAll(".approval__sheet button")].find((b) => b.textContent.trim() === "Approve").click()`, { gesture: true }); }
    log(`phone: ${what}: ${shown ? "approved" : "none shown"}`);
  };
  if (resuming) {
    log("phone: the last run stopped halfway; finishing its restore in the same profile");
    await phone.waitFor(`document.querySelector(".rc-count") || document.querySelector(".af-tray") || ${enabled("I already have one")}`, "the phone's first screen", 60_000);
    if (await phone.js<boolean>(enabled("I already have one"))) throw new Error("the kept profile opened on the welcome screen, so its restore can't be finished from here; tools/testnet/e2e-unstick.ts clears it 10 minutes after its countdown");
  }
  if (!resuming) {
    await phone.waitFor(enabled("I already have one"), "the welcome screen", 60_000);
    await phone.press("I already have one");
    await phone.waitFor(enabled("Agree"), "the terms (one tap)");
    await phone.press("Agree");
    await phone.waitFor(`document.querySelector("#rc-word")`, "the 24-word screen");
    await phone.type("#rc-word", account.recoveryWords);
    await phone.waitFor(enabled("Bring back my account"), "all 24 words accepted");
    halfway = true;
    await phone.press("Bring back my account");
    await approveSheet("the restore's approval sheet", 30_000);
  }
  if (!(await phone.js<boolean>(`Boolean(document.querySelector(".af-tray"))`))) {
    // The wait the account sets (60 s for the e2e account; longer if a recovery from an earlier run still stands).
    await phone.waitFor(`document.querySelector(".rc-count")`, "On its way", 90_000);
    const left = (await phone.text(".rc-count")) ?? "";
    const unit: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };   // "1d 2h", "1h 5m", "1m 05s", "45s"
    const waitS = [...left.matchAll(/(\d+)([dhms])/g)].reduce((t, [, n, u]) => t + Number(n) * unit[u]!, 0);
    log(`phone: restoring the e2e account from its words; the recovery wait shows ${left}`);
    if (waitS > 600) throw new Error(`the recovery wait is ${left}: a recovery from an earlier run may still stand on the account`);
    await phone.waitFor(enabled("Finish"), "Finish, after the recovery wait", (waitS + 90) * 1000);
    await phone.press("Finish");
    // Finish's sheet can take a while on testnet: any sheet until the bank opens is approved
    for (const end = Date.now() + 180_000; !(await phone.has("Your account is open.")) && Date.now() < end; await sleep(500)) {
      if (await phone.js<boolean>(`Boolean(document.querySelector(".approval__sheet"))`)) await approveSheet("Finish's approval sheet", 1_000);
    }
    await phone.waitFor(`document.body.textContent.includes("Your account is open.")`, "Your account is open.", 1_000);
    halfway = false;
    await phone.press("Open ZeroFee");
  }
  halfway = false;   // resumed into a bank already open: nothing is pending
  await phone.waitFor(`document.querySelector(".af-tray")`, "the bank's apps", 30_000);
  check(true, "phone: the account is restored and its apps are open");

  // Across to the Extension app. A neighbour's Problem shows when its app comes on screen (Wallet's test-account notice):
  // it is pressed away with its one next step, and logged.
  const onExtension = `document.querySelector('section.ah-page[aria-hidden="false"] .af-top .zf-label')?.textContent.trim() === "Extension"`;
  for (let i = 0; i < 12 && !(await phone.js<boolean>(`Boolean(${onExtension})`)); i++) {
    await phone.key("ArrowRight", 39); await sleep(900);
    const notice = await phone.text(".ah-problem .zf-title");
    if (notice) { log(`phone: a notice on the way: "${notice}"`); await phone.press("OK").catch(() => undefined); await sleep(600); }
  }
  await phone.waitFor(onExtension, "the Extension app");
  await phone.waitFor(enabled("Link my laptop"), "Link my laptop");
  await phone.press("Link my laptop");
  await phone.waitFor(live(".ea-code"), "the phone's code");
  const code = (await phone.text(".ea-code"))!;
  check(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(code), "phone: shows a one-time code (subwallet.linkStart), 10 characters (not logged)");

  /** The import's approval sheet: it names the panel's own address and says when to say yes. Answered `yes` or not. */
  const importSheet = async (yes: boolean) => {
    await phone.waitFor(live(".approval__sheet"), "the import's approval sheet", 60_000);
    await sleep(600);
    const t = await phone.js<string>(`document.querySelector(".approval__sheet").innerText.replace(/\\s+/g, " ")`);
    check(t.includes("Link the wallet in your laptop's ZeroFee panel") && t.includes(`${sol.slice(0, 4)}…${sol.slice(-4)}`) && t.includes("Only approve if you typed this phone's code into your own laptop a moment ago."),
      "phone: the import sheet names the panel's own address and says when to say yes");
    await phone.js(`[...document.querySelectorAll(".approval__sheet button")].find((b) => b.textContent.trim() === ${JSON.stringify(yes ? "Approve" : "Not now")}).click()`, { gesture: true });
    log(`phone: import sheet: ${yes ? "approved" : "Not now"}`);
  };

  /** In the panel: Settings → Link your phone → the code and the passcode → the QR, into the camera. */
  const panelQr = async (typed: string) => {
    if (!(await panel.js<boolean>(`Boolean(document.querySelector("#link-code"))`))) {
      if (await panel.js<boolean>(`[...document.querySelectorAll("button")].some((b) => b.getAttribute("aria-label") === "Back" && b.offsetParent)`)) { await panel.pressLabel("Back"); await sleep(300); }
      if (!(await panel.has("Link your phone"))) { await panel.pressLabel("Settings"); await panel.waitFor(`document.body.textContent.includes("Link your phone")`, "Settings"); }
      await panel.pressRow("Link your phone");
      await panel.waitFor(`document.querySelector("#link-code")`, "the panel's Link screen");
    }
    await panel.type("#link-code", typed);
    await panel.type("#link-pass", passcode);
    await panel.press("Make the link");
    await panel.waitFor(`document.querySelector(".p-qr svg path")`, "the panel's QR", 30_000);
    const svg = await panel.js<{ d: string; size: number }>(`(() => { const s = document.querySelector(".p-qr svg"); return { d: s.querySelector("path").getAttribute("d"), size: Number(s.getAttribute("viewBox").split(" ")[2]) }; })()`);
    const { dark, n } = qrCells(svg);
    writeCamera(camera, dark, n);
    return n;
  };

  // 1. the whole link, back at the panel after the phone: Chrome may have stopped the idle worker, and here it surely is
  check(await stopWorker(cdp, extId, pps), "laptop: the extension's worker is stopped, as Chrome stops an idle one");
  const n = await panelQr(code);
  log(`panel: QR shown (${n}x${n} cells, sealed under the phone's code); the fake camera now plays it`);
  await phone.press("Scan the panel's code");
  await importSheet(true);
  await phone.waitFor(`${live(".ea-total")} || ${live(".ah-problem .zf-title")}`, "the scan's result", 60_000);
  const problem1 = await phone.text(".ah-problem .zf-title");
  check(!problem1 && (await phone.has("On your laptop")), `phone: scanned and imported (subwallet.import)${problem1 ? `; instead: "${problem1}"` : ""}`);
  await panel.press("Done");
  await panel.waitFor(`document.body.textContent.includes("You're set")`, "You're set");
  await panel.press("Start trading");
  await panel.waitFor(`document.querySelector(".p-title")?.textContent.trim() === "Trading wallet"`, "the trading wallet");
  log("panel: journey done (Done, You're set, Start trading); on the trading wallet");
  await phone.js(`[...document.querySelectorAll(".af-tray button")].find((b) => b.textContent.includes("Link") && !b.closest("[inert]"))?.click()`, { gesture: true });
  await phone.waitFor(live(".ea-addr"), "the Link tab");
  const listed = await phone.text(".ea-addr");
  check(listed === sol, `phone: subwallet.list has the laptop wallet, and it is the panel's own address (${listed})`);

  // 2. a "Not now" on the import sheet: nothing changes, and the app goes back to its tabs
  await phone.press("Link again");
  await phone.waitFor(live(".ea-code"), "a new code");
  await panelQr((await phone.text(".ea-code"))!);
  await phone.press("Scan the panel's code");
  await importSheet(false);
  await phone.waitFor(live(".ah-problem .zf-title"), "a Problem", 30_000);
  const declined = await phone.text(".ah-problem .zf-title");
  check(declined === "You didn't link it. Nothing changed.", `phone: "Not now" on the import sheet gives security.link.declined ("${declined}")`);
  await phone.press("OK");
  await phone.waitFor(live(".ea-addr"), "the Link tab, unchanged");
  check((await phone.text(".ea-addr")) === sol, "phone: after Not now, the linked wallet is the same one");

  // 3. a wrong code
  await phone.press("Link again");
  await phone.waitFor(live(".ea-code"), "a new code");
  const fresh = (await phone.text(".ea-code"))!;
  const other = fresh.slice(0, -1) + (fresh.endsWith("0") ? "1" : "0");
  await panelQr(other);
  await phone.press("Scan the panel's code");
  await phone.waitFor(live(".ah-problem .zf-title"), "a Problem", 60_000);
  const wrong = await phone.text(".ah-problem .zf-title");
  check(wrong === "That code doesn't open this QR. Start again on your phone.", `phone: a QR sealed under another code gives security.link.wrong ("${wrong}")`);
  await phone.press("Start again");

  // 4. a code that runs out
  await phone.waitFor(live(".ea-code"), "a new code after starting again");
  log("phone: a new code; waiting for it to run out (5 minutes)");
  // what the phone shows every 10 s while it waits (never the code itself)
  const state = () => phone.js<string>(`(() => { const p = document.querySelector(".ah-problem .zf-title"); if (p) return "Problem: " + p.textContent.trim();
    const v = document.querySelector('section.ah-page[aria-hidden="false"]'); if (!v) return "no app";
    if (v.querySelector(".ea-video")) return "the scanner"; const l = v.querySelector(".ea-left"); if (l) return "the code, " + l.textContent.trim();
    return "tabs: " + v.innerText.replace(/\\s+/g, " ").slice(0, 80); })()`);
  for (const end = Date.now() + 330_000; Date.now() < end && !(await phone.js<boolean>(`Boolean(${live(".ah-problem .zf-title")})`)); await sleep(10_000)) log(`phone shows ${await state()}`);
  await phone.waitFor(live(".ah-problem .zf-title"), "the code to run out", 5_000);
  const ranOut = await phone.text(".ah-problem .zf-title");
  check(ranOut === "That code ran out before you scanned the laptop's code.", `phone: a code that runs out gives extension-app.code.ran-out ("${ranOut}")`);
} catch (e) {
  check(false, `stopped: ${(e as Error).message}`);
  log(`phone shows ${await onPhone().catch(() => "(unreadable)")}`);
}
await cdp.send("Browser.close").catch(() => undefined);
await new Promise((done) => { if (chrome.exitCode !== null) return done(undefined); chrome.once("exit", done); setTimeout(done, 5_000); });
log(failed() ? "RESULT: FAIL" : "RESULT: PASS");
stopAll();
process.exit(failed() ? 1 : 0);
