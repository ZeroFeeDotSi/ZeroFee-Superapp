// H-5 Scan to pay (QA's rules, each with a control): one test per code kind; three poisoned codes caught before Send opens;
// a scanned amount is in the form, never sent; a bare 0x address asks which network; bank codes only through a live
// partner; scanning never sends; the camera stops when the sheet closes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TokenDirectory } from "@zerofee/pay/tokens";
import { RECORDED_TOKENS } from "@zerofee/pay/testing/recorded-tokens";
import { emv, field as f } from "@zerofee/pay/testing/emv";
import { watchCamera, type CameraEnv } from "@zerofee/pay/app/camera.ts";
import { BANK_TILE_ON } from "@zerofee/pay/registry";
import { targetForSend } from "@zerofee/pay/send";
import { cantSendTo, sendNetworks, startNetwork } from "../../send-reach.ts";
import { BANK_IN_PAY, CANT_BANK, LOOKALIKE_LINE, SCAN_HIDES, SCAN_LINE, SHOP_TILL, UNREADABLE, WEB_LINE, readScan, saysDollars, type ScanResult } from "./scan.ts";

const tokens = new TokenDirectory(RECORDED_TOKENS);
const at = (text: string, o: { bankLive?: boolean } = {}): ScanResult => readScan(text, { tokens, self: "me.near", ...o });
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
const G = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const filled = (r: ScanResult) => {
  assert.ok("prefill" in r, JSON.stringify(r));
  return r.prefill;
};
const line = (r: ScanResult) => {
  assert.ok("line" in r, JSON.stringify(r));
  return r.line;
};
const token = (id: string | undefined) => (id ? tokens.byAsset(id)?.symbol : undefined);

