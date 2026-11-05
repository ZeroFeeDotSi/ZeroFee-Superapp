// What the core reads from the network: at most 2 MB a response (audit NF-22). A node, partner or relay that answers more
// is refused as it streams, never buffered whole: RPC answers, quotes and token lists are a few kilobytes to ~50 KB.
// On the phone the native fetch caps the same way (CoreContext.swift) and its responses have no stream; the text is
// checked again here.
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class TooLarge extends Error {
  constructor() {
    super(`the answer is over ${MAX_RESPONSE_BYTES} bytes`);
  }
}

/** A response's text, refused past `max` bytes: by its stated length, or while it streams. */
export async function readText(res: Response, max = MAX_RESPONSE_BYTES): Promise<string> {
  const stated = Number(res.headers?.get?.("content-length") ?? NaN);
  if (Number.isFinite(stated) && stated > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (text.length > max) throw new TooLarge();
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) all.set(c, (at += c.byteLength) - c.byteLength);
  return new TextDecoder().decode(all);
}

/** A response's JSON, refused past `max` bytes. */
export async function readJson(res: Response, max = MAX_RESPONSE_BYTES): Promise<any> {
  return JSON.parse(await readText(res, max));
}

/** One line of the network's own story, for the developer: which node, what was asked, and the real exception. */
export interface NetLogEntry {
  atIso?: string;
  node: string;
  method: string;
  what: string;
  detail?: string;
}

const NET_LOG_MAX = 100;
/**
 * The dev log (grade 1 Nov, D2: "can't reach the network" hid a 429 from our own burst). Kept in memory on
 * `globalThis.__zfNetLog` (the last 100) and written to console.debug, which a browser shows only at "Verbose".
 * Never on screen: the person sees the plain Problem.
 */
export function netLog(entry: NetLogEntry): void {
  const g = globalThis as { __zfNetLog?: NetLogEntry[] };
  const log = (g.__zfNetLog ??= []);
  log.push({ atIso: new Date().toISOString(), ...entry });
  if (log.length > NET_LOG_MAX) log.splice(0, log.length - NET_LOG_MAX);
  // A page's console only (a browser shows debug at "Verbose"); not a test run's or a tool's output.
  if (typeof document === "undefined") return;
  try {
    console.debug("[zerofee net]", entry.node, entry.method, entry.what, entry.detail ?? "");
  } catch {
    // no console (a bare JS context)
  }
}
