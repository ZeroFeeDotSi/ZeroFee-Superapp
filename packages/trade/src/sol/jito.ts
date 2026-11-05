// Send speed, A2a (Security, 28 Oct: yes, a fixed host and the same bytes, no tip): a signed Solana trade also goes to Jito's
// public block engine, beside the nodes. Only another door for the very bytes the core signed; it never decides whether the
// trade was sent (the nodes do), never throws, and gives up after a moment. Without a tip Jito may not forward it at all:
// the test dust run says whether it adds anything, and if not this is dropped, not kept as a dead door. A tip (A2b)
// would change what's signed: not now.
export const JITO_URL = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";
export const JITO_TIMEOUT_MS = 1_500;

export function jitoSender(fx: typeof fetch = (...a) => fetch(...a)): (signedTx: string) => Promise<void> {
  return async (signedTx) => {
    const ac = typeof AbortController === "undefined" ? undefined : new AbortController();
    const t = ac ? setTimeout(() => ac.abort(), JITO_TIMEOUT_MS) : undefined;
    try {
      await fx(JITO_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [signedTx, { encoding: "base64" }] }),
        ...(ac ? { signal: ac.signal } : {}),
      });
    } catch { /* another door that didn't open: the nodes' send stands */ } finally { clearTimeout(t); }
  };
}
