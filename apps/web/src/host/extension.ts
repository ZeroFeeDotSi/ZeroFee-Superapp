// D157: the app in the ZeroFee Chrome extension's side panel. Every passkey moment (making the key, the unlock, the fresh
// check) and every approval happens in the extension's OWN window, opened over the whole screen (chrome.windows.create,
// type "popup", the screen's size), never inside a web page and never in the narrow side panel. The page that asks (the
// panel) keeps the account; the window only shows the words, runs the one WebAuthn request it was handed (the person's
// iPhone, over hybrid) and hands the answer back. The panel checks it itself: verify.ts reads the challenge it made, the
// RP ID (pageRpId: the extension's own origin) and the signed flags, so a window can't approve what the panel didn't ask.
//
// Wire: chrome.runtime messages between the two extension pages (never seen by a web page or a content script). Buffers
// travel as base64url. The window accepts only the request shapes passkey.ts and verify.ts make (wireRequestAllowed).
import type { Bridge } from "@zerofee/core/bridge";
import type { PlainWords } from "@zerofee/core/signer";
import { markWindowYes } from "./window-yes.ts";

export const APPROVE_PATH = "/approve.html";
export type AskKind = "get" | "create";
/** What the panel hands the window: the request, and the sheet's words when it is an approval. */
export interface Ask { kind: AskKind; publicKey: Wire; words?: PlainWords }
/** What the window hands back: the credential, the WebAuthn error by name, or a no on the sheet. */
export type Answer = { credential: WireCredential } | { error: { name: string; message: string } } | { declined: true };

/* ---------- the wire: JSON-safe, buffers as base64url ---------- */

export type Wire = null | boolean | number | string | { $b: string } | Wire[] | { [k: string]: Wire };
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const bytesOf = (b: ArrayBuffer | ArrayBufferView) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
const isBuf = (v: unknown): v is ArrayBuffer | ArrayBufferView => v instanceof ArrayBuffer || ArrayBuffer.isView(v);
const isBytes = (v: unknown): v is { $b: string } => !!v && typeof v === "object" && Object.keys(v).length === 1 && typeof (v as { $b?: unknown }).$b === "string" && /^[A-Za-z0-9_-]*$/.test((v as { $b: string }).$b);

export function toWire(v: unknown): Wire {
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (isBuf(v)) return { $b: b64u(bytesOf(v)) };
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toWire(x)]));
  throw new Error("not sendable");
}
export function fromWire(v: Wire): unknown {
  if (isBytes(v)) return unb64u(v.$b);
  if (Array.isArray(v)) return v.map(fromWire);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromWire(x)]));
  return v;
}

/* ---------- what the window will run ---------- */

const keysWithin = (o: unknown, allowed: readonly string[]) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).every((k) => allowed.includes(k));
const prfOnly = (e: unknown) => e === undefined || (keysWithin(e, ["prf"]) && keysWithin((e as { prf: unknown }).prf, ["eval"]) && keysWithin((e as { prf: { eval: unknown } }).prf.eval, ["first"]) && isBytes((e as { prf: { eval: { first: unknown } } }).prf.eval.first));
const hybridOnly = (h: unknown) => h === undefined || (Array.isArray(h) && h.every((x) => x === "hybrid"));
const credList = (l: unknown) => Array.isArray(l) && l.length >= 1 && l.length <= 4 && l.every((c) => keysWithin(c, ["type", "id", "transports"]) && (c as { type: unknown }).type === "public-key" && isBytes((c as { id: unknown }).id));

/**
 * Only the requests the app makes (passkey.ts createPasskey / passkeyPrf, verify.ts passkeyUserVerified): user verification
 * required, a fresh 32-byte challenge, the extension's own RP ID (no rp.id / rpId given: Chrome's default, the extension
 * itself), no mediation, no attestation, the PRF extension only. Anything else the window refuses to run.
 */
