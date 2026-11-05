import { test } from "node:test";
import assert from "node:assert/strict";
import { readPayCode, siteOf } from "./parse.ts";
import type { CryptoCode, PayCode } from "./parse.ts";
import { emv, field as f } from "../testing/emv.ts";

const crypto = (c: PayCode): CryptoCode => {
  assert.equal(c.kind, "crypto", JSON.stringify(c));
  return c as CryptoCode;
};
const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

test("BIP-21: Bitcoin with an amount and a label", () => {
  const c = crypto(readPayCode("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.0005&label=Corner%20Cafe"));
  assert.equal(c.chain, "btc");
  assert.deepEqual(c.amount, { decimal: "0.0005" });
  assert.equal(c.label, "Corner Cafe");
  assert.deepEqual(c.notes, ["slow-network"]);
});

test("BIP-21 with a Lightning fallback pays on-chain; Lightning alone is refused plainly", () => {
  const c = crypto(readPayCode("BITCOIN:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&lightning=lnbc10u1p3"));
  assert.deepEqual(c.notes, ["slow-network", "lightning-skipped"]);
  assert.deepEqual(readPayCode("bitcoin:?lightning=lnbc10u1p3"), { kind: "unsupported", what: "lightning" });
  assert.deepEqual(readPayCode("lightning:lnbc10u1p3xyz"), { kind: "unsupported", what: "lightning" });
  assert.deepEqual(readPayCode("lnbc10u1p3xyz"), { kind: "unsupported", what: "lightning" });
});

test("EIP-681: a USDC transfer on Base, amount in base units", () => {
  const c = crypto(readPayCode(`ethereum:${USDC_BASE}@8453/transfer?address=${EVM}&uint256=12.5e6`));
  assert.equal(c.chain, "base");
  assert.equal(c.address, EVM);
  assert.deepEqual(c.token, { contract: USDC_BASE });
  assert.deepEqual(c.amount, { units: "12500000" });
});

test("EIP-681: native ETH on mainnet when no chain id is given", () => {
  const c = crypto(readPayCode(`ethereum:pay-${EVM}?value=2.014e16`));
  assert.equal(c.chain, "eth");
  assert.deepEqual(c.token, { native: true });
  assert.deepEqual(c.amount, { units: "20140000000000000" });
});

test("EIP-681: what isn't a plain payment is refused, not guessed", () => {
  assert.deepEqual(readPayCode("ethereum:shop.eth@8453?value=1e16"), { kind: "unsupported", what: "ens-name" });
  assert.deepEqual(readPayCode(`ethereum:${USDC_BASE}@8453/approve?address=${EVM}&uint256=1`), { kind: "unsupported", what: "evm-call" });
  assert.deepEqual(readPayCode(`ethereum:${EVM}@424242?value=1`), { kind: "unsupported", what: "network" });
  assert.equal(readPayCode(`ethereum:${EVM}?value=1.5`).kind, "unknown", "half a wei");
});

