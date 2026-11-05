// ZeroFee's words guard (product decision, 3 Nov): a page that asks for the person's secret words, or draws its own Face ID, is named
// on ZeroFee's own bar above it (PartnerSeedGuard.swift). Its own content world ("zf-seedguard"), every frame: the page
// can't see it, change it or post to its handler. It reads the page on the phone only and sends one word, never the
// page's text and never anything typed: "words" or "faceid". At most one check per 500 ms; it stops at its first find.
// Pinned: PartnerScripts.seedGuardPin (shasum -a 256 this file).
(() => {
  "use strict";
  if (window.__zfSeedGuardRan === true) return;
  window.__zfSeedGuardRan = true;
  const gate = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.zfSeedGuard;
  if (!gate) return;

  // matcher:start (the same lists and rules as SeedGuard in PartnerSeedGuard.swift)
  const PHRASES = ["backup words", "seed phrase", "secret recovery phrase", "recovery phrase", "private key", "12 words", "24 words", "12 word", "24 word", "mnemonic", "passcode", "enter your words"];
  const FACE = ["face id", "faceid"];
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s‐-―_-]+/g, " ");
  const words = (list) => new RegExp("(?:^|[^a-z0-9])(?:" + list.join("|") + ")s?(?![a-z0-9])");
  const ASKS = words(PHRASES);
  const FACE_ID = words(FACE);
  // matcher:end

  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  const MAX = 400000;
  const FIELDS = "input, textarea, [contenteditable], [role='textbox']";
  const OVERLAY = "dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true']";

  // The page's words without layout: its text nodes (no scripts or styles), up to MAX characters.
  const rawText = () => {
    const root = document.body || document.documentElement;
    if (!root) return "";
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentNode && SKIP[n.parentNode.nodeName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let out = "";
    for (let n = walk.nextNode(); n && out.length < MAX; n = walk.nextNode()) out += " " + n.nodeValue;
    return out;
  };
  const shown = (el) => el.getClientRects().length > 0;
  // A field's own label, placeholder and aria-label (never its value).
  const labelOf = (el) => {
    let s = (el.getAttribute("placeholder") || "") + " " + (el.getAttribute("aria-label") || "");
    if (el.labels) for (const l of el.labels) s += " " + l.textContent;
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) { const t = id && document.getElementById(id); if (t) s += " " + t.textContent; }
    return s;
  };
  const covers = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height >= 0.25 * innerWidth * innerHeight; };
  // "Face ID" inside a dialog, or inside a fixed box over a quarter or more of the screen.
  const faceInOverlay = () => {
    for (const d of document.querySelectorAll(OVERLAY)) if (shown(d) && FACE_ID.test(norm(d.innerText))) return true;
    const root = document.body;
    if (!root) return false;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let n = walk.nextNode(); n && seen < 20; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || !/face/i.test(n.nodeValue) || !FACE_ID.test(norm(el.textContent))) continue;
      seen += 1;
      for (let a = el, up = 0; a && a !== root && up < 12; a = a.parentElement, up += 1) {
        if (getComputedStyle(a).position === "fixed" && shown(a) && covers(a)) return true;
      }
    }
    return false;
  };

  let done = false;
  let queued = false;
  let last = 0;
  let watch = null;
  const tell = (kind) => {
    done = true;
    if (watch) watch.disconnect();
    try { gate.postMessage(kind); } catch (e) { /* the window closed */ }
  };
  const check = () => {
    queued = false;
    last = Date.now();
    if (done || !document.body) return;
    const raw = norm(rawText());
    if (ASKS.test(raw) && ASKS.test(norm(document.body.innerText))) return tell("words");
    for (const f of document.querySelectorAll(FIELDS)) if (ASKS.test(norm(labelOf(f))) && shown(f)) return tell("words");
    if (FACE_ID.test(raw) && faceInOverlay()) return tell("faceid");
  };
  const soon = () => {
    if (done || queued) return;
    queued = true;
    setTimeout(check, Math.max(0, 500 - (Date.now() - last)));
  };
  watch = new MutationObserver(soon);
  watch.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["placeholder", "aria-label", "aria-labelledby", "open", "hidden", "aria-hidden", "aria-modal", "role", "style", "class"],
  });
  soon();
})();
