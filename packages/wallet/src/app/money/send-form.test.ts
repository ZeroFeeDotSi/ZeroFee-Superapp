// V4 Send's form (FLOW-V4 §1, H5, H7, B35): the order above the keyboard, the cap, the demo's Hidden balance, the top line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { OVER_MAX_TAP, coinShown, overLine, overMax, underAmount } from "./send-cap.ts";
import { homePots } from "../format.ts";
import { RELAY_LIMIT_LINE, RELAY_SEND_MAX_USD } from "../../send-to.ts";
import { walletProblems } from "../../wallet-problems.ts";

test("finding 64: a typed number over what the coin can send stays as typed, Hold stays off and the line says the most; Max sends it (control: all of it, or less, is not over)", () => {
  assert.equal(overMax("50", "42.1"), true);
  assert.equal(overMax("6944.444444444", "1.42"), true, "the tester's 999999 dollars of SOL");
  assert.equal(overMax("42.1", "42.1"), false, "control: exactly all is not over");
  assert.equal(overMax("10.55", "42.1"), false);
  assert.equal(overMax("abc", "42.1"), false);
  assert.equal(overLine("your SOL wallet", "$144.27"), "You can send at most $144.27 from your SOL wallet.");
  // S1 (QA's ledger re-walk, 6 Nov): the line names the next tap while Max can set something (control: none, no tap)
  assert.equal(overLine("your ETH (RH) wallet", "$27.93", true), "You can send at most $27.93 from your ETH (RH) wallet. Tap Max to send that.");
  assert.equal(OVER_MAX_TAP, "Tap Max to send that.");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const type = form.slice(form.indexOf("const type = (v: string)"), form.indexOf("const slide = "));
  // the copy review's ruling (5 Nov): a Send from Private alone caps at Private's figure, and says so (send-private-cap.test.ts)
  const notPrivate = type.split("\n").filter((l) => !/privateCap|if \(cap\)|Send from Private/.test(l)).join("\n");
  assert.doesNotMatch(notPrivate, /max|setTyped\(null\)/, "typing never turns into the whole balance, nor drops what was typed");
  assert.match(type, /source\.privateOnly \? privateCap\(/, "control: the cap is only a Send from Private's");
  assert.match(form, /: waits \? waits\s*(: amountNo \? amountNo\s*)?: over \? overLine\(source\.place, most, Number\(max\) > 0\)/, "said before any other reason, once something is typed");
  assert.match(form, /if \(typed === null && Number\(amount\) > Number\(max\)\)/, "a new source caps only what wasn't typed (Max)");
  assert.match(form, /onClick=\{\(\) => \{ setPreset\(true\); slide\(STEPS\); \}\} data-testid="send-max"/, "Max is the way to all of it");
});

test("Send's coin figures have at most 4 decimals (COIN_SHOWN_DECIMALS): what leaves rounds UP, what is held rounds DOWN (control: 4 or fewer stay as they are)", async () => {
  const { COIN_SHOWN_DECIMALS } = await import("@zerofee/core/add-outside");
  assert.equal(COIN_SHOWN_DECIMALS, 4);
  assert.equal(coinShown("0.049179", "up"), "0.0492", "the walk's line: never says less leaves than does");
  assert.equal(coinShown("0.049179", "down"), "0.0491", "held: never says more is there");
  assert.equal(coinShown("0.04910001", "up"), "0.0492", "any leftover past 4 places rounds up");
  assert.equal(coinShown("1234.56789", "down"), "1,234.5678");
  assert.equal(coinShown("0.99999", "up"), "1");
  assert.equal(coinShown("1e-7", "up"), "0.0001", "a figure written with an exponent still reads");
  for (const x of ["1.42", "0.0492", "4.819", "12", "0"]) for (const dir of ["up", "down"] as const) assert.equal(coinShown(x, dir), x, `control: ${x} ${dir}`);
  for (let i = 0; i < 2000; i++) {
    const x = (Math.random() * 50).toFixed(9);
    const up = coinShown(x, "up"), down = coinShown(x, "down");
    for (const s of [up, down]) assert.ok(!/\.\d{5,}/.test(s), `${x}: ${s} has at most 4 decimals`);
    assert.ok(Number(up.replace(/,/g, "")) >= Number(x) && Number(down.replace(/,/g, "")) <= Number(x), `${x}: up ${up} at or over, down ${down} at or under`);
  }
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  // the line under the amount (the auditor's ruling, 5 Nov): rounded as the sheet rounds it (send-coin-said.test.ts)
  // changed pin (S1, 6 Nov): the line is underAmount's (send-cap.ts), as behaviour
  assert.equal(underAmount({ over: false, exact: null, amount: "1.128653627", symbol: "NEAR", place: "your Safe", maxLine: null }).coins, "1.1286 NEAR from your Safe", "the line under the amount: as the sheet says it, down");
  // S3: the From line is send-cap.ts heldWords (a Safe coin says "$8.85 ready to send"); a site's wallet its own line; a wallet's as before
  assert.match(form, /const heldNow = \(s: SendSource\) => s\.line \?\? heldWords\(\{ \.\.\.s, max: sendable\(s, decOf\(s\)\) \}\);/);
  assert.match(readFileSync(new URL("./send-cap.ts", import.meta.url), "utf8"), /(?::|return) `\$\{coinShown\(s\.amount, "down"\)\} \$\{s\.symbol\}/, "what a wallet holds, down");
  assert.doesNotMatch(form, /maximumFractionDigits: 6|round\(amount, Math\.min\(places, 6\)/, "control: the old 6-place figures are gone");
});

test("the form's order, top to bottom (the design review §4.5, the Buy pattern; was the Home plan §1.3's slider): From (one dropdown), To, Which network?, dollars, the chips ending in Max, the keypad, the one line, Hold to send; no sideways coin bar, no Hidden / Plain", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const at = (re: RegExp) => { const m = re.exec(form); assert.ok(m, String(re)); return m!.index; };
  const order = [at(/data-testid="send-from"/), at(/aria-label="Who to send to"/), at(/data-testid="send-where"/), at(/"send-route"/), at(/aria-label="Which network\?"/), at(/data-testid="send-amount"/), at(/data-testid="send-max"/), at(/<Keypad /), at(/data-testid="send-go"/)];   // a16: the network line is in the card, under the payee
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(form, /aria-haspopup="listbox"/, "From is one small dropdown");
  assert.doesNotMatch(form, /overflowX|data-testid="send-coins"|\{toggle\}|type="range"/, "control: no sideways chip bar, no mode toggle, no range slider");
  assert.match(form, /onClick=\{\(\) => \{ setPreset\(true\); slide\(STEPS\); \}\} data-testid="send-max"/, "Max is what the coin can send, never more (the slider's old top)");
  assert.match(form, /inputMode="none"/, "the keypad types; the phone's keyboard never slides over the screen");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /<SendForm /);
});

test("Send's top line in Home's words (home/words): Safe (the pocket's money under it, D128) · Wallets; never Hidden, Trading or Spending", () => {
  const host = readFileSync(new URL("./MoneyHost.tsx", import.meta.url), "utf8");
  const line = host.split("\n").find((l) => l.includes('ask.kind === "send"'))!;
  assert.match(line, /pots=\{homePots\(\{ safeUsd: safeOwn, pocket, trading, tradingPartial, spending: spending !== null \}\)\}/);
  assert.doesNotMatch(line, /Spending|potsOf/);
  const pocket = (usd: string) => ({ available: true, ready: true, defaultOn: false, rows: [{ tokenId: "u", symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: usd, usd, bridged: false, listed: true }] });
  const said = (p: ReturnType<typeof homePots>) => p.map((x) => `${x.name} ${x.usd}`).join(" · ");
  assert.equal(said(homePots({ safeUsd: "5254.15", pocket: pocket("33.86") as never, trading: "172.54", tradingPartial: false, spending: true })), "Safe $5,288.01 · Wallets $172.54", "$5,254.15 + the pocket's $33.86 under the Safe, as Home counts it");
  assert.equal(said(homePots({ safeUsd: "5254.15", pocket: pocket("0") as never, trading: "172.54", tradingPartial: false, spending: true })), "Safe $5,254.15 · Wallets $172.54", "control: an empty pocket adds nothing");
  assert.equal(said(homePots({ safeUsd: "5254.15", pocket: null, trading: "172.54", tradingPartial: true, spending: true })), "Safe $5,254.15 · Wallets updating…", "a part unread: never a short figure");
  for (const p of [homePots({ safeUsd: "1", pocket: pocket("5") as never, trading: "1", tradingPartial: false, spending: true })]) assert.ok(!p.some((x) => /Hidden|Trading|Spending/.test(x.name)), "the old words are gone");
  const home = readFileSync(new URL("../screens/Home.tsx", import.meta.url), "utf8");
  // D128: Home itself names no Hidden any more (no figure, line or row); its money counts under the Safe
  assert.doesNotMatch(home, /<span> · Hidden|>Hidden</, "Home says no Hidden");
});

test("the web demo's sample account starts with Hidden set up and holding money; any other bridge doesn't (control)", async () => {
  const demo = createMockBridge({ latencyMs: 0, hiddenStart: { usdc: "25", near: "2" } });
  const r = await demo.call<{ ready: boolean; rows: { symbol: string; amount: string; held?: string }[] }>("ledger.private");
  assert.ok("ok" in r);
  assert.equal(r.ok.ready, true);
  assert.deepEqual(r.ok.rows.map((x) => [x.symbol, x.amount, x.held]), [["USDC", "25", "private"], ["NEAR", "2", "private"]]);
  const plain = createMockBridge({ latencyMs: 0 });
  const p = await plain.call<{ ready: boolean; rows: unknown[] }>("ledger.private");
  assert.ok("ok" in p);
  assert.deepEqual([p.ok.ready, p.ok.rows.length], [false, 0], "a bridge without the option starts with no Hidden");
  const screens = readFileSync(new URL("../../../../../apps/web/src/gallery/Screens.tsx", import.meta.url), "utf8");
  assert.match(screens, /const HIDDEN_START = \{ usdc: "25", near: "2" \};\nexport const demoBridge = createMockBridge\(\{[^\n]*\n  hiddenStart: HIDDEN_START,/, "only the web demo passes it");
});

test("review fixes: a stale lookup can't set who; a link's recipient passes Send's reach; a link's amount only in its own coin; a NEAR name's lookup alone is NEAR's (bug 8)", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const effect = form.slice(form.indexOf("const seq = useRef(0);"));
  assert.ok(effect.indexOf("const n = ++seq.current;") < effect.indexOf("return;"), "seq moves before any return");
  assert.match(form, /const no = cantSendTo\(r, chainName\);\n\s+if \(no\) return setLine\(refusedLine\(no, [^\n]*TAP_ADDRESS\)\);\n\s+setWho\(\{ recipient: r \}\);/);
  assert.match(form, /setExact\(\{ tokenId: coin\.assetId, amount: wanted, symbol: coin\.symbol \}\);/);
  assert.doesNotMatch(form, /setAmount\(prefill\.amount\)|setAmount\(wanted\)/, "control: never the link's number as another coin's");
  // SendForm:100 said "NEAR didn't answer" for any failure, a Solana address's too: only a NEAR name is looked up on NEAR
  assert.match(form, /isNamedNearAccount\(t\.toLowerCase\(\)\) \? refusedLine\("NEAR didn't answer"[^\n]*: refusedLine\("That address can't be read"/);
  assert.doesNotMatch(form, /NEAR didn't answer\. Check the address/, "control: the old blanket line is gone");
});

test("every disabled Hold says why, the first that applies; the relay's own limit is named; the line and the button agree", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  for (const why of ['"Paste an address or a name."', "LOOKALIKE_LINE", '"Pick the network first."', '"Pick how much."', "RELAY_LIMIT_LINE", "waits ? waits"]) assert.ok(form.includes(why), why);
  // a19d97be's Sim crawl (4 Nov, 03-send-3.png): `waits ? null` left Hold off with no line when the sheet had none
  assert.ok(!form.includes("waits ? null"), "a waiting Send says why under Hold too");
  assert.match(form, /const ready = !!source && !!who && !!network && !why && !waits && !busy/, "Hold is on only when no reason stands");
  assert.equal(RELAY_LIMIT_LINE, "ZeroFee's price server takes up to $10,000 a send.");
  // security review L6: the form's figure is the relay's own (relay.mjs POCKET_USD), so a raised relay never leaves it stopping lower
  const relay = readFileSync(new URL("../../../../../apps/quotes/relay.mjs", import.meta.url), "utf8");
  assert.equal(Number(/^const POCKET_USD = ([\d_]+);/m.exec(relay)?.[1]?.replace(/_/g, "")), RELAY_SEND_MAX_USD);
  assert.equal(walletProblems.relayLimit().whatHappened, `${RELAY_LIMIT_LINE} Nothing was sent.`, "the ledger's line with no figure said is the same");
  assert.doesNotMatch(readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8"), /> 100\b|\$100/, "control: no $100 left in the form");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const waits = services\.down \? services\.line : null;/, "Hold waits only when the line says it waits (down on two sources, or offline)");
  assert.match(sheet, /<SheetLine text=\{line \?\? services\.line\} \/>/, "said once, at the top of the sheet");
  assert.match(form, /!why && !waits && !busy/, "and Hold is off while it waits");
});

test("security review M1: a new 0x address starts on no network, whatever coin it comes from; a known one on the network it was paid on; the exchange line is said for a new one", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /startNetwork\(networks, who \? paidOn\(/, "the start comes from where this address was paid before");
  assert.doesNotMatch(form, /startNetwork\(networks, source/, "control: never from the coin's own chain");
  assert.match(form, /isNew && <p className="zf-small" data-testid="send-exchange">\{EXCHANGE_LINE\}<\/p>/, "a new address hears that exchanges take one network");
});

test("D125: Home's Send is on only in the test build (VITE_HOME_PROOF=1); off, one line and Close with the money line, nothing asked of the core (control: on, the Send sheet itself)", async () => {
  const { SEND_PROOF_OFF, homeProof } = await import("./home-proof.ts");
  assert.equal(SEND_PROOF_OFF, "Send opens after its first real test.");
  assert.equal(homeProof(), false, "a test run (no build flag): off");
  assert.equal(homeProof({ VITE_HOME_PROOF: "1" }), true, "control: the test build");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const entry = sheet.slice(sheet.indexOf("export function SendSheet("), sheet.indexOf("function SendBody("));
  assert.match(entry, /proof = homeProof\(\)/, "the build's flag by default");
  const off = entry.slice(entry.indexOf("if (!proof)"), entry.indexOf("return <PayProvider"));
  assert.match(off, /^if \(!proof\) return <MoneySheet title="Send" pots=\{pots\} onClose=[^]*\{SEND_PROOF_OFF\}<\/p><\/MoneySheet>;/, "off: the money line and the one line; the corner's Close is the way out");
  assert.doesNotMatch(off, /<button/, "control: no second Close (product decision, 3 Nov)");
  assert.doesNotMatch(off, /bridge\.call|ledger\.|subwallet\.|SendBody|SendForm/, "off: nothing asked of the core, no way to send");
  assert.match(entry, /return <PayProvider bridge=\{bridge\}><SendBody /, "control: on, the Send sheet");
  const fault = readFileSync(new URL("../../../../../apps/web/src/shell/never-blocked.test.ts", import.meta.url), "utf8");
  assert.match(fault, /process\.env\.VITE_HOME_PROOF = "1";\n\s*server = await createServer\(/, "the fault suite runs the test build, so the on sheet keeps its outage checks");
});

test("the review's walk: (1) Send from a wallet's tab opens From on that wallet, end to end; (4) every sheet's Safe figure is Home's, the private balance counted under it (control: Send's top line never counts it twice)", () => {
  const app = readFileSync(new URL("../WalletApp.tsx", import.meta.url), "utf8");
  const money = readFileSync(new URL("../../../../shell-api/src/money.ts", import.meta.url), "utf8");
  const home = readFileSync(new URL("../screens/Home.tsx", import.meta.url), "utf8");
  const host = readFileSync(new URL("./MoneyHost.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(home, /\{ word: "Send", icon: <ActSend \/>, on: \(\) => a\.onSend\(wallet\) \}/, "Home's tab hands its wallet");
  assert.match(app, /const send = \(wallet\?: unknown\) => shell\.openMoney\(\{ kind: "send", \.\.\.\(typeof wallet === "string" \? \{ wallet \} : \{\}\) \}/, "WalletApp passes it on");
  assert.match(money, /\{ kind: "send"; link\?: string; [^}]*wallet\?: string;/, "the send ask carries it");
  assert.match(host, /<SendLater link=\{ask\.link\} wallet=\{ask\.wallet\}/, "MoneyHost hands it to Send");
  assert.match(sheet, /start=\{startSource\(wallet, sources, coin\)\}/, "and From opens on it");
  const homeSafe = /safeLines\(balances!?, pocket, chains, earning\)/;
  assert.match(home, homeSafe, "Home's Safe: its coins and the private balance's");
  assert.match(host, /const safeUsd = balances \? safeLines\(balances, pocket, chains, earning\)\.totalUsd : null;/, "every sheet's Safe is the same sum");
  assert.match(host, /<MoveSheet status=\{status\} safeUsd=\{safeUsd\}/, "Move's too");
  assert.match(host, /pots=\{homePots\(\{ safeUsd: safeOwn, pocket,/, "Send's top line adds the private balance once, itself");
  assert.doesNotMatch(host, /homePots\(\{ safeUsd, pocket/, "control: never the private balance twice");
});

test("the amount line says where the coin is: \"0.5 SOL from your SOL wallet\", \"12 USDC in your Safe\" (control: never \"in your USDC in your Safe\")", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.equal(underAmount({ over: false, exact: null, amount: "0.5", symbol: "SOL", place: "your SOL wallet", maxLine: null }).coins, "0.5 SOL from your SOL wallet", "changed pin: behaviour, not source");
  // R3 (the design review §4.5, say it once): before anything is typed there is no line; the From row says what it holds
  assert.doesNotMatch(form, /\$\{held\(source\)\} in \$\{source\.place\}`/, "control: never the balance a second time under the chips");
  assert.equal(underAmount({ over: false, exact: null, amount: "0", symbol: "SOL", place: "your SOL wallet", maxLine: null }).coins, null, "nothing typed, no line (changed pin)");
  assert.match(form, /: under\.coins && <p className="zf-small wl-send2__coins"/);
  assert.match(form, /<span className="zf-small">\{heldNow\(source\)\}<\/span>/, "the From row's balance, once");
  assert.doesNotMatch(form, /your \$\{source\.label\}/, "control: the dropdown's words never sit inside the line");
});

test("speed (D145): a pasted address is read at once; typing still waits for a pause (control: one key at a time waits)", async () => {
  const { lookupDelayMs, TYPING_PAUSE_MS } = await import("./send-lookup.ts");
  assert.equal(lookupDelayMs("", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), 0, "a paste into an empty To");
  assert.equal(lookupDelayMs("", "0x7D06e272b5305a4b9D40e872C7950D3437547e3D"), 0);
  assert.equal(lookupDelayMs("bob", "bob.near.x"), 0, "a paste after a few letters");
  assert.equal(lookupDelayMs("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAs", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), TYPING_PAUSE_MS, "control: one key typed waits");
  assert.equal(lookupDelayMs("bo", "bob"), TYPING_PAUSE_MS, "control: typing");
  assert.equal(lookupDelayMs("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", ""), TYPING_PAUSE_MS, "control: clearing");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /const wait = lookupDelayMs\(lastText\.current, text\)/, "the form asks how long to wait");
  assert.match(form, /if \(wait === 0\) return look\(\);/, "and reads a paste at once");
  assert.doesNotMatch(form, /\}, 300\);/, "control: the fixed 300 ms wait is gone");
});

