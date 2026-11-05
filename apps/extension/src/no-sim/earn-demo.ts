// The extension's stand-in for packages/earn/src/app/demo.ts: no account is ever the sample one in the extension, so Earn
// always reads the account's own network.
import type { Bridge } from "@zerofee/core/bridge";
export const isSampleAccount = (_id: string): boolean => false;
export function sampleEarn(_bridge: Bridge, _accountId: string): never {
  throw new Error("The Chrome extension has no sample account.");
}
