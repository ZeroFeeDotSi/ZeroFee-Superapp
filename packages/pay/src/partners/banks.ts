// Your bank (D29's Bank tile): the person's own personal IBAN at Mt Pelerin, kept on this phone only. It's saved from
// what the person copied in Mt Pelerin's page (or the Robot's read), checked by its own check digits first.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { readIban } from "../codes/iban.ts";
import { payProblems } from "../pay-problems.ts";

export interface SavedBank {
  partner: "mt-pelerin";
  /** The person's own personal IBAN at the partner, checked. */
  iban: string;
}

/** Mt Pelerin's own web app, where the personal IBAN is made (recipes.ts, partner "mt-pelerin"). */
export const BANK_SIGNUP = "https://app.mtpelerin.com";
const KEY = "bank.v1";

export async function loadBank(bridge: Bridge): Promise<SavedBank | null> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if ("problem" in r || r.ok.value === null) return null;
  try {
    const b = JSON.parse(r.ok.value) as SavedBank;
    return readIban(b.iban) ? b : null;
  } catch {
    return null;
  }
}

/** Saves the IBAN found in what the person copied; the Problem to show when there isn't one. */
export async function saveBankFrom(bridge: Bridge, text: string | null): Promise<{ ok: SavedBank } | { problem: Problem }> {
  const found = text?.match(/[A-Za-z]{2}\d{2}[A-Za-z0-9 ]{11,40}/)?.[0];
  const iban = readIban(found);
  if (!iban) return { problem: payProblems.copiedNone("an IBAN", "Mt Pelerin") };
  const bank: SavedBank = { partner: "mt-pelerin", iban };
  const r = await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(bank) });
  return "problem" in r ? { problem: r.problem } : { ok: bank };
}

export async function removeBank(bridge: Bridge): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: null });
}
