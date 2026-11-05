// The panel against a stopped worker. Chrome stops an idle MV3 worker after about 30 s, so a person who opens the panel,
// spends a minute on their phone and comes back must find it working. Here: the panel's first run up to its link step;
// the worker stopped; 60 s idle; the worker stopped again; then "Make the link" must still show the QR (the panel's
// message wakes the worker, and the open wallet is in chrome.storage.session, not the worker's memory). No account and no
// network: the code is a made-up one in the right shape, and nothing is linked.
//
//   npm run -w @zerofee/extension build && node apps/extension/tools/worker-wake.ts [--idle 60]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Cdp, chromeFlags, makeLog, openPanel, page, sleep, stopWorker, workerOf } from "./cdp.ts";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : fallback; };
const repo = resolve(import.meta.dirname, "../../..");
const idleS = Number(arg("idle", "60"));
const { log, check, failed } = makeLog();
const passcode = `wake ${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code = [...crypto.getRandomValues(new Uint8Array(10))].map((b, i) => (i === 5 ? "-" : "") + ALPHABET[b % 32]).join("");

const work = mkdtempSync(join(tmpdir(), "zf-worker-wake-"));
const chrome = spawn(arg("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), chromeFlags(join(work, "profile")), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const cdp = new Cdp(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);

try {
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: join(repo, "apps/extension/build") });
  const pt = await openPanel(cdp, id);
  const { sessionId: ps } = await cdp.send("Target.attachToTarget", { targetId: pt.targetId, flatten: true });
  const panel = page(cdp, ps);
  log("panel: open in Chrome's side panel");

  await panel.waitFor(`document.body.textContent.includes("Trade from this browser")`, "Welcome");
  await panel.press("Set up now");
  await panel.waitFor(`document.querySelector("#new-pass")`, "the wallet step");
  await panel.type("#new-pass", passcode);
  await panel.press("Make my trading wallet");
  await panel.waitFor(`document.body.textContent.includes("Add trading money")`, "the money step", 60_000);
  await panel.press("Later");
  await panel.waitFor(`document.querySelector("#link-code")`, "the link step");
  log("panel: on the link step, wallet open");

  check(await stopWorker(cdp, id, ps), "the worker is stopped, as Chrome stops an idle one");
  log(`idle for ${idleS} s, as a person who went to their phone`);
  await sleep(idleS * 1000);
  log(`worker after the idle time: ${(await workerOf(cdp, id)) ? "running (the panel's own status check woke it)" : "stopped"}`);
  check(await stopWorker(cdp, id, ps), "the worker is stopped again, just before the link");

  await panel.type("#link-code", code);
  await panel.type("#link-pass", passcode);
  await panel.press("Make the link");
  const qr = await panel.waitFor(`document.querySelector(".p-qr svg path")`, "the QR", 30_000).catch(() => false);
  const problem = qr ? null : await panel.text(".zf-title");
  check(qr, `the link step answers after the worker was stopped: the QR is shown${problem ? `; instead: "${problem}"` : ""}`);
  check(Boolean(await workerOf(cdp, id)), "the panel's message started the worker again");
  const status = await panel.js<{ ok?: { stage: string } }>(`chrome.runtime.sendMessage({ t: "vault.status" })`);
  check(status.ok?.stage === "unlocked", `the wallet is still open after two stops (${status.ok?.stage})`);
} catch (e) {
  check(false, `stopped: ${(e as Error).message}`);
}
await cdp.send("Browser.close").catch(() => undefined);
await new Promise((done) => { if (chrome.exitCode !== null) return done(undefined); chrome.once("exit", done); setTimeout(done, 5_000); });
try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the OS's temp folder clears it */ }
log(failed() ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed() ? 1 : 0);
