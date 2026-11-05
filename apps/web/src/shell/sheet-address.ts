// the copy review's rules for the full address on every outside sheet (5 Nov): the address in the mono face, in groups of 4 with thin
// spaces, wrapping freely, never shortened; "To" a small caption above it; the network line ("Public on Solana." or
// "Private.") quiet under it; copying gives the address without the spaces. The sheet's words stay the core's own: these
// only read a line ("To <address>") and set it, never change what it says.

/** The thin space between groups (U+2009): narrow enough to read as one address, wide enough to check 4 at a time. */
export const THIN = " ";

/** The address in groups of 4 (an EVM address keeps its "0x" on the first group: "0x5290 aBcD …"); a name (bob.near) or
 *  anything that isn't one run of letters and digits stays as it is. */
export function groupAddress(address: string): string {
  const evm = address.startsWith("0x");
  const body = evm ? address.slice(2) : address;
  if (!/^[0-9a-zA-Z]{12,}$/.test(body)) return address;
  return `${evm ? "0x" : ""}${body.match(/.{1,4}/g)!.join(THIN)}`;
}

/** What copying gives: the address alone, every space (thin or not) taken out. */
export const ungroup = (shown: string): string => shown.replace(/[\s   ]/g, "");

/** The address an outside sheet's "To <address>" line names in full (the core's OUTSIDE_WORDS.to, the fill sheet's first
 *  line); null for any other line, and for a short form ("To 0x7D06…7e3D on Ethereum") that is not the address. */
export function toAddress(line: string): string | null {
  const m = /^To (\S+)$/.exec(line);
  return m && !m[1]!.includes("…") ? m[1]! : null;
}

/** The line that says where the payee's side lands (OUTSIDE_WORDS.seen, the copy review's words): shown quiet. */
export const isLandsLine = (line: string): boolean => /^(Public on [^.]+\.|Private\.)$/.test(line);

/** A Send fill sheet's first leg, "They get · 1.2345 SOL ($40.00)" (the UI lead's rulings, 5 Nov: core private-route.ts
 *  SEND_LEG_WORDS): drawn in ink, the two legs under it quiet. Only this line: "They get about $2.71" stays plain. */
export const isLeadLine = (line: string): boolean => /^They get · /.test(line);
