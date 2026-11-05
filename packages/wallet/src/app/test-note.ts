// A test account can't hold real coins. The core says so as a Problem (ledger.account.testnet); on screen it is one quiet
// line at the top of Wallet, never a sheet. A tap dismisses it and the phone remembers (device.store), so it shows once.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";

export const TESTNET_CODE = "ledger.account.testnet";
// Test NEAR is valued at NEAR's own price as a sample (grade 02f, F3/E3), said here once; v2 so it shows again once.
export const TEST_NOTE = "Test money only. The dollars use NEAR's real price.";
const KEY = "testnote.v2";

/** The Problem that is only a note, not a sheet. */
export const isTestNote = (p: Problem) => p.code === TESTNET_CODE;

/** Whether the line was already dismissed on this phone. Unreadable means not yet (it holds nothing that matters). */
export async function noteDismissed(bridge: Bridge): Promise<boolean> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  return !("problem" in r) && r.ok.value === "1";
}

export async function dismissNote(bridge: Bridge): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: "1" });
}
