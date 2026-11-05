// The live feed's sockets (Wallet V1's nodes.ts at 52d44eb, all keyless; Security approved these four, 27 Oct 2026). Exact
// wss:// origins, one list per chain: the phone's CSP pins all of them, the extension's (Solana only) pins the sol list,
// and both CSP tests read this constant so nothing drifts. The feed is display only: it moves the open coin's chart and
// live price, never a trade's amount, floor, cap or address (those come from the route's quote).
import type { ChainId } from "../types.ts";
import { onCopy } from "@zerofee/core/fork";

/** The chains with a live feed of their own (NEAR has none: its coin page polls the market data). */
export type FeedChain = Exclude<ChainId, "near">;
// On the mainnet copy (VITE_FORK=1) there is no feed: the sockets would watch real mainnet, so each list is empty and the
// open coin polls the copy's own node (core fork.ts onCopy).
export const WS_HOSTS: Readonly<Record<FeedChain, readonly string[]>> = {
  sol: onCopy(null, ["wss://solana-rpc.publicnode.com", "wss://public.rpc.solanavibestation.com"]),
  bsc: onCopy(null, ["wss://bsc-rpc.publicnode.com"]),
  hood: onCopy(null, ["wss://robinhood-rpc.publicnode.com"]),
};
