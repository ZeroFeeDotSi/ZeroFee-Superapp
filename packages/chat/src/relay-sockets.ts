// Where ZeroFee Chat's relay sockets come from. The real app leaves this alone: every RelayPool opens a WebSocket to its
// relay. The sample-money pages (?demo, ?screens) set `make` to the in-memory relay (local-relay.ts) before Chat loads,
// so nothing a visitor types in the demo ever reaches a public relay (QA, 3 Nov: the demo's split posted to a live
// city room). No imports: the demo page sets this without loading Chat's code.
import type { SocketMaker } from "./pool.ts";

export const relaySockets: { make: SocketMaker | null } = { make: null };
