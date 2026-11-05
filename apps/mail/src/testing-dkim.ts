// Tests only: signs a mail as a sender's domain would (ed25519-sha256, relaxed/relaxed), and a DNS answer for its key.
// The verifier (dkim.ts) is also checked against RFC 8463's own signed mail, so this signer is never its only witness.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { canonBody, canonHeader, splitMail, type TxtResolver } from "./dkim.ts";

export interface TestSigner { domain: string; selector: string; privateKey: KeyObject; record: string }

export function testSigner(domain: string, selector = "s1"): TestSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  return { domain, selector, privateKey, record: `v=DKIM1; k=ed25519; p=${raw.toString("base64")}` };
}

/** The mail with a DKIM-Signature on top. `tags` adds or overrides tags (l=, x=, a=…) to make bad ones. */
export function dkimSign(mail: string, s: TestSigner, o: { headers?: string[]; tags?: Record<string, string> } = {}): string {
  const text = mail.replace(/\r?\n/g, "\r\n");
  const { headers, body } = splitMail(text);
  const names = o.headers ?? ["from", "to", "subject", "date", "message-id"];
  const tags: Record<string, string> = { v: "1", a: "ed25519-sha256", c: "relaxed/relaxed", d: s.domain, s: s.selector, h: names.join(":"), bh: createHash("sha256").update(canonBody(body, "relaxed"), "latin1").digest("base64"), ...o.tags };
  let data = "";
  const used = new Map<string, number>();
  for (const n of names) {
    const all = headers.filter((h) => h.name === n);
    const k = used.get(n) ?? 0;
    used.set(n, k + 1);
    const h = all[all.length - 1 - k];
    if (h) data += canonHeader(h.raw, "relaxed");
  }
  const head = `DKIM-Signature: ${Object.entries(tags).map(([k, v]) => `${k}=${v}`).join("; ")}; b=`;
  data += canonHeader(`${head}\r\n`, "relaxed").replace(/\r\n$/, "");
  const b = sign(null, createHash("sha256").update(data, "latin1").digest(), s.privateKey).toString("base64");
  return `${head}${b}\r\n${text}`;
}

/** A DNS of these signers' keys only; any other name is "not found". */
export function testDns(...signers: TestSigner[]): TxtResolver {
  return async (name) => {
    const s = signers.find((x) => `${x.selector}._domainkey.${x.domain}` === name);
    if (!s) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return [[s.record]];
  };
}
