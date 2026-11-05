// Sites' two-factor codes on the phone (SiteCodes.swift; security review of 9004735f (c); decisions G and K2):
// each secret sealed under a Face ID chip key, the same exact hosts as the core's list, the core's backup methods out of
// every page's reach, and a fill only into the site's own main frame. The Swift TOTP itself was checked against
// RFC 4226 Appendix D and RFC 6238 Appendix B by compiling its functions on the Mac (see the commit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ISSUER_NAMES, TWO_FACTOR_SITES } from "../../packages/core/src/site-2fa.ts";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
const codes = read("apps/ios/ZeroFee/SiteCodes.swift");
const isolated = read("apps/ios/ZeroFee/IsolatedCore.swift");
const partner = read("apps/ios/ZeroFee/PartnerView.swift");
const logins = read("apps/ios/ZeroFee/Logins.swift");
const vercel = JSON.parse(read("apps/quotes/vercel.json")) as { rewrites: { source: string }[] };

/** A Swift `[String: [String]]` literal's entries, by its `static let <name>` line. */
function swiftMap(name: string): Record<string, string[]> {
  const line = codes.split("\n").find((l) => l.includes(`static let ${name}: [String: [String]] = [`));
  assert.ok(line, `SiteCodes.${name}`);
  const out: Record<string, string[]> = {};
  for (const m of line.matchAll(/"([^"]+)": \[([^\]]*)\]/g)) out[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return out;
}

test("the phone's sites and hosts are exactly the core's (no wildcard subdomains), and so are their issuers", () => {
  assert.deepEqual(swiftMap("hosts"), Object.fromEntries(Object.entries(TWO_FACTOR_SITES).map(([k, v]) => [k, [...v]])));
  assert.deepEqual(swiftMap("issuers"), Object.fromEntries(Object.entries(ISSUER_NAMES).map(([k, v]) => [k, [...v]])));
});

test("review (c): each secret is sealed to a chip key that needs today's faces, kept on this device only", () => {
  assert.match(codes, /\[\.privateKeyUsage, \.biometryCurrentSet\]/);
  assert.match(codes, /kSecAttrTokenIDSecureEnclave/);
  assert.match(codes, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(codes, /SecKeyCreateEncryptedData\(pub, Logins\.algorithm/);
  assert.doesNotMatch(codes, /kSecAttrSynchronizable as String: true/);
  // Opening needs a Face ID context first (faceId: Logins.approvedContext), then the enclave's decrypt with it.
  const show = codes.slice(codes.indexOf("private static func show("));
  assert.ok(show.indexOf("await faceId(") >= 0 && show.indexOf("await faceId(") < show.indexOf("open(it, context: context)"));
  assert.match(codes.slice(codes.indexOf("private static func faceId(")), /try\? await Logins\.approvedContext\(reason: reason\)/);
});

test("the core's site2fa.* is no page's: not a family the page may call, and refused before the isolated-core switch", () => {
  const families = isolated.match(/static let coreFamilies: Set<String> = \[([^\]]*)\]/)?.[1] ?? "";
  assert.ok(families.length > 0 && !families.includes("site2fa"));
  const body = isolated.slice(isolated.indexOf("func pageMayUse("));
  assert.ok(body.indexOf('if method.hasPrefix("site2fa.") { return false }') < body.indexOf("guard Self.isolatedCoreWanted"));
});

test("a code is filled only into the main frame of the site's own https page, checked again inside the page", () => {
  const fill = partner.slice(partner.indexOf("func fillSiteCode("), partner.indexOf("@objc private func pageBack()"));
  assert.match(fill, /guard SiteCodes\.site\(of: web\.url\) == site/);
  assert.match(fill, /location\.protocol !== "https:" \|\| location\.hostname !== host/);
  assert.match(fill, /in: nil, contentWorld: \.defaultClient/, "the main frame (nil), never an iframe");
  assert.match(partner, /codeItem\?\.isHidden = SiteCodes\.site\(of: web\.url\) == nil/);
});

test("account forget and the first launch after an install wipe the codes and their key with the logins", () => {
  const wipe = logins.slice(logins.indexOf("static func wipe()"), logins.indexOf("static func wipeOnFirstLaunch()"));
  assert.match(wipe, /SiteCodes\.wipe\(\)/);
  assert.match(wipe, /return gone\(items\) && gone\(key\) && codes/);
});

test("the relay's keep route is reached by its own rewrite, before the catch-all", () => {
  const sources = vercel.rewrites.map((r) => r.source);
  const keep = sources.indexOf("/v0/keep/:id");
  assert.ok(keep >= 0 && keep < sources.indexOf("/v0/:route"));
});

const entry = read("apps/ios/core/entry.ts");
const words = read("apps/ios/ZeroFee/WordsEntry.swift");
const context = read("apps/ios/ZeroFee/CoreContext.swift");

test("review MUST 1: the words' copy opens only after Face ID with the account's approval key, or the words typed", () => {
  assert.match(isolated, /if op == "approval-confirm" \{ return ok\(\["approved": await ApprovalPass\.shared\.confirm\(\)\]\) \}/);
  assert.match(entry, /codesStepUp: async \(\) => \{\s*const r = await keyCall<\{ approved: boolean \}>\("approval-confirm"\);\s*return "ok" in r && r\.ok\.approved === true;/);
  assert.match(context, /asked == "codes"/, "the words screen opens for codes");
  assert.match(words, /purpose == "codes" \? "Bring back my codes"/);
  // the phone never opens the copy itself: it asks the core's site2fa.restore, which decides
  assert.doesNotMatch(codes, /keepKeys|HOT_ROOT|hot-root/);
});

test("review G2: a backup that didn't answer says try again, never set-up", () => {
  const open = codes.slice(codes.indexOf("@MainActor static func open("), codes.indexOf("private static func faceId("));
  assert.match(open, /case \.unreachable: return await say\(host, "ZeroFee's backup didn't answer\. Tap the key button again in a minute\."\)/);
  assert.match(open, /case \.declined: return/);
});

test("review G1 and G3: a Face ID that can't run is said; a face change names every code it took", () => {
  assert.match(codes, /"Face ID isn't set up on this phone\. Turn it on in Settings\."/);
  const changed = codes.slice(codes.indexOf("private static func facesChanged("), codes.indexOf("private static func setUp("));
  assert.match(changed, /let had = items\(\)\s*wipe\(\)/);
  assert.match(changed, /for other in had where other\.site != site/);
  assert.match(changed, /It wasn't backed up yet\. Set it up again on/);
});
