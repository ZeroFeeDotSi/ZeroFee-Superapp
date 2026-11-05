// Rules saved before every coin was counted (H01), and a saved change that counts every coin: pure reads of the account
// contract's own JSON (protection, waiting_requests), shared by the core's sheet (dev-signer.ts), the held list (held.ts)
// and Spending's check before a Top up (spending.ts). No imports, so any of them can use it.

/** NEAR as a coin the rules count (wrap.near's wNEAR). A Top up paid with NEAR moves it: 1Click takes no other NEAR. */
export const WNEAR = "nep141:wrap.near";

/**
 * Rules saved before every coin was counted (H01, the test release-4 account, mainnet 2 Nov): a band that lists coins
 * but not wNEAR. Such a first band holds any other coin, at any size, as a big payment.
 */
export const bandsCountFewCoins = (bands: unknown): boolean => {
  const first = Array.isArray(bands) ? (bands[0] as { up_to?: unknown } | undefined)?.up_to : undefined;
  return Array.isArray(first) && !first.some((c) => Array.isArray(c) && c[0] === WNEAR);
};

/**
 * A change to the rules that the person already saved and the account is holding, which counts every coin (its first band
 * lists wNEAR): the newest one, from the contract's own waiting_requests. Finishing it is the one step a Top up needs on
 * rules that don't (mainnet 2 Nov: a test account had two such changes saved, both past their wait, and was sent to save a
 * third). Null when there is none, or it needs the second device.
 */
export function savedEveryCoinRules(waiting: unknown, nowMs = Date.now()): { id: string; readyAtIso: string; ready: boolean } | null {
  const list = Array.isArray(waiting) ? (waiting as { id?: unknown; change?: { SetProtection?: { bands?: unknown } }; ready_at_ns?: unknown; needs_device?: unknown; approved?: unknown }[]) : [];
  const saved = list.filter((w) => w?.change?.SetProtection && !bandsCountFewCoins(w.change.SetProtection.bands) && /^\d+$/.test(String(w.ready_at_ns)) && !(w.needs_device === true && w.approved !== true));
  const newest = saved.sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!newest) return null;
  const readyMs = Number(BigInt(String(newest.ready_at_ns)) / 1_000_000n);
  return { id: String(newest.id), readyAtIso: new Date(readyMs).toISOString(), ready: nowMs >= readyMs };
}

/**
 * Will these rules hold a move of this coin at any size (contract `level_for_moves`: a band fits only if it lists every
 * coin that moves)? True when the rules count few coins and the first band that could take this coin (one that lists it,
 * or the last, unlimited one) is not plain Face ID. Spending's early answer only: the core's sheet asks the contract.
 */
export function holdsCoin(bands: unknown, coin: string): boolean {
  if (!bandsCountFewCoins(bands)) return false;
  const list = bands as { up_to?: unknown; level?: unknown }[];
  const takes = list.find((b) => !Array.isArray(b?.up_to) || b.up_to.some((c) => Array.isArray(c) && c[0] === coin));
  return !!takes && takes.level !== "FaceId";
}
