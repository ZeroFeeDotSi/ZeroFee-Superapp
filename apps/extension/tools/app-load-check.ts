// D157's load check: the built extension in a temporary Chrome profile (never the person's), driven over a pipe (no port).
//   1. build/ (the shipped Real build, the only one: row 35, never a Sim): the toolbar button opens the side panel, and
//      it renders the real app's first screen, with no policy (CSP) error.
//   2. build/, headless: a passkey request from the app's page opens the extension's own approval window, where a
//      VIRTUAL authenticator of this throwaway profile (CDP WebAuthn, hybrid transport) answers; the answer comes back to
//      the page, signed for chrome-extension://<id>, with user verification and PRF. No real key, no phone.
// Every http(s)/ws(s) request of the pages is failed on purpose (CDP Fetch), so nothing reaches any network.
//   npm run -w @zerofee/extension build && node apps/extension/tools/app-load-check.ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Cdp, chromeFlags, makeLog, sleep } from "./cdp.ts";

const here = fileURLToPath(new URL("..", import.meta.url));
const chromePath = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const shots = process.env.ZF_SHOTS;
const { log, check, failed } = makeLog();
type Target = { targetId: string; type: string; url: string };

async function launch(headless: boolean) {
  const profile = mkdtempSync(join(tmpdir(), "zf-ext-check-"));
  const chrome = spawn(chromePath, chromeFlags(profile, headless ? ["--headless=new"] : []), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new Cdp(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);
  const errors: string[] = [];
  const blocked: string[] = [];
  cdp.on((m) => {
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/net::ERR_FAILED|Failed to load resource/.test(m.params.entry.text)) errors.push(m.params.entry.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
    if (m.method === "Fetch.requestPaused") { blocked.push(m.params.request.url); void cdp.send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "BlockedByClient" }, m.sessionId).catch(() => undefined); }
  });
  const done = async () => { chrome.kill(); await sleep(500); rmSync(profile, { recursive: true, force: true }); };
  return { cdp, errors, blocked, done };
}

/** Attaches to a page, watching its errors and failing every network request it makes. */
async function watch(cdp: Cdp, targetId: string) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http*" }, { urlPattern: "ws*" }] }, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  const js = async <T>(expression: string): Promise<T> => {
    const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const waitFor = async (expr: string, ms = 30_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js<boolean>(`Boolean(${expr})`).catch(() => false)) return true; await sleep(250); } return false; };
  const shot = async (name: string) => {
    if (!shots) return;
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
  };
  return { sessionId, js, waitFor, shot };
}

/** The toolbar button, as a person presses it; the side panel's page target. */
async function openSidePanel(cdp: Cdp, extId: string, path: string): Promise<Target> {
  const url = `chrome-extension://${extId}/${path}`;
  for (let i = 0; i < 10; i++) {
    const tab = ((await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos as Target[]).find((t) => t.type === "tab" && !t.url.startsWith("chrome-extension://"));
    if (tab) await cdp.send("Extensions.triggerAction", { id: extId, targetId: tab.targetId }).catch(() => undefined);
    for (let j = 0; j < 8; j++) {
      const p = ((await cdp.send("Target.getTargets")).targetInfos as Target[]).find((t) => t.url === url);
      if (p) return p;
      await sleep(250);
    }
  }
  throw new Error(`the side panel didn't open ${path}`);
}

async function sidePanelCheck(dir: string, what: string, expect: string, shotName: string) {
  const { cdp, errors, blocked, done } = await launch(false);
  try {
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: join(here, dir) });
    log(`${what}: loaded unpacked from apps/extension/${dir} (id ${id})`);
    const t = await openSidePanel(cdp, id, "app.html");
    const p = await watch(cdp, t.targetId);
    await cdp.send("Page.reload", {}, p.sessionId); // from the start, with the network failed and errors watched
    const rendered = await p.waitFor(expect, 45_000);
    await p.shot(shotName);
    if (!rendered) log(`${what}: the side panel shows: ${(await p.js<string>("document.body.innerText").catch((e) => String(e))).slice(0, 300).replace(/\n+/g, " / ")} | errors: ${errors.join(" | ").slice(0, 400)}`);
    check(rendered, `${what}: the side panel renders ${shotName}`);
    check(!errors.some((e) => /Content.Security.Policy|Refused to/i.test(e)), `${what}: no policy (CSP) refusal${errors.length ? ` (errors: ${errors.slice(0, 3).join(" | ").slice(0, 300)})` : ""}`);
    if (dir === "build") {
      // the trading panel: what the side panel is on an Axiom, pump.fun or GMGN tab (the worker sets it when the site's
      // content script reports the page). Here the worker is asked to set it for this tab, then the panel is opened.
      const sw = ((await cdp.send("Target.getTargets")).targetInfos as Target[]).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${id}/`));
      if (sw) {
        const { sessionId: sws } = await cdp.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
        await cdp.send("Runtime.evaluate", { expression: `chrome.tabs.query({}).then((ts) => Promise.all(ts.map((t) => chrome.sidePanel.setOptions({ tabId: t.id, path: "panel.html", enabled: true }))))`, awaitPromise: true }, sws);
      }
      let tpt: Target | undefined;
      for (let i = 0; i < 3 && !tpt; i++) tpt = await openSidePanel(cdp, id, "panel.html").catch(() => undefined);
      const shown = tpt ? await (await watch(cdp, tpt.targetId)).waitFor(`document.body.textContent.includes("Trade from this browser")`, 20_000) : false;
      check(shown, `${what}: on a trading site's tab the side panel is still the trading panel, and it renders its Welcome`);
    }
    check(!errors.some((e) => /Content.Security.Policy|Refused to/i.test(e)), `${what}: still no policy (CSP) refusal`);
    log(`${what}: ${blocked.length} network request(s) failed on purpose`);
  } finally { await done(); }
}