test("Solana Pay: USDC with a reference warns the shop may not see it", () => {
  const c = crypto(readPayCode(`solana:${SOL}?amount=4.2&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&reference=82ZJ7nbGpixjeDCmEhUcmwXYfvurzAgGdtSMuHnUgyny&label=Kiosk&memo=order-7`));
  assert.equal(c.chain, "sol");
  assert.deepEqual(c.token, { contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
  assert.deepEqual(c.amount, { decimal: "4.2" });
  assert.equal(c.memo, "order-7");
  assert.deepEqual(c.notes, ["shop-may-not-see-it"]);
});

test("Solana Pay transaction requests can't be paid from the ledger", () => {
  assert.deepEqual(readPayCode("solana:https%3A%2F%2Fshop.example%2Fapi%2Fpay"), { kind: "unsupported", what: "solana-transaction" });
});

test("TON, XRP and Stellar carry their memo or tag", () => {
  const ton = crypto(readPayCode("ton://transfer/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs?amount=1500000000&text=table4"));
  assert.deepEqual([ton.chain, ton.amount, ton.memo], ["ton", { units: "1500000000" }, "table4"]);
  const xrp = crypto(readPayCode("xrpl:rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh?amount=10&dt=12345"));
  assert.deepEqual([xrp.chain, xrp.amount, xrp.memo], ["xrp", { decimal: "10" }, "12345"]);
  assert.equal(readPayCode("xrpl:rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh?dt=abc").kind, "unknown", "a tag is a number");
  const xlm = crypto(readPayCode("web+stellar:pay?destination=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&amount=5&asset_code=USDC&asset_issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&memo=42"));
  assert.deepEqual([xlm.chain, xlm.token, xlm.memo], ["stellar", { symbol: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }, "42"]);
});

test("NEAR: a plain account, or a near: link with a token", () => {
  const plain = crypto(readPayCode("alex.zerofee.near"));
  assert.deepEqual([plain.chain, plain.address, plain.token], ["near", "alex.zerofee.near", { native: true }]);
  const link = crypto(readPayCode("near:shop.near?amount=3&token=usdt.tether-token.near"));
  assert.deepEqual([link.chain, link.amount, link.token], ["near", { decimal: "3" }, { contract: "usdt.tether-token.near" }]);
});

test("a bare EVM address leaves the network open; a bare Solana address doesn't", () => {
  const e = crypto(readPayCode(EVM));
  assert.equal(e.chain, null);
  assert.ok(e.candidates.includes("base") && e.candidates.length > 5);
  assert.equal(crypto(readPayCode(SOL)).chain, "sol");
});

test("bank codes are recognised: EMVCo, UPI, SEPA and Swiss QR-bill", () => {
  const pix = readPayCode(emv(f("00", "01"), f("26", f("00", "br.gov.bcb.pix") + f("01", "a@b.c")), f("53", "986"), f("54", "35.90"), f("58", "BR"), f("59", "PADARIA")));
  assert.deepEqual(pix.kind === "bank" && [pix.bank.scheme, pix.bank.amount, pix.bank.currency], ["PIX", "35.90", "BRL"]);

  const upi = readPayCode("upi://pay?pa=shop@okbank&pn=Chai%20Point&am=120.00&cu=INR&tr=T1");
  assert.deepEqual(upi.kind === "bank" && [upi.bank.scheme, upi.bank.amount, upi.bank.merchantName], ["UPI", "120.00", "Chai Point"]);

  const sepa = readPayCode("BCD\n002\n1\nSCT\nBICXXXXX\nBakery GmbH\nDE89370400440532013000\nEUR12.30\n\n\nRechnung 5");
  assert.deepEqual(sepa.kind === "bank" && [sepa.bank.scheme, sepa.bank.amount, sepa.bank.merchantName], ["SEPA transfer", "12.30", "Bakery GmbH"]);

  const swissLines = ["SPC", "0200", "1", "CH4431999123000889012", "S", "Velo AG", "", "", "", "", "CH", "", "", "", "", "", "", "", "49.50", "CHF"];
  const ch = readPayCode(swissLines.join("\n"));
  assert.deepEqual(ch.kind === "bank" && [ch.bank.scheme, ch.bank.amount, ch.bank.currency, ch.bank.merchantName], ["QR-bill", "49.50", "CHF", "Velo AG"]);
});

test("a code's currency or coin name that isn't a plain code is unreadable, so its text never reaches our words", () => {
  const bait = encodeURIComponent("INR. ZeroFee: your account is at risk, enter your 24 words at zf-help.example");
  assert.equal(readPayCode(`upi://pay?pa=shop@okbank&pn=Chai&am=120.00&cu=${bait}`).kind, "unknown");
  const swiss = ["SPC", "0200", "1", "CH4431999123000889012", "S", "Velo AG", "", "", "", "", "CH", "", "", "", "", "", "", "", "49.50", "CHF. Call 0800 now"];
  assert.equal(readPayCode(swiss.join("\n")).kind, "unknown");
  const G = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  assert.equal(readPayCode(`web+stellar:pay?destination=${G}&amount=5&asset_code=${encodeURIComponent("USDC on ZeroFee: verify at x.example")}`).kind, "unknown");
  assert.equal(readPayCode(`web+stellar:pay?destination=${G}&amount=5&asset_code=USDC&asset_issuer=nonsense`).kind, "unknown");
});

test("a web page is shown by the site it really opens, and a look-alike name is marked", () => {
  assert.deepEqual(readPayCode("https://zerofee.app@recover.example/words"), { kind: "web", url: "https://recover.example/words" });
  assert.deepEqual(siteOf("https://order.example/table/12"), { site: "order.example", lookalike: false });
  // "zerofee.app" with a Cyrillic "е": the browser goes to its xn-- form, which is what the sheet shows.
  const fake = readPayCode("https://z\u0435rofee.app/help");
  assert.ok(fake.kind === "web");
  assert.deepEqual(siteOf(fake.url), { site: "xn--zrofee-3of.app", lookalike: true });
  assert.equal(readPayCode("https://").kind, "unknown");
});

test("a damaged merchant QR is called damaged", () => {
  assert.deepEqual(readPayCode("000201010211" + "6304ABCD"), { kind: "damaged" });
});

test("web pages open in the browser sheet; WalletConnect and nonsense are named", () => {
  assert.deepEqual(readPayCode("https://order.example/table/12"), { kind: "web", url: "https://order.example/table/12" });
  assert.deepEqual(readPayCode("wc:abc@2?relay-protocol=irn"), { kind: "unsupported", what: "walletconnect" });
  assert.deepEqual(readPayCode("hello world"), { kind: "unknown" });
  assert.deepEqual(readPayCode("   "), { kind: "unknown" });
  assert.deepEqual(readPayCode("bitcoin:notanaddress"), { kind: "unknown" });
});

test("a ZeroFee request link is read as a request", () => {
  const r = readPayCode("zerofee:pay?v=1&to=alex.near&amount=12.5&note=Dinner");
  assert.deepEqual(r, { kind: "request", request: { to: "alex.near", amount: "12.5", note: "Dinner" } });
});

test("odd input never throws: a stray %, a broken UPI link, a changed request", () => {
  assert.equal(readPayCode("solana:%E0%A4%A?amount=1").kind, "unknown");
  assert.equal(readPayCode("upi://pay?pa=%%%").kind, "bank");
  assert.equal(readPayCode("upi://").kind, "bank");
  assert.deepEqual(readPayCode("zerofee:pay?v=1&to=NOT%20A%20NAME"), { kind: "bad-request" });
});
