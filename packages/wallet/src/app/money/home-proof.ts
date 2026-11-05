import { onDemoPage } from "@zerofee/shell-api/release.ts";
// D125: a Home money path that hasn't passed its real-money test is hidden, never shown to test. Add and
// Request's new route (one-time addresses through NEAR Confidential, E1/E2) is on only in the test build
// (VITE_HOME_PROOF=1, the same build flag as Move's), and off in a release build until the $1 proof passes. While off,
// Add says so in one line; it never falls back to an old public address. Home's Send (E3 and E4, every Send private
// through NEAR; no plain send is left) is behind the same flag: off, one line and Close, nothing asked of the core.

/** The build's own flag (Vite puts VITE_* in import.meta.env at build time); no flag, a test or the phone's core: off. */
export const homeProof = (env: Record<string, unknown> | undefined = (import.meta as { env?: Record<string, unknown> }).env, sim: boolean = onDemoPage()): boolean => env?.VITE_HOME_PROOF === "1" || sim; // Sim (sample money, no real route to test) is always open

/** Add's one line while the route is off. */
export const HOME_PROOF_OFF = "Add opens after its first real test.";
/** Send's one line while its route is off. */
export const SEND_PROOF_OFF = "Send opens after its first real test.";