export function wireRequestAllowed(kind: AskKind, pk: Wire): boolean {
  if (!pk || typeof pk !== "object" || Array.isArray(pk) || isBytes(pk)) return false;
  const o = pk as Record<string, Wire>;
  const challenge = o.challenge;
  if (!isBytes(challenge) || unb64u(challenge.$b).length !== 32) return false;
  if (!hybridOnly(o.hints) || !prfOnly(o.extensions)) return false;
  if (o.timeout !== undefined && (typeof o.timeout !== "number" || o.timeout <= 0 || o.timeout > 300_000)) return false;
  if (kind === "get") {
    return keysWithin(o, ["challenge", "allowCredentials", "userVerification", "timeout", "hints", "extensions"]) && o.userVerification === "required" && credList(o.allowCredentials);
  }
  const sel = o.authenticatorSelection as Record<string, Wire> | undefined;
  return keysWithin(o, ["rp", "user", "challenge", "pubKeyCredParams", "authenticatorSelection", "timeout", "hints", "extensions"])
    && keysWithin(o.rp, ["name"]) && keysWithin(o.user, ["id", "name", "displayName"]) && isBytes((o.user as Record<string, Wire>).id)
    && Array.isArray(o.pubKeyCredParams) && o.pubKeyCredParams.length > 0
    && !!sel && sel.userVerification === "required" && sel.residentKey === "required";
}

/** The ask the window was handed, checked: anything malformed or outside wireRequestAllowed is null. */
export function readAsk(m: unknown): Ask | null {
  const x = m as Partial<Ask> | null;
  if (!x || typeof x !== "object" || (x.kind !== "get" && x.kind !== "create") || !wireRequestAllowed(x.kind, x.publicKey as Wire)) return null;
  if (x.words !== undefined && (x.kind !== "get" || typeof x.words?.title !== "string" || !Array.isArray(x.words.lines))) return null;
  return { kind: x.kind, publicKey: x.publicKey as Wire, ...(x.words ? { words: x.words } : {}) };
}

/* ---------- credentials across the wire ---------- */

export interface WireCredential {
  id: string; rawId: string; type: string; authenticatorAttachment: string | null;
  response: { clientDataJSON: string; authenticatorData?: string; signature?: string; userHandle?: string | null; attestationObject?: string; transports?: string[] };
  prf?: { enabled?: boolean; first?: string };
}

type AnyResponse = { clientDataJSON: ArrayBuffer; authenticatorData?: ArrayBuffer; signature?: ArrayBuffer; userHandle?: ArrayBuffer | null; attestationObject?: ArrayBuffer; getAuthenticatorData?: () => ArrayBuffer; getTransports?: () => string[] };
type AnyCredential = { id: string; rawId: ArrayBuffer; type: string; authenticatorAttachment?: string | null; response: AnyResponse; getClientExtensionResults: () => { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } } } };

/** The window's side: the PublicKeyCredential it got, as plain JSON. */
export function credentialToWire(c: AnyCredential): WireCredential {
  const r = c.response, prf = c.getClientExtensionResults()?.prf;
  const auth = r.authenticatorData ?? r.getAuthenticatorData?.();
  return {
    id: c.id, rawId: b64u(bytesOf(c.rawId)), type: c.type, authenticatorAttachment: c.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: b64u(bytesOf(r.clientDataJSON)),
      ...(auth ? { authenticatorData: b64u(bytesOf(auth)) } : {}),
      ...(r.signature ? { signature: b64u(bytesOf(r.signature)) } : {}),
      ...(r.userHandle !== undefined ? { userHandle: r.userHandle ? b64u(bytesOf(r.userHandle)) : null } : {}),
      ...(r.attestationObject ? { attestationObject: b64u(bytesOf(r.attestationObject)) } : {}),
      ...(r.getTransports ? { transports: r.getTransports() } : {}),
    },
    ...(prf ? { prf: { ...(prf.enabled !== undefined ? { enabled: prf.enabled } : {}), ...(prf.results?.first ? { first: b64u(bytesOf(prf.results.first)) } : {}) } } : {}),
  };
}

