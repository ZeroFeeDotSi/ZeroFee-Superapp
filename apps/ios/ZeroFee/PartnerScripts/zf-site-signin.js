// ZeroFee's sign-in steps for a site's own window (Social trading, product decision, 2 Nov): the few taps a person would make to
// sign in with ZeroFee, made for them when the site opens, so it opens signed in with its own wallet. Hash-pinned
// (PartnerScripts.swift signInPin); put only into a site's own window (a known site, wallet mode, an adult's phone), in
// its own content world ("zf-signin"), main frame only, at document end. The page can't see or change this script.
//
// What it may do, and nothing else: on one of the exact hosts below, tap the elements whose visible words are exactly
// the step's (or start with them, where marked), in order, each within its time, at most once per page. It never types,
// never reads a field, a cookie or storage, never sends anything anywhere, and never taps a word on the never-list.
// One number stays in its own world for the host to read: the step whose tap changed nothing twice ("retry" below).
// Security review B (M3): what it taps is the element it clicks, checked again (its words, its label, its link: never
// to another host), on top of the page where it stands, and in its place: the tab bar at the bottom, the header at the
// top, or the open dialog; so nothing a stranger posts on the site (a coin named "ZeroFee", a link) can steer it.
// The sign-in itself is ZeroFee's wallet: the site's own wallet signs a plain sign-in with no sheet (the core's rule);
// anything else the site asks still raises the sheet.
// Signed out later (product decision, 3 Nov: a sign-out was a dead end, since AgentZero had signed them in): when the site's own
// sign-in button shows again with no dialog open, the same steps run again by themselves, at most 3 times per page; if
// it still shows after that, one flag (__zfSignedOut) tells the host, which reloads once and then says so.
(() => {
  "use strict";
  if (window.top !== window) return;
  /** Per exact host: the steps, each [words, how long to look (ms), where it must be, how]. `how`: "prefix" (the words
   *  start the element's), "after" (a step after the sign-in that may not come: not found, the run goes on; it taps only a
   *  real button or link, never a box of words such as a coin's name: security review ST4b, M3), or both ("prefix
   *  after"). Any other step not found ends the run quietly (the site's own Log in still works). "retry": the tap must
   *  open something (a dialog, the next step, another page); if it changed nothing it is tapped once more, and if that
   *  changed nothing either the run stops and marks the step for the window, which says which tap to make (never a loop). */
  const RECIPES = {
    // GMGN (walked 2 Nov in the phone's WebKit, a macOS WKWebView with the iPhone web view's user agent): Portfolio in
    // its bottom tab bar shows your money, and its Log in when signed out; then its Log In sheet's "Connect with
    // extension wallet", then GMGN's own list ("Connect a wallet on Solana to continue"), where ZeroFee is "Installed".
    // GMGN then asks its plain sign-in itself (D65's allow-list; no sheet).
    // A fresh store (2 Nov): a page still settling, or its first-visit tour drawer, can swallow the Log in tap, so
    // Log in and Connect are "retry" steps.
    "gmgn.ai": [["Portfolio", 6000, "bottom"], ["Log in", 2500, "page", "retry"], ["Connect with extension wallet", 4000, "dialog", "retry"], ["ZeroFee", 4000, "dialog", "prefix"]],
    // pump.fun (walked 2 Nov in the phone's WebKit): its header's "Sign in" (a button inside a box with the same words).
    // A first visit shows its terms first ("Welcome to Pump.fun!" · Continue: agreeing to its terms and that you are 18
    // or over): that is the person's own tap, never this script's, so Sign in is looked for up to a minute while they
    // read it. Then ZeroFee in its "or connect a wallet" list (below the fold of its dialog); pump.fun asks its own
    // sign-in ("Sign in to pump.fun: <time>", the core's site allow-list; no sheet). After it, when they come: its
    // referral prompt's Skip, and its cookie banner's "Reject all" (ZeroFee shares nothing it needn't).
    // B32: a returning visit is signed in by pump.fun's own reconnect (ZeroFee answers its connect at once),
    // so its wallet list may never show: ZeroFee is an "after" step (a real button only; not found, the run goes on),
    // never the "ZeroFee · external wallet" words in pump.fun's balance panel.
    "pump.fun": [["Sign in", 60000, "top", "retry"], ["ZeroFee", 6000, "dialog", "prefix after"], ["Skip", 8000, "dialog", "after"], ["Reject all", 4000, "banner", "after"]],
  };
  /** Words this script never taps, whatever a site calls them. */
  /** The site's own signed-out sign: its sign-in button, where it stands when nobody is signed in. */
  const SIGNED_OUT = { "gmgn.ai": ["Log in", "page"], "pump.fun": ["Sign in", "top"] };
  const NEVER = /\b(buy|sell|trade|swap|send|withdraw|deposit|confirm|approve|pay|bet|stake|transfer|export|delete|sign out|log ?out|disconnect|mint|claim|purchase|enable|accept|agree|launch|create|copy|share)\b/i;
  const MAX_TAPS = 6;
  const steps = RECIPES[location.host];
  if (!steps || location.protocol !== "https:") return;
  // `=== true`: a page element with this id shows up as a window property in every world (review retry, L2)
  if (window.__zfSignInRan === true) return;
  window.__zfSignInRan = true;

  // words as a person reads them: invisible letters (zero-width, joiners) and icon-font glyphs (private use) dropped,
  // spaces as one
  const norm = (s) => (s || "").replace(/[\u200b-\u200f\u2060\ufeff\u00ad\ue000-\uf8ff]/g, "").replace(/\s+/g, " ").trim();
  const DIALOG = '[role="dialog"], [aria-modal="true"]';
  const pinned = (el) => {
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      const p = getComputedStyle(x).position;
      if (p === "fixed" || p === "sticky") return true;
    }
    return false;
  };
  /** Is it where the step says: the tab bar (pinned, the bottom fifth), the header (pinned, the top 140 px), a banner
   *  (pinned, outside any dialog: a cookie banner), the open dialog, or the page outside any dialog. */
  const placed = (el, where) => {
    const r = el.getBoundingClientRect();
    const inDialog = Boolean(el.closest(DIALOG));
    if (where === "bottom") return !inDialog && pinned(el) && r.top > innerHeight * 0.8;
    if (where === "top") return !inDialog && pinned(el) && r.bottom < 140;
    if (where === "banner") return !inDialog && pinned(el);
    if (where === "dialog") return inDialog;
    return !inDialog;
  };
  /** On top where it stands: the point at its middle is it or inside it (nothing covers it, it isn't under a dialog). */
  const onTop = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) < 0.05) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (hit === el || el.contains(hit)));
  };
  const says = (t, want, prefix) => (prefix ? t.startsWith(want) && t.length <= want.length + 24 : t === want);
  /** The element a tap would click, checked as clicked: its words (and label) are the step's and nothing on the
   *  never-list; a link stays on this site. */
  const target = (el, want, prefix) => {
    const t = el.closest("button, a, [role=button], [role=menuitem]") || el;
    const words = norm(t.textContent).toLowerCase();
    const label = norm(t.getAttribute("aria-label")).toLowerCase();
    if (!says(words, want, prefix) && !says(label, want, prefix)) return null;
    if (NEVER.test(words) || NEVER.test(label)) return null;
    if (t.tagName === "A" && t.hasAttribute("href")) {
      // read as text, never through the page's own URL (a page may replace it): a path, a #, or this very site
      const href = (t.getAttribute("href") || "").trim();
      const here = `https://${location.host}`;
      const same = (href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#") || href === here || href.startsWith(`${here}/`) || href.startsWith(`${here}?`) || href.startsWith(`${here}#`);
      if (!same) return null;
    }
    return t;
  };
  const CONTROL = "button, a, [role=button], [role=menuitem]";
  /** Brought into view once each, never again while a person scrolls (review ST4b, L6). */
  const scrolled = new WeakSet();
  const find = (words, where, prefix, controlOnly) => {
    const want = words.toLowerCase();
    // innermost first (document order reversed): a tap on the inner element reaches every handler above it, while a tap
    // on a wrapper never reaches a button inside it (pump.fun's Sign in is a button inside a box with the same words)
    for (const el of [...document.querySelectorAll("button, a, [role=button], [role=menuitem], li, div, span, p")].reverse()) {
      if (!says(norm(el.textContent).toLowerCase(), want, prefix)) continue;
      const t = target(el, want, prefix);
      if (!t || !placed(t, where) || (controlOnly && !t.matches(CONTROL))) continue;
      // a choice below the fold of its own dialog (pump.fun lists wallets under "or connect a wallet"): brought into view
      // first, as a person scrolls to it, then checked on top where it now stands
      const r = t.getBoundingClientRect();
      if (where === "dialog" && (r.top < 0 || r.bottom > innerHeight) && !scrolled.has(t)) {
        scrolled.add(t);
        t.scrollIntoView({ block: "center", behavior: "instant" });
      }
      if (onTop(t)) return t;
    }
    return null;
  };
  const waitFor = (words, ms, where, prefix, controlOnly) =>
    new Promise((done) => {
      const end = Date.now() + ms;
      const look = () => {
        const el = find(words, where, prefix, controlOnly);
        if (el) return done(el);
        if (Date.now() > end) return done(null);
        setTimeout(look, 120);
      };
      look();
    });
  const tap = (t) => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    t.click();
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const dialogsOpen = () => [...document.querySelectorAll(DIALOG)].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  /** Did the tap on step i open something within `ms`: a dialog opened or closed, the page moved, the next step showed,
   *  or the step's own words are no longer on top where they stood. A button the page drew again with the same words
   *  still counts as unchanged. */
  const changed = (i, before, ms) =>
    new Promise((done) => {
      const [words, , where, how = ""] = steps[i];
      const next = steps[i + 1];
      const end = Date.now() + ms;
      const look = () => {
        if (dialogsOpen() !== before.dialogs || location.href !== before.href) return done(true);
        if (next && find(next[0], next[2], (next[3] || "").includes("prefix"), (next[3] || "").includes("after"))) return done(true);
        if (!find(words, where, how.includes("prefix"), how.includes("after"))) return done(true);
        if (Date.now() > end) return done(false);
        setTimeout(look, 120);
      };
      setTimeout(look, 120);
    });
  const run = async () => {
    let taps = 0;
    for (let i = 0; i < steps.length; i++) {
      const [words, ms, where, how = ""] = steps[i];
      if (taps >= MAX_TAPS) return;
      const prefix = how.includes("prefix"), after = how.includes("after");
      const el = await waitFor(words, ms, where, prefix, after);
      if (!el && after) continue;
      if (!el) return;
      const before = { dialogs: dialogsOpen(), href: location.href };
      const at = el.getBoundingClientRect();
      tap(el);
      taps += 1;
      if (how.includes("retry") && !(await changed(i, before, 2500))) {
        // the tap changed nothing (GMGN on a fresh store: a page still settling, or its tour drawer): once more, then stop
        const again = find(words, where, prefix, after);
        if (!again) continue;
        if (taps >= MAX_TAPS) return;
        // the same control, or the page's own redraw of it in the same place; never another control with those words
        // (review retry, L3): that is marked, not tapped
        const r = again.getBoundingClientRect();
        if (again !== el && (el.isConnected || Math.abs(r.top - at.top) > 8 || Math.abs(r.left - at.left) > 8)) {
          window.__zfSignInStuck = i;
          return;
        }
        const before2 = { dialogs: dialogsOpen(), href: location.href };
        tap(again);
        taps += 1;
        if (!(await changed(i, before2, 2500))) {
          // read by the host (PartnerView) from this world only, as a number: the window's words are its own
          window.__zfSignInStuck = i;
          return;
        }
      }
      await pause(250);
    }
  };
  // Signed out later: the sign-in button seen twice in a row (4 s), no dialog open, 8 s since the last run: run again.
  const out = SIGNED_OUT[location.host];
  let again = 0, seen = 0, lastRun = Date.now();
  const signedOutNow = () => Boolean(out) && dialogsOpen() === 0 && Boolean(find(out[0], out[1], false, true));
  const watchOut = () => {
    seen = signedOutNow() ? seen + 1 : 0;
    if (seen >= 2 && Date.now() - lastRun > 8000) {
      if (again >= 3) {
        window.__zfSignedOut = true;
        return;
      }
      again += 1;
      seen = 0;
      window.__zfSignInStuck = undefined;
      run().finally(() => { lastRun = Date.now(); setTimeout(watchOut, 2000); });
      return;
    }
    setTimeout(watchOut, 2000);
  };
  run().finally(() => { lastRun = Date.now(); setTimeout(watchOut, 4000); });
})();
