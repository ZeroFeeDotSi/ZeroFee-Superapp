import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@zerofee/design/tokens.css";
import "@zerofee/design/ui.css";
import "@zerofee/design/motion.css";
import "./app.css";
import "./gallery/screens.css";
import { applyTheme, savedTheme } from "./shell/theme.ts";
import { SIM_BLOCKED, SITE_TITLE, tabTitle } from "./demo-line.ts";
import { EXTENSION_BUILD, SIM, WEB_MODES, WEB_WALLET, pinTabMode, savedWebMode } from "./mode.ts";
import { LAYOUT_KEY, adoptOldDemo, installSimStorage } from "./sim-storage.ts";
import { install as installRest } from "@zerofee/shell-api/rest.ts";
import { installChunkReload, setChunkReloadDeps } from "@zerofee/shell-api/chunk-reload.ts";
import { jobStarting, jobsWritten } from "@zerofee/shell-api/job-start.ts";

applyTheme(savedTheme(), false);
// Focus rings are for the keyboard only (design ui.css, product decision, 5 Nov): the page starts as a pointer page; a Tab or an arrow key
// turns the ring on, the next finger or mouse turns it off again. Scripted taps and a script's focus() never draw one.
document.documentElement.dataset.input = "pointer";
addEventListener("keydown", (e) => { if (e.key === "Tab" || e.key.startsWith("Arrow")) document.documentElement.dataset.input = "keyboard"; }, true);
addEventListener("pointerdown", () => { document.documentElement.dataset.input = "pointer"; }, true);
// the page rests while hidden or covered by a site window: no endless animation, no idle read (shell-api rest.ts)
installRest();
// a deploy swapped the chunks under this open page: it reloads once by itself onto the new build, never in a loop, never
// on the phone (its files are its own), never under a job that is just starting (chunk-reload.ts; QA Sim crawl, 5 Nov)
setChunkReloadDeps({ busy: jobStarting, settled: jobsWritten });
installChunkReload(window);

// The test flight recorder (shell/flight.ts, product decision, 4 Nov): only in the test builds (VITE_TEST_TRACE=1 with the
// reader's key and the trace id), never the public one; otherwise read inline, so not a byte of it is in the bundle.
if (import.meta.env.VITE_TEST_TRACE === "1" && import.meta.env.VITE_ZEROFEE_PUBLIC !== "1" && !!import.meta.env.VITE_TEST_TRACE_KEY && !!import.meta.env.VITE_TEST_TRACE_ID) {
  void import("./shell/flight.ts").then((m) => m.startFlight({ key: import.meta.env.VITE_TEST_TRACE_KEY, id: import.meta.env.VITE_TEST_TRACE_ID, relay: import.meta.env.VITE_ZEROFEE_RELAY }), () => undefined);
}

// On a wide screen the app sits in an iPhone-sized frame (393 × 852), scaled down to fit shorter windows.
// The public site leaves room above the frame for its one name (app.css .demo-title) and its Sim | Real switch (app.css
// .zf-site-switch): 88 px above the frame, so as much below it (the frame stays centred).
const room = import.meta.env.VITE_ZEROFEE_PUBLIC === "1" && !EXTENSION_BUILD ? 176 : 48;
const fit = () => document.documentElement.style.setProperty("--fit", String(Math.min(1, (innerHeight - room) / 876)));
fit();
addEventListener("resize", fit);

const root = createRoot(document.getElementById("root")!);

/**
 * The public site (D157, product decision, 3 Nov): the Sim only, the whole app on sample money (the demo page: no core, no
 * key). Real money is the iPhone app and, on a computer, the Chrome extension. Before any app code loads: the old public
 * demo's keys move under Sim's own names once (sim-storage.ts adoptOldDemo), and the page's storage becomes Sim's own.
 * A browser that won't let Sim keep its own storage doesn't start it (fail closed): one plain line.
 */
async function startPublic() {
  // the site names itself once above the frame; D157: the extension's side panel is the app itself (its own page, no site)
  if (!EXTENSION_BUILD) {
    document.title = tabTitle(SIM);
    const title = document.createElement("p");
    title.className = "demo-title";
    title.textContent = SITE_TITLE;
    document.body.prepend(title);
    // product decision, 4 Nov: the Sim | Real switch above the phone (site-switch.ts); asked for first, so a Sim that can't
    // start below still offers Real. Loaded beside the app, never in the phone build's first load (speed budget)
    // its room is kept at once (app.css html[data-site-switch]), so the app never moves when it arrives
    if (WEB_MODES) document.documentElement.dataset.siteSwitch = "";
    if (WEB_MODES) void import("./site-switch.ts").then((m) => m.mountSiteSwitch(document, SIM), () => undefined);
    // D157: no real account ever runs on this site, so the old demo's keys move under Sim's names without a vault check
    // (never in the extension: its storage is its own origin's, and it never held the old demo)
    if (!localStorage.getItem(LAYOUT_KEY)) adoptOldDemo(localStorage, false);
  }
  if (SIM && !installSimStorage()) {
    root.render(<div className="zf-screen zf-pad" style={{ display: "grid", placeItems: "center", textAlign: "center" }}><p className="zf-body">{SIM_BLOCKED}</p></div>);
    return;
  }
  const m = await import("./full-app.tsx");
  m.mount(root);
}

if (import.meta.env.VITE_ZEROFEE_PUBLIC === "1") {
  // product decision, 4 Nov is the web wallet (hot wallets, no Safe); shell-api release.ts webWallet reads it
  document.documentElement.dataset.public = SIM ? "sim" : WEB_WALLET ? "web" : "real";
  // this tab keeps the mode it opened in: a reload here never follows another tab's switch (mode.ts pinTabMode)
  if (WEB_MODES) pinTabMode(savedWebMode());
  void startPublic();
} else {
  void import("./full-app.tsx").then((m) => m.mount(root));
}
