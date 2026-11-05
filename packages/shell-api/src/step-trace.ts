// Named steps for the test flight recorder (apps/web/src/shell/flight.ts, the test builds only), from code that has no
// bridge call to show them: a site's sign-in through ZeroFee's wallet (packages/browser engine, ledger row 4: "can't
// sign in to pump.fun / GMGN"), so the test next try on the phone shows the step that failed.
// A step carries ONLY fixed words: its name, the site's host, how long it took, and a fixed reason word. Never an
// address, a signature, a message, a key or any text a page wrote. With no recorder (every other build) the steps are
// kept nowhere: the first 50 wait for a recorder that may load late, then are dropped.

export type StepName =
  | "signin.inject" // the page's first ask of the wallet since it loaded: provider.js is in the page and answers
  | "signin.connect" // the site asked for the address (asked, or silent: its own reconnect)
  | "signin.sign.request" // the site asked to sign a sign-in message
  | "signin.sign.reply" // the core's answer to it
  | "signin.session.saved" // the site is kept as connected on this device
  | "signin.session.restored"; // a silent reconnect after a reload or an app close: answered from the kept connection, or not

export interface StepNote {
  s: StepName;
  /** The site's host (pump.fun, gmgn.ai): a site's name, never a person's. */
  host: string;
  ms?: number;
  /** "ok", or a fixed reason word (never free text). */
  r: string;
}

let sink: ((n: StepNote) => void) | null = null;
const early: StepNote[] = [];
const HOST = /^[a-z0-9.-]{1,80}(:[0-9]{1,5})?$/;
const REASON = /^[a-z0-9.-]{1,40}$/;

/** flight.ts: where each step goes from now on (the ones already noted first). */
export function setStepSink(f: ((n: StepNote) => void) | null): void {
  sink = f;
  if (f) for (const n of early.splice(0)) f(n);
}

/** One step. A host or reason that isn't the fixed shape is replaced, so nothing a page wrote can leave the phone. */
export function noteStep(s: StepName, host: string, r: string, ms?: number): void {
  try {
    const n: StepNote = { s, host: HOST.test(host) ? host : "?", r: REASON.test(r) ? r : "other", ...(ms !== undefined && Number.isFinite(ms) ? { ms: Math.max(0, Math.round(ms)) } : {}) };
    if (sink) sink(n);
    else if (early.length < 50) early.push(n);
  } catch {
    // never into the app
  }
}

/**
 * The fixed reason word for a refused sign-in, read from the core's refusal (subwallets.ts signMessage and
 * sign-message.ts's allow-list), so the trace names WHICH rule said no and nothing of the message itself.
 */
export function signInWhy(what: string): string {
  const rules: [RegExp, string][] = [
    [/too soon/i, "room"],
    [/first line isn't the standard/i, "first-line"],
    [/laid out the standard way/i, "layout"],
    [/asks for more than a sign-in/i, "resources-or-request-id"],
    [/lines a sign-in doesn't/i, "extra-line"],
    [/repeat or are out of order/i, "field-order"],
    [/words are (too long|about more)/i, "statement"],
    [/one-time number/i, "nonce"],
    [/isn't fresh/i, "stale"],
    [/lasts too long/i, "expiry"],
    [/isn't valid yet/i, "not-before"],
    [/address isn't the site's own/i, "uri"],
    [/isn't version 1/i, "version"],
    [/letters a plain sign-in doesn't/i, "letters"],
    [/too long for a sign-in/i, "length"],
    [/isn't this site's own sign-in|no sign-in of its own|aren't a sign-in/i, "not-a-sign-in"],
    [/only signs messages in plain words|can't read what/i, "binary"],
    [/Only a site's own window/i, "not-browser"],
    [/another network/i, "network"],
    [/Connect ZeroFee to this site first/i, "not-connected"],
    [/isn't the (address|one) ZeroFee gave/i, "other-address"],
    [/still asking/i, "busy"],
    [/said no/i, "declined"],
  ];
  for (const [re, word] of rules) if (re.test(what)) return word;
  return "other";
}
