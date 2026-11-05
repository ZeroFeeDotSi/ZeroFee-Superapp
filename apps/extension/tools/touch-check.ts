// Touch ID in the built panel, in real Chrome, with Chrome's virtual authenticator standing in for the Mac's (a platform
// authenticator with user verification and the PRF extension): Settings → Unlock with Touch ID → the passcode → on;
// lock; "Unlock with Touch ID" opens it; then a cancel goes straight to the passcode. This proves Chrome does WebAuthn
// PRF from the extension's own origin; the test run proves it with Touch ID itself.
//
//   npm run -w @zerofee/extension build && node apps/extension/tools/touch-check.ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Cdp, chromeFlags, makeLog, openPanel, page, sleep } from "./cdp.ts";

const repo = resolve(import.meta.dirname, "../../..");
const { log, check, failed } = makeLog();
const passcode = `touch ${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
const work = mkdtempSync(join(tmpdir(), "zf-touch-check-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", chromeFlags(join(work, "profile")), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const cdp = new Cdp(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);

try {
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: join(repo, "apps/extension/build") });
  const pt = await openPanel(cdp, id);
  const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId: pt.targetId, flatten: true });
  const panel = page(cdp, s);
  await cdp.send("WebAuthn.enable", { enableUI: false }, s);
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } }, s);
  log("laptop: a virtual platform authenticator with user verification and PRF stands in for Touch ID");

  await panel.waitFor(`document.body.textContent.includes("Trade from this browser")`, "Welcome");
  await panel.press("Set up now");
  await panel.waitFor(`document.querySelector("#new-pass")`, "the wallet step");
  await panel.type("#new-pass", passcode);
  await panel.press("Make my trading wallet");
  await panel.waitFor(`document.body.textContent.includes("Add trading money")`, "the money step", 60_000);
  await panel.press("Later");
  await panel.waitFor(`document.querySelector("#link-code")`, "the link step");
  await panel.press("Not now");
  await panel.waitFor(`document.body.textContent.includes("You're set")`, "You're set");
  await panel.press("Start trading");
  await panel.waitFor(`document.querySelector(".p-title")?.textContent.trim() === "Trading wallet"`, "the trading wallet");

  await panel.pressLabel("Settings");
  await panel.waitFor(`document.body.textContent.includes("Unlock with Touch ID")`, "the Touch ID row");
  await panel.pressRow("Unlock with Touch ID");
  await panel.waitFor(`document.querySelector("#touch-pass")`, "the passcode sheet");
  await panel.type("#touch-pass", passcode);
  await panel.press("Turn on");
  const on = await panel.waitFor(`[...document.querySelectorAll(".zf-row")].some((r) => r.textContent.includes("Unlock with Touch ID") && r.textContent.trim().endsWith("On"))`, "Touch ID on", 30_000).catch(() => false);
  const problem = on ? null : await panel.text(".zf-title");
  check(on, `panel: Touch ID turned on with the passcode, the credential made with PRF from the extension's origin${problem ? `; instead: "${problem}"` : ""}`);
  const st = await panel.js<{ ok: { touch?: { credId: string } } }>(`chrome.runtime.sendMessage({ t: "vault.status" })`);
  check(Boolean(st.ok.touch?.credId), "vault: the Touch ID seal is kept beside the passcode's (only its id and salt are shown)");

  await panel.pressLabel("Back");
  await panel.pressLabel("Lock now");
  await panel.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Unlock with Touch ID")`, "Unlock with Touch ID");
  await panel.press("Unlock with Touch ID");
  const opened = await panel.waitFor(`document.querySelector(".p-title")?.textContent.trim() === "Trading wallet"`, "unlocked by Touch ID", 30_000).catch(() => false);
  check(opened, 'panel: locked, then "Unlock with Touch ID" opened the wallet (PRF → HKDF → the second seal)');

  // a failed Touch ID (the person isn't verified) goes straight to the passcode, and the passcode still opens it
  await panel.pressLabel("Lock now");
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false }, s);
  await panel.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Unlock with Touch ID")`, "Unlock with Touch ID again");
  await panel.press("Unlock with Touch ID");
  const toPass = await panel.waitFor(`document.body.textContent.includes("Touch ID didn't open it. Type your passcode.")`, "the passcode after a failed Touch ID", 30_000).catch(() => false);
  check(toPass, "panel: a Touch ID that fails goes straight to the passcode, no retry loop");
  await panel.type("#pass", passcode);
  await panel.press("Unlock");
  check(await panel.waitFor(`document.querySelector(".p-title")?.textContent.trim() === "Trading wallet"`, "unlocked by passcode", 30_000).catch(() => false), "panel: the passcode still opens the wallet");
} catch (e) {
  check(false, `stopped: ${(e as Error).message}`);
}
await cdp.send("Browser.close").catch(() => undefined);
await new Promise((done) => { if (chrome.exitCode !== null) return done(undefined); chrome.once("exit", done); setTimeout(done, 5_000); });
try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the OS's temp folder clears it */ }
log(failed() ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed() ? 1 : 0);
