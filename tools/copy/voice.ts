// The house style's checks (the house style), as code: the banned words with what to say instead, and the grade
// the copy audit gives each user-visible string. The guard test (voice.test.ts) fails on any banned word.

export interface Banned { re: RegExp; word: string; say: string }

/** The house style, section 5. Each is matched against one user-visible string at a time. */
export const BANNED: Banned[] = [
  { re: /\bfloat\b/i, word: "float", say: "Spending" },
  // D108 (QA 3 Nov): "Trading" is the pot's name ("Move $10.00 to Trading"); only the old two-word names stay banned
  { re: /\bTrading balance\b|\btrading wallets?\b/i, word: "Trading (the money)", say: "Trading" },
  { re: /\bmain balance\b|\bvault\b/i, word: "vault / main balance", say: "your Safe" },
  { re: /\breserve[sd]?\b/i, word: "reserve", say: "money kept back for network fees" },
  { re: /\b1Click\b/i, word: "1Click", say: "the swap service, or what it did" },
  { re: /\b(confidential )?intents\b(?!\.near)/i, word: "intents", say: "your Safe, or a private move" },
  { re: /\bnep\d{3}\b/i, word: "nep141", say: "the coin's name" },
  { re: /\brelay(er)?s?\b/i, word: "relay", say: "ZeroFee's message server, or what it does" },
  { re: /\bslots?\b/i, word: "slot", say: "wallet" },
  { re: /\bhot (root|keys?|wallets?)\b/i, word: "hot root / hot wallet", say: "your Spending wallets" },
  { re: /\breleases?\b/i, word: "release", say: "version of your account's rules" },
  { re: /\bbands?\b/i, word: "band", say: "rule, payments up to $500" },
  { re: /\bquotes?\b|\bquoted\b/i, word: "quote", say: "price" },
  { re: /\bsignatures?\b/i, word: "signature", say: "approve" },
  { re: /\btransactions?\b|\btxs?\b/i, word: "transaction", say: "payment, or what it does" },
  { re: /\bT?gas\b/i, word: "gas", say: "network fee" },
  { re: /\byocto|\bunits of\b/i, word: "yocto / units of", say: "the amount with its coin" },
  { re: /\bstorage deposit\b/i, word: "storage deposit", say: "a small amount the network holds (it comes back)" },
  { re: /\bfee allowance\b|\ballowance\b/i, word: "allowance", say: "the fees set aside for this device" },
  { re: /\bRPC\b|\bnodes?\b/i, word: "RPC / node", say: "the network, two separate network servers" },
  { re: /\bexplorer\b/i, word: "explorer", say: "the network's public record" },
  { re: /\bseed( phrase)?\b|\bmnemonic\b/i, word: "seed phrase", say: "backup words" },
  { re: /\bsessions?\b/i, word: "session", say: "permission to trade for 30 minutes" },
  { re: /\bexecut(e|es|ed|ing|ion)\b|\binitiat(e|es|ed|ing)\b|\bsubmit(s|ted|ting)?\b/i, word: "execute / initiate / submit", say: "send, pay, start, save" },
  { re: /^(invalid|failed|error|something went wrong)[.!]?$/i, word: "an error said alone", say: "what was wrong, where the money is, what to do" },
  { re: /\b(oops|uh-oh|whoops)\b/i, word: "oops", say: "(cut it)" },
  { re: /\bplease\b/i, word: "please", say: "(cut it)" },
  { re: /\bsimply\b|\bjust\b(?! now)|\beasy\b/i, word: "simply / just / easy", say: "(cut it)" },
  { re: /0\s?% from ZeroFee/i, word: "0% from ZeroFee", say: "Given away at ZeroFee." },
  { re: /\bweb ?app\b/i, word: "web app", say: "the web demo" },
  // Product decision, 5 Nov is a banned phrase; AgentZero's money is "AgentZero's wallet", a site's is "your pump.fun wallet"
  { re: /\bpocket[ -]money\b/i, word: "pocket money", say: "AgentZero's wallet, or the site's wallet by name" },
  { re: /\bApp Store\b/, word: "App Store (for Apps)", say: "Apps" },
  { re: /[A-Za-z)]!(\s|$)/, word: "exclamation mark", say: "a full stop" },
  // B28 R5 (product decision, 2 Nov): blame by name, the money line always. ZeroFee never says "we can't reach" or "we couldn't"
  // (it puts the fault on ZeroFee and names nothing), never "something went wrong", and never "the service that holds
  // your coins": no service holds them (D37).
  // D98 (product decision, 2 Nov): the app never asks for or shows a PERSON's name. A NEAR account, a coin, a site are named by
  // what they are ("your NEAR account", "Your account isn't on the public chain.").
  { re: /\byour (full |legal |real )?name\b/i, word: "your name (a person's name)", say: "your account, or what people see" },
  // D111 + D108 (QA, 3 Nov): the app's word for confidential is "Hidden"; "confidential" is never on screen (the README,
  // which isn't app copy, says "a NEAR confidential wallet for every chain")
  // Product decision, 5 Nov (a job names the protocol doing the work): the protocol's own name, "NEAR Confidential",
  // is a name and may be on screen; the plain word stays "Hidden"
  { re: /(?<!\bNEAR )\b[Cc]onfidential(ly)?\b|\bNEAR confidential(ly)?\b|\bCONFIDENTIAL/, word: "confidential", say: "Hidden" },
  { re: /\bwe can[’']t reach\b|\bwe couldn[’']t\b|\bsomething went wrong\b|\bthe service that holds\b/i, word: "we can't reach / we couldn't / something went wrong / the service that holds", say: "who failed, by name (NEAR, 1Click, NEAR Intents' bridge, Solana), then where the money is" },
];

