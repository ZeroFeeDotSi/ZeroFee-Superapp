// IBANs from bank codes, checked by their own check digits (ISO 13616, mod 97) before Pay shows or uses one.

const SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** The IBAN in plain capitals with no spaces, or nothing when it isn't one (wrong shape, or its check digits fail). */
export function readIban(text: string | undefined): string | undefined {
  const t = text?.replace(/\s+/g, "").toUpperCase();
  if (!t || !SHAPE.test(t)) return undefined;
  let r = 0;
  for (const ch of t.slice(4) + t.slice(0, 4)) {
    const v = ch >= "A" ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
    r = (v > 9 ? r * 100 + v : r * 10 + v) % 97;
  }
  return r === 1 ? t : undefined;
}

/** "DE89 3704 0044 0532 0130 00": groups of four, as banks print it. */
export const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");

/** "DE89 …3000": its country and check digits, and its last four. */
export const shortIban = (iban: string) => `${iban.slice(0, 4)} …${iban.slice(-4)}`;
