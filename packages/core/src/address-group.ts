// An address in groups of four, so a person can check it group by group against what they meant to send to or share
// (address poisoning swaps the middle). One rule for every screen that shows a whole address: Add, Request, Send and
// a site's wallet.

import { outsideShort } from "./format.ts";

/** "DezX AZ8z 7Pnr …"; an EVM address keeps its "0x" on the first group ("0x9a 554b …"). Spaces only: nothing is
 *  dropped or added, so the groups joined back are the address. */
export function groupAddress(address: string): string {
  const a = address.trim();
  const evm = /^0x/i.test(a);
  const groups = (evm ? a.slice(4) : a).match(/.{1,4}/g) ?? [];
  return (evm ? [a.slice(0, 4), ...groups] : groups).join(" ");
}

/** Its start and end, to check a copy at a glance, in the core sheet's short form (format.ts outsideShort; the copy review's
 *  ruling, 5 Nov: 6+6 everywhere): "0xa517ef…049f8C" (six past an EVM address's "0x"), "DezXAZ…pPB263". */
export function addressEnds(address: string): string {
  return outsideShort(address.trim());
}

/** Its short form for one line beside a Copy: six and six ("DezXAZ…pPB263"). The whole address stays one tap away. */
export function addressShort(address: string): string {
  const a = address.trim();
  return a.length > 13 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}