const SERVICES = "(?:1Click|NEAR Intents(?:'s?)?(?: bridge)?|Helius|GeckoTerminal|NEAR AI Cloud)";
const FAILED = "(?:isn't answering|is down|didn't answer|refused|said no|doesn't know|didn't confirm|gave no|gave nothing to approve|sent nothing|isn't the one asked for|didn't take it|didn't take this move|didn't give a safe price|didn't accept|is still finishing|couldn't fill|doesn't trade|doesn't name|priced [A-Za-z0-9{}$._-]+ too far)";
/** D88: the service as the subject, straight before what failed ("1Click isn't answering"). Never "We can't reach 1Click"
 *  (B28 R5) nor marketing ("1Click can't see what you buy"). It lifts only the service-name bans: the rest still apply. */
export const SERVICE_ERROR = new RegExp(`\\b${SERVICES}(?:'s price)? ${FAILED}\\b`);
const SERVICE_WORDS = new Set(["1Click", "intents"]);
/** Product decision, 5 Nov (mandatory protocols; zero fee: every money screen says who is paid, directly, the protocol): the protocol
 *  by name as the one doing the work or being paid ("1Click prices it.", "NEAR Intents doesn't swap one of these coins.",
 *  "Paid to NEAR Intents' solver directly."), or the name alone (a label). Never marketing ("Swap with 1Click today."): it lifts only the service-name bans. */
export const PROTOCOL_ROLE = new RegExp(`\\b${SERVICES}(?:'s? (?:fee|price|solver|bridge))? (?:prices|priced|swaps|doesn't swap|moves|settles|charges|takes|signs|didn't sign|sent a different)\\b|\\b(?:[Pp]aid|[Pp]ays|[Tt]hrough|[Gg]oes) (?:to |straight to |directly to )?${SERVICES}\\b|\\bNEAR Intents and the network keep\\b|^(?:1Click|NEAR Intents)$`);

/** Strings that may keep a banned word, each with its reason (The house style, section 5: only where it is defined in plain words
 *  or is a name the person must see). Matched on the file and the text. */
