// ZeroFee's mail host (D80, K3), the app's one mail setting: the inbox API's host and the domain addresses end in, both
// mail.zerofee.si (never the apex). QA, 5 Nov: up, SMTP on 25 with STARTTLS, the inbox API on https 443; no MX
// record (senders fall back to its A record). The core gets it as `mail` (DemoCore options): AgentZero's mailbox
// (mailbox.ts) and the person's own sign-in mailbox (site-mail.ts) both live here. Tiny on purpose: no crypto loads with it.
export const MAIL_SERVICE: { readonly host: string; readonly domain: string } = { host: "mail.zerofee.si", domain: "mail.zerofee.si" };
