// One read of 1Click's token list for the whole page (speed, 2 Nov). Wallet's coin list, Spending's prices and the core's
// own dollar limits each asked for the same public list on their own: on a cold open three of them, one after another,
// the slowest 650 ms on Home's path. Here a plain GET of exactly that address is asked once and handed to every caller
// that asks within SHARE_MS of the answer (or while it is on its way), each as its own copy. Nothing else is touched:
// any other address, method or body goes to the browser's fetch as it is. A failed read is never kept.

export const SHARED_GETS = ["https://1click.chaindefuser.com/v0/tokens"];
export const SHARE_MS = 10_000;

type Kept = { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer };

export function sharingFetch(plain: typeof fetch, urls: readonly string[] = SHARED_GETS, shareMs = SHARE_MS, now: () => number = Date.now): typeof fetch {
  const kept = new Map<string, { at: number | null; read: Promise<Kept> }>();
  const copy = (k: Kept) => new Response(k.body.slice(0), { status: k.status, statusText: k.statusText, headers: k.headers });
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    if (method !== "GET" || init?.body != null || !urls.includes(url)) return plain(input, init);
    let entry = kept.get(url);
    if (!entry || (entry.at !== null && now() - entry.at > shareMs)) {
      const read = plain(url, { signal: AbortSignal.timeout(15_000) }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return { status: r.status, statusText: r.statusText, headers: [...r.headers.entries()], body: await r.arrayBuffer() };
      });
      const made: { at: number | null; read: Promise<Kept> } = { at: null, read };
      entry = made;
      kept.set(url, made);
      read.then(() => (made.at = now()), () => kept.get(url) === made && kept.delete(url));
    }
    const signal = init?.signal;
    const answer = entry.read.then(copy);
    if (!signal) return answer;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      answer.then(resolve, reject);
    });
  };
}
