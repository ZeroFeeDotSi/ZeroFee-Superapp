// What the robot may do, decided by our code (Security's section D), never by the model or the page. The page is a
// stranger's: its words can say anything, so nothing here takes an instruction from it. The host checks every action
// again natively; these checks mean a bad step never even reaches it.
import { redactPage } from "./redact.ts";
import type { HostAction, PageElement, Recipe, RobotAction, Slot, Snapshot } from "./types.ts";

/** Exactly one of the recipe's hosts (D.A1: no wildcards). */
export const onHost = (host: string, hosts: readonly string[]): boolean => hosts.includes(host.toLowerCase());

/** The slots this recipe may fill on this host: its profile slots, and its login's on the login's own host only (D.D6). */
export function allowedSlots(recipe: Recipe, host?: string): Slot[] {
  const login: Slot[] = recipe.login && (host === undefined || host === recipe.login.host) ? ["login.username", "login.password", "login.new"] : [];
  return [...recipe.profile.map((f) => `profile.${f}` as Slot), ...login];
}

/** The model's goal and guide, from the recipe in its own words. */
export function goalOf(recipe: Recipe): { goal: string; guide: string[] } {
  return {
    goal: `Sign the person up with ${recipe.name}${recipe.gives ? `: ${recipe.gives}` : "."}`,
    guide: (recipe.steps ?? []).map((s, i) => `${i + 1}. ${s.at ? `${s.at}: ` : ""}${s.act}${s.fill?.length ? ` ${s.fill.map((f) => `{{${f}}}`).join(" ")}` : ""}${s.turn ? ` (${s.turn})` : ""}. ${s.say}`),
  };
}

