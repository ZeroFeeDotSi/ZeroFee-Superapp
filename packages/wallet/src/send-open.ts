// Whether Home's Send from the Safe can go (E4, ledger.sendFromSafe): its first step fills Private from the Safe (route B
// for this one call: the Send asks with `fill`, the same switch as Move's, safe-fill-open.ts), then NEAR Confidential
// pays the payee (product decision, 5 Nov: Send works for every coin, Safe money included). Only a Safe coin whose fill works
// end to end is offered (send-sources.ts: a coin native to NEAR); any other offers only its share in Private (D125).
// Also the hard constant SAFE_SEND_FILL_OPEN (QA's MUST, 5 Nov): shut, no build flag offers the Safe as a Send
// source to an outside payee.
import { SAFE_FILL_OPEN } from "@zerofee/core/safe-fill-open";
import { SAFE_SEND_FILL_OPEN } from "@zerofee/core/safe-send-fill-open";

export const SAFE_SEND_OPEN: boolean = SAFE_SEND_FILL_OPEN && SAFE_FILL_OPEN;
