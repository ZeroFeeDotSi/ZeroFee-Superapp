// The account's rules as the contract holds them, in plain words ("Up to $500 in any coin with a price: Face ID"), and
// what Protection opens on. Its own file so only Protection loads it, never Home (speed budget, 5 Nov).
import { defaultBands, type ProtectionBand } from "@zerofee/core/protection-bands";
import { approvalWords, type ApprovalWords } from "@zerofee/shell-api/approval-words.ts";
import { contractNeed, needWords } from "@zerofee/core/rule-words";
import { countsFewCoins, fromCore, usd, youWord, type Loaded } from "./rules.ts";

/**
 * account.protection.get's answer → what the screen opens on. The account's own bands in dollars when the core could
 * say them; with no bands on the account yet (an account made before protection), set-up's own defaults for this
 * network, offered with "Turn on"; otherwise the coin rules only, and no save. Never a number of this screen's own.
 */
export function openOn(res: { bands?: unknown; usd?: readonly ProtectionBand[] | null } | null, network: string, w: ApprovalWords = approvalWords()): Loaded {
  const now = res ? rulesNow(res.bands, w, res.usd) : [];
  const own = fromCore(res?.usd);
  if (own) return { k: "bands", bands: own, from: own, first: false, now, ...(network === "mainnet" && countsFewCoins(res?.bands) ? { fewCoins: true } : {}) };
  if (res && Array.isArray(res.bands) && res.bands.length === 0) {
    const set = fromCore(defaultBands(network))!;
    return { k: "bands", bands: set, from: set, first: true, now };
  }
  return { k: "unread", now };
}

/**
 * The rules the account contract holds now, in plain words: coin limits fixed when they were saved, e.g.
 * "Up to 5 NEAR: Face ID". Dollars aren't kept on chain, so this is what is true, not what was typed.
 */
/** `dollars`: the same bands in dollars (account.protection.get's `usd`), said first when a limit is in NEAR only (D8). */
export function rulesNow(bands: unknown, w: ApprovalWords = approvalWords(), dollars?: readonly { upToUsd: number | null; about?: boolean }[] | null): string[] {
  if (!Array.isArray(bands)) return [];
  return bands.map((b: { up_to?: [string, string][] | null; level?: unknown }, i: number) => {
    // H01: a band lists up to 32 coins. Said as one figure and which coins can use it (5 Nov, copywriter): today's rules
    // list every coin ZeroFee prices ("in any coin with a price"); older ones list a few by name ("in NEAR, USDC or USDT",
    // "NEAR only"), so every other coin takes the strictest rule. Never an id, never the same limit twice.
    const listed = Array.isArray(b.up_to) ? b.up_to : [];
    const inUsd = dollars?.length === bands.length ? dollars[i]?.upToUsd : null;
    const said = listed.length ? limitWords(listed, typeof inUsd === "number" ? inUsd : null, dollars?.[i]?.about === true) : null;
    return `${said ? `Up to ${said}` : "Anything bigger"}: ${contractLevelWords(b.level, w)}`;
  });
}
/** A band's limit part: "$500 in any coin with a price", "$500 in NEAR, USDC or USDT", "about $500 today, NEAR only". */
function limitWords(listed: readonly [string, string][], inUsd: number | null, about: boolean): string {
  const named = listed.filter(([coin]) => COINS[coin]);
  const texts = named.map(([coin, amount]) => coinText(coin, amount));
  // a dollar coin's figure is the limit itself; a NEAR-only one moves with NEAR's price ("today")
  const figure = texts.find((t) => t.startsWith("$")) ?? (inUsd !== null ? `${about ? "about " : ""}${usd(inUsd)} today` : texts[0] ?? "a limit");
  if (named.length < listed.length) return `${figure} in any coin with a price`;
  const names = [...new Set(named.map(([coin]) => COINS[coin]![2]))];
  const last = names.pop();
  return names.length ? `${figure} in ${names.join(", ")} or ${last}` : last === "NEAR" ? `${figure}, NEAR only` : `${figure} in ${last}`;
}
const COINS: Record<string, [string, number, string]> = {
  near: ["NEAR", 24, "NEAR"],
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": ["$", 6, "USDC"],
  "nep141:usdt.tether-token.near": ["$", 6, "USDT"],
};
/** A limit is context, not an amount that moves: rounded down to 4 decimals, so it never reads bigger than it is. */
function coinText(coin: string, units: string): string {
  const k = COINS[coin];
  if (!k || !/^\d+$/.test(units)) return coin;
  const scale = 10n ** BigInt(k[1]);
  const whole = BigInt(units) / scale;
  const frac = ((BigInt(units) % scale) * 10_000n) / scale;
  const f = frac.toString().padStart(4, "0").replace(/0+$/, "");
  // a dollar coin's limit is said in dollars, "$500", as the rest of the screen says it (grade 1 Nov, item 8)
  const n = `${whole.toLocaleString("en-US")}${f ? `.${f}` : ""}`;
  return k[0] === "$" ? `$${n}` : `${n} ${k[0]}`;
}
function contractLevelWords(level: unknown, w: ApprovalWords): string {
  const n = contractNeed(level);
  return n ? needWords(n.level, n.waitSeconds, youWord(w)) : "your strictest level";
}
