// ZeroFee's Sign-up Robot, the page side (D29; Security's rules, backlog/security.md §B2 and §D). It runs in its own
// WKContentWorld "zf-robot", in the main frame only: the partner page can't see its globals, and its message handler
// exists in that world only. It is hash-pinned (PartnerScripts.swift): changing one byte changes the pin.
//
// It does two things, and only when the host asks: describe the visible form (snapshot) and do one checked action
// (act). It never reads a field's value, never looks at hidden or off-screen elements, frames, cookies or storage, and
// never navigates. No eval, no new Function, no string timers.
(() => {
  "use strict";
  if (globalThis.__zfRobot) return;
  const MAX = 8000; // bytes of JSON; the host refuses anything over 8 KB
  let ids = new Map();
  let shot = 0;
  // The host's gate, taken once: before EVERY act it is asked, and "ended" (or no handler: the run's end removed it)
  // means nothing more is done (Security's stop path).
  const gate = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.zfRobot;
  const mayAct = async () => {
    try {
      return gate ? (await gate.postMessage({ kind: "may-act" })) === "go" : false;
    } catch (_) {
      return false;
    }
  };

  const clip = (t, n) => {
    const s = String(t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const FORM = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

  function shown(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    if (el.closest("[hidden],[aria-hidden='true'],[inert]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const de = document.documentElement;
    const w = Math.max(de.scrollWidth, innerWidth), h = Math.max(de.scrollHeight, innerHeight);
    const x = r.left + scrollX, y = r.top + scrollY;
    if (x + r.width <= 0 || y + r.height <= 0 || x >= w || y >= h) return false; // off the page (where injected text hides)
    for (let a = el; a && a !== de; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.1) return false;
      if (s.clipPath && s.clipPath !== "none" && /inset\(\s*50%|circle\(\s*0/.test(s.clipPath)) return false;
      if (s.clip && /rect\(\s*0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\s*\)/.test(s.clip)) return false;
      if (parseFloat(s.fontSize) < 4 && a === el) return false;
    }
    return true;
  }

  /** The visible text of a node, never what is inside a form field (a field's value is never read). */
  function textOf(node, n) {
    if (!node) return "";
    const out = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => {
        for (let p = t.parentElement; p && p !== node.parentElement; p = p.parentElement) if (FORM.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        return t.parentElement && shown(t.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walk.nextNode()) {
      out.push(walk.currentNode.nodeValue);
      if (out.join(" ").length > n * 2) break;
    }
    return clip(out.join(" "), n);
  }

  function labelOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return clip(aria, 80);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((i) => textOf(document.getElementById(i), 80)).join(" ");
      if (t.trim()) return clip(t, 80);
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return textOf(l, 80);
    }
    const wrap = el.closest("label");
    if (wrap) return textOf(wrap, 80);
    return clip(el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("title") || "", 80);
  }

  const auto = (el) => String(el.getAttribute("autocomplete") || "").toLowerCase().trim();
  const isSecret = (el) => el.tagName === "INPUT" && (el.type === "password" || /\bone-time-code\b/.test(auto(el)) || /\bcc-/.test(auto(el)));
  const BUTTON_TYPES = new Set(["submit", "button", "reset", "image"]);

  function filled(el) {
    if (el.tagName === "SELECT") return el.selectedIndex > 0;
    if (el.type === "checkbox" || el.type === "radio") return !!el.checked;
    return String(el.value || "").length > 0; // only whether it is empty; the value itself never leaves here
  }

  function snapshot() {
    shot += 1;
    ids = new Map();
    let n = 0;
    const items = [];
    let size = 40;
    let more = false;
    const add = (item, el) => {
      if (el) {
        n += 1;
        item.id = "e" + n;
      }
      const bytes = JSON.stringify(item).length + 1;
      if (size + bytes > MAX) {
        more = true;
        return false;
      }
      size += bytes;
      if (el) ids.set(item.id, el);
      items.push(item);
      return true;
    };
    const notes = new Set();
    const all = document.querySelectorAll("input,textarea,select,button,[role=button],a[href],h1,h2,h3,[role=alert],[aria-live],[id*=error],[class*=error],[id*=help],[class*=help],[class*=hint]");
    for (const el of all) {
      if (more) break;
      if (!shown(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" && el.type === "hidden") continue;
      if ((tag === "input" && BUTTON_TYPES.has(el.type)) || tag === "button" || el.getAttribute("role") === "button") {
        if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
        add({ kind: "button", text: tag === "input" ? clip(el.value || el.type, 60) : textOf(el, 60) || clip(el.getAttribute("aria-label"), 60) }, el);
        continue;
      }
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (el.disabled || el.readOnly) continue;
        const item = { kind: "field", tag, type: tag === "input" ? el.type : tag, autocomplete: clip(auto(el), 40), label: labelOf(el), required: !!el.required, invalid: el.getAttribute("aria-invalid") === "true" || (el.willValidate && !el.validity.valid && filled(el)), filled: filled(el) };
        if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) item.checked = !!el.checked;
        if (tag === "select") item.options = [...el.options].slice(0, 20).map((o) => clip(o.text, 40));
        if (!add(item, el)) break;
        const described = el.getAttribute("aria-describedby");
        if (described) for (const d of described.split(/\s+/)) {
          const t = textOf(document.getElementById(d), 160);
          if (t) {
            const note = document.getElementById(d);
            notes.add(note);
            add({ kind: "text", text: t, near: item.id }, note);
          }
        }
        continue;
      }
      if (tag === "a") {
        let to = "";
        try {
          const u = new URL(el.href, location.href);
          if (u.protocol !== "https:" && u.protocol !== "http:") continue;
          to = u.hostname.toLowerCase() + (u.port && u.port !== "443" ? ":" + u.port : "");
        } catch (_) {
          continue;
        }
        add({ kind: "link", text: textOf(el, 60) || clip(el.getAttribute("aria-label"), 60), host: to }, el);
        continue;
      }
      if (tag === "h1" || tag === "h2" || tag === "h3") {
        const t = textOf(el, 100);
        if (t) add({ kind: "heading", text: t }, el);
        continue;
      }
      if (notes.has(el) || el.querySelector("input,textarea,select,button")) continue;
      const t = textOf(el, 160);
      if (t) {
        const err = el.getAttribute("role") === "alert" || /error|invalid/i.test(String(el.className) + " " + el.id);
        add(err ? { kind: "text", text: t, error: true } : { kind: "text", text: t }, el);
      }
    }
    // The page's visible words (D114, AgentZero's browser only uses them): innerText never holds what's typed in a box.
    const text = document.body ? String(document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000) : "";
    // The page's declared language ("" when it has none): the robot runs only on English pages.
    return { shot, lang: String(document.documentElement.getAttribute("lang") || "").slice(0, 20), items, more, text };
  }

  const setValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  /** One action the host has already checked against this snapshot. `value` is used once and dropped. */
  async function act(a) {
    // Only on the page the host checked (audit IOS-7): a document that isn't it types nothing, a password least of all.
    if (!a || typeof a.mustBeHost !== "string" || location.protocol !== "https:" || location.host !== a.mustBeHost) {
      if (a) a.value = null;
      return { error: "wrong-page" };
    }
    if (!(await mayAct())) {
      if (a) a.value = null;
      ids = new Map();
      return { error: "ended" };
    }
    const el = ids.get(String(a && a.target));
    if (!el) return { error: "unknown" };
    if (!el.isConnected || !shown(el)) return { error: "gone" };
    if (el.disabled) return { error: "disabled" };
    switch (a.kind) {
      case "fill":
        if (!(el.tagName === "INPUT" || el.tagName === "TEXTAREA") || (el.tagName === "INPUT" && (BUTTON_TYPES.has(el.type) || el.type === "checkbox" || el.type === "radio" || el.type === "file"))) return { error: "not-a-text-field" };
        if (a.mustBePassword && !(el.tagName === "INPUT" && el.type === "password")) return { error: "not-a-password-field" };
        if (a.mustNotBeSecret && isSecret(el)) return { error: "secret-field" };
        el.focus({ preventScroll: true });
        setValue(el, String(a.value));
        a.value = null;
        return { ok: true };
      case "select": {
        if (el.tagName !== "SELECT") return { error: "not-a-select" };
        const want = String(a.option || "").trim().toLowerCase();
        const i = [...el.options].findIndex((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want);
        if (i < 0) return { error: "no-such-option" };
        el.selectedIndex = i;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      case "check":
        if (!(el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio"))) return { error: "not-a-box" };
        if (!el.checked) el.click();
        return { ok: true };
      case "click":
        el.click();
        return { ok: true };
      case "scroll":
        el.scrollIntoView({ block: "center" });
        return { ok: true };
      default:
        return { error: "unknown-action" };
    }
  }

  /** The end of a run: the host removes this world's scripts and handlers; this drops what is in memory now. */
  function end() {
    ids = new Map();
    delete globalThis.__zfRobot;
    return true;
  }

  Object.defineProperty(globalThis, "__zfRobot", { value: Object.freeze({ snapshot, act, end }), configurable: true, enumerable: false, writable: false });
  if (gate) gate.postMessage({ kind: "ready" }).catch(() => {});
})();
