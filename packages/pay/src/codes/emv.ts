// EMVCo Merchant-Presented QR (MPM): the format behind most national bank QRs (PIX, PromptPay, PayNow, VietQR, QRIS, …).
//
// Pay can't pay these from crypto yet: no provider lets a self-custody wallet pay them without a server holding a
// partner secret (see ../../partners.md). Pay still reads them fully, so the screen can say exactly what the shop asked
// for, and offer the card instead.
//
// Layout: a run of ID(2 digits) LENGTH(2 digits) VALUE fields. 00 = "01" first, 63 = CRC-16 last. 26–51 are merchant
// account templates whose sub-field 00 names the scheme. 53 currency (ISO 4217 numeric), 54 amount, 58 country,
// 59 name, 60 city, 62 extra data, 64 the name in a local language.

export interface Tlv {
  tag: string;
  value: string;
}

/** Splits ID-LENGTH-VALUE fields. Lengths count characters. Null if the fields don't add up exactly. */
export function parseTlv(text: string): Tlv[] | null {
  const chars = Array.from(text);
  const out: Tlv[] = [];
  let i = 0;
  while (i < chars.length) {
    if (i + 4 > chars.length) return null;
    const tag = chars.slice(i, i + 2).join("");
    const lenText = chars.slice(i + 2, i + 4).join("");
    if (!/^\d\d$/.test(tag) || !/^\d\d$/.test(lenText)) return null;
    const len = Number(lenText);
    if (i + 4 + len > chars.length) return null;
    out.push({ tag, value: chars.slice(i + 4, i + 4 + len).join("") });
    i += 4 + len;
  }
  return out;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the UTF-8 bytes, as 4 upper-case hex digits. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface BankQr {
  /** The scheme's everyday name: "PIX", "PromptPay", "UPI", "SEPA transfer", or "Bank QR" when unknown. */
  scheme: string;
  /** ISO 3166-1 alpha-2, from the code itself. */
  country?: string;
  /** ISO 4217 alpha code, e.g. "BRL". */
  currency?: string;
  /** Decimal string in that currency; absent when the payer types the amount. */
  amount?: string;
  merchantName?: string;
  city?: string;
  /** A bill or reference number the shop wants echoed back. */
  reference?: string;
  /** The account a bank transfer pays, when the code names one (EPC/SEPA QR, Swiss QR-bill): its IBAN, checked. */
  account?: { iban: string; bic?: string };
  /** True for a one-time code made for this payment. */
  dynamic: boolean;
  /** Card networks the code also accepts (Visa, Mastercard, …). */
  cardNetworks: string[];
}

const CURRENCIES: Record<string, string> = {
  "032": "ARS", "036": "AUD", "068": "BOB", "104": "MMK", "116": "KHR", "144": "LKR", "156": "CNY", "170": "COP",
  "188": "CRC", "230": "ETB", "344": "HKD", "356": "INR", "360": "IDR", "392": "JPY", "404": "KES", "410": "KRW",
  "418": "LAK", "458": "MYR", "484": "MXN", "496": "MNT", "524": "NPR", "566": "NGN", "586": "PKR", "604": "PEN",
  "608": "PHP", "682": "SAR", "702": "SGD", "704": "VND", "756": "CHF", "764": "THB", "784": "AED", "826": "GBP",
  "834": "TZS", "840": "USD", "901": "TWD", "949": "TRY", "978": "EUR", "981": "GEL", "986": "BRL",
};

/** Scheme ids found in sub-field 00 of templates 26–51 (compared without case). */
const GUIDS: [prefix: string, scheme: string][] = [
  ["br.gov.bcb.pix", "PIX"],
  ["a000000677010111", "PromptPay"],
  ["a000000677010112", "PromptPay"],
  ["sg.paynow", "PayNow"],
  ["sg.sgqr", "SGQR"],
  ["a000000727", "VietQR"],
  ["id.co.qris", "QRIS"],
  ["hk.com.hkicl", "FPS"],
  ["ph.ppmi", "QR Ph"],
];

/** When no template names the scheme, the country's national one is the best plain name. */
const NATIONAL: Record<string, string> = {
  BR: "PIX", TH: "PromptPay", IN: "UPI", ID: "QRIS", MY: "DuitNow", SG: "SGQR", VN: "VietQR", PH: "QR Ph",
  KH: "KHQR", LA: "LAOQR", MM: "MMQR", HK: "FPS", TW: "TWQR", JP: "JPQR", KR: "ZeroPay", LK: "LankaQR",
  NP: "NepalPay", PK: "Raast", CO: "Bre-B", MX: "CoDi", AR: "QR 3.0", PE: "QR Peru", BO: "QR BCB", NG: "NQR",
  KE: "KE-QR", TZ: "TANQR", AE: "Aani", MN: "QPay", CN: "UnionPay QR",
};

const CARD_TAGS: [from: number, to: number, network: string][] = [
  [2, 3, "Visa"],
  [4, 5, "Mastercard"],
  [6, 8, "EMVCo"],
  [9, 10, "Discover"],
  [11, 12, "Amex"],
  [13, 14, "JCB"],
  [15, 16, "UnionPay"],
];

export type EmvResult = { ok: BankQr } | { damaged: true } | null;

/** Reads an EMVCo merchant QR. Null if the text isn't one; `damaged` if it is one but its checksum fails. */
export function readEmvQr(text: string): EmvResult {
  if (!text.startsWith("000201")) return null;
  const fields = parseTlv(text);
  if (!fields || fields.length < 3) return { damaged: true };
  const last = fields[fields.length - 1];
  if (last.tag !== "63" || last.value.length !== 4) return { damaged: true };
  if (crc16(text.slice(0, text.length - 4)) !== last.value.toUpperCase()) return { damaged: true };

  const get = (tag: string) => fields.find((f) => f.tag === tag)?.value;
  const country = get("58")?.toUpperCase();
  let scheme: string | undefined;
  const cardNetworks: string[] = [];
  for (const f of fields) {
    const n = Number(f.tag);
    const card = CARD_TAGS.find(([a, b]) => n >= a && n <= b);
    if (card && !cardNetworks.includes(card[2])) cardNetworks.push(card[2]);
    if (n >= 26 && n <= 51 && !scheme) {
      const guid = parseTlv(f.value)?.find((s) => s.tag === "00")?.value.toLowerCase();
      if (guid) scheme = GUIDS.find(([prefix]) => guid.startsWith(prefix))?.[1];
    }
  }
  const extra = parseTlv(get("62") ?? "") ?? [];
  const local = parseTlv(get("64") ?? "") ?? [];
  const amount = get("54");
  return {
    ok: {
      scheme: scheme ?? (country && NATIONAL[country]) ?? "Bank QR",
      country,
      currency: CURRENCIES[get("53") ?? ""],
      amount: amount && /^\d+(\.\d+)?$/.test(amount) ? amount : undefined,
      merchantName: clean(get("59")) ?? clean(local.find((s) => s.tag === "01")?.value),
      city: clean(get("60")),
      reference: clean(extra.find((s) => s.tag === "01")?.value ?? extra.find((s) => s.tag === "05")?.value),
      dynamic: get("01") === "12",
      cardNetworks,
    },
  };
}

/**
 * Text from a code is untrusted: trim it, cap its length, and drop control characters, including the invisible ones
 * that reorder or hide text (C1, zero-width, bidi overrides and isolates), so what shows is what the code says.
 */
export function clean(s: string | undefined, max = 60): string | undefined {
  const t = s?.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, "").trim();
  if (!t || t === "***") return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
