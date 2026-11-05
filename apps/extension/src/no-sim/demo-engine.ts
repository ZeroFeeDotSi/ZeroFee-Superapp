// The extension's stand-in for packages/trade/src/demo-engine.ts: no address is ever a sample wallet in the extension, so
// every trading wallet gets the real chain engine (Solana, BNB, Robinhood Chain) and the core's session rule, always.
export const SAMPLE_EVM_ADDRESS = "";
export const isSampleAddress = (_a: string): boolean => false;
export const SAMPLE_OPENING: Record<"sol" | "bsc" | "hood", string> = { sol: "0", bsc: "0", hood: "0" };
export const resetSampleWallets = (): void => {};
export const keepSampleWallets = (_store: unknown, _key: string): void => {};
export function createDemoEngine(_o: unknown): never {
  throw new Error("The Chrome extension has no sample wallets.");
}
