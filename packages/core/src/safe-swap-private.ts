// Product decision (8 Nov): "make it all confidential". A Safe Swap and a Safe Buy or Sell (Trade's NEAR Intents
// tab, the coin page) go ONLY through NEAR Confidential: the Safe's coin into Private (one mt_transfer inside NEAR
// Intents, the Safe's one Face ID), NEAR Intents swaps it from Private, and the coin lands back in the Safe. The public
// swap (an INTENTS-to-INTENTS 1Click quote the Safe paid straight) is gone. This switch is read by the code that shows the
// Buy and Sell buttons and by the ledger that runs the job: off, both are hidden and the ledger refuses, by name.
// On once proven end to end (builder 15, 8 Nov: tests + the Sim's whole job, both themes, sim-crawls/2026-11-08-b15).
export const SAFE_SWAP_PRIVATE: boolean = true;
