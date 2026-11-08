// spending.wallets and spending.exportKey (Wallet's Details, Add's and Request's addresses, the old-words line): every wallet Spending uses,
// with its full address and contents, one wallet per chain (D55). Its code loads with its first ask, never in Home's
// first load (speed budget, 3 Nov: Home's Move and Swap made room for their resume logic there). Moved from spending.ts
// as it was: nothing it does changed.
// Types only from spending.ts: its values come in `lib` (the bundler then never splits spending.ts out of Home's chunk).
import type { AppsNetwork, SpendingDeps, SpendingLib, SpendingNetwork, SpendingWallet } from "./spending.ts";

/** Who may have a chain wallet's key shown through Spending (spending.exportKey): Wallet's Details and ZeroFee's own
 *  screens (no caller), never Trade's, Browser's, an app's in Apps or Chat's code. */
const EXPORTERS = new Set(["wallet", undefined, ""]);

type Deps = Pick<SpendingDeps, "engine" | "call" | "nativeUsd">;
/** One coin a site wallet holds, as subwallet.coins lists it (site-coins.ts): `usd` null when it has no price. */
type SiteCoinRow = { token: string; amount: string; usd: number | null };
/** How long spending.wallets waits for a site wallet's coins before it answers with its own coin alone. */
export const SITE_COINS_WAIT_MS = 1200;

/** A chain coin's smallest units as a short decimal (six places at most, rounded down): "0.0012". */
function coinText(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals), whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export async function wallets(d: Deps, lib: SpendingLib): Promise<SpendingWallet[]> {
  const { APPS_NETWORK_NAME, WALLET_LABEL, SPENDING_NETWORKS, usdText } = lib;
  const e = d.engine();
  // The list is read first, as spending.status reads it (2 Nov rehearsal: the engine's last snapshot, taken before a
  // wallet was made or read, listed that Solana wallet "unread", so export found none; Wallet's Details, which asks once
  // when it opens, hid it, and could say "No wallets yet" over a wallet holding money). A read that fails still lists
  // every wallet, the ones it has no figure for marked unread.
  await e.refresh().catch(() => undefined);
  const s = e.snapshot();
  type Listed = { id: string; kind: string; chain: string; address: string; label: string; site?: string; current?: boolean; oldWords?: boolean; keyExported?: boolean };
  const list = await d.call<Listed[]>("subwallet.list", {});
  const isApps = (c: string): c is AppsNetwork => c in APPS_NETWORK_NAME;
  // Every wallet is read at once (Home speed, 3 Nov: each site and Apps wallet waited for the one before it) and listed
  // in subwallet.list's order; null is a wallet left out (an older one that holds nothing, a kind Spending doesn't list).
  const row = async (w: Listed): Promise<SpendingWallet | null> => {
    const marks = { keyExported: w.keyExported === true, ...(w.oldWords ? { oldWords: true as const } : {}) };
    if (w.kind === "trade" && w.chain === "near") {
      return { id: w.id, role: "hub", network: "near", address: w.address, label: "Your NEAR wallet's cash", current: true, inCap: true, cashUsd: usdText(s.reserveUsd), coinsUsd: "0.00", keyExported: false, ...(s.unread ? { unread: true as const } : {}) };
    }
    if (w.kind === "site") return siteRow(d, lib, w, marks);
    if (w.kind !== "trade" && w.kind !== "browser") return null;
    const current = w.current === true;
    if ((SPENDING_NETWORKS as readonly string[]).includes(w.chain)) {
      const name = WALLET_LABEL[w.chain as SpendingNetwork];
      const chain = s.chains.find((x) => x.chain === w.chain);
      const v = chain?.wallets.find((x) => x.id === w.id);
      // A network Spending doesn't move money on yet (closed: BNB Chain until its own test) has no figure from the
      // engine: its wallet is read as an Apps network's is, what the chain says it holds, outside the cap, never
      // "Can't see it" for a wallet nothing went wrong with (demo, 2 Nov).
      if (!v && chain?.closed) {
        const rows = await d.call<{ token: string; symbol: string; decimals: number; amount: string }[]>("subwallet.balances", { id: w.id }).catch(() => null);
        const n = rows?.find((r) => r.token === "native");
        if (!current && n && BigInt(n.amount) === 0n) return null;
        return {
          id: w.id, role: current ? "chain" : "older", network: w.chain as SpendingNetwork, address: w.address, label: current ? name : `Older ${name}`, current, inCap: false,
          ...(n ? { holds: `${coinText(BigInt(n.amount), n.decimals)} ${n.symbol}` } : { unread: true as const }), ...marks,
        };
      }
      // an older wallet only while it holds anything (or can't be read: never hidden as if empty)
      if (!current && v && v.nativeUsd < 0.01 && v.coinsUsd < 0.01) return null;
      return {
        id: w.id, role: current ? "chain" : "older", network: w.chain as SpendingNetwork, address: w.address, label: current ? name : `Older ${name}`, current, inCap: true,
        cashUsd: usdText(v?.nativeUsd ?? 0), coinsUsd: usdText(v?.coinsUsd ?? 0), ...marks, ...(!v ? { unread: true as const } : {}),
      };
    }
    if (!isApps(w.chain)) return null;
    // Ethereum, Base, Gnosis, Arbitrum (today's Browser wallets): listed with what the chain says they hold, outside the cap
    const rows = await d.call<{ token: string; symbol: string; decimals: number; amount: string }[]>("subwallet.balances", { id: w.id }).catch(() => null);
    const n = rows?.find((r) => r.token === "native");
    if (!current && n && BigInt(n.amount) === 0n) return null;
    return {
      id: w.id, role: current ? "chain" : "older", network: w.chain, address: w.address, label: current ? `${APPS_NETWORK_NAME[w.chain]} wallet` : `Older ${APPS_NETWORK_NAME[w.chain]} wallet`, current, inCap: false,
      ...(n ? { holds: `${coinText(BigInt(n.amount), n.decimals)} ${n.symbol}` } : { unread: true as const }), ...marks,
    };
  };
  return (await Promise.all(list.map(row))).filter((r): r is SpendingWallet => r !== null);
}