test("speed (D145): the guard's facts are asked for when To is read, and Hold uses them (control: another address, or old facts, are asked again)", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(form, /useEffect\(\(\) => \{ onWho\?\.\(who\?\.recipient \?\? null\); \}, \[who\]\);/, "the form says who To reads as, as soon as it does");
  assert.match(sheet, /onWho=\{knowWho\}/);
  assert.match(sheet, /const e = r && g \? \{ to: g\.guardTarget\(r\), at: Date\.now\(\), facts: g\.guardFactsSoon\(shell\.bridge, r\) \} : null;\n\s*early\.current = e;/, "asked at once, for that address");
  assert.match(sheet, /facts = await \(e && e\.to === to && Date\.now\(\) - e\.at < FACTS_FRESH_MS \? e\.facts : guardFactsSoon\(shell\.bridge, a\.recipient\)\);/, "Hold takes them only for the same address, still fresh; else asks again");
  assert.doesNotMatch(sheet, /^\s*facts = await guardFactsSoon\(shell\.bridge, a\.recipient\);$/m, "control: the read after the hold is gone");
});

test("speed (D145): Send's From is there in its first frame, from what Home's runtime read (control: an empty start said \"Nothing to send yet\")", async () => {
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const \[rows, setRows\] = useState<Balance\[\]>\(\(\) => rowCoins\(home\.spending\)\);/, "the wallets from Home's read");
  assert.match(sheet, /const balances = balancesRead \? payBalances : home\.balances \?\? \[\];/, "the Safe's coins from Home's read until Send's own answer");
  assert.doesNotMatch(sheet, /useState<Balance\[\]>\(\[\]\);\n\s*const \[pocket/, "control: no empty first frame");
  const { rowCoins } = await import("./send-rows.ts");
  const status = { loaded: true, networks: [{ network: "sol", nativeAmount: "1.42", cashUsd: "144.37" }] } as never;
  assert.equal(rowCoins(status).length, 1, "a read Spending gives the SOL wallet as a source at once");
  assert.equal(rowCoins(null).length, 0, "control: nothing read yet, no source");
});