test("the camera's one line", () => {
  assert.equal(SCAN_LINE, "Point at a wallet's or a shop's code");
  const sheet = readFileSync(new URL("./ScanSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{SCAN_LINE\}/);
});

test("each code kind a wallet or a shop shows opens Send filled in: address, network, coin, and the amount it names", () => {
  const btc = filled(at("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.0005&label=Corner%20Cafe"));
  assert.deepEqual([btc.recipient, btc.amount, token(btc.tokenId)], [{ kind: "address", chain: "btc", candidates: ["btc"], address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }, "0.0005", "BTC"]);
  const eth = filled(at(`ethereum:${EVM}@8453?value=1e15`));
  assert.deepEqual([eth.recipient.kind === "address" && eth.recipient.chain, eth.amount, token(eth.tokenId)], ["base", "0.001", "ETH"], "EIP-681 native: wei read at ETH's 18 decimals");
  const erc20 = filled(at(`ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=${EVM}&uint256=12.5e6`));
  assert.deepEqual([erc20.recipient.kind === "address" && erc20.recipient.address, erc20.amount, token(erc20.tokenId)], [EVM, "12.5", "USDC"], "EIP-681 transfer: the payee, never the coin's contract");
  const sol = filled(at(`solana:${SOL}?amount=4.2&spl-token=${USDC_SOL}&label=Kiosk&message=Coffee`));
  assert.deepEqual([sol.recipient.kind === "address" && sol.recipient.chain, sol.amount, token(sol.tokenId), sol.label], ["sol", "4.2", "USDC", "Kiosk"]);
  const xrp = filled(at("xrpl:rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh?amount=10&dt=12345"));
  assert.deepEqual([xrp.recipient, xrp.amount], [{ kind: "address", chain: "xrp", candidates: ["xrp"], address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", memo: "12345" }, "10"], "XRP keeps its tag");
  const xlm = filled(at(`web+stellar:pay?destination=${G}&amount=5&asset_code=USDC&asset_issuer=${G}&memo=42`));
  assert.deepEqual([xlm.recipient.kind === "address" && xlm.recipient.chain, xlm.amount, token(xlm.tokenId)], ["stellar", "5", "USDC"]);
  const trx = filled(at("tron:TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7?amount=3"));
  assert.deepEqual([trx.recipient.kind === "address" && trx.recipient.chain, trx.amount], ["tron", "3"]);
  const near = filled(at("near:kim.near?amount=2"));
  assert.deepEqual([near.recipient, near.amount, near.tokenId], [{ kind: "near-wallet", accountId: "kim.near" }, "2", "near"], "NEAR is the Safe's own NEAR row, never wrapped NEAR");
  const req = filled(at("zerofee:pay?v=1&to=alex.near&amount=12.5&token=nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1&ref=r1"));
  assert.deepEqual([req.recipient, req.amount, token(req.tokenId), req.ref], [{ kind: "ledger", accountId: "alex.near" }, "12.5", "USDC", "r1"], "a ZeroFee request");
  const chat = filled(at("zerofee:send?v=1&to=kim.near&chain=near&coin=USDC&amount=3"));
  assert.deepEqual([chat.recipient, chat.amount, token(chat.tokenId)], [{ kind: "near-wallet", accountId: "kim.near" }, "3", "USDC"], "ZeroFee's own send link");
  // a bare address is a paste: who and where, the person picks the coin and the amount
  const bare = filled(at(SOL));
  assert.deepEqual([bare.recipient, bare.tokenId, bare.amount], [{ kind: "address", chain: "sol", candidates: ["sol"], address: SOL }, undefined, undefined]);
  const acct = filled(at("kim.near"));
  assert.deepEqual([acct.recipient, acct.tokenId, acct.amount], [{ kind: "near-wallet", accountId: "kim.near" }, undefined, undefined]);
  // TON's coin isn't one 1Click lists here: one line, never another coin's amount
  assert.equal(line(at("ton://transfer/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs?amount=1500000000&text=table4")), "ZeroFee can't send the coin this code asks for.");
});

test("a bare 0x address asks which network: no network, no coin, no amount guessed; Send's tap asks it", () => {
  const p = filled(at(EVM));
  assert.ok(p.recipient.kind === "address");
  assert.equal(p.recipient.chain, null);
  for (const c of ["eth", "base", "bsc", "arb"]) assert.ok(p.recipient.candidates.includes(c), c);
  assert.equal(p.tokenId, undefined);
  assert.equal(p.amount, undefined);
  // the same ask a pasted 0x address gets: Send's "Which network?" sheet, before any quote
  const t = targetForSend(p.recipient, tokens.find("near", { symbol: "USDC" })!, "5", tokens, {});
  assert.ok("problem" in t && t.ask === "network", JSON.stringify(t));
  assert.ok(t.networks!.includes("bsc") && t.networks!.includes("base"));
  // Home's Send (bug 9, security review M1): "Which network?" with the four it reaches; a new address starts on none
  const nets = sendNetworks(p.recipient);
  assert.deepEqual(nets, ["hood", "bsc", "eth", "base", "arb", "op", "pol", "avax", "gnosis", "bera"]);
  assert.equal(startNetwork(nets, null), null, "a scanned 0x address with no network named: the person picks (M1: never the wallet's own network)");
  assert.equal(startNetwork(nets, "bsc"), "bsc", "one this person paid on BNB Chain before starts there");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /\{who && networks\.length > 1 && \(\n\s+<div className="wl-send2__nets" role="radiogroup" aria-label="Which network\?"/);
  assert.match(form, /!network \? "Pick the network first\."/, "and Hold says why it waits");
  // control: an address with its network named isn't asked
  const named = filled(at(`ethereum:${EVM}@56`));
  assert.ok(named.recipient.kind === "address" && named.recipient.chain === "bsc");
});

test("Lightning, WalletConnect and a Solana Pay checkout: one plain 'can't pay this yet' line", () => {
  assert.equal(line(at("lightning:lnbc10u1p3xyz")), "It's a Lightning invoice. ZeroFee can't pay this yet.");
  assert.equal(line(at("lnbc10u1p3xyz")), "It's a Lightning invoice. ZeroFee can't pay this yet.");
  assert.equal(line(at("bitcoin:?lightning=lnbc10u1p3")), "It's a Lightning invoice. ZeroFee can't pay this yet.");
  assert.equal(line(at("wc:abc@2?relay-protocol=irn&symKey=x")), "It links a wallet to a website. ZeroFee can't pay this yet.");
  assert.equal(line(at("solana:https%3A%2F%2Fshop.example%2Fapi%2Fpay")), "It's a Solana Pay checkout. ZeroFee can't pay this yet.");
  assert.equal(line(at("ethereum:vitalik.eth")), "It gives a .eth address. Ask for the 0x address instead.");
  assert.equal(line(at(`ethereum:${EVM}/approve?address=${EVM}&uint256=1`)), "It asks to run an app, not to pay. ZeroFee can't pay this yet.");
  assert.equal(line(at(`ethereum:${EVM}@999999`)), "Its network isn't in ZeroFee yet.");
  assert.equal(line(at("zerofee:pay?v=2&to=x.near")), "This payment link is broken. Ask for a new one.");
  assert.equal(line(at("garbage text")), UNREADABLE);
  assert.equal(line(at("   ")), UNREADABLE);
  // control: a Solana Pay transfer (not a checkout) fills Send
  filled(at(`solana:${SOL}?amount=1`));
});

test("bank codes (EMV, UPI, SEPA, Swiss): one line while Pay has no live bank partner (D77); a line pointing to Pay when it has one", () => {
  const codes = {
    emv: emv(f("00", "01"), f("26", f("00", "br.gov.bcb.pix") + f("01", "a@b.c")), f("53", "986"), f("54", "35.90"), f("58", "BR"), f("59", "PADARIA")),
    upi: "upi://pay?pa=shop@okbank&pn=Chai%20Point&am=120.00&cu=INR&tr=T1",
    sepa: "BCD\n002\n1\nSCT\nCOBADEFFXXX\nBakery GmbH\nDE89 3704 0044 0532 0130 00\nEUR20.00\n\n\nRechnung 5",
    swiss: ["SPC", "0200", "1", "CH4431999123000889012", "S", "Velo AG", "", "", "", "", "CH", "", "", "", "", "", "", "", "49.50", "CHF"].join("\n"),
  };
  assert.equal(BANK_TILE_ON, false, "Mt Pelerin's tile is off: no live bank-code partner");
  for (const [k, c] of Object.entries(codes)) {
    assert.deepEqual(at(c), { line: CANT_BANK }, k);
    // control: with a live partner the line says where it is paid (Pay); never Send, never a jump between apps
    assert.deepEqual(at(c, { bankLive: true }), { line: BANK_IN_PAY }, k);
  }
  assert.equal(CANT_BANK, "ZeroFee can't pay bank codes.");
});

test("a web page's code is a line, and a look-alike site says so (siteOf)", () => {
  assert.equal(line(at("https://zerofee.si/pay")), WEB_LINE);
  // the look-alike: "zerofeé.si" is xn--… under the hood
  assert.equal(line(at("https://zerofeé.si/pay")), LOOKALIKE_LINE);
  assert.equal(line(at("https://xn--zerofe-9ua.si/pay")), LOOKALIKE_LINE);
});

test("POISONED 1, a look-alike name: mixed alphabets in the code's name, or a name on the block list, stop before Send", () => {
  // "Віnance": Cyrillic В and і dressed as Latin
  assert.equal(line(at(`solana:${SOL}?amount=1&label=%D0%92%D1%96nance`)), SCAN_HIDES);
  assert.equal(line(at(`solana:${SOL}?amount=1&label=Віnance`)), SCAN_HIDES, "unencoded too");
  // control: a name all in one alphabet is a shop's own name, kept (as the code's words, never a contact)
  assert.equal(filled(at(`solana:${SOL}?amount=1&label=%D0%9C%D0%B0%D0%B3%D0%B0%D0%B7%D0%B8%D0%BD`)).label, "Магазин");
  assert.equal(filled(at(`solana:${SOL}?amount=1&label=Binance`)).label, "Binance");
  // the block list's look-alike of NEAR's support: judge blocks it by name
  assert.equal(line(at("near:near-support.near?amount=2")), "near-support.near is on the block list. Nothing was sent.");
  assert.equal(line(at("near-support.near")), "near-support.near is on the block list. Nothing was sent.");
  assert.equal(line(at("ethereum:0x000000000000000000000000000000000000dEaD@56?value=1")), "This BNB Chain address is on the block list. Nothing was sent.");
  // control: an account not on the list opens Send
  filled(at("near:kim.near?amount=2"));
});

test("POISONED 2, hidden characters: zero-width, bidi, percent-encoded or not, in the address or the words", () => {
  assert.equal(line(at(`${SOL}​`)), SCAN_HIDES);
  assert.equal(line(at(`solana:${SOL}?amount=1&label=Bin%E2%80%8Bance`)), SCAN_HIDES);
  assert.equal(line(at(`solana:${SOL}?amount=1&message=pay%E2%80%AEecnaniB`)), SCAN_HIDES, "a right-to-left override");
  assert.equal(line(at(`near:kim.near⁠?amount=2`)), SCAN_HIDES);
  // control: the same codes clean
  filled(at(SOL));
  filled(at(`solana:${SOL}?amount=1&label=Binance`));
  filled(at("near:kim.near?amount=2"));
});

test("POISONED 3, an amount ten times what the code's own words say: the unit guard stops it", () => {
  assert.equal(line(at(`solana:${SOL}?amount=42&spl-token=${USDC_SOL}&label=Kiosk&message=Coffee%20%244.20`)), "That's $42, not $4.20. Stopped.");
  assert.equal(line(at(`solana:${SOL}?amount=0.42&spl-token=${USDC_SOL}&message=Coffee%20%244.20`)), "That's $0.42, not $4.20. Stopped.", "and a tenth");
  assert.equal(line(at("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.05&message=Lunch%2040%20USD")), "That's $4,023, not $40. Stopped.", "priced coins at their price");
  assert.equal(line(at("zerofee:pay?v=1&to=alex.near&amount=500&token=nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1&note=Dinner%20%2450")), "That's $500, not $50. Stopped.");
  // controls: the words match, the words name no dollars, or the code names no amount
  filled(at(`solana:${SOL}?amount=4.2&spl-token=${USDC_SOL}&label=Kiosk&message=Coffee%20%244.20`));
  filled(at(`solana:${SOL}?amount=42&spl-token=${USDC_SOL}&message=Table%204`));
  filled(at(`solana:${SOL}?spl-token=${USDC_SOL}&message=Coffee%20%244.20`));
  filled(at("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.0005&message=Lunch%2040%20USD"));
  assert.equal(saysDollars(["Coffee $4.20"]), 4.2);
  assert.equal(saysDollars(["$1,250.50 rent"]), 1250.5);
  assert.equal(saysDollars(["12 dollars"]), 12);
  assert.equal(saysDollars(["Table 4", undefined]), null);
  // and on Send itself the code's amount is said in its own coin before the hold ("They asked for 12.5 USDC."), the
  // dollars beside it are that amount at the coin's price, and the core's sheet then shows what 1Click signed
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /exact \? `They asked for \$\{exact\.amount\} \$\{exact\.symbol\}\.`/);
  assert.match(form, /const usd = exact \? \(\(\) => \{ const t = tokens\?\.byAsset\(exact\.tokenId\); return t\?\.priceUsd \? Number\(exact\.amount\) \* Number\(t\.priceUsd\) : null; \}\)\(\)/);
});

test("a prefilled Send runs the same guard before Approve: obfuscated, judge, then the unit check", () => {
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  // one send() for typed, linked and scanned sends alike: the form's Send tap is its only way in
  assert.equal((sheet.match(/onSend=\{\(x\) => void send\(x\)\}/g) ?? []).length, 1);
  const body = sheet.slice(sheet.indexOf("const send = async"));
  const order = [/obfuscated\(to\) \|\| obfuscated\(a\.amountIn\)/, /guardFactsSoon\(shell\.bridge, a\.recipient\)/, /const check = judge\(/, /check\.verdict === "block"/, /"ledger\.hiddenFromRow"/].map((re) => body.search(re));
  assert.ok(order.every((i) => i >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("scanning never sends: a scan only fills the form or says a line; Send stays the person's tap", () => {
  // even a code that names everything (who, coin, amount, its reference: Pay's 'fully named') is only a prefill
  const r = at("zerofee:pay?v=1&to=alex.near&amount=12.5&token=nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1&ref=r1");
  assert.deepEqual(Object.keys(r), ["prefill"]);
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const handler = /onResult=\{\(r\) => \{(.*?)\}\} \/>/.exec(sheet)?.[1];
  assert.ok(handler, "the scan handler");
  assert.equal(handler, ` setScanning(false); back.current = null; setWarn(null); setFormKey((k) => k + 1); if ("prefill" in r) return setPrefill(r.prefill); setPrefill(null); if ("line" in r) setLine(r.line); `);
  // a refused scan empties the form: its stop line never sits over a Send still ready for the last payee (walk, 3 Nov)
  assert.match(sheet, /<SendForm key=\{formKey\} prefill=\{prefill\}/);
  // no tap jumps apps for money (the one-sheet rule, apps/web/src/shell/money-sheet.test.ts): no openApp here at all
  assert.doesNotMatch(readFileSync(new URL("./ScanSheet.tsx", import.meta.url), "utf8"), /openApp/);
  assert.doesNotMatch(handler!, /send\(|run\(|flow\.|fullyNamed|confirm/);
  assert.doesNotMatch(readFileSync(new URL("./scan.ts", import.meta.url), "utf8"), /fullyNamed|bridge|flow\./, "the reader can't reach anything that sends");
  assert.doesNotMatch(readFileSync(new URL("./ScanSheet.tsx", import.meta.url), "utf8"), /bridge|flow\.|send\(/);
});

test("a scanned amount is in the form, shown and editable (the amount field and the slider), and a new scan replaces it", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const effect = form.slice(form.indexOf("// A link (Chat's pay) or a scanned code"), form.indexOf("}, [prefill, sources.length > 0]);"));
  assert.ok(effect.length > 0, "the prefill effect");
  // the code's amount, exactly, in the coin it names, and only where that coin can land on a network Send reaches
  assert.match(effect, /if \(coin && wanted && Number\(wanted\) > 0 && \(nets as string\[\]\)\.includes\(coin\.chain\)\) \{\n\s+setPicked\(coin\.chain as SendToChain\);\n\s+setExact\(\{ tokenId: coin\.assetId, amount: wanted, symbol: coin\.symbol \}\);/);
  assert.doesNotMatch(effect, /setAmount\(prefill\.amount\)/, "control: never its number as another coin's");
  // a second scan is a fresh form (new key), so nothing of the first one's coin, amount or typed number is kept
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.ok(/setFormKey\(\(k\) => k \+ 1\); if \("prefill" in r\) return setPrefill\(r\.prefill\);/.test(sheet), "the key changes before any prefill");
  assert.doesNotMatch(effect, /onSend|disabled/, "the effect fills, never sends");
  // the amount it set is the field the person types in, and Send is a button they tap
  assert.match(form, /value=\{shown\} onChange=\{\(e\) => paste\(e\.target\.value\)\}/);
  assert.match(form, /const setCoins = \(coins: string\) => \{\n\s+setExact\(null\);/, "a change by the person is theirs: the exact amount gives way");
  assert.match(form, /<button type="button" className="zf-btn wl-hold" disabled=\{!ready\} onClick=\{go\} data-testid="send-go">\{label\}<\/button>/, "and sending is the person's own tap (no hold: product decision, 5 Nov)");
});

test("the scan glyph sits at the end of Send's 'where to' field; Home keeps its four buttons; the camera loads on first tap", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const field = form.slice(form.indexOf('<label className="py-field wl-send2__to">'), form.indexOf("</label>", form.indexOf('<label className="py-field wl-send2__to">')));
  assert.ok(field.length > 0, "the field");
  assert.ok(field.indexOf('aria-label="Who to send to"') < field.indexOf('aria-label="Scan a code"'), "after the input, at the field's end");
  assert.match(field, /<button type="button" className="zf-icon-btn" onClick=\{onScan\} disabled=\{busy\} aria-label="Scan a code"><TrayScan \/><\/button>/);
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const ScanSheet = lazy\(\(\) => import\("\.\/ScanSheet\.tsx"\)/);
  assert.doesNotMatch(sheet, /import \{[^}]*\} from "\.\/(ScanSheet\.tsx|scan\.ts)"/, "never a static import");
  const home = readFileSync(new URL("../screens/Home.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /Scan/, "Home has no fifth button");
});

test("the camera stops when the sheet closes: any close unmounts it, and its unmount stops every track", async () => {
  const sheet = readFileSync(new URL("./ScanSheet.tsx", import.meta.url), "utf8");
  // the effect returns watchCamera's own stop: React runs it when the sheet goes
  assert.match(sheet, /useEffect\(\s*\(\) => watchCamera\(\{ active, /);
  assert.match(sheet, /<Sheet title="Scan" onClose=\{onClose\}>/);
  const send = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(send, /\{scanning && <Suspense fallback=\{null\}><ScanSheet [^\n]*onClose=\{\(\) => setScanning\(false\)\} onResult=\{\(r\) => \{ setScanning\(false\);/);
  // what that stop does, with a pretend camera: the track ends, and no code is read after
  const stopped: number[] = [];
  let reads = 0;
  const env: CameraEnv = {
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped.push(1) }] }) as unknown as MediaStream,
    Detector: class { async detect() { reads++; return []; } },
  };
  const stop = watchCamera({ active: true, env, video: () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLVideoElement, onState: () => {}, onCode: () => assert.fail("no code"), everyMs: 5 });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(reads > 0, "it was looking");
  stop();
  assert.equal(stopped.length, 1, "closed: the camera is off");
  const at = reads;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(reads, at, "and it looks no more");
  // control: off screen it never starts at all
  const never = watchCamera({ active: false, env, video: () => null, onState: () => {}, onCode: () => {} });
  never();
  assert.equal(stopped.length, 1);
});

test("security review fixes (3 Nov): each with its control", () => {
  // L4: a bank code whose shop is named in another alphabet is still the bank line, never "hides its words"
  const cyr = emv(f("00", "01"), f("26", f("00", "br.gov.bcb.pix") + f("01", "a@b.c")), f("53", "986"), f("54", "35.90"), f("58", "RU"), f("59", "Магазин"), f("60", "Москва"));
  assert.deepEqual(at(cyr), { line: CANT_BANK });
  assert.equal(line(at(`solana:${SOL}?amount=1&label=Bin%E2%80%8Bance`)), SCAN_HIDES, "control: a crypto code still gets the check");
  // M2: a Solana Pay till code (it watches for its own reference key) can't be paid from Send: one line, never filled
  assert.equal(line(at(`solana:${SOL}?amount=4.5&spl-token=${USDC_SOL}&reference=82ZJ7nbGpixjeDCmEhUcmwXYfvurzAgGdtSMuHnUgyny`)), SHOP_TILL);
  assert.equal(SHOP_TILL, "It's a shop's till code. ZeroFee can't pay this yet.");
  filled(at(`solana:${SOL}?amount=4.5&spl-token=${USDC_SOL}`)); // control: no reference, a plain transfer
  // M2: a memo or tag the code carries is never carried unseen: a private Send can't carry one, so it is said and refused
  const memo = filled(at("xrpl:rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh?amount=10&dt=12345")).recipient;
  assert.equal((memo as { memo?: string }).memo, "12345");
  assert.equal(cantSendTo({ kind: "address", chain: "sol", candidates: ["sol"], address: SOL, memo: "12345" }), "ZeroFee can't send with a memo yet.");
  assert.equal(cantSendTo({ kind: "address", chain: "sol", candidates: ["sol"], address: SOL }), null, "control: the same address with no memo goes");
  // L5: a comma for cents is four fifty, thousands stay thousands
  assert.equal(saysDollars(["Coffee $4,50"]), 4.5);
  assert.equal(saysDollars(["Rent $1,250"]), 1250);
  assert.equal(saysDollars(["Rent $1,250.50"]), 1250.5);
  filled(at(`solana:${SOL}?amount=4.5&spl-token=${USDC_SOL}&message=Coffee%20%244%2C50`));
  assert.equal(line(at(`solana:${SOL}?amount=45&spl-token=${USDC_SOL}&message=Coffee%20%244%2C50`)), "That's $45, not $4.50. Stopped.", "control: ten times it still stops");
  // L1: a second scan the form refuses keeps nothing of the first: every scan result remounts the form (formKey)
  const sheet0 = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet0, /<SendForm key=\{formKey\} /);
  // M1 + L2: a scan ends Chat's ask (Chat never hears "sent" for a payee it didn't ask for) and clears the last send's state
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const handler = /onResult=\{\(r\) => \{(.*?)\}\} \/>/.exec(sheet)![1]!;
  for (const s of ["back.current = null;", "setWarn(null);", "setFormKey((k) => k + 1);"]) assert.ok(handler.includes(s), s);
  // L3: a request's note names the payment (its Activity row and the core's sheet hint); a private Send carries no memo
  assert.match(sheet, /\.\.\.\(a\.note \? \{ label: a\.note \} : \{\}\)/);
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /\.\.\.\(prefill\?\.note \?\? filled\?\.note \? \{ note: prefill\?\.note \?\? filled\?\.note \} : \{\}\)/, "a link's note first, else the one it was opened with");
  // L6: the page going out of sight closes the sheet, and so stops the camera
  const scanSheet = readFileSync(new URL("./ScanSheet.tsx", import.meta.url), "utf8");
  assert.match(scanSheet, /const away = \(\) => document\.visibilityState === "hidden" && shut\.current\(\);/);
  assert.match(scanSheet, /return \(\) => document\.removeEventListener\("visibilitychange", away\);/);
});

test("on a fresh form the code's recipient is the last word: the prefill effect is declared after the address lookup", () => {
  // both run at mount (each scan remounts the form); React runs them in order, so the later one's who stands. Were the
  // lookup later, it would clear who and look the bare address up again: a code's memo and its named network lost (walk)
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  const lookup = form.indexOf("const seq = useRef(0);");
  const fill = form.indexOf("// A link (Chat's pay) or a scanned code");
  assert.ok(lookup > 0 && fill > lookup, `lookup at ${lookup}, prefill at ${fill}`);
  // and the lookup skips the text the prefill set, while its who stands
  assert.match(form, /if \(prefill && who && \(who\.recipient\.kind === "address" \? who\.recipient\.address : who\.recipient\.accountId\) === t\) return;/);
});

test("L7: an ethereum: code with no chain id asks which network, like a bare 0x; an explicit @<chain id> is taken as given", () => {
  const asks = (text: string) => {
    const p = filled(at(text));
    assert.ok(p.recipient.kind === "address", text);
    assert.equal(p.recipient.chain, null, text);
    for (const c of ["eth", "base", "bsc", "arb"]) assert.ok(p.recipient.candidates.includes(c), `${text}: ${c}`);
    // no network, so no coin and no amount guessed: the person picks and types them
    assert.equal(p.tokenId, undefined, text);
    assert.equal(p.amount, undefined, text);
    return p;
  };
  assert.equal(asks(`ethereum:${EVM}`).recipient.kind === "address" && asks(`ethereum:${EVM}`).recipient.address, EVM);
  asks(`ethereum:${EVM}?value=1e15`);
  asks(`ethereum:pay-${EVM}?value=1e15`);
  // an ERC-20 transfer with no chain id: the payee is the address= one, never the coin's contract
  const t = asks(`ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/transfer?address=${EVM}&uint256=12.5e6`);
  assert.ok(t.recipient.kind === "address" && t.recipient.address === EVM);
  // and Send's tap asks it: the same "Which network?" a pasted 0x gets
  const r = targetForSend(t.recipient, tokens.find("near", { symbol: "USDC" })!, "5", tokens, {});
  assert.ok("problem" in r && r.ask === "network");
  // controls: @1 is Ethereum as given, @8453 Base, @56 BNB Chain, with their coin and amount
  const one = filled(at(`ethereum:${EVM}@1?value=1e15`));
  assert.deepEqual([one.recipient.kind === "address" && one.recipient.chain, one.amount, token(one.tokenId)], ["eth", "0.001", "ETH"]);
  const base = filled(at(`ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=${EVM}&uint256=12.5e6`));
  assert.deepEqual([base.recipient.kind === "address" && base.recipient.chain, base.amount, token(base.tokenId)], ["base", "12.5", "USDC"]);
  const bsc = filled(at(`ethereum:${EVM}@56`));
  assert.ok(bsc.recipient.kind === "address" && bsc.recipient.chain === "bsc");
  // the guard still runs first on such a code: a blocked address with no chain id is still stopped
  assert.equal(line(at("ethereum:0x000000000000000000000000000000000000dEaD?value=1")), "This address is on the block list. Nothing was sent.");
});

test("auditor (4 Nov): a pasted link and Chat's link meet the scan's unit check before Send fills in", async () => {
  const { requestLink } = await import("@zerofee/pay/request");
  const { prefillFromLink } = await import("@zerofee/pay/app/links.ts");
  const { linkUnitOff } = await import("./send-guard.ts");
  const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const off = (link: string) => {
    const r = prefillFromLink(link, tokens, "me.near");
    assert.ok("ok" in r, JSON.stringify(r));
    return linkUnitOff(r.ok, tokens);
  };
  assert.equal(off(requestLink({ to: "kim.near", amount: "4500", token: USDC_NEAR, note: "Coffee $4.50" })), "That's $4,500, not $4.50. Stopped.");
  assert.equal(off(requestLink({ to: "kim.near", amount: "4.5", token: USDC_NEAR, note: "Coffee $4.50" })), null, "control: the right amount fills in");
  assert.equal(off(requestLink({ to: "kim.near", amount: "4500", token: USDC_NEAR })), null, "control: no dollars in its words, nothing to be off from");
  // both ways a link enters the sheet run it before the form fills (the scan runs it inside readScan)
  const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
  const paths = [sheet.indexOf("const r = prefillFromLink(link, tokens, self);"), sheet.indexOf("const r = prefillFromLink(text, tokens, self);")];
  for (const at of paths) {
    assert.ok(at > 0);
    const after = sheet.slice(at, sheet.indexOf("setPrefill(r.ok)", at));
    assert.match(after, /const off = g\.linkUnitOff\(r\.ok, tokens\);\s*if \(off\)/);
  }
  assert.match(readFileSync(new URL("./scan.ts", import.meta.url), "utf8"), /const off = linkUnitOff\(p, o\.tokens/);
});
