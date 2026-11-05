// D130/D131, private browsing: every Browser window (the person's and AgentZero's) goes through Tor, run inside this
// app as a SOCKS port on 127.0.0.1 (WKWebsiteDataStore.proxyConfigurations, iOS 17+). The internet provider sees only
// Tor; sites see a Tor exit, never the phone. DNS happens inside Tor (the host name goes to the SOCKS port). Default on;
// the Privacy screen turns it off, and a site can be set to normal from its own window (faster for trading).
// Drop, don't degrade: until Tor is up, a private window loads nothing; its store points at a closed port meanwhile, so a
// request that slipped out would fail, never go in the clear. tor is built from its signed sources (build-tor.sh); a
// build without it opens no private window ("Private browsing isn't on this phone yet.").
import Foundation
import Network
import WebKit
#if canImport(Tor)
import Tor
#endif

@MainActor
final class PrivateBrowsing {
  static let shared = PrivateBrowsing()
  /** Product decision, 3 Nov: normal browsing for now, "Tor coming soon". Off: no window goes through Tor, tor never starts, the
   *  Privacy screen says it's coming. The engine, the guards and the checks stay built; turning this on is the switch. */
  static let ready = false

  enum State: Equatable {
    /** This build has no tor in it. */
    case unavailable
    case off
    case connecting(Int)
    case ready(UInt16)
    case failed
  }

  private(set) var state: State = .off
  private var watchers: [UUID: (State) -> Void] = [:]

  private static let onKey = "zf.browser.private"
  private static let normalKey = "zf.browser.normal-sites"

  /** The person's choice (the Browser's Privacy screen). On unless they turned it off. */
  static var isOn: Bool {
    get { UserDefaults.standard.object(forKey: onKey) as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: onKey) }
  }

  /** Sites the person set to normal browsing from their own window (exact hosts). */
  static var normalSites: Set<String> {
    get { Set(UserDefaults.standard.stringArray(forKey: normalKey) ?? []) }
    set { UserDefaults.standard.set(newValue.sorted(), forKey: normalKey) }
  }

  /** Does a Browser window on this host go through Tor? */
  static func usesTor(host: String) -> Bool { ready && isOn && !normalSites.contains(host.lowercased()) }

  static var built: Bool {
    #if canImport(Tor)
    return ready
    #else
    return false
    #endif
  }

  /** Hear every change (the window that waits for Tor). Returns the id to stop hearing. */
  func watch(_ f: @escaping (State) -> Void) -> UUID {
    let id = UUID()
    watchers[id] = f
    f(state)
    return id
  }

  func unwatch(_ id: UUID) { watchers[id] = nil }

  private func set(_ s: State) {
    guard s != state else { return }
    state = s
    for f in watchers.values { f(s) }
  }

  /** A store for a private window: Tor's port once it's up, a closed loopback port until then. One user name per site,
   *  so each site gets its own circuit (IsolateSOCKSAuth). Set before the store's first use (WebKit bug 316948). */
  func configure(_ store: WKWebsiteDataStore, site: String) {
    let port: UInt16 = { if case .ready(let p) = state { return p } else { return 9 } }()
    var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!))
    proxy.allowFailover = false
    proxy.applyCredential(username: "zf-\(site.lowercased())", password: "zerofee")
    store.proxyConfigurations = [proxy]
  }

  /** Start tor once (any later call does nothing). */
  func start() {
    #if canImport(Tor)
    guard Self.ready else { return set(.unavailable) }
    // tor runs once per process (tor_api.h): a failure is final until ZeroFee opens again (review M3).
    guard state == .off else { return }
    set(.connecting(0))
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("tor", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path)
      // tor's state never goes into an iCloud or computer backup (review L)
      var keep = dir
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try keep.setResourceValues(values)
    } catch {
      return set(.failed)
    }
    guard let cfg = tor_main_configuration_new() else { return set(.failed) }
    let args = TorControl.arguments(dataDirectory: dir.path)
    // tor keeps the argv pointer itself (not a copy): it lives as long as the app does, never freed.
    let argv = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: args.count + 1)
    for (i, a) in args.enumerated() { argv[i] = strdup(a) }
    argv[args.count] = nil
    let fd = tor_main_configuration_setup_control_socket(cfg)
    guard fd >= 0, tor_main_configuration_set_command_line(cfg, Int32(args.count), argv) == 0 else {
      tor_main_configuration_free(cfg)
      return set(.failed)
    }
    // tor's own loop on its own thread; it keeps cfg and argv for the life of the app (tor runs once per process).
    nonisolated(unsafe) let torConfig = cfg // tor owns it from here, on its own thread only
    let runner = Thread { [weak self] in
      _ = tor_run_main(torConfig)
      // tor stopped: private windows can't load until ZeroFee opens again (never a second tor in this process)
      Task { @MainActor in self?.set(.failed) }
    }
    runner.name = "zf.tor"
    runner.stackSize = 4 << 20
    runner.start()
    listen(fd)
    #else
    set(.unavailable)
    #endif
  }

  /** tor's owning control socket: its bootstrap progress and its SOCKS port. */
  private nonisolated func listen(_ fd: Int32) {
    let reader = Thread { [weak self] in
      _ = TorControl.hello.withCString { write(fd, $0, strlen($0)) }
      var pending = ""
      var port: UInt16?
      var progress = 0
      var buf = [UInt8](repeating: 0, count: 4096)
      while true {
        let n = read(fd, &buf, buf.count)
        if n < 0, errno == EINTR { continue } // an interrupted read isn't tor stopping (review M3)
        if n <= 0 { break }
        pending += String(decoding: buf[0 ..< n], as: UTF8.self)
        while let r = pending.range(of: "\r\n") {
          let line = String(pending[..<r.lowerBound])
          pending.removeSubrange(..<r.upperBound)
          if let p = TorControl.socksPort(line) { port = p }
          if let p = TorControl.progress(line) { progress = max(progress, p) }
          let now: State = progress >= 100 && port != nil ? .ready(port!) : .connecting(progress)
          Task { @MainActor in self?.set(now) }
        }
      }
      // the control socket closed: tor is gone (tor_run_main's own return says so too)
      Task { @MainActor in self?.set(.failed) }
    }
    reader.name = "zf.tor.control"
    reader.start()
  }
}