/** A site's own wallet as Details and the site's settings list it: its own coin in dollars where the network has a
 *  price, else what the chain says it holds; outside the cap (the engine never fills or empties it by itself). One of
 *  replaced words says so. */
async function siteRow(d: Deps, { SPENDING_NETWORKS, usdText }: SpendingLib, w: { id: string; chain: string; address: string; label: string; site?: string; oldWords?: boolean }, marks: { keyExported: boolean; oldWords?: true }): Promise<SpendingWallet> {
  // its coins as its page lists them (subwallet.coins: SOL and every coin bought on the site, priced), read beside the
  // balance: one figure for the wallet everywhere (QA, 5 Nov: Home $22.81, its page $25.28, the toast $29.85).
  // Never waits past SITE_COINS_WAIT_MS (Home's speed): late, the coin alone as before, and the core keeps the answer.
  const [rows, listed] = await Promise.all([
    d.call<{ token: string; symbol: string; decimals: number; amount: string }[]>("subwallet.balances", { id: w.id }).catch(() => null),
    Promise.race([d.call<SiteCoinRow[]>("subwallet.coins", { id: w.id }).catch(() => null), new Promise<null>((ok) => (setTimeout(() => ok(null), SITE_COINS_WAIT_MS) as unknown as { unref?: () => void }).unref?.())]),
  ]);
  const n = rows?.find((r) => r.token === "native");
  const own = Array.isArray(listed) ? listed.find((c) => c?.token === "native") : undefined;
  const others = Array.isArray(listed) ? listed.filter((c) => c && c.token !== "native" && /[1-9]/.test(String(c.amount)) && typeof c.usd === "number" && Number.isFinite(c.usd) && c.usd > 0) : [];
  const coinsUsd = usdText(others.reduce((t, c) => t + (c.usd as number), 0));
  if (n && own && typeof own.usd === "number" && Number.isFinite(own.usd)) {
    return { id: w.id, role: "site", ...(w.site ? { site: w.site } : {}), network: w.chain as SpendingNetwork | AppsNetwork, address: w.address, label: w.oldWords ? `Older ${w.label}` : w.label, current: !w.oldWords, inCap: false, cashUsd: usdText(own.usd), coinsUsd, units: n.amount, ...marks };
  }
  const priced = n && (SPENDING_NETWORKS as readonly string[]).includes(w.chain) && d.nativeUsd ? await d.nativeUsd(w.chain as SpendingNetwork).catch(() => 0) : 0;
  const figure = n
    ? priced > 0
      ? { cashUsd: usdText((Number(BigInt(n.amount) / 10n ** BigInt(Math.max(0, n.decimals - 9))) / 1e9) * priced), coinsUsd, units: n.amount }
      : { holds: `${coinText(BigInt(n.amount), n.decimals)} ${n.symbol}` }
    : { unread: true as const };
  return { id: w.id, role: "site", ...(w.site ? { site: w.site } : {}), network: w.chain as SpendingNetwork | AppsNetwork, address: w.address, label: w.oldWords ? `Older ${w.label}` : w.label, current: !w.oldWords, inCap: false, ...figure, ...marks };
}

/** D56: the key is shown (the core's sheet, then its own screen) and the wallet is marked "Key exported"; nothing else
 *  changes: it stays the network's wallet and is filled as before, up to the cap. */
export async function exportKey(d: Pick<SpendingDeps, "call">, lib: SpendingLib, told: () => void, p: Record<string, unknown>): Promise<unknown> {
  const { ProblemError, securityProblems, spendingProblems } = lib;
  // Only Wallet's Details and ZeroFee's own screens (security review 2 Nov, Medium): Spending asks the core as Trade, its
  // host, and the core lets Trade export, so without this Browser or an app in Apps had a chain wallet's key back here,
  // past the core's own "never from Browser, Apps or Chat", on a sheet that named Trade.
  if (!EXPORTERS.has(p.caller as string | undefined)) throw new ProblemError(securityProblems.requestNotAllowed("A wallet's key is shown only from Wallet's Details."));
  const id = String(p.id ?? "");
  const w = (await d.call<{ id: string; chain: string }[]>("subwallet.list", {})).find((x) => x.id === id);
  if (!w) throw new ProblemError(securityProblems.subwalletUnknown());
  if (w.chain === "near") throw new ProblemError(spendingProblems.noExport());
  const r = await d.call<{ shown?: boolean; secretKey?: string; declined?: true }>("subwallet.export", { id });
  if (!r.declined) told();
  return r;
}
