// The laptop page's key (product decision, 5 Nov): it never asks "what chip". Its passkey is the laptop's own (WebAuthn "platform":
// Touch ID, Windows Hello), hinted "client-device", read over "internal" only, so the browser shows only its own prompt:
// no phone, no QR code, no security key. Every other page keeps the iPhone (hybrid). The RP ID is the page's host on
// either candidate host, so a passkey made on one never answers on the other. Controls: the iPhone's request, put on
// the laptop page, fails each check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPasskey, passkeyAvailable } from "./passkey.ts";
import { ASK, createRequest, prfRequest } from "./passkey-requests.ts";
import { keyOnHere } from "./passkey-words.ts";
import { LAPTOP_LOCK } from "./laptop-lock-words.ts";
import { pageRpId, passkeyUserVerified } from "./verify.ts";

const z = (n: number) => new Uint8Array(n);
const platformOnly = (o: Record<string, any>) =>
  o.authenticatorSelection?.authenticatorAttachment === "platform" && !JSON.stringify(o).match(/cross-platform|hybrid|usb|nfc|ble|security-key/);

test("the laptop page is told by its mode, nothing else", () => {
  assert.equal(keyOnHere({ documentElement: { dataset: { mode: "laptop" } } }), "laptop");
  for (const mode of ["app", "demo", "screens", undefined]) assert.equal(keyOnHere({ documentElement: { dataset: { mode } } }), "iphone", String(mode));
  assert.equal(keyOnHere(undefined), "iphone");
});

test("create: platform only, hinted client-device, found by itself, user verification required; no rp.id (the host is the RP ID)", () => {
  const o = createRequest("laptop", z(32), z(32), z(16)) as Record<string, any>;
  assert.ok(platformOnly(o));
  assert.deepEqual(o.hints, ["client-device"]);
  assert.equal(o.authenticatorSelection.residentKey, "required");
  assert.equal(o.authenticatorSelection.userVerification, "required");
  assert.ok(o.extensions.prf);
  assert.deepEqual(Object.keys(o.rp), ["name"], "no rp.id: the browser uses the page's own host");
  // control: the iPhone's request fails on the laptop's check
  assert.ok(!platformOnly(createRequest("iphone", z(32), z(32), z(16)) as Record<string, any>));
});

test("every read on the laptop: the same passkey over internal only; the step-up check too", async () => {
  const r = prfRequest("laptop", z(3), z(32), z(32)) as Record<string, any>;
  assert.deepEqual(r.allowCredentials[0].transports, ["internal"]);
  assert.deepEqual(r.hints, ["client-device"]);
  assert.equal(r.userVerification, "required");
  const seen: Record<string, any>[] = [];
  await passkeyUserVerified(z(1), { get: async (o: any) => { seen.push(o.publicKey); return null; } } as never, "zerofee.si", { on: "laptop" });
  assert.deepEqual(seen[0]!.allowCredentials[0].transports, ["internal"]);
  assert.deepEqual(seen[0]!.hints, ["client-device"]);
  // control: the iPhone pages are unchanged (hybrid), and they'd fail the laptop's check
  assert.deepEqual(ASK.iphone.transports, ["hybrid"]);
  assert.deepEqual((prfRequest("iphone", z(3), z(32), z(32)) as Record<string, any>).allowCredentials[0].transports, ["hybrid"]);
});

test("no cross-platform path: a passkey the browser made off this laptop never seals it, and no platform passkey here means no", async () => {
  const fake = (attachment: string | null, uvpa: boolean) => {
    const credentials = {
      create: async () => ({ rawId: new Uint8Array([1]).buffer, authenticatorAttachment: attachment, getClientExtensionResults: () => ({ prf: { enabled: true } }) }),
      get: async () => ({ rawId: new Uint8Array([1]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(5).buffer } } }) }),
    };
    Object.defineProperty(globalThis, "navigator", { value: { credentials }, configurable: true });
    Object.defineProperty(globalThis, "PublicKeyCredential", { value: { isUserVerifyingPlatformAuthenticatorAvailable: async () => uvpa }, configurable: true });
  };
  fake("cross-platform", true);
  assert.equal(await createPasskey("laptop"), null, "a phone's or a security key's passkey: refused");
  fake("platform", true);
  assert.ok(await createPasskey("laptop"), "the laptop's own: made");
  assert.equal(await passkeyAvailable("laptop"), true);
  fake("platform", false);
  assert.equal(await passkeyAvailable("laptop"), false, "no Touch ID / Windows Hello: never the phone instead");
  assert.equal(await passkeyAvailable("iphone"), true, "control: the iPhone pages don't ask for a platform passkey");
});

test("RP ID per host: both candidate hosts are their own RP ID; a passkey of one never answers the other", () => {
  const at = (host: string) => pageRpId({ protocol: "https:", hostname: host, origin: `https://${host}` });
  assert.equal(at("laptop.zerofee.si"), "laptop.zerofee.si", "laptop.zerofee.si: the RP ID is its own host, so the website (zerofee.si) can't ask for its passkey");
  assert.equal(at("zerofee.si"), "zerofee.si");
  assert.equal(at("superapp.zerofee.si"), "superapp.zerofee.si", "superapp.zerofee.si/laptop: its own host");
  assert.notEqual(at("zerofee.si"), at("superapp.zerofee.si"));
  assert.notEqual(at("laptop.zerofee.si"), at("zerofee.si"));
});

test("the words: the product title, and never a claim that the key is in the chip", () => {
  assert.equal(LAPTOP_LOCK.setupTitle, "Laptop chip");
  for (const line of Object.values(LAPTOP_LOCK)) assert.doesNotMatch(line, /iPhone|scan|QR|security key/i, line);
  assert.doesNotMatch(Object.values(LAPTOP_LOCK).join(" ").replace("Laptop chip", ""), /chip/i, "the passkey may sync: no chip claim in the body");
});
