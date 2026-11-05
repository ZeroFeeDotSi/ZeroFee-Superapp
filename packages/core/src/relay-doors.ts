// The relay's doors a page asks first, set in one load after the first screen (apps/web core.ts; one dynamic load, not
// two, for Home's speed budget): Solana's reads through its Helius (sol-proxy.ts), Robinhood Chain's reads and sends
// through its Alchemy (hood-proxy.ts). `relay`: the relay's base address (core.ts RELAY).
import { setSolProxy } from "./sol-proxy.ts";
import { setHoodProxy } from "./hood-proxy.ts";

export function setRelayDoors(relay: string): void {
  setSolProxy(`${relay}/v0/sol/read`);
  setHoodProxy(`${relay}/v0/rh/rpc`);
}
