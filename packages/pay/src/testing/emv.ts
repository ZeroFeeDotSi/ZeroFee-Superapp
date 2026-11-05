// Builds EMVCo merchant QRs the way a bank's printer does, checksum last, for tests.
import { crc16 } from "../codes/emv.ts";

/** One ID-LENGTH-VALUE field. Lengths count characters. */
export const field = (tag: string, value: string) => `${tag}${String(Array.from(value).length).padStart(2, "0")}${value}`;

export function emv(...fields: string[]): string {
  const body = fields.join("") + "6304";
  return body + crc16(body);
}
