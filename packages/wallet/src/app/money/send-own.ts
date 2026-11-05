// The person's own places, said under Send's To (QA's sd-errors crawl, 4 Nov: their own Safe and SOL addresses
// read "That isn't an account or an address."). Loaded on its own when Send opens, so Home's first load stays as it was.
import { ADD_ROWS, ADD_WORDS, cardKeys } from "./add-coins.ts";
// row 16: Add's keys live in Home's sealed store; Send reads the last 6 from there
export { addCardStore } from "./add-keep.ts";

/** The one-time Add addresses kept on this phone, by the last 6 the card keeps (never the address), each with the place
 *  money sent there lands: "SOL wallet", "Safe". Send reads them to say a pasted one is the person's own (sd-errors crawl). */
export function keptAddEnds(store: Pick<Storage, "getItem"> | undefined): { last6: string; place: string }[] {
  return Object.entries(cardKeys(store)).flatMap(([slot, v]) => {
    const safe = slot.startsWith("safe-"), row = ADD_ROWS.find((r) => r.chain === (safe ? slot.slice(5) : slot));
    return row && typeof v?.last6 === "string" && v.last6.length === 6 ? [{ last6: v.last6, place: ADD_WORDS.rowName(row.name, safe ? "safe" : "wallet") }] : [];
  });
}

/** Under To, the moment the person's own place is pasted: moving between your own places is Move's (the Copywriter's
 *  words, QA's sd-errors crawl: their own Safe and SOL addresses read "That isn't an account or an address."). */
export const OWN_WALLET = (wallet: string) => `That's your own ${wallet}. Use Move.`;
export const OWN_ADD = (place: string) => `That's where you add money to your ${place}. Use Move.`;
export const OWN_SAFE = "That's your own Safe. Use Move.";

/** The person's own places, as Send knows them: each wallet's address (lowercased) with its name, the Add addresses'
 *  last 6 kept on this phone, and the Safe's NEAR account. */
export interface OwnPlaces { wallets: ReadonlyMap<string, string>; addEnds: readonly { last6: string; place: string }[]; self?: string | undefined }

/** The line for a pasted address that is the person's own, or null. Read before the address's own checks, so a made-up
 *  sample address (the Sim's Add) is still said to be theirs. An Add address is matched on its last 6 only (the phone
 *  keeps no more), and only for an address-length paste. */
export function ownLine(text: string, own: OwnPlaces): string | null {
  const t = text.trim(), low = t.toLowerCase();
  if (t.length < 3) return null;
  if (own.self && low === own.self.toLowerCase()) return OWN_SAFE;
  const wallet = own.wallets.get(low);
  if (wallet) return OWN_WALLET(wallet);
  if (t.length >= 32 && /^(0x)?[A-Za-z0-9]+$/.test(t)) {
    const add = own.addEnds.find((e) => e.last6 === t.slice(-6));
    if (add) return OWN_ADD(add.place);
  }
  return null;
}
