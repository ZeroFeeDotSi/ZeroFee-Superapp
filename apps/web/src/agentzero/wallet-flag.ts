// AgentZero's own wallet on screen (design $ZEROFEE_HOME/AGENTZERO-WALLET.md §5, L9): AGENTZERO_WALLET, off until the
// steps O1–O7 and the key-path review (SR2). Off, the AgentZero app is exactly as before: the key chip and card,
// the free reading's note, no wallet line anywhere. The core's doors refuse by name while it is off, whatever the screen.
// Only a walk harness turns it on (walletFlag.on = true, before the app renders); the app itself never does.
import { AGENTZERO_WALLET } from "@zerofee/core/agent-route";

export const walletFlag: { on: boolean } = { on: AGENTZERO_WALLET };
