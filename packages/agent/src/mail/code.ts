// The sign-in code reader lives in the core (packages/core/src/mail-code.ts), so the core can read the person's own
// site mailbox (site-mail.ts) without a model or an app ever seeing the mail. This path stays for AgentZero's inbox,
// the receiver (apps/mail) and the tests.
export * from "@zerofee/core/mail-code";
