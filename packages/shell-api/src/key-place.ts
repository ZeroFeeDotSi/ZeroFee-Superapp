// Where the person's key is, said as each platform can truly say it: ONE table keyed by platform (the copy review's words and the audit's
// MUST, 7 Nov). On the iPhone the Safe's key is the chip's and never leaves the phone; in a browser (the Sim, the web
// app) it is this device's own key, so the web never says "phone" or "secure chip" for it. Every screen that says where
// the key is reads this table: Details' Safe card, Devices' key row, and the web's own Check this sheet's footer.
// (The iPhone's own sheet, NativeSheet.swift, draws its footer itself; its words here are the same ones, for the table.)
import { onPhone } from "./approval-words.ts";

export type KeyPlatform = "iphone" | "web";

export interface KeyPlaceWords {
  /** Details' Safe card: the row that says the key has no export. */
  neverLeaves: string;
  /** Devices' key row's right side, once its proof matched (its title names the device). */
  isHere: string;
  /** Details' key row, its reason one tap down; null: the row says it once (copy review, 7 Nov: the web said it twice). */
  neverLeavesWhy: string | null;
  /** The Check this sheet's footer. */
  sheetFoot: string;
}

export const KEY_PLACE_WORDS: Readonly<Record<KeyPlatform, KeyPlaceWords>> = {
  iphone: { neverLeaves: "This key never leaves the phone.", isHere: "Your key is here", neverLeavesWhy: "Its key never leaves this device, so there's nothing to export.", sheetFoot: "Approve is your yes. Your key never leaves this phone." },
  // the copy review (7 Nov): the row's title says "This device", so its right side is "Key is here"
  web: { neverLeaves: "This key never leaves this device.", isHere: "Key is here", neverLeavesWhy: null, sheetFoot: "Approve is your yes. Your key never leaves this device." },
};

/** Inside the iPhone app, or a browser (the Sim too: it simulates the phone but holds no chip key). */
export const keyPlatform = (phone: boolean): KeyPlatform => (phone ? "iphone" : "web");

export const keyPlaceWords = (phone: boolean = onPhone()): KeyPlaceWords => KEY_PLACE_WORDS[keyPlatform(phone)];

/** A sheet's footer without a key's place: a trading, site or row wallet's key can leave the device when the person
 *  asks (Details' "Show this wallet's key"; core web-wallet.ts:274-279, exportChecked → secretKey), so its sheet never
 *  says "never leaves" (the audit's MUST, 7 Nov). */
export const SHEET_YES = "Approve is your yes.";

/** The Check this footer by key: the Safe's own key (`safeKey`) keeps its place line; any other key, the yes alone. */
export const sheetFoot = (safeKey: boolean, phone: boolean = onPhone()): string => (safeKey ? keyPlaceWords(phone).sheetFoot : SHEET_YES);

/** The Sim's sample device key, on every build (the audit's MUST, 7 Nov): never "secure-chip". A sample key is in no chip, so
 *  no screen fed by the Sim's data can say "secure chip"; the phone's real key (host/vault.ts) keeps its own kind. */
export const SIM_KEY_KIND = "development" as const;