export const ALLOWED: { file: RegExp; text: RegExp; why: string }[] = [
  // D88 (copy pass, 3 Nov): the waiting-rules line names 1Click as the cause of the stop (its price lasts minutes).
  { file: /packages\/core\/src\/security-problems\.ts$/, text: /but 1Click's price lasts only minutes\. So it stopped\./, why: "D88: the cause, by name" },
  // Apple's own store, where the iPhone app updates (D57): a real name, not our Apps.
  { file: /./, text: /through the App Store|from the App Store|in the App Store|coming to the App Store/, why: "Apple's App Store, where the app updates (and, on the web wallet's top note, where the phone app is coming)" },
  // The product's words for the locked Perps tile (5 Nov, the site's wording, no venue named): D111's "Hidden" gives way here only.
  { file: /apps\/web\/src\/shell\/locked-apps\.tsx$/, text: /^Confidential perps\. Trade with leverage, in private\.$/, why: "the product's own words for the locked Perps tile (5 Nov)" },
  // The product beta note in the terms (5 Nov late): "first release" means this first version of ZeroFee, not a contract
  // release; only these two lines in terms.ts.
  { file: /apps\/web\/src\/terms\.ts$/, text: /^First release\. Use small amounts\.$|^This is the first release\. Use small amounts while you try it\.$/, why: "the product beta note: ZeroFee's first version (5 Nov)" },
  // A bug report line for ZeroFee, shown behind Details: the code is the point of it.
  { file: /./, text: /^Details for ZeroFee/, why: "bug-report line, by design" },
  // Key-derivation constants (BIP32's "Bitcoin seed", the Spending wallets' passphrase): bytes that make keys, never shown.
  // A held payment's reason code in the web demo (compared in code: why === "change"), never shown.
  { file: /packages\/shell-api\/src\/MockBridge\.ts$/, text: /^band$/, why: "an internal reason code" },
  { file: /packages\/core\/src\/hot-keys\.ts$/, text: /^(ZeroFee hot wallets v1|Bitcoin seed)$/, why: "key-derivation constants, never shown" },
  // B28 R5 (product decision, 2 Nov): a service that fails is named by its own name, in one
  // place (core services.ts); every line that names it fills it in from there.
  { file: /packages\/core\/src\/services\.ts$/, text: /^(NEAR Intents|NEAR Intents' bridge)$/, why: "a failing service, by the name people can look up" },
  // S21 (the copy review's words, 5 Nov): a move home NEAR Intents says is done that the Safe's read hasn't shown yet: who said it, by name.
  { file: /packages\/core\/src\/float-moves\.ts$/, text: /^NEAR Intents says it's done\. Your Safe hasn't shown it yet\. Pull down on Home to check\.$/, why: "the copy review's words: who says it's done, by name, the whole sentence only (S21)" },
  // Product decision (5 Nov, Jobs "they" voice): a job's steps name the protocol doing the work, from this one table.
  { file: /packages\/shell-api\/src\/job-steps\.ts$/, text: /^NEAR Intents$/, why: "Jobs name the protocol doing the work (product decision, 5 Nov)" },
  // the audit's privacy ruling (5 Nov): PRIVATE_SEEN names who sees every payment, by the name people can look up; never "private from everyone".
  { file: /packages\/wallet\/src\/app\/format\.ts$/, text: /^Private from the public, except the money going in and coming out\. NEAR Intents sees every payment\.$/, why: "the honest privacy line names who sees, the whole sentence only (audit)" },
  // Send's NEAR line (build, 5 Nov): a balance held in NEAR Intents lands as wNEAR; the product's name is how that form is told.
  { file: /packages\/wallet\/src\/send-reach\.ts$/, text: /^Lands as wNEAR, the NEAR Intents form of NEAR\.$/, why: "names the form wNEAR is, by the product's own name, the whole sentence only" },
  // D98 (QA): AgentZero's receipt for a Chat request it paid privately names the route people can look up, once.
  { file: /packages\/chat\/src\/agentzero\.ts$/, text: /^Paid \$(?:\{[^}]*\}|[\d.]+) to (?:\{[^}]*\}|\S+) through NEAR Intents\. Only the middle of the payment is hidden\.$/, why: "D98's receipt: the route's own name, the whole sentence only (privacy audit, 4 Nov: only the middle is hidden)" },
];

export function bannedIn(file: string, text: string): Banned[] {
  if (ALLOWED.some((a) => a.file.test(file) && a.text.test(text))) return [];
  const words = text.replace(/\{[^}]*\}/g, " "); // what code fills in isn't the string's own words
  const lifted = SERVICE_ERROR.test(text) || PROTOCOL_ROLE.test(text) ? SERVICE_WORDS : new Set<string>();
  return BANNED.filter((b) => b.re.test(words) && !lifted.has(b.word));
}

const PASSIVE = /(?<!\bnothing\s)\b(is|are|was|were|been|being|be|get|gets|got)\s+(\w+ed|made|sent|kept|held|done|taken|given|shown|paid|seen|known|set|built|read|told|put|left|lost|stolen|written|run|spent|found|brought|drawn|frozen)\b(?!\s+(up|in|on|off|out))/i;
const VAGUE = /\bsomething\b|\bsome (issue|problem|thing)s?\b|\bthings?\b|\bstuff\b|\ba while\b|\bmay\b|\bmight\b|\bissue\b|\bcertain\b|\betc\b/i;
// FLOW-V4 (D106): "Trading" is Home's word for the money outside the Safe ("Safe $X · Hidden $Z · Trading $Y"), so it is
// no longer another name for it
const OTHER_NAMES = /\b[Yy]our balance\b|\b[Yy]our account's balance\b|\bPrivate wallets?\b|\b[Tt]he app store\b/;
/** The money outside the Safe has one name per screen: "Trading" (FLOW-V4's Home) or, where V4 hasn't reached yet,
 *  "Spending". One line, or one screen's lines (onePot), never both (review 3 Nov, L11). */
