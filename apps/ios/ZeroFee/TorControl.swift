// D130/D131, private browsing: the pure parts (no UIKit, no tor), so apps/ios/check runs them on a Mac (partner.sh).
// The engine is PrivateBrowsing.swift; tor itself is built from its signed sources (tools/ios/build-tor.sh).
import Foundation

/** Reading tor's own control lines (its owning control socket: already authenticated, ours alone). */
enum TorControl {
  /** "… BOOTSTRAP PROGRESS=45 TAG=…" → 45; anything else → nil. */
  static func progress(_ line: String) -> Int? {
    guard line.contains("BOOTSTRAP"), let r = line.range(of: "PROGRESS=") else { return nil }
    let digits = line[r.upperBound...].prefix { $0.isNumber }
    guard let n = Int(digits), (0 ... 100).contains(n) else { return nil }
    return n
  }

  /** `250-net/listeners/socks="127.0.0.1:53419"` → 53419. Only a loopback listener counts (never one on the network). */
  static func socksPort(_ line: String) -> UInt16? {
    guard let r = line.range(of: "net/listeners/socks=") else { return nil }
    let value = line[r.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: "\" \r\n"))
    guard value.hasPrefix("127.0.0.1:"), let port = UInt16(value.dropFirst("127.0.0.1:".count)), port > 0 else { return nil }
    return port
  }

  /** tor's command line: a client only, one SOCKS port on loopback that gives each site its own circuit (by the user
   *  name each site's store sends), no torrc, no GeoIP files, nothing logged but errors. DNS happens inside Tor. */
  static func arguments(dataDirectory: String) -> [String] {
    ["tor", "--ignore-missing-torrc", "-f", "\(dataDirectory)/torrc-none", "--DataDirectory", dataDirectory,
     "--SocksPort", "127.0.0.1:auto IsolateSOCKSAuth", "--ClientOnly", "1", "--AvoidDiskWrites", "1",
     "--GeoIPFile", "", "--GeoIPv6File", "", "--Log", "err stderr", "--SafeLogging", "1", "--ClientUseIPv6", "1",
     // a request whose name was looked up on the phone is refused, never carried (DNS stays inside Tor)
     "--SafeSocks", "1"]
  }

  /** The control commands sent once tor runs: hear bootstrap progress, then ask where its SOCKS port is. */
  static let hello = "SETEVENTS STATUS_CLIENT\r\nGETINFO status/bootstrap-phase\r\nGETINFO net/listeners/socks\r\n"
}

/** The rules every Browser window follows, in either mode (D130/D131). */
enum PrivateRules {
  static let connectingLine = "Private browsing is connecting…"
  static let failedLine = "Private browsing stopped. Close ZeroFee and open it again. Nothing opened."
  static let unavailableLine = "Private browsing isn't on this phone yet. Nothing opened."
  static let didntOpenLine = "This page didn't open in private browsing."
  /** Pay's partner windows (a ramp knows who you are): said, never silent (QA, 3 Nov). */
  static let notPrivateLine = "This partner window doesn't use private browsing."
  static func useNormal(_ host: String) -> String { "Use normal browsing on \(host)" }
  static func usePrivate(_ host: String) -> String { "Use private browsing on \(host)" }
  static let normalWhy = "Faster, but the site sees your phone's address."
  static let turnOffTitle = "Turn off private browsing?"

  /**
   * The leak guard, in the page's own world, every frame, before the page's scripts: no WebRTC (its UDP finds the
   * phone's address around any proxy), no WebTransport, no DNS prefetch (each goes around WebKit's proxy on iOS 26:
   * Mysk, Aug 2026). In private browsing passkeys are off too (the system fetches a site's passkey list directly).
   */
  static func guardScript(privately: Bool) -> String {
    """
    (() => {
      const gone = (o, k) => { try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch (e) {} };
      const KEYS = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCRtpSender", "RTCRtpReceiver", "RTCRtpTransceiver", "RTCIceCandidate", "RTCSessionDescription", "WebTransport"];
      const scrub = (w) => { try { if (w) for (const k of KEYS) gone(w, k); } catch (e) {} return w; };
      scrub(window);
      // a blank frame made by the page gets no user script: scrub its window the moment the page reaches it
      try {
        const cw = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
        Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { get() { return scrub(cw.get.call(this)); }, configurable: false });
        const cd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentDocument");
        Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", { get() { const d = cd.get.call(this); if (d) scrub(d.defaultView); return d; }, configurable: false });
      } catch (e) {}
      try { const m = document.createElement("meta"); m.httpEquiv = "x-dns-prefetch-control"; m.content = "off"; (document.head || document.documentElement).prepend(m); } catch (e) {}
      \(privately ? "try { if (navigator.credentials) { const no = () => Promise.reject(new DOMException(\"Passkeys are off in private browsing.\", \"NotAllowedError\")); gone(navigator.credentials, \"get\"); gone(navigator.credentials, \"create\"); Object.defineProperty(navigator, \"credentials\", { value: { get: no, create: no }, configurable: false }); } } catch (e) {}" : "")
    })();
    """
  }
}
