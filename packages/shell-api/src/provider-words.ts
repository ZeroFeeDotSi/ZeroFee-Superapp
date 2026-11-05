// The product decision (26 Oct): ZeroFee is software, never in the middle. The person is each provider's own customer, and
// ZeroFee stands behind no one (no endorsement word anywhere, not even negated).
// Said the same way everywhere: the terms gate, and every screen
// that opens a provider (a card, a bank account, an exchange).

/** The terms gate's line. */
export const SOFTWARE_LINE = "ZeroFee is an app. Cards, banks and exchanges you open in it are other companies. You're their customer, and ZeroFee doesn't stand behind them.";

/** Under a provider's name, on every screen that opens one. */
export const providerLine = (name: string) => `${name} is its own company. You're its customer, not ZeroFee's. ZeroFee isn't in the middle. It only opens their page and sends your money.`;