const TWO_POT_NAMES = [/\bTrading\b/, /\bSpending\b/];
export function onePot(lines: readonly string[]): string[] {
  const has = TWO_POT_NAMES.map((re) => lines.filter((l) => re.test(l)));
  return has.every((xs) => xs.length > 0) ? [...has[0]!, ...has[1]!] : [];
}
/** Internals product decision (2 Nov): how the rules work inside, never what happens to the money. */
const INTERNALS = /\bcounted every coin\b|\bcount(s|ed)? every coin\b|\bhash\b|\bon[ -]chain\b|\bcontract\b|\bledger\b|\bengine\b|\bthe core\b|\bdecimals\b|\bbytes\b|\bprotocol\b|\brequest #|\bmt_|\bft_|\bwrap\.near\b|\bwNEAR\b|\bdeposit address\b|\bsha-?256\b|\bpost-quantum\b|\brules? (was|were) saved\b/i;
const VAGUE_BUTTON = /^(OK|Ok|Okay|Continue|Submit|Next|Proceed|Confirm|Yes|No)$/;

export interface Graded { grade: "A" | "B" | "C" | "D" | "F"; problems: string[] }

/** The audit's grade for one string: F banned word or raw id, D passive / other name / sentence over 25 words, C vague /
 *  over 40 words / a label that isn't a verb, B a sentence of 16-25 words, else A. */
export function grade(file: string, text: string): Graded {
  const words = text.replace(/\{[^}]*\}/g, "X");
  const problems: string[] = [];
  let g: Graded["grade"] = "A";
  const worse = (to: Graded["grade"], why: string) => {
    problems.push(why);
    if ("ABCDF".indexOf(to) > "ABCDF".indexOf(g)) g = to;
  };
  for (const b of bannedIn(file, text)) worse("F", `jargon "${b.word}" (say: ${b.say})`);
  if (/\bnep141:|[0-9a-f]{40,}|\b\d+ units of\b/i.test(words)) worse("F", "raw coin id or units");
  if (OTHER_NAMES.test(words)) worse("D", `inconsistent name "${words.match(OTHER_NAMES)![0]}" (Safe / Hidden / Trading)`);
  if (TWO_POT_NAMES.every((re) => re.test(words))) worse("D", "two names for one pot (Trading and Spending)");
  if (INTERNALS.test(words)) worse("D", `internals "${words.match(INTERNALS)![0]}"`);
  if (PASSIVE.test(words)) worse("D", `passive "${words.match(PASSIVE)![0]}"`);
  const sentences = words.split(/(?<=[.?!:])\s+/).map((s) => s.split(/\s+/).filter(Boolean).length);
  const longest = Math.max(0, ...sentences);
  const total = words.split(/\s+/).filter(Boolean).length;
  if (longest > 20) worse("D", `too long: a ${longest}-word sentence`);
  else if (longest > 12) worse("B", `long-ish: a ${longest}-word sentence`);
  if (total > 40) worse("C", `too long: ${total} words`);
  if (VAGUE.test(words)) worse("C", `vague "${words.match(VAGUE)![0]}"`);
  if (VAGUE_BUTTON.test(words.trim())) worse("C", `label "${words.trim()}" doesn't say what happens`);
  return { grade: g, problems };
}

/**
 * D111 (QA, 3 Nov): NEAR is a chain among chains, never the theme. On screen it appears only as the NEAR row ("NEAR"), in
 * "Your NEAR account keeps these rules.", and in a true cause line ("NEAR is down."). True when a string says NEAR
 * anywhere else. REPORT-ONLY until the copy pass reaches each package (voice.test.ts prints the count; it never fails).
 */
const NEAR_ALLOWED = [/^NEAR$/, /^Your NEAR account keeps these rules\.$/, /^NEAR (?:is down|isn't answering|didn't answer|is slow right now|refused|said no)\b/];
export function nearOffRow(text: string): boolean {
  const t = text.trim();
  // a coin amount ("{n} NEAR", "1.18 NEAR") is the NEAR coin on its row, not NEAR as the theme
  const words = t.replace(/(?:\{[^}]*\}|\d[\d,.]*) NEAR\b/g, " ").replace(/\{[^}]*\}/g, " ");
  return /\bNEAR\b/.test(words) && !NEAR_ALLOWED.some((re) => re.test(t));
}
