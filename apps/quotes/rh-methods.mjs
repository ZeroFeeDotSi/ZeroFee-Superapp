// The Robinhood Chain methods the relay and the app share, in a file of their own: the app's copy loads with the door
// (core hood-proxy.ts, after the first screen), never in Home's first load. Plain JS: the relay deploys it as is.
/**
 * Robinhood Chain JSON-RPC methods POST /v0/rh/rpc passes on to Alchemy (rh-rpc.mjs), and nothing else: the reads the
 * app asks a Robinhood node (core evm.ts, Trade's evm/) and eth_sendRawTransaction. Never eth_getLogs (Trade's log scans
 * span thousands of blocks every 2 s and keep to the free nodes), a filter, a subscription, debug_*, trace_* or txpool_*.
 */
export const RH_RPC_METHODS = [
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_simulateV1",
  "eth_sendRawTransaction",
];
