// A new account's protection bands and the coins a band lists: plain values and pure functions, apart from the core, so
// a screen can show them without loading the in-page core (the phone's core runs in its own context, D134).
/** The coins a band read from the account lists, so the Protection screen can say whether a save would add every coin. */
export function bandCoins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const first = (raw as { up_to?: unknown }[]).find((b) => Array.isArray(b?.up_to));
  return first ? (first.up_to as unknown[]).filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === "string").map((x) => x[0]) : [];
}

/** A protection band as the app sends it: a dollar limit (null for the last band) and what it needs. */
export interface ProtectionBand {
  upToUsd: number | null;
  /** The limit is NEAR at today's price, rounded (an older limit that carries no dollars of its own). */
  about?: boolean;
  level: "faceid" | "wait" | "device" | "both";
  waitSeconds?: number;
}

/**
 * A new account's protection (the outside study's item 3; design review, 28 Oct), in dollars, measured in NEAR, USDC and
 * USDT alike: Face ID up to $500 in any 24 hours; above that, a 24-hour wait this device can cancel. Testnet waits 2
 * minutes instead, so a held request can be tried in a test. The person changes it on the Protection screen. The one
 * place these numbers live: other numbers are an edit here.
 */
export const DEFAULT_PROTECTION = { faceIdUpToUsd: 500, waitSeconds: { mainnet: 86_400, testnet: 120 } } as const;

export function defaultBands(network: string): ProtectionBand[] {
  const waitSeconds = network === "mainnet" ? DEFAULT_PROTECTION.waitSeconds.mainnet : DEFAULT_PROTECTION.waitSeconds.testnet;
  return [{ upToUsd: DEFAULT_PROTECTION.faceIdUpToUsd, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds }];
}