const buf = (s: string) => unb64u(s).buffer as ArrayBuffer;
/** The panel's side: a credential shaped like the browser's own, for passkey.ts and verify.ts to read unchanged. */
export function credentialFromWire(w: WireCredential): Credential {
  const auth = w.response.authenticatorData ? buf(w.response.authenticatorData) : undefined;
  const response = {
    clientDataJSON: buf(w.response.clientDataJSON),
    ...(auth ? { authenticatorData: auth } : {}),
    ...(w.response.signature ? { signature: buf(w.response.signature) } : {}),
    ...(w.response.userHandle !== undefined ? { userHandle: w.response.userHandle ? buf(w.response.userHandle) : null } : {}),
    ...(w.response.attestationObject ? { attestationObject: buf(w.response.attestationObject) } : {}),
    getAuthenticatorData: () => auth,
    getTransports: () => w.response.transports ?? [],
  };
  const prf = w.prf ? { prf: { ...(w.prf.enabled !== undefined ? { enabled: w.prf.enabled } : {}), ...(w.prf.first ? { results: { first: buf(w.prf.first) } } : {}) } } : {};
  return { id: w.id, rawId: buf(w.rawId), type: w.type, authenticatorAttachment: w.authenticatorAttachment, response, getClientExtensionResults: () => prf } as unknown as Credential;
}

/** A window's answer as what navigator.credentials would have done: a credential, null (a no), or its DOMException. */
export function settle(a: Answer): Credential | null {
  if ("credential" in a) return credentialFromWire(a.credential);
  if ("declined" in a) return null;
  throw new DOMException(a.error.message, a.error.name);
}

/* ---------- the panel's side: open the window, wait for its answer ---------- */

interface ChromeLike {
  runtime: { id: string; getURL(p: string): string; onMessage: { addListener(cb: (m: unknown, s: { id?: string; url?: string; tab?: { windowId?: number } }, reply: (r: unknown) => void) => boolean | void): void } };
  windows: { create(o: Record<string, unknown>): Promise<{ id?: number }>; remove(id: number): Promise<void>; onRemoved: { addListener(cb: (id: number) => void): void } };
}
const chromeApi = () => (globalThis as { chrome?: ChromeLike }).chrome;

type Pending = { ask: Ask; windowId?: number; created: Promise<number | undefined>; done: (a: Answer) => void };
const pending = new Map<string, Pending>();
let listening = false;

/** Is this message from our own approval window for ask `id` (its page, its window)? */
export function fromOurWindow(s: { id?: string; url?: string; tab?: { windowId?: number } }, runtimeId: string, origin: string, id: string, windowId: number | undefined): boolean {
  if (s.id !== runtimeId || !s.url) return false;
  let u: URL;
  try { u = new URL(s.url); } catch { return false; }
  // protocol + host, never URL.origin (an engine may give "null" for a chrome-extension: URL)
  return `${u.protocol}//${u.host}` === origin && u.pathname === APPROVE_PATH && u.hash === `#${id}` && windowId !== undefined && s.tab?.windowId === windowId;
}

function listen(c: ChromeLike) {
  if (listening) return;
  listening = true;
  c.runtime.onMessage.addListener((m, sender, reply) => {
    const x = m as { t?: unknown; id?: unknown; answer?: unknown } | null;
    if (!x || typeof x.id !== "string") return false;
    const p = pending.get(x.id);
    if (!p) return false;
    // the window can speak before windows.create has said its id (review L3): judged once the id is known
    void p.created.then((windowId) => {
      if (!fromOurWindow(sender, c.runtime.id, location.origin, x.id as string, windowId)) { if (x.t === "zf.approve.ready") reply(null); return; }
      if (x.t === "zf.approve.ready") reply(p.ask);
      else if (x.t === "zf.approve.answer") { p.done(readAnswer(x.answer)); reply(null); }
    });
    return true;
  });
  c.windows.onRemoved.addListener((windowId) => {
    for (const p of pending.values()) if (p.windowId === windowId) p.done({ error: { name: "NotAllowedError", message: "The window was closed." } });
  });
}

/** An answer from the window, checked; anything else is a cancel. */
export function readAnswer(a: unknown): Answer {
  const x = a as Record<string, unknown> | null;
  if (x && x.declined === true) return { declined: true };
  const c = x?.credential as WireCredential | undefined;
  if (c && typeof c.rawId === "string" && typeof c.response?.clientDataJSON === "string") return { credential: c };
  const e = x?.error as { name?: unknown; message?: unknown } | undefined;
  return { error: { name: typeof e?.name === "string" ? e.name : "NotAllowedError", message: typeof e?.message === "string" ? e.message.slice(0, 200) : "Stopped." } };
}