const words = (e: PageElement) => [e.label, e.text, e.autocomplete].filter(Boolean).join(" ");
const HUMAN = /\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|verify (that )?you('| a)re (a )?human|are you human)\b/i;
const IDENTITY = /\b(selfie|liveness|camera|passport|id card|identity (document|verification)|verify your identity|scan your (id|document)|upload)\b/i;
const CODE = /\b(code|otp|one[- ]?time|verification code|2fa|two[- ]factor|authenticator|pin)\b/i;
const CARD = /\b(card number|cvc|cvv|security code|expiry|expiration|iban|bank (login|password)|online banking)\b/i;
const TERMS = /\b(terms|agree|consent|privacy|accept|conditions)\b/i;
const DESTINATION = /\b(address|wallet|account number|iban|routing|swift|bic|recipient|beneficiary|payout)\b/i;
const COMMIT = /\b(pay|send|buy|purchase|order|confirm (the )?(order|payment|purchase)|place order|delete|close (my )?account|withdraw|transfer)\b/i;
/** A compliance question: the answer is the person's own legal statement, never the model's (Security's D5, amended). */
const DECLARATION = /\b(politically exposed|pep|(source|origin) of (funds|wealth)|income|salary|occupation|employment|employer|profession|purpose of (the |your )?account|tax (residence|residency|id|identification|number)|tin|u\.?s\.? person|fatca|sanctions?|sanctioned|beneficial owner|nationality|citizenship|country of residence)\b/i;

const isCard = (e: PageElement) => e.kind === "field" && ((e.autocomplete ?? "").startsWith("cc-") || CARD.test(e.label ?? ""));
const isCode = (e: PageElement) => e.kind === "field" && (e.autocomplete === "one-time-code" || CODE.test(e.label ?? ""));
const isSecretField = (e: PageElement) => e.type === "password" || isCode(e) || isCard(e);

/**
 * The person's turn on this whole page, before the model is asked, or null (D.D5): bot checks, ID and selfies,
 * uploads and the camera, codes, card and bank details. Terms and commit buttons are caught at the step (`decide`),
 * so the robot can still fill the rest of a page that has them.
 */
export function personsTurn(page: Snapshot, recipe: Recipe): string | null {
  const els = page.elements;
  // The robot's own words (terms, commits, declarations) are English: on any other page it can't tell buttons apart.
  if (!/^en\b/i.test(page.lang ?? "")) return `This page isn't in English: ZeroFee can't tell its buttons apart. Fill it in yourself, then tap Continue.`;
  if (els.some((e) => HUMAN.test(words(e)))) return `${recipe.name} wants to check you're a person. Do that yourself, then tap Continue.`;
  if (els.some((e) => e.type === "file" || (e.kind !== "link" && IDENTITY.test(words(e))))) return `${recipe.name} needs your ID, a selfie or a document. Do that step yourself, then tap Continue.`;
  if (els.some((e) => isCode(e) && !e.filled)) return `Type the code ${recipe.name} sent you, then tap Continue.`;
  if (els.some((e) => isCard(e) && !e.filled)) return `Card and bank details are yours to type. Do that, then tap Continue.`;
  const extra = (recipe.pauses ?? []).find((w) => els.some((e) => words(e).toLowerCase().includes(w.toLowerCase())));
  if (extra) return `Your turn on this page of ${recipe.name}. Tap Continue when you're done.`;
  return null;
}

/** Has the sign-up reached the recipe's done-state, when it names one? Our check, not the model's word. */
export function isDone(page: Snapshot, recipe: Recipe): boolean {
  const want = recipe.done?.textIncludes.toLowerCase();
  return !!want && page.elements.some((e) => (e.kind === "heading" || e.kind === "text") && (e.text ?? "").toLowerCase().includes(want));
}

/** IBANs, card-like digit runs and emails, wherever the page shows them: the person's own data, none of it needed by the model. */
const HIDE = [/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, /\b(?:\d[ -]?){12,19}\b/g, /[\w.+-]+@[\w-]+(\.[\w-]+)+/g];
/** E6: these as before, then every other kind redactPage knows (wallets, keys, tokens, phones, addresses). */
const hidden = (s: string) => redactPage(HIDE.reduce((t, re) => t.replace(re, "[hidden]"), s));

/** What the model is shown of a page: short strings, at most 8 KB (D.D2), never a value, and the person's data hidden. */
export function forModel(page: Snapshot, limit = 8192): Snapshot {
  const cut = (s: string | undefined, n = 100) => (s === undefined ? undefined : hidden(s.replace(/\s+/g, " ").trim()).slice(0, n));
  const out: Snapshot = { host: page.host, lang: page.lang, elements: [], ...(page.more ? { more: true } : {}) };
  let size = JSON.stringify(out).length;
  for (const e of page.elements) {
    const clean: PageElement = { id: e.id, kind: e.kind, tag: e.tag, type: e.type, autocomplete: e.autocomplete, label: cut(e.label), text: cut(e.text, 160), host: e.host, options: e.options?.slice(0, 20).map((o) => cut(o, 40)!), required: e.required, invalid: e.invalid, filled: e.filled, checked: e.checked, error: e.error, near: e.near };
    const add = JSON.stringify(clean).length + 1;
    if (size + add > limit) break;
    out.elements.push(clean);
    size += add;
  }
  return out;
}

export type Decision = { kind: "act"; action: HostAction; note: string } | { kind: "yourTurn"; reason: string } | { kind: "refuse"; why: string };

const SLOT_WORDS: Record<Slot, string> = { "profile.name": "the form's name field", "profile.email": "your email", "profile.phone": "your phone number", "profile.address": "your address", "profile.dateOfBirth": "your date of birth", "login.username": "your username", "login.password": "your saved password", "login.new": "a new password, kept in your Passwords" };
const SLOT = /^\{\{(profile\.(name|email|phone|address|dateOfBirth)|login\.(username|password|new))\}\}$/;

/**
 * Check one step the model asked for against the latest page and the recipe (D.D4–D6), and turn it into what the host
 * does, the person's turn, or a refusal the model hears about. A slot is a placeholder: the host fills its value
 * natively, so no secret and none of the person's details ever pass through here.
 */
export function decide(a: RobotAction, page: Snapshot, recipe: Recipe): Decision {
  if (a.kind === "yourTurn") return { kind: "yourTurn", reason: a.reason };
  if (a.kind === "wait") return a.ms > 0 && a.ms <= 5000 ? { kind: "act", action: { kind: "wait", ms: a.ms }, note: `waited ${a.ms} ms` } : { kind: "refuse", why: "a wait is 1 ms to 5 s" };
  if (a.kind === "done") return { kind: "refuse", why: "done is ZeroFee's to decide" };
  const el = page.elements.find((e) => e.id === a.id);
  if (!el) return { kind: "refuse", why: `no element ${a.id} on this page` };
  const name = (el.label || el.text || el.id).slice(0, 60);
  const said = words(el);
  // A compliance answer (funds, income, tax, PEP, nationality…) is the person's legal statement.
  if ((a.kind === "select" || a.kind === "check" || a.kind === "fill") && DECLARATION.test(said)) return { kind: "yourTurn", reason: `"${name}" is a question only you can answer. Answer it yourself, then tap Continue.` };

  switch (a.kind) {
    case "scroll":
      return { kind: "act", action: { kind: "scroll", id: el.id }, note: `scrolled to "${name}"` };
    case "click": {
      if (el.kind !== "button" && el.kind !== "link") return { kind: "refuse", why: `can't click a ${el.kind}` };
      if (el.kind === "link" && el.host && !onHost(el.host, recipe.hosts)) return { kind: "refuse", why: `that link leaves ${recipe.name}` };
      // Its words and its label (an icon button has only a label).
      const commit = recipe.commit.some((c) => said.toLowerCase().includes(c.toLowerCase())) || COMMIT.test(said);
      if (commit) return { kind: "yourTurn", reason: `"${name}" is yours to tap: ZeroFee never pays, sends, buys or deletes for you.` };
      if (TERMS.test(said) && /\b(agree|accept)\b/i.test(said)) return { kind: "yourTurn", reason: `Read ${recipe.name}'s terms and tap "${name}" yourself if you agree.` };
      return { kind: "act", action: { kind: "click", id: el.id }, note: `clicked "${name}"` };
    }
    case "check":
      if (el.kind !== "field" || (el.type !== "checkbox" && el.type !== "radio")) return { kind: "refuse", why: "only a checkbox or a radio can be checked" };
      if (TERMS.test(said)) return { kind: "yourTurn", reason: `Read ${recipe.name}'s terms and tick "${name}" yourself if you agree.` };
      return { kind: "act", action: { kind: "check", id: el.id }, note: `ticked "${name}"` };
    case "select":
      if (el.kind !== "field" || el.tag !== "select") return { kind: "refuse", why: "only a list can be chosen from" };
      if (!el.options?.includes(a.option)) return { kind: "refuse", why: `"${a.option}" isn't one of its options` };
      return { kind: "act", action: { kind: "select", id: el.id, option: a.option }, note: `chose "${a.option}" in "${name}"` };
    case "fill": {
      if (el.kind !== "field" || el.tag === "select" || ["checkbox", "radio", "file"].includes(el.type ?? "")) return { kind: "refuse", why: `can't type into "${name}"` };
      if (el.filled) return { kind: "refuse", why: `"${name}" already has something in it` };
      const slot = SLOT.exec(a.value)?.[1] as Slot | undefined;
      const password = el.type === "password";
      if (slot) {
        if (!allowedSlots(recipe, page.host).includes(slot)) return { kind: "refuse", why: slot.startsWith("login.") && recipe.login ? `the login is only for ${recipe.login.host}` : `${recipe.name}'s recipe doesn't use {{${slot}}}` };
        const passwordSlot = slot === "login.password" || slot === "login.new";
        if (passwordSlot !== password) return { kind: "refuse", why: password ? "only a password slot goes in a password box" : "a password slot only goes in a password box" };
        return { kind: "act", action: { kind: "fill", id: el.id, value: a.value }, note: `filled "${name}" with ${SLOT_WORDS[slot]}` };
      }
      // No literals (Security's D4, amended): a planted email, phone or security answer typed by the model would hand
      // the person's partner account to whoever planted it. Anything without a slot is the person's to type.
      if (isSecretField(el)) return { kind: "yourTurn", reason: `"${name}" is yours to type: ZeroFee never types passwords, codes or card details.` };
      if (DESTINATION.test(el.label ?? "") || (el.autocomplete ?? "").includes("address")) return { kind: "yourTurn", reason: `"${name}" is yours to type: ZeroFee never types where money goes.` };
      return { kind: "yourTurn", reason: `"${name}" needs something ZeroFee doesn't keep for you. Type it yourself, then tap Continue.` };
    }
  }
}
