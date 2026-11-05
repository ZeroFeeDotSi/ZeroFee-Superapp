import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, crc16, parseTlv, readEmvQr } from "./emv.ts";
import { emv, field as f } from "../testing/emv.ts";

test("the CRC matches the PIX manual's published example", () => {
  // Banco Central do Brasil, "Manual de Padrões para Iniciação do Pix": the static QR example ends in CRC 1D3D.
  const sample =
    "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
  assert.equal(crc16(sample), "1D3D");
  const read = readEmvQr(sample + "1D3D");
  assert.ok(read && "ok" in read);
  assert.equal(read.ok.scheme, "PIX");
  assert.equal(read.ok.country, "BR");
  assert.equal(read.ok.currency, "BRL");
  assert.equal(read.ok.merchantName, "Fulano de Tal");
  assert.equal(read.ok.city, "BRASILIA");
  assert.equal(read.ok.reference, undefined, '"***" means no reference');
  assert.equal(read.ok.dynamic, false);
});

test("a PromptPay bill with an amount is read in full", () => {
  const qr = emv(
    f("00", "01"),
    f("01", "12"),
    f("30", f("00", "A000000677010112") + f("01", "010753600010286") + f("02", "INV1234")),
    f("53", "764"),
    f("54", "250.00"),
    f("58", "TH"),
    f("59", "NOODLE HOUSE"),
    f("62", f("01", "INV1234")),
  );
  const read = readEmvQr(qr);
  assert.ok(read && "ok" in read);
  assert.deepEqual(read.ok, {
    scheme: "PromptPay",
    country: "TH",
    currency: "THB",
    amount: "250.00",
    merchantName: "NOODLE HOUSE",
    city: undefined,
    reference: "INV1234",
    dynamic: true,
    cardNetworks: [],
  });
});

test("schemes are named by their id, or by country when the id is unknown", () => {
  const paynow = emv(f("00", "01"), f("26", f("00", "SG.PAYNOW") + f("01", "2") + f("02", "201234567K")), f("53", "702"), f("58", "SG"), f("59", "KOPI"));
  assert.equal((readEmvQr(paynow) as { ok: { scheme: string } }).ok.scheme, "PayNow");
  const vietqr = emv(f("00", "01"), f("38", f("00", "A000000727") + f("01", f("00", "970415") + f("01", "113366668888"))), f("53", "704"), f("58", "VN"));
  assert.equal((readEmvQr(vietqr) as { ok: { scheme: string } }).ok.scheme, "VietQR");
  const duitnow = emv(f("00", "01"), f("26", f("00", "A0000006150001") + f("01", "123")), f("53", "458"), f("58", "MY"));
  assert.equal((readEmvQr(duitnow) as { ok: { scheme: string } }).ok.scheme, "DuitNow");
  const unknown = emv(f("00", "01"), f("26", f("00", "XX.SOMETHING")), f("53", "999"), f("58", "ZZ"));
  const u = readEmvQr(unknown) as { ok: { scheme: string; currency?: string } };
  assert.equal(u.ok.scheme, "Bank QR");
  assert.equal(u.ok.currency, undefined);
});

test("card networks in the code are noticed", () => {
  const qr = emv(f("00", "01"), f("02", "4111111111111111"), f("04", "5111111111111111"), f("53", "840"), f("58", "US"));
  assert.deepEqual((readEmvQr(qr) as { ok: { cardNetworks: string[] } }).ok.cardNetworks, ["Visa", "Mastercard"]);
});

test("a changed or damaged code is refused, never half-read", () => {
  const good = emv(f("00", "01"), f("26", f("00", "br.gov.bcb.pix") + f("01", "key")), f("53", "986"), f("54", "10.00"), f("58", "BR"));
  assert.ok(readEmvQr(good) && "ok" in readEmvQr(good)!);
  const changedAmount = good.replace("5405" + "10.00", "5405" + "99.00");
  assert.deepEqual(readEmvQr(changedAmount), { damaged: true });
  assert.deepEqual(readEmvQr(good.slice(0, -1)), { damaged: true });
  assert.deepEqual(readEmvQr("000201" + "26XX"), { damaged: true });
  assert.equal(readEmvQr("bitcoin:bc1q…"), null, "not a merchant QR at all");
});

test("names in the code are cleaned and capped", () => {
  const qr = emv(f("00", "01"), f("53", "986"), f("58", "BR"), f("59", "  Café\u0007 Zé  "));
  assert.equal((readEmvQr(qr) as { ok: { merchantName?: string } }).ok.merchantName, "Café Zé");
});

test("hidden characters that reorder or hide text are dropped: what shows is what the code says", () => {
  // A right-to-left override would show "Kiosk gpj.exe" as "Kiosk exe.jpg"; zero-width and C1 hide text.
  assert.equal(clean("Kiosk\u202egpj.exe"), "Kioskgpj.exe");
  assert.equal(clean("Mu\u200bm\u2066\u2069\u0085\ufeff"), "Mum");
});

test("lengths count characters, so local-language names parse", () => {
  const fields = parseTlv(f("59", "ร้านก๋วยเตี๋ยว") + f("60", "TOWN"));
  assert.deepEqual(fields?.map((x) => x.tag), ["59", "60"]);
});
