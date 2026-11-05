// Every Problem the Browser can produce, in one place. Each code is listed in packages/browser/errors.md, and a test checks.
//
// The words follow the three-part rule in @zerofee/core/problem: what happened, where the money is, the one next step.
// The Browser never says a site or a wallet is "safe", and never promises what a site will do. A site's own refusal
// reaches the person as one of these, never as the site's error text or a code.
import type { MoneyState, Problem } from "@zerofee/core/problem";

const nothingMoved: MoneyState = { state: "safe", where: "where it was" };
const inBrowserWallet: MoneyState = { state: "safe", where: "in Spending" };

export const browserProblems = {
  /** Make $10 ready on a test account (grade 02g, G7): Spending moves real money only, so its Top up can only refuse
   *  too. Said first, with what the test account can do, never a "Top up Spending" that leads to a second refusal. */
  readyTestAccount: (): Problem => ({
    code: "browser.ready.test-account",
    whatHappened: "This is a test account, so there's no real money to make ready.",
    money: { state: "safe", where: "in your Safe" },
    next: { kind: "nothing", label: "Go back" },
    more: "Spending and Top up work with real money only. You can still open the app and look around.",
  }),
  // Opening a site
  addressInvalid: (): Problem => ({
    code: "browser.address.invalid",
    whatHappened: "That doesn't look like a site's address.",
    money: nothingMoved,
    next: { kind: "fix-input", label: "Check the address", field: "address" },
    more: "A site's address looks like pump.fun or app.example.com.",
  }),
  addressInsecure: (host: string): Problem => ({
    code: "browser.address.insecure",
    whatHappened: `${host} isn't an https site, so ZeroFee won't open it.`,
    money: nothingMoved,
    next: { kind: "nothing", label: "Go back" },
    more: "ZeroFee opens https sites only. So no one in between can read or change the page.",
  }),
  siteUnreachable: (host: string): Problem => ({
    code: "browser.site.unreachable",
    whatHappened: `${host} didn't answer.`,
    money: nothingMoved,
    next: { kind: "retry", label: "Try again" },
    more: "Either the site is down, or this phone is offline.",
  }),
  siteBlocked: (host: string): Problem => ({
    code: "browser.site.blocked",
    whatHappened: `${host} won't open inside another app.`,
    money: nothingMoved,
    next: { kind: "open", label: "Open in Safari", screen: "safari" },
    more: "Some sites check which browser is visiting and turn some away. ZeroFee doesn't try to get around those checks.",
  }),
  siteWantsApp: (host: string): Problem => ({
    code: "browser.site.wants-app",
    whatHappened: `${host} asked for its own app. ZeroFee closed that. Carry on here.`,
    money: nothingMoved,
    next: { kind: "retry", label: "Show the desktop page" },
    more: "The desktop page is the same site, laid out for a computer. It can look small on a phone.",
  }),

  /** A site's Google sign-in inside ZeroFee's window: Google refuses sign-ins from app windows ("disallowed_useragent"). */
  googleBlocked: (host: string): Problem => ({
    code: "browser.site.google-blocked",
    whatHappened: `Google doesn't let you sign in to ${host} inside another app.`,
    money: nothingMoved,
    next: { kind: "retry", label: "Sign in with Apple instead" },
    more: "Google turns away sign-ins from app windows. On the sign-in screen, choose Continue with Apple.",
  }),

  /** fomo opens in its own app (Social trading and the Browser); neither the app nor its App Store page opened. */
  appDidntOpen: (name: string): Problem => ({
    code: "browser.social.app-didnt-open",
    whatHappened: `${name}'s app didn't open.`,
    money: nothingMoved,
    next: { kind: "retry", label: "Try again" },
    more: `If ${name} isn't on this phone, ZeroFee opens it in the App Store instead. Get the app there, then try again.`,
  }),

  socialFailed: (): Problem => ({
    code: "browser.social.failed",
    whatHappened: "That didn't go through.",
    money: { state: "safe", where: "where it was" },
    next: { kind: "retry", label: "Try again" },
    more: "Nothing moved. Check your connection, then try again.",
  }),
  // The wallet inside a site
  requestRefused: (host: string): Problem => ({
    code: "browser.request.refused",
    whatHappened: `${host} asked for a step ZeroFee can't show in plain words. So it said no.`,
    money: inBrowserWallet,
    next: { kind: "nothing", label: "Go back" },
    more: "ZeroFee never approves anything it can't show you first.",
  }),
  /** Ledger row 4 + rule 8 (phone test, 5 Nov): a site's sign-in the core's wallet refused. The copywriter's words; the
   *  money by its wallet's name (the screen says "Your money hasn't moved. It's in your {site} wallet."); `cause`: the
   *  core's own reason, under it ("pump.fun asked to sign you in again too soon. Try again in a minute."). */
  signInRefused: (site: string, cause?: string, agent = false): Problem => ({
    code: "browser.signin.refused",
    whatHappened: `Your ${site} sign-in didn't finish.`,
    // AgentZero's own window signs in with AgentZero's wallet, never the person's (ruling b): it names that one
    money: { state: "safe", where: agent ? "in AgentZero's wallet" : `in your ${site} wallet` },
    next: { kind: "nothing", label: `Back to ${site}` },
    ...(cause ? { more: cause } : {}),
  }),
  /** QA (rule 8): a sign-in text outside the core's allow-list (security.signin.unknown), on its own sheet,
   *  never a silent refusal. Words: the copy review, 5 Nov. */
  signInUnknown: (site: string, agent = false, cause?: string): Problem => ({
    code: "browser.signin.unknown",
    // the copy review's words, cut to the voice guard's bar (no "something", no 16-word sentence, no passive "is untouched")
    whatHappened: `${site} asked you to sign words that aren't a normal sign-in. ZeroFee didn't sign them.`,
    money: { state: "safe", where: agent ? "in AgentZero's wallet" : `still in your ${site} wallet` },
    next: { kind: "nothing", label: `Back to ${site}` },
    ...(cause ? { more: cause } : {}),
  }),
};

export type BrowserProblem = ReturnType<(typeof browserProblems)[keyof typeof browserProblems]>;
