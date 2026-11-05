// The only scripts ZeroFee ever puts into a partner page (Security's D29 rules, backlog/security.md §B): the wallet
// provider (page world), the Sign-up Robot (its own content world, "zf-robot") and, in a site's own window only
// (Social trading, 2 Nov), the site's sign-in steps (their own content world, "zf-signin"), and in every partner window the
// words guard (its own content world, "zf-seedguard", every frame; product decision, 3 Nov). All come from the app bundle
// and nothing else: never fetched, never built from model output. The SHA-256 of each file's exact bytes is pinned below;
// the host hashes the bundled file before adding it, and a mismatch means the plain window plus one log line.
//
// Changing either script changes its pin here, and Security reviews the diff (`shasum -a 256` on the file);
// apps/web/src/host/partner-scripts.test.ts fails when a pin and its file disagree.
import CryptoKit
import Foundation
import WebKit

enum PartnerScripts {
  static let providerFile = "zf-partner-provider"
  static let robotFile = "zf-partner-robot"
  static let signInFile = "zf-site-signin"
  /** packages/browser/src/provider/provider.js (bundled by build-web.sh as zf-partner-provider.js); = its pin.ts. */
  static let providerPin = "6e083ac3b350bd769ed5825c5f4e8daf69f9d9559f4d03e55946a34f637158a9"
  /** apps/ios/ZeroFee/PartnerScripts/zf-partner-robot.js. */
  static let robotPin = "a4c442a278395e1cb479b319e86411ffa0d720e46f6dd29387ea69289058073f"

  /** apps/ios/ZeroFee/PartnerScripts/zf-site-signin.js: a site's own window's sign-in taps (fixed per exact host). */
  static let signInPin = "03861aa63e5cd4292be6f271fcaadf01aea63baaf41334bd04e731a21490ea94"
  /** The sign-in steps' own world: the page can't see or change them; they have no handler at all. */
  static let signInWorld = WKContentWorld.world(name: "zf-signin")

  static let seedGuardFile = "zf-seed-guard"
  /** apps/ios/ZeroFee/PartnerScripts/zf-seed-guard.js: names a page asking for the person's words (PartnerSeedGuard.swift). */
  static let seedGuardPin = "0038415a4ae3d5569c4a3300b8ef673007282f287d9783e16b5925eb42ef5eff"
  /** The words guard's own world: the page can't see it or post to its one handler (SeedGuard.handler, this world only). */
  static let seedGuardWorld = WKContentWorld.world(name: "zf-seedguard")

  /** The robot's own world: the page can't see its globals, and its handler is added for this world only. */
  static let robotWorld = WKContentWorld.world(name: "zf-robot")

  static func sha256Hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

  /** The script's text if its bytes match the pin exactly; nil (and a log line) otherwise. */
  static func verified(_ data: Data, pin: String, name: String) -> String? {
    let got = sha256Hex(data)
    guard got == pin, let text = String(data: data, encoding: .utf8) else {
      NSLog("[zf-host] %@ does not match its pin (got %@): the partner window stays plain", name, got)
      return nil
    }
    return text
  }

  private static func bundled(_ name: String, pin: String) -> String? {
    guard let url = Bundle.main.url(forResource: name, withExtension: "js"), let data = try? Data(contentsOf: url) else {
      NSLog("[zf-host] %@.js isn't in this build: the partner window stays plain", name)
      return nil
    }
    return verified(data, pin: pin, name: name)
  }

  /** provider.js: page world, main frame only, at document start. Nil when it fails its pin. */
  static func providerScript() -> WKUserScript? {
    bundled(providerFile, pin: providerPin).map { WKUserScript(source: $0, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page) }
  }

  /** robot.js's verified text (also used to install it into a page that is already loaded, in the robot's world only). */
  static func robotSource() -> String? { bundled(robotFile, pin: robotPin) }

  /** zf-site-signin.js: the "zf-signin" world, main frame only, at document end. Nil when it fails its pin. */
  static func signInScript() -> WKUserScript? {
    bundled(signInFile, pin: signInPin).map { WKUserScript(source: $0, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: signInWorld) }
  }

  /** zf-seed-guard.js: the "zf-seedguard" world, every frame (a frame can ask for words too), at document end. */
  static func seedGuardScript() -> WKUserScript? {
    bundled(seedGuardFile, pin: seedGuardPin).map { WKUserScript(source: $0, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: seedGuardWorld) }
  }

  /** robot.js: the "zf-robot" world, main frame only, at document end. */
  static func robotScript() -> WKUserScript? {
    robotSource().map { WKUserScript(source: $0, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: robotWorld) }
  }
}
