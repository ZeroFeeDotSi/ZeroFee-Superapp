// The content script on a supported site. It does two things: it tells the background which page this is (its address
// only, never its content), and on a coin's page it shows the launcher, one round button on the right edge, inside a
// closed shadow root so the site's code and styles can't reach it. Pressing it opens the panel; dragging it moves it up
// or down, and the place is kept. It holds no key and sees no balance.
import { coinFromUrl } from "./site.ts";

const POS_KEY = "launcher.top", THEME_KEY = "theme";
const MARK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M6.2 17.8 17.8 6.2"/></svg>';
const CSS = `
:host { all: initial; }
.l { position: fixed; right: 0; z-index: 2147483647; display: flex; align-items: center; gap: 10px; transform: translateY(-50%);
  font: 400 12.5px/1.2 -apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif; touch-action: none; }
.b { appearance: none; border: 0; width: 46px; height: 46px; border-radius: 23px 0 0 23px; display: grid; place-items: center; cursor: pointer;
  background: #fff; color: #0b0b0c; box-shadow: 0 6px 20px rgba(0,0,0,.28); transition: width .2s cubic-bezier(.2,0,0,1); }
.dark .b { background: #000; color: #f2f2f3; box-shadow: 0 0 0 1px rgba(242,242,243,.18), 0 6px 20px rgba(0,0,0,.3); }
.b:hover { width: 52px; }
.b:focus-visible { outline: 1px solid currentColor; outline-offset: -5px; }
.b svg { fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; }
.t { color: #f2f2f3; background: rgba(11,11,12,.86); padding: 7px 11px; border-radius: 9px; opacity: 0; transform: translateX(6px);
  transition: opacity .2s cubic-bezier(.2,0,0,1), transform .2s cubic-bezier(.2,0,0,1); pointer-events: none; white-space: nowrap; }
.l:hover .t, .b:focus-visible + .t { opacity: 1; transform: none; }
.l.drag .t { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .b, .t { transition: none; } }
`;

let host: HTMLElement | undefined, wrap: HTMLDivElement | undefined, last = "";

function mount(): HTMLDivElement {
  host = document.createElement("zerofee-launcher");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${CSS}</style><div class="l"><button class="b" type="button" aria-label="Open the ZeroFee panel">${MARK}</button><span class="t">Trade with ZeroFee</span></div>`;
  const w = root.querySelector<HTMLDivElement>(".l")!, button = root.querySelector<HTMLButtonElement>(".b")!;
  place(w, 0.58);
  void chrome.storage.local.get(POS_KEY).then((v) => { if (typeof v[POS_KEY] === "number") place(w, v[POS_KEY] as number); });
  void chrome.storage.local.get(THEME_KEY).then((v) => { w.classList.toggle("dark", v[THEME_KEY] === "dark"); });

  // a press without moving opens the panel; a press that moves drags the launcher along the edge
  let start: { y: number; top: number } | undefined, moved = false;
  button.addEventListener("pointerdown", (e) => { start = { y: e.clientY, top: w.getBoundingClientRect().top + w.offsetHeight / 2 }; moved = false; button.setPointerCapture(e.pointerId); });
  button.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (!moved && Math.abs(dy) < 4) return;
    moved = true;
    w.classList.add("drag");
    place(w, (start.top + dy) / innerHeight);
  });
  button.addEventListener("pointerup", () => {
    if (moved) { void chrome.storage.local.set({ [POS_KEY]: parseFloat(w.style.top) / 100 }); w.classList.remove("drag"); }
    start = undefined;
  });
  button.addEventListener("click", (e) => {
    if (moved) { e.preventDefault(); moved = false; return; }
    void chrome.runtime.sendMessage({ t: "open" }).catch(() => undefined);
  });
  document.documentElement.append(host);
  return w;
}

function place(w: HTMLDivElement, fraction: number) {
  const f = Math.min(0.92, Math.max(0.08, Number.isFinite(fraction) ? fraction : 0.58));
  w.style.top = `${f * 100}%`;
}

/** On every address change: tell the background, and show the launcher only on a coin's page. */
function tick() {
  if (location.href === last) return;
  last = location.href;
  void chrome.runtime.sendMessage({ t: "page", href: last }).catch(() => undefined);
  const onCoin = coinFromUrl(last) !== null;
  if (onCoin && !wrap) wrap = mount();
  if (host) host.style.display = onCoin ? "" : "none";
}

// The sites change pages without reloading, so the address is watched.
tick();
addEventListener("popstate", tick);
setInterval(tick, 500);