/** Opens the extension's own window over the whole screen with this ask, and waits for its answer (or its closing). */
export async function askWindow(ask: Ask): Promise<Answer> {
  // the page asks only what the window will run (the same rule): anything else is refused here, no window opens
  if (!readAsk(ask)) return { error: { name: "NotAllowedError", message: "Not allowed here." } };
  const c = chromeApi();
  if (!c?.windows) return { error: { name: "NotAllowedError", message: "No ZeroFee window here." } };
  listen(c);
  const id = b64u(crypto.getRandomValues(new Uint8Array(16)));
  return new Promise<Answer>((resolve) => {
    const s = globalThis.screen as (Screen & { availLeft?: number; availTop?: number }) | undefined;
    let made!: (id: number | undefined) => void;
    const p: Pending = { ask, created: new Promise((r) => (made = r)), done: (a) => { if (!pending.delete(id)) return; resolve(a); if (p.windowId !== undefined) void c.windows.remove(p.windowId).catch(() => undefined); } };
    pending.set(id, p);
    void c.windows.create({
      url: c.runtime.getURL(`${APPROVE_PATH.slice(1)}#${id}`), type: "popup", focused: true,
      ...(s ? { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight } : {}),
    }).then((w) => { p.windowId = w.id; made(w.id); }, () => { made(undefined); p.done({ error: { name: "NotAllowedError", message: "The window didn't open." } }); });
  });
}

/** navigator.credentials for the app's page: every create and get runs in the window (no words: a passkey moment alone). */
export function windowCredentials(): Pick<CredentialsContainer, "get" | "create"> {
  const run = (kind: AskKind, o?: CredentialCreationOptions | CredentialRequestOptions) => {
    if (!o?.publicKey || (o as { mediation?: unknown }).mediation || (o as { signal?: unknown }).signal) return Promise.reject(new DOMException("Not allowed here.", "NotAllowedError"));
    return askWindow({ kind, publicKey: toWire(o.publicKey) }).then(settle);
  };
  return { get: (o) => run("get", o), create: (o) => run("create", o) };
}

/**
 * The core's sheet in the extension (DemoCore `sheet`): the words in the window, and Approve there is the person's iPhone
 * (D143's fresh check, in the same tap). Yes only when verify.ts accepts the iPhone's answer to the panel's own challenge.
 * No passkey on this browser (it can't be on mainnet: iPhone only), a no, a cancel or a bad answer: false, nothing signed.
 */
export async function windowSheet(words: PlainWords, readRecord: () => Promise<{ method: string; credentialId?: Uint8Array } | null>, ask: (a: Ask) => Promise<Answer> = askWindow): Promise<boolean> {
  const record = await readRecord().catch(() => null);
  if (record?.method !== "passkey" || !record.credentialId) return false;
  const { passkeyUserVerified } = await import("../unlock/verify.ts");
  const creds = { get: (o?: CredentialRequestOptions) => ask({ kind: "get", publicKey: toWire(o!.publicKey), words }).then(settle) };
  // the iPhone's yes is bound to these words (review M4): the challenge is a hash of them and a fresh nonce
  return passkeyUserVerified(record.credentialId, creds, undefined, { bind: new TextEncoder().encode(JSON.stringify(words)) });
}

/**
 * A shell sheet in the extension (an `approval.needed` that didn't come from the app's own core: being a guardian, and
 * any other the shell hears): the same window, the same iPhone check. Its yes is marked for the shell's gate
 * (window-yes.ts) just before it is answered; a no, a cancel or a throw is answered no. Nothing shows in the panel.
 */
export async function answerInWindow(p: { id: string; words: PlainWords }, bridge: Pick<Bridge, "call">, sheet: (words: PlainWords) => Promise<boolean>): Promise<boolean> {
  const yes = await sheet(p.words).catch(() => false);
  if (yes) markWindowYes(p.id);
  await bridge.call("approval.answer", { id: p.id, approve: yes });
  return yes;
}

/** The app's page in the extension: its passkey requests go to the window from here on (installed once, before the app). */
export function installWindowCredentials(nav: Navigator = navigator): void {
  Object.defineProperty(nav, "credentials", { value: windowCredentials(), configurable: false, writable: false });
}