async function approvalWindowCheck() {
  const { cdp, errors, done } = await launch(true);
  try {
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: join(here, "build") });
    const origin = `chrome-extension://${id}`;
    // every new page waits for us first, so the window's virtual authenticator is there before it asks
    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "page" }] });
    const windows: string[] = [];
    // each window is its own page with its own virtual authenticator: the key made in the first is carried to the next
    const made: unknown[] = [];
    cdp.on((m) => { if (m.method === "WebAuthn.credentialAdded") made.push(m.params.credential); });
    cdp.on((m) => {
      if (m.method !== "Target.attachedToTarget") return;
      const s = m.params.sessionId as string, url = m.params.targetInfo.url as string;
      void (async () => {
        if (url.startsWith(`${origin}/approve.html#`)) {
          windows.push(url);
          await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http*" }, { urlPattern: "ws*" }] }, s);
          await cdp.send("Runtime.enable", {}, s);
          await cdp.send("Log.enable", {}, s);
          await cdp.send("WebAuthn.enable", { enableUI: false }, s);
          const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "cable", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } }, s);
          for (const credential of made) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential }, s);
        }
        await cdp.send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => undefined);
      })();
    });
    const { targetId } = await cdp.send("Target.createTarget", { url: `${origin}/app.html` });
    await sleep(500);
    const p = await watch(cdp, targetId);
    await p.waitFor(`document.readyState === "complete"`);
    // the requests passkey.ts makes (createPasskey, then the unlock-shaped read), from the app's page
    const got = await p.js<Record<string, unknown>>(`(async () => {
      const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
      let made;
      try { made = await navigator.credentials.create({ publicKey: { rp: { name: "ZeroFee" }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "ZeroFee", displayName: "ZeroFee" },
        challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
        timeout: 60000, hints: ["hybrid"], extensions: { prf: { eval: { first: new Uint8Array(32) } } } } }); } catch (e) { return { createError: e.name + ": " + e.message }; }
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const read = await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ type: "public-key", id: new Uint8Array(made.rawId), transports: ["hybrid"] }],
        userVerification: "required", timeout: 60000, hints: ["hybrid"], extensions: { prf: { eval: { first: new Uint8Array(32) } } } } });
      const ad = new Uint8Array(read.response.authenticatorData);
      const client = JSON.parse(new TextDecoder().decode(read.response.clientDataJSON));
      const want = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(location.origin)));
      let refused = "";
      try { await navigator.credentials.get({ publicKey: { challenge, rpId: "zerofee.si", allowCredentials: [{ type: "public-key", id: new Uint8Array(made.rawId) }], userVerification: "required" } }); } catch (e) { refused = e.name; }
      const prfMade = made.getClientExtensionResults().prf?.results?.first;
      return { made: !!made.rawId, prfEnabled: made.getClientExtensionResults().prf?.enabled === true, prfOnCreate: !!prfMade && new Uint8Array(prfMade).length === 32, signedForOrigin: hex(ad.slice(0, 32)) === want, flags: ad[32],
        challengeOk: client.challenge === btoa(String.fromCharCode(...challenge)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""), origin: client.origin, prfFirst: !!read.getClientExtensionResults().prf?.results?.first, refused };
    })()`);
    log(`approval window: ${JSON.stringify(got)}${errors.length ? ` errors: ${errors.join(" | ").slice(0, 400)}` : ""}`);
    check(windows.length >= 2, `approval window: each passkey request opened the extension's own window (${windows.length})`);
    check(got.made === true && got.prfEnabled === true, "approval window: the key was made there, with PRF");
    check(got.signedForOrigin === true && got.origin === origin && got.challengeOk === true, "approval window: the read came back to the page signed for chrome-extension://<id>, to the page's own challenge");
    check(((got.flags as number) & 0x05) === 0x05, "approval window: the read says user present AND verified");
    // CDP can't carry a virtual key's PRF secret to the second window's authenticator, so PRF is read from the making
    // (its 32 bytes crossed the wire); the read's own PRF crossing is unit-tested (web host/extension.test.ts).
    check(got.prfOnCreate === true, "approval window: the PRF output (32 bytes) came back through the window");
    check(got.refused === "NotAllowedError", "approval window: a request for another RP ID is refused before any window opens");
    check(!errors.some((e) => /Content.Security.Policy|Refused to/i.test(e)), "approval window: no policy (CSP) refusal");
  } finally { await done(); }
}

// Real, first run: the app's own Welcome (no key is made: nothing is pressed), with no Sim link and no sample link
await sidePanelCheck("build", "Real build", `[...document.querySelectorAll("button")].some((b) => b.offsetParent && b.textContent.trim() === "Create my account") && !document.body.textContent.includes("sample money") && !document.body.textContent.includes("pretend money")`, "real-first-screen");
await approvalWindowCheck();
log(failed() ? "FAILED" : "all checks passed");
process.exit(failed() ? 1 : 0);
