// The web unlock's walk (audits K-1, K-2, K-6): a new person on testnet, in headless Chrome with a virtual platform
// authenticator that has PRF (as Touch ID does), at 390×844 and 1440×900, light and dark.
//
//   node tools/vault/unlock-walk.mjs http://127.0.0.1:5180       (a running `npm run -w @zerofee/web dev`; any port)
//   SHOTS=/some/dir node tools/vault/unlock-walk.mjs <url>        (a screenshot after every step)
//   ONLY=390x844-light node tools/vault/unlock-walk.mjs <url>     (one of the four)
//
//   ONLY=trusted-tap ...                                          (the approval sheet's own click check, K2-2)
//   CPU=4 ...                                                     (Chrome runs 4 times slower: a mid laptop's timing)
//
// Steps: set-up (lock with the passkey) → the app opens → Create my account (testnet) → the words → reload → locked →
// unlock → new words (none were kept) → three checked → the backup key's sheet: a script's Approve is refused, a real
// tap signs → the bank opens. After every step the screen's words are read and checked; IndexedDB is scanned after
// set-up, at the words, and after signing: no "__wrap-key", no "pending-words", no words seed or hot root in the clear.
// Exit 0 only if every check passes and the console stays clean. Uses the Chrome installed on this Mac; nothing is
// installed, nothing in the product changes.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wordsToSeed } from "../../packages/core/src/recovery-words.ts";
import { hotRoot } from "../../packages/core/src/hot-keys.ts";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) {
  console.error("usage: node tools/vault/unlock-walk.mjs <web app url, on localhost: a passkey's site can't be an IP address>");
  process.exit(2);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (b) => Buffer.from(b).toString("hex");
const COMBOS = [
  { w: 390, h: 844, mobile: true, theme: "light" },
  { w: 390, h: 844, mobile: true, theme: "dark" },
  { w: 1440, h: 900, mobile: false, theme: "light" },
  { w: 1440, h: 900, mobile: false, theme: "dark" },
  // An authenticator without PRF: the passkey can't seal, so a passcode (no bank is made in this one).
  { w: 390, h: 844, mobile: true, theme: "light", passcode: true },
].filter((c) => !process.env.ONLY || process.env.ONLY.split(",").includes(`${c.w}x${c.h}-${c.theme}${c.passcode ? "-passcode" : ""}`));

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  return ok;
};
/** A step the rest of the walk depends on: failed, this size and theme stop here. */
const must = (ok, what) => {
  if (!check(ok, what)) throw new Error(`stopped at: ${what}`);
};

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer().once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function walk(combo) {
  const tag = `${combo.w}x${combo.h}-${combo.theme}${combo.passcode ? "-passcode" : ""}`;
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "unlock-walk-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${combo.w},${combo.h}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const errors = [];
  let shotOnStop = null;
  let ws;
  let step = 0;
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
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
      if (m.method === "Runtime.consoleAPICalled" && process.env.DEBUG) console.log("     console:", m.params.args.map((a) => a.value ?? a.description).join(" "));
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    });
    const cdp = (method, params = {}) =>
      new Promise((res) => {
        const id = ++n;
        pending.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const text = () => js(`document.body.innerText`);
    /** Screenshot, then read the screen's words back (the robot reads the screen after every tap). */
    const shot = async (name) => {
      await sleep(500);
      step++;
      const words = ((await text()) ?? "").replace(/\s+/g, " ").trim();
      if (shots) {
        const r = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(shots, `${tag}-${String(step).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64"));
      }
      console.log(`     [${tag} ${String(step).padStart(2, "0")} ${name}] ${words.slice(0, 220)}`);
      return words;
    };
    shotOnStop = () => shot("stopped");
    /** Wait until the screen says `want` (up to `ms`). */
    const until = async (want, ms = 60_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const t = (await text()) ?? "";
        if (typeof want === "string" ? t.includes(want) : want.test(t)) return true;
        await sleep(400);
      }
      return false;
    };
    /** A real tap (the browser's own input, so it counts as a person's gesture) on the first visible button with this text. */
    const tap = async (label, selector = "button") => {
      const at = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.offsetParent !== null && !b.disabled && b.textContent.trim().includes(${JSON.stringify(label)})); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!at) return false;
      for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
      await sleep(700);
      return true;
    };
    /** Every ZeroFee database's contents, byte strings as hex (a CryptoKey shows as such). */
    const scan = () =>
      js(`(async () => {
        const out = {};
        const enc = (v) => v instanceof CryptoKey ? "CryptoKey" : v instanceof ArrayBuffer ? "hex:" + [...new Uint8Array(v)].map((b) => b.toString(16).padStart(2, "0")).join("") : ArrayBuffer.isView(v) ? "hex:" + [...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)].map((b) => b.toString(16).padStart(2, "0")).join("") : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v;
        for (const { name } of await indexedDB.databases()) {
          const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
          const stores = [...db.objectStoreNames];
          out[name] = {};
          for (const s of stores) {
            const tx = db.transaction(s, "readonly").objectStore(s);
            const [keys, vals] = await Promise.all([tx.getAllKeys(), tx.getAll()].map((q) => new Promise((res) => { q.onsuccess = () => res(q.result); })));
            keys.forEach((k, i) => (out[name][String(k)] = enc(vals[i])));
          }
          db.close();
        }
        return JSON.stringify(out);
      })()`);
    const scanClean = async (when, secrets = []) => {
      const dump = (await scan()) ?? "{}";
      const db = JSON.parse(dump);
      const keys = Object.values(db).flatMap((s) => Object.keys(s));
      check(!keys.includes("__wrap-key"), `${tag} ${when}: no vault keeps its own key ("__wrap-key")`);
      check(!keys.includes("item:pending-words"), `${tag} ${when}: no pending-words item`);
      for (const [label, bytes] of secrets) check(!dump.includes(hex(bytes)), `${tag} ${when}: IndexedDB holds no ${label} in the clear`);
      return db;
    };

    await cdp("Runtime.enable");
    await cdp("Page.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width: combo.w, height: combo.h, deviceScaleFactor: 2, mobile: combo.mobile });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: combo.theme }] });
    // CPU=4: Chrome runs this page's work 4 times slower, as a mid laptop would (for the passcode's timing).
    if (process.env.CPU) await cdp("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU) });
    // A platform authenticator with user verification and PRF, as Touch ID on a Mac.
    await cdp("WebAuthn.enable", { enableUI: false });
    const auth = await cdp("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: !combo.passcode } });
    check(!!auth.result?.authenticatorId, `${tag}: a virtual platform authenticator ${combo.passcode ? "without" : "with"} PRF`);
    /** Type into the focused field, as a keyboard does. */
    const type = async (text) => {
      await js(`document.querySelector('input[type=password]')?.focus()`);
      await cdp("Input.insertText", { text });
      await sleep(300);
    };
    const go = async () => {
      await cdp("Page.navigate", { url: `${base}/` });
      await sleep(2500);
      if (combo.theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    };

    // 1. Set-up: the lock first, one action.
    await go();
    check(await until("Lock ZeroFee on this device", 15_000), `${tag}: first open asks once to lock ZeroFee`);
    let t = await shot("setup");
    check(/encrypted with your passkey/.test(t) && !/chip/i.test(t), `${tag}: set-up says "encrypted with your passkey", never chip`);
    check(await tap("Use "), `${tag}: tap Use Touch ID`);
    if (combo.passcode) {
      must(await until("Choose a passcode", 20_000), `${tag}: no PRF: straight to a passcode`);
      t = await shot("no-prf-passcode");
      check(/Choose a passcode instead/.test(t) && /weaker/.test(t), `${tag}: the screen says why, and that a passcode is weaker`);
      for (const [weak, says] of [["kite42", /at least 8/i], ["20261029", /Not only numbers/], ["abcdefgh", /run or a repeat/], ["password", /every list/]]) {
        await type(weak);
        await tap("Next");
        t = await shot(`refused-${weak}`);
        check(says.test(t), `${tag}: "${weak}" is refused, plainly`);
        await js(`(() => { const i = document.querySelector('input[type=password]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      }
      await type("maple river 42");
      must(await tap("Next"), `${tag}: Next`);
      must(await until("Type it again", 5_000), `${tag}: type it again`);
      await shot("again");
      await type("maple river 42");
      let t0 = Date.now();
      must(await tap("Lock with this passcode"), `${tag}: Lock with this passcode`);
      must(await until(/Own your bank|Create my account/, 60_000), `${tag}: locked with the passcode, the app opens`);
      console.log(`     time: locking with the passcode (Argon2id 64 MiB, 3 passes) took ${Date.now() - t0 - 700} ms`);
      await shot("unlocked-welcome");
      const rec = JSON.parse((await scan()) ?? "{}")["zerofee-unlock"]?.record;
      check(rec?.method === "passcode" && rec?.kdf?.name === "argon2id" && rec.kdf.m >= 65536 && rec.kdf.t >= 3, `${tag}: the root is sealed with Argon2id, 64 MiB and 3 passes at least`);
      await cdp("Page.reload", {});
      await sleep(2500);
      must(await until("ZeroFee is locked", 15_000), `${tag}: after a reload it is locked`);
      t = await shot("locked");
      check((await js(`document.querySelector('input[type=password]')?.placeholder`)) === "Enter your passcode", `${tag}: locked: enter your passcode`);
      // Wrong tries: the first two say try again; the third waits 30 seconds, with Unlock off, counted in the record.
      for (let i = 1; i <= 3; i++) {
        await type(`wrong river ${i}`);
        await tap("Unlock");
        check(await until("didn't open it", 30_000), `${tag}: wrong passcode ${i} opens nothing, and says so`);
        t = await shot(`wrong-${i}`);
      }
      check(/Try again in (2\d|30) seconds/.test(t), `${tag}: the third wrong try waits 30 seconds, and says so`);
      check(await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === "Unlock")?.disabled === true`), `${tag}: Unlock is off while it waits`);
      const counted = JSON.parse((await scan()) ?? "{}")["zerofee-unlock"]?.record;
      check(counted?.failed === 3 && counted?.waitUntil > 0, `${tag}: the wrong tries are counted in the record`);
      // The wait, shortened for the walk: the record says when (a browser's clock can't be wound on).
      await js(`(async () => { const db = await new Promise((r) => { const q = indexedDB.open("zerofee-unlock"); q.onsuccess = () => r(q.result); }); const s = db.transaction("items", "readwrite").objectStore("items"); const rec = await new Promise((r) => { const q = s.get("record"); q.onsuccess = () => r(q.result); }); rec.waitUntil = Date.now() + 3000; await new Promise((r) => { const q = s.put(rec, "record"); q.onsuccess = r; }); db.close(); })()`);
      await cdp("Page.reload", {});
      await sleep(5500);
      must(await until("ZeroFee is locked", 15_000), `${tag}: locked again`);
      await type("maple river 42");
      t0 = Date.now();
      await tap("Unlock");
      must(await until(/Own your bank|Create my account/, 60_000), `${tag}: the right passcode opens it once the wait is over`);
      console.log(`     time: unlocking with the passcode took ${Date.now() - t0 - 700} ms`);
      await shot("unlocked");
      const cleared = JSON.parse((await scan()) ?? "{}")["zerofee-unlock"]?.record;
      check(!cleared?.failed && !cleared?.waitUntil, `${tag}: a right passcode clears the count`);
      return;
    }
    must(await until(/Own your bank|Create my account/, 20_000), `${tag}: locked with the passkey, the app opens`);
    t = await shot("unlocked-welcome");
    await scanClean("after set-up");
    const unlockDb = JSON.parse((await scan()) ?? "{}")["zerofee-unlock"];
    check(unlockDb?.record?.method === "passkey", `${tag}: the sealed root is kept with the passkey's id and salt only`);

    // 2. Create a bank on testnet, to the words.
    check(await tap("Create my account"), `${tag}: tap Create my account`);
    await sleep(800);
    // One screen (PAR 8): the key, the recovery wait's line, and the terms when not yet agreed; one tap agrees and makes it.
    must(await until("Make your key", 10_000), `${tag}: Make your key`);
    t = await shot("make-key");
    check(!/secure chip/i.test(t) && /encrypted with your passkey/.test(t), `${tag}: Make your key says encrypted with your passkey, never secure chip`);
    check(/Recovery wait: 48 hours/.test(t) && !/recommend/i.test(t), `${tag}: the recovery wait is one line, 48 hours, never "Recommended"`);
    must((await tap("Agree and make my key")) || (await tap("Make my key")), `${tag}: tap Make my key`);
    const madeIt = await until(/Write these down|Write down|backup words/i, 120_000);
    t = await shot("words");
    must(madeIt, `${tag}: the testnet bank is made and the words show`);
    const firstWords = await js(`[...document.querySelectorAll('.ob-words li')].map((li) => li.lastChild.textContent.trim())`);
    check(Array.isArray(firstWords) && firstWords.length === 24, `${tag}: 24 words on screen`);
    if (firstWords?.length === 24) {
      const seed = wordsToSeed(firstWords);
      await scanClean("at the words", [["words seed", seed], ["hot root", hotRoot(seed)]]);
    }

    // 3. Reload: locked. 4. Unlock with the passkey.
    await cdp("Page.reload", {});
    await sleep(2500);
    if (combo.theme === "dark") await js(`document.documentElement.dataset.theme = "dark"`);
    must(await until("ZeroFee is locked", 15_000), `${tag}: after a reload it is locked`);
    t = await shot("locked");
    check(/Unlock with/.test(t) && /Lost your passkey/.test(t), `${tag}: locked: one action, and what to do if the passkey is lost`);
    check(await tap("Unlock with"), `${tag}: tap Unlock`);
    const backAtWords = await until(/Write these down|Write down|backup words/i, 60_000);
    t = await shot("unlocked-words");
    must(backAtWords, `${tag}: unlocked, the words step again`);
    const words = await js(`[...document.querySelectorAll('.ob-words li')].map((li) => li.lastChild.textContent.trim())`);
    check(words?.length === 24 && words.join(" ") !== firstWords?.join(" "), `${tag}: new words: none were kept from before the reload`);

    // 5. Check three, then the backup key's sheet: a script's Approve is refused; a real tap signs.
    const done = await js(`[...document.querySelectorAll('.zf-floor .zf-btn')].pop()?.textContent ?? ""`);
    await tap(done.trim());
    for (let i = 0; i < 3; i++) {
      const pos = Number((await js(`document.querySelector('h1')?.textContent.match(/word (\\d+)/)?.[1] ?? 0`)) ?? 0);
      if (!pos) break;
      await shot(`check-${i + 1}`);
      await tap(words[pos - 1], ".ob-option");
    }
    must(await until(/check this/i, 60_000), `${tag}: the backup key's approval sheet`);
    await sleep(1200);
    t = await shot("sheet");
    // A script clicks Approve (no user gesture): refused.
    await js(`[...document.querySelectorAll('.approval button')].find((b) => b.textContent.includes("Approve"))?.click()`);
    const refused = await until(/your own tap|wasn't added|said no/i, 30_000);
    t = await shot("script-approve-refused");
    check(refused, `${tag}: Approve clicked by a script is refused`);
    // Back to the check, then a real tap.
    for (const label of ["Add it now", "Try again", "Go back", "OK"]) if (await tap(label)) break;
    await sleep(800);
    for (let i = 0; i < 3; i++) {
      const pos = Number((await js(`document.querySelector('h1')?.textContent.match(/word (\\d+)/)?.[1] ?? 0`)) ?? 0);
      if (!pos) break;
      await tap(words[pos - 1], ".ob-option");
    }
    must(await until(/check this/i, 60_000), `${tag}: the sheet again`);
    await sleep(1200);
    await shot("sheet-again");
    check(await tap("Approve", ".approval button"), `${tag}: a real tap on Approve`);
    const opened = await until(/Your account is open|Wallet/i, 120_000);
    t = await shot("signed");
    check(opened, `${tag}: signed: the backup key is on chain and the bank opens`);
    const seed = wordsToSeed(words);
    await scanClean("after signing", [["words seed", seed], ["hot root", hotRoot(seed)]]);
  } catch (e) {
    check(false, `${tag}: ${e?.message ?? e}`);
    await shotOnStop?.().catch(() => undefined);
  } finally {
    const noisy = errors.filter((e) => !/favicon|Failed to load resource/.test(String(e)));
    check(noisy.length === 0, `${tag}: console clean${noisy.length ? `: ${noisy.slice(0, 3).join(" | ")}` : ""}`);
    ws?.close();
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

/**
 * Re-audit K2-2: the approval sheet's own check (personTapped, the module the sheet uses, loaded from the dev server),
 * in Chrome: a real click counts; el.click(), a constructed MouseEvent, a forged object, a forged { isTrusted: true },
 * a real click on another button, and a real click replayed later do not.
 */
async function trustProbe() {
  const tag = "trusted-tap";
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), "unlock-walk-"));
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=390,844", "--no-first-run", "about:blank"], { stdio: "ignore" });
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
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    const cdp = (method, params = {}) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    await cdp("Page.enable");
    await cdp("Page.navigate", { url: `${base}/?screens` });
    await sleep(3000);
    await js(`(async () => {
      window.__act = await import("/src/unlock/activation.ts");
      document.body.innerHTML = '<button id="a" style="position:fixed;left:20px;top:20px;width:200px;height:60px">Approve</button><button id="b" style="position:fixed;left:20px;top:120px;width:200px;height:60px">Other</button>';
      window.__seen = [];
      for (const id of ["a", "b"]) document.getElementById(id).addEventListener("click", (e) => window.__seen.push({ id, ev: e, ok: __act.personTapped(e, document.getElementById("a")) }));
      return true;
    })()`);
    const click = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await sleep(200); };
    await click(100, 50);
    check(await js(`__seen.at(-1)?.ok === true`), `${tag}: a person's click on Approve counts`);
    await js(`document.getElementById("a").click()`);
    check(await js(`__seen.at(-1)?.ok === false`), `${tag}: a script's el.click() doesn't`);
    check(await js(`__act.personTapped(new MouseEvent("click", { bubbles: true }), document.getElementById("a")) === false`), `${tag}: a constructed MouseEvent doesn't`);
    check(await js(`__act.personTapped(Object.create(MouseEvent.prototype, { isTrusted: { value: true }, type: { value: "click" }, target: { value: document.getElementById("a") }, timeStamp: { value: performance.now() } }), document.getElementById("a")) === false`), `${tag}: a forged MouseEvent with isTrusted: true doesn't`);
    check(await js(`__act.personTapped({ isTrusted: true, type: "click", target: document.getElementById("a"), timeStamp: performance.now() }, document.getElementById("a")) === false`), `${tag}: a made-up { isTrusted: true } doesn't (the handler called by hand)`);
    await click(100, 150);
    check(await js(`__seen.at(-1)?.id === "b" && __seen.at(-1)?.ok === false`), `${tag}: a person's click on another button doesn't`);
    await sleep(1300);
    check(await js(`__act.personTapped(__seen[0].ev, document.getElementById("a")) === false`), `${tag}: a person's real click replayed a second later doesn't`);
  } catch (e) {
    check(false, `${tag}: ${e?.message ?? e}`);
  } finally {
    ws?.close();
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

for (const combo of COMBOS) await walk(combo);
if (!process.env.ONLY || process.env.ONLY.split(",").includes("trusted-tap")) await trustProbe();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nall passed");
process.exit(failures.length ? 1 : 0);
