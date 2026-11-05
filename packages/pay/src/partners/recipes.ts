// Sign-up recipes (D29), in Security's schema A (backlog/security.md A, D, F): compiled into the app, every change
// reviewed by Security. A recipe is the only thing that picks a partner window's mode. It names the partner, its exact
// hosts (no wildcards), its modes, the chains and wallet for wallet mode, and for robot mode the profile slots it may
// fill, the login it may fill or create, and its commit buttons. Off its hosts the page gets the plain window.
//
// The steps are the Robot's guide (Agent drives it on the person's own key): what to expect on each screen, in the
// robot's own action words (fill a listed slot, select, check, click, wait, your turn, done; never navigate). Every
// step names its source and how sure it is: "official" (the partner's own help pages), "third-party" (a guide), or
// "unrecorded" (no public page shows it: recorded on the test first run, then this file is updated).
// Terms, codes, ID, selfies and anything that pays or confirms are always the person's turn (D5).

/** Profile slots a recipe may fill (E4): the person enters them once, on a native sheet; the page never sees the rest. */
export type ProfileSlot = "name" | "email" | "phone" | "address" | "dateOfBirth";
export type Mode = "wallet" | "robot";
export type YourTurn = "code-email" | "code-sms" | "terms" | "id-document" | "selfie" | "proof-of-address" | "questions" | "video-call" | "payment" | "wallet-sheet";

export interface RecipeStep {
  id: string;
  /** What happens, in the words the Robot shows the person. */
  say: string;
  /** The robot's action for this step (D4). "wallet" is wallet mode's native sheet, never the robot's. */
  act: "open" | "fill" | "select" | "click" | "wait" | "your-turn" | "wallet" | "read" | "done";
  /** The partner's own name for the screen. */
  at?: string;
  /** Placeholders for `fill`: only the recipe's own profile slots and login (D6). */
  fill?: ("profile.name" | "profile.email" | "profile.phone" | "profile.address" | "profile.dateOfBirth" | "login.username" | "login.password" | "login.new")[];
  turn?: YourTurn;
  /**
   * What to keep for Pay's tile. A HOST action, not the model's (Security's review): robot.js finds the value by this
   * kind's own pattern, hands it straight to Pay, and the person confirms it on Pay's screen. The model never sees it.
   *   card-address: 0x + 40 hex on the page, then card.check proves it's a Gnosis Pay Safe.
   *   iban: an IBAN whose ISO 13616 mod-97 check digits hold (codes/iban.ts readIban).
   */
  keep?: keyof typeof KEEP_PATTERNS;
  source: string;
  sure: "official" | "third-party" | "unrecorded";
}

/** The patterns behind `keep`: what robot.js looks for on the page. Checked again in Pay before anything is saved. */
export const KEEP_PATTERNS = {
  "card-address": /\b0x[0-9a-fA-F]{40}\b/,
  iban: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/,
} as const;

export interface Recipe {
  partner: "gnosis-pay" | "mt-pelerin";
  name: string;
  /** Exact hosts, as read natively from the top frame (A2). No wildcards, no paths. */
  hosts: readonly string[];
  /** The first page: always on one of `hosts`. */
  start: string;
  modes: readonly Mode[];
  /** Wallet mode: which wallet answers the partner and on which chains. The card's Safe owner is its own capped
   * "pay" wallet, never the Browser wallet (F1). */
  wallet?: { kind: "pay" | "browser"; chains: readonly string[] };
  /** Robot mode: what it may fill. */
  profile: readonly ProfileSlot[];
  /** The login it may fill or create, on exactly this host; null when the partner signs in without a password. */
  login: { host: string; may: "fill-or-create"; password: { min: number; classes: readonly ("lower" | "upper" | "digit" | "symbol")[] } } | null;
  /** Buttons the robot never presses (they pay, confirm or delete): the person taps (D5). Matched by their words. */
  commit: readonly string[];
  /** What the person ends up with, and which Pay tile it fills. */
  gives: string;
  tile: "card" | "bank";
  steps: readonly RecipeStep[];
}

