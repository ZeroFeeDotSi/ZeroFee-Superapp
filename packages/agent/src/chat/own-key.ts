// "Paste your own Claude key" is a developer switch only (product decision, 3 Nov: "no Claude key for normal people; people
// only use a funded wallet for compute"). It is built in only with VITE_AGENTZERO_OWN_KEY=1, and never in the public
// build. Off (every build people get), AgentZero thinks only on what the person put in its own wallet, through
// ZeroFee's relay: no key card, no "Use your own Claude key" link, no saved key is ever read for a turn.
// Read inline (import.meta.env, never an alias), so a build without it can fold the own-key branches away. Under node
// (tests) it reads as off; a test that runs the own-key path passes the key to chatTurn itself.
export const OWN_KEY_ON: boolean = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_AGENTZERO_OWN_KEY === "1" && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZEROFEE_PUBLIC !== "1";
