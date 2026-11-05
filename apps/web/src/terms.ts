// The terms a person agrees to before making or restoring a bank on this device: one tap that says what it agrees to,
// once per device, asked again whenever TERMS_VERSION changes. Kept in this browser only; nothing is sent anywhere. No
// geo-blocking: TERMS_AGREE is the person's own statement. Bump TERMS_VERSION when the terms change materially.
import { SOFTWARE_LINE } from "@zerofee/shell-api/provider-words.ts";
// The version and the one read of the agreement live in terms-accepted.ts (Home's first load reads only that, never the
// terms' own text: speed budget, 5 Nov).
export { TERMS_VERSION, acceptTerms, termsAccepted } from "./terms-accepted.ts";

/** The facts the terms screen shows above the ticks. The last is the product rule: ZeroFee is software, never in the
 *  middle (shell-api/provider-words.ts, the same words every provider screen uses). */
export const TERMS_POINTS = [
  // product decision, 5 Nov late: this is a beta, the first release (the UI lead's words)
  "First release. Use small amounts.",
  "You hold your keys. ZeroFee never has them, so it can't move your money or get it back for you.",
  "Payments can't be undone, and prices move.",
  SOFTWARE_LINE,
] as const;

/** What the agreeing tap says, beside its button (the two ticks before 1 Nov c, now one statement and one tap). */
/** Make your key's one short line (product decision, 2 Nov: the long statement was a wall); the terms' own "Who can use it" says the rest. */
export const TERMS_AGREE_SHORT = "By continuing, you agree to the terms. You're 18 or older and not in a sanctioned place.";

export const TERMS_AGREE = "By tapping below, you agree to the terms and confirm you're 18 or older, not in or from a sanctioned place, not on a sanctions list, and not using a VPN to get around this. You use ZeroFee at your own risk.";

/** The first view of the terms (UI-SIMPLICITY-RULES 2, 10; product decision, 2 Nov: a summary line, the legal text one tap
 *  down): one line of what matters most, then TERMS_AGREE_SHORT. TERMS_POINTS and TERMS_AGREE, word for word, are under
 *  "What you agree to", with the full terms. */
export const TERMS_SUMMARY = "A beta: use small amounts. You hold your keys, and payments can't be undone.";

/** The Beta section, first (product decision, 5 Nov late: "this is a beta version when they accept in the app"; the UI lead's
 *  words; the site's /legal/terms says the same four lines). */
export const TERMS_BETA = [
  "This is the first release. Use small amounts while you try it.",
  "ZeroFee holds no keys and no money, so it cannot get either back for you.",
  "Your funds, your backup words and any loss are your responsibility.",
  "The code comes with no warranty.",
] as const;

export const TERMS: { h: string; p: string }[] = [
  { h: "Beta", p: TERMS_BETA.join(" ") },
  {
    h: "What ZeroFee is",
    p: "ZeroFee is software that runs on your device. It connects you to public blockchains, such as NEAR, and to other companies' own services. It is not a bank, exchange, broker, payment service or custodian. It never holds your money, your keys or your identity.",
  },
  {
    h: "Your keys",
    p: "Your key is made on your device and stays there. Your 24 backup words are the only way to bring your account to a new device. If you lose your device and your words, nobody can get your money back. Not even ZeroFee. You are responsible for your device and your words.",
  },
  {
    h: "Payments are final",
    p: "Payments on a blockchain can't be undone. Check who and how much before you approve. Prices and fees move. Each price shows its limits, and anything not used comes back as that price says. Networks and partners can be slow, refuse a payment or stop working.",
  },
  {
    h: "Other companies and public networks",
    p: "Apps inside ZeroFee open public networks and other companies' own services. These are for things like buying with a card, cashing out or a payment card. Each company is independent. You sign up with it yourself, in its own screens, and you are its customer under its own terms, fees and ID checks. ZeroFee does not choose, rank or stand behind any of them. ZeroFee is not part of your agreement with them, and is not responsible for what they do.",
  },
  {
    h: "Who can use it",
    p: "You must be 18 or older. Don't use ZeroFee if you are in, or live in, a sanctioned or restricted place, such as Cuba, Iran, North Korea, Syria, or the Crimea, Donetsk or Luhansk regions of Ukraine. Don't use it if you are on any sanctions list, or if using it is against the law where you are. You will not use a VPN or anything else to get around these limits.",
  },
  {
    h: "Your responsibility",
    p: "You are responsible for following the laws and paying the taxes that apply to you. Privacy features are for lawful privacy, not for hiding crime. Nothing in ZeroFee is financial, investment, tax or legal advice.",
  },
  {
    h: "Risks",
    p: "Software can have bugs. Blockchains, the programs on them and the services that carry coins between them can fail. A coin carried over from another network is only as good as the service that carried it. Digital assets can lose all their value. Test networks hold no real value. ZeroFee's code is audited by SI agents, not by an outside audit firm.",
  },
  {
    h: "No guarantees, no liability",
    p: "We offer ZeroFee “as is”, with no warranties of any kind. As far as the law allows, ZeroFee and its contributors are not liable for any loss or damage from your use of it. You will cover any claims caused by your use of it.",
  },
  {
    h: "Disputes",
    p: "If you have a dispute with us, you agree to first try to settle it informally for 30 days. If that fails, final and binding arbitration settles it, one person at a time, not a court. Individual small-claims cases are the exception. You and we each give up any right to a jury trial and to a class, collective or representative action. If the law where you live gives you rights nobody can waive, this applies only as far as that law allows.",
  },
  {
    h: "Changes",
    p: "If these terms change in a way that matters, ZeroFee asks you to agree again before you go on.",
  },
];