export const RECIPES: readonly Recipe[] = [
  {
    partner: "gnosis-pay",
    name: "Gnosis Pay",
    hosts: ["app.gnosispay.com"],
    start: "https://app.gnosispay.com",
    modes: ["wallet", "robot"],
    // F: the card's own key (subwallet.create {kind:"pay", chain:"gnosis"}): it signs only Pay's own flows, built by the core.
    wallet: { kind: "pay", chains: ["gnosis"] },
    profile: ["email", "address"],
    // Gnosis Pay signs in with an email code and the wallet, not a password (help center).
    login: null,
    commit: ["Order", "Order card", "Pay", "Confirm order", "Confirm", "Delete account"],
    gives: "A Visa debit card on a Gnosis Chain account. Pay tops it up.",
    tile: "card",
    steps: [
      { id: "open", act: "open", say: "Opening Gnosis Pay inside ZeroFee.", source: "help.gnosispay.com: sign-up starts in the app (a phone test: gnosispay.com is the business page)", sure: "official" },
      { id: "email", act: "fill", at: "Sign up", fill: ["profile.email"], say: "Filling in your email.", source: "help center, 'Step-by-Step Guide to Ordering Your Gnosis Card': enter your email", sure: "official" },
      { id: "email-code", act: "your-turn", turn: "code-email", say: "Your turn: type the code Gnosis Pay emailed you.", source: "help center: verify your email with a one-time code", sure: "official" },
      { id: "terms", act: "your-turn", turn: "terms", say: "Your turn: read Gnosis Pay's terms and accept them if you agree.", source: "help center: accept the terms", sure: "official" },
      { id: "wallet", act: "wallet", turn: "wallet-sheet", say: "Gnosis Pay asks your card wallet to sign. ZeroFee can't do that step yet.", source: "third-party guides (gnosis.io hackers' guide, coinstancy): an EVM wallet on Gnosis Chain (chain 100) signs in and owns the Safe; when the Safe is made varies by source", sure: "third-party" },
      { id: "kyc", act: "your-turn", turn: "id-document", say: "Your turn: Gnosis Pay checks your ID with SumSub: your country, then an ID document.", source: "help center, 'Why KYC is Required': SumSub; choose country, upload an accepted ID, liveness check", sure: "official" },
      { id: "selfie", act: "your-turn", turn: "selfie", say: "Your turn: a short selfie video.", source: "help center: liveness check", sure: "official" },
      { id: "details", act: "fill", at: "Order your card", fill: ["profile.address"], say: "Filling in your shipping address. Type the rest on Gnosis Pay's page yourself.", source: "third-party summaries of the help center: confirm shipping address and an ENS name", sure: "third-party" },
      { id: "card-fee", act: "your-turn", turn: "payment", say: "Your turn: the card's fee, about 30 EURe from your card wallet. You see the exact amount on the sheet first.", source: "help center ordering guide: 30.23 EURe in your wallet on Gnosis Chain (often waived in promotions)", sure: "official" },
      { id: "ordered", act: "wait", say: "Card ordered. Gnosis Pay ships it; a virtual card may be ready sooner.", source: "help center: order confirmation and shipping", sure: "official" },
      { id: "safe", act: "read", keep: "card-address", at: "Account details", say: "Reading your card's address, then checking it's a Gnosis Pay account.", source: "help center, 'Understanding and Changing Your Gnosis Card Safe Owner': the Safe in account details", sure: "unrecorded" },
      { id: "done", act: "done", say: "Your card is on your home screen. Its first top-up is small until you say it arrived.", source: "Pay (FIRST_TOPUP_MAX)", sure: "official" },
    ],
  },
  {
    partner: "mt-pelerin",
    name: "Mt Pelerin",
    hosts: ["app.mtpelerin.com"],
    start: "https://app.mtpelerin.com",
    modes: ["wallet", "robot"],
    // Linking a wallet to the IBAN (receiving address): the Browser wallet answers on Base. Never the card's pay key (F1).
    wallet: { kind: "browser", chains: ["base"] },
    profile: ["email", "phone", "name", "address", "dateOfBirth"],
    login: { host: "app.mtpelerin.com", may: "fill-or-create", password: { min: 20, classes: ["lower", "upper", "digit", "symbol"] } },
    commit: ["Get your own IBAN", "Send funds", "Send", "Confirm", "Buy", "Sell", "Delete account"],
    gives: "Your own IBAN (EUR or CHF): add money, cash out, and pay bank bills.",
    tile: "bank",
    steps: [
      { id: "open", act: "open", say: "Opening Mt Pelerin inside ZeroFee.", source: "mtpelerin.com/support: go to app.mtpelerin.com or Bridge Wallet, create an account", sure: "official" },
      { id: "account", act: "fill", at: "Register", fill: ["profile.email", "login.new"], say: "Making your Mt Pelerin login. The password is saved in ZeroFee's password store before it's typed.", source: "the support page says 'create an account' without the method (email, phone or a wallet signature)", sure: "unrecorded" },
      { id: "code", act: "your-turn", turn: "code-sms", say: "Your turn: type the code Mt Pelerin sent you.", source: "mtpelerin.com/support: message signature or SMS code as its login methods", sure: "official" },
      { id: "terms", act: "your-turn", turn: "terms", say: "Your turn: read Mt Pelerin's terms and accept them if you agree.", source: "every regulated sign-up; the screen itself is unrecorded", sure: "unrecorded" },
      { id: "details", act: "fill", at: "Profile", fill: ["profile.name", "profile.dateOfBirth", "profile.address", "profile.phone"], say: "Filling in your details for Mt Pelerin's check.", source: "mtpelerin.com/support: personal and economical information", sure: "official" },
      { id: "kyc", act: "your-turn", turn: "id-document", say: "Your turn: an ID, proof of address and a selfie, in Mt Pelerin's own screens.", source: "mtpelerin.com/support: ID document, proof of address, selfie", sure: "official" },
      { id: "more-checks", act: "your-turn", turn: "questions", say: "Sometimes Mt Pelerin asks where your money comes from, or for a short recorded video call. That's theirs to ask.", source: "mtpelerin.com/support: origin-of-funds questions by email, or a ~10 min recorded call with compliance", sure: "official" },
      { id: "wallet", act: "wallet", turn: "wallet-sheet", say: "Mt Pelerin asks to link a wallet. ZeroFee can't do that step yet.", source: "mtpelerin.com/blog/personal-crypto-iban: connect and verify a wallet on the web interface, then pick it as the receiving address", sure: "official" },
      { id: "iban-options", act: "select", at: "Get your own IBAN", say: "Choosing euro, with USDC on Base as what arrives. You tap Get your own IBAN.", source: "personal-crypto-iban blog: choose currency, default blockchain, default crypto, receiving address", sure: "official" },
      { id: "iban-go", act: "your-turn", turn: "terms", say: "Your turn: tap Get your own IBAN. It's free.", source: "blog: 'Get your own IBAN' (a commit button: the person taps)", sure: "official" },
      { id: "read-iban", act: "read", keep: "iban", say: "Reading your new IBAN.", source: "the blog shows the IBAN in the app once made; where on the web page is unrecorded", sure: "unrecorded" },
      { id: "done", act: "done", say: "Your bank is on your home screen: add money, cash out, and pay bank bills from it.", source: "Pay (bank.ts)", sure: "official" },
    ],
  },
];

/** A partner's recipe, for the Robot and the partner window. */
export const recipeFor = (partner: Recipe["partner"]) => RECIPES.find((r) => r.partner === partner);
