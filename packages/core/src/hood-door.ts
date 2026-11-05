// The Robinhood door's hook (hood-proxy.ts), the only part in Home's first load (speed budget): empty until the door's
// code loads after the first screen (apps/web core.ts setHoodProxy) and fills it. core evm.ts and Trade's evm/rpc.ts ask it.
export const HOOD_DOOR: {
  /** hood-proxy.ts hoodNodes: the relay's door first, then `free`. */
  order: ((free: readonly string[], method: string) => string[]) | null;
  /** fetch for the door: its 404, 403 and 503 rest it, and any answer but a 200 throws (the node is asked next). */
  fetch: typeof fetch | null;
  /** For Trade's own fetch (packages/trade evm/rpc.ts): what the door's HTTP status says (hood-proxy.ts hoodProxySaid). */
  said: ((url: string, status: number) => void) | null;
} = { order: null, fetch: null, said: null };
