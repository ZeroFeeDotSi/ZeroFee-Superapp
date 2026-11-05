// Send speed, A1 (Security, 28 Oct; route 5689827 in apps/quotes): a signed Solana trade also goes through ZeroFee's relay to
// the paid node V1 used, whose key stays on the relay. The relay takes the bytes only ({tx}) and answers the signature or a
// short error. Another door beside the public nodes, never instead of them: the normal send always runs, and the relay
// counts as having taken the trade only when it answers this transaction's own signature. No relay in the build, a 503
// (not set up), a limit or any error: the public nodes' answer stands.
import { relayBase } from "../market/relay.ts";

export const RELAY_SEND_PATH = "/v0/sol/send";
export const RELAY_SEND_TIMEOUT_MS = 2_500;

/** `hash`: the signature the signed bytes carry. True only when the relay answered exactly that. */
export function relaySender(raw: string | undefined, fx: typeof fetch = (...a) => fetch(...a)): ((signedTx: string, hash: string) => Promise<boolean>) | undefined {
  const base = relayBase(raw);
  if (!base) return undefined;
  return async (signedTx, hash) => {
    const ac = typeof AbortController === "undefined" ? undefined : new AbortController();
    const t = ac ? setTimeout(() => ac.abort(), RELAY_SEND_TIMEOUT_MS) : undefined;
    try {
      const r = await fx(`${base}${RELAY_SEND_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: signedTx }), ...(ac ? { signal: ac.signal } : {}) });
      if (!r.ok) return false;
      const j = await r.json().catch(() => null) as { signature?: unknown } | null;
      return typeof j?.signature === "string" && j.signature === hash;
    } catch { return false; } finally { clearTimeout(t); }
  };
}
