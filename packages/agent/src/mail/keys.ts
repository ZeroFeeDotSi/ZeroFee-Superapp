// AgentZero's mailbox keys and sealed mail: the code lives in the core (packages/core/src/mail-keys.ts) so the core can
// open mail with the hot root without the root ever leaving it. This path stays for the receiver (apps/mail), the tray
// and the tests.
export * from "@zerofee/core/mail-keys";
