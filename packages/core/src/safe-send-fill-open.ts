// Send from the Safe through the fill (QA's MUST, 5 Nov): the fill's one sheet says "Move $X to Private", then
// Private pays an OUTSIDE payee no sheet names, so rule 4 (an outside send asks every time, with the full address) and the
// binding to the signed payout quote both fail. A hard constant, never SAFE_FILL_OPEN or VITE_SAFE_FILL_OPEN (the test
// phone build sets that one for Move). OPEN since feat/safe-send-fill: the fill's one sheet names the payee in full and
// what they get, and the core binds the payout to the move in before the Safe signs (security.send.unbound otherwise).
// The bound path still needs the build's fill switch (ledger.ts); off, the ledger's refusal stands. Move's own fill
// (private-move.ts), a site's top-up and Safe → own wallets never read it.
export const SAFE_SEND_FILL_OPEN = true as boolean;
