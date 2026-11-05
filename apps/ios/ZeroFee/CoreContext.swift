// The trusted core in a JavaScriptCore context of its own (S1.6 phase 2, step 1): apart from the page, with no DOM, no
// page scripts and no message handler the apps could reach. Swift gives it the few things a browser would
// (`__native`, used by apps/ios/core/shims.ts): HTTPS requests, random bytes, timers, a log, its vault, and scrypt.
//
// On the phone (ZFIsolatedCore = YES) the Host runs the core here and the page reaches it only through `core.call`
// (Bridge.swift). The core's approvals, its chip key and the account contract's code come from the Host
// (CoreHostDelegate). The Mac smoke test (apps/ios/check/core-smoke.sh) loads the real bundle here too.
//
// One serial queue owns the context: every call into JavaScript, and every answer coming back from the network or a
// timer, runs on it.
import CommonCrypto
import Foundation
import JavaScriptCore
import Security

/** Where the isolated core keeps its state and keys: the Keychain on the phone, a dictionary in the smoke test. */
protocol CoreVault: AnyObject {
  func get(_ name: String) throws -> Data?
  func put(_ name: String, _ data: Data) throws
  func delete(_ name: String) throws
}

/** What only the app can do for the core: its native sheet, its chip key, its own files, and the page's events. */
@MainActor
protocol CoreHostDelegate: AnyObject {
  /** The native sheet for these words (PlainWords, JSON-decoded), with Face ID: true only if approved. */
  func coreApprove(_ words: Any?) async -> Bool
  /** The chip key: "info" | "create" | "sign" ({ id, words, bytes }) → { ok } | { problem }. */
  func coreKey(_ op: String, _ params: [String: Any]) async -> [String: Any]
  /** One of the app's files for the core ("account_policy.wasm"), or nil. Any thread: it only reads the app bundle. */
  nonisolated func coreResource(_ name: String) -> Data?
  /** An event from the core, for the page. */
  func coreEmit(_ event: String, _ payload: Any)
  /** The backup words, shown and checked natively: the three positions and words picked, or nil for Later. */
  func coreWords(_ words: [String], kid: Bool, renew: Bool) async -> ([Int], [String])?
  /** An exported separate wallet's key, shown natively (never to the page): true once shown. */
  func coreSecret(_ label: String, _ secretKey: String) async -> Bool
  /** The 24 words typed natively, for a restore or "Check my words": the words, or nil if the person stopped. */
  func coreTypeWords(_ purpose: String, wordlist: [String]) async -> [String]?
}

/** Confined to its own serial queue (everything that touches the context runs there), so it is safe to share. */
/**
 * The core's redirects: followed only to https and an allowed host, like the first request. Anything else isn't
 * followed, and the core gets the redirect itself as its answer (a 3xx it treats as no answer).
 */
final class RedirectGate: NSObject, URLSessionTaskDelegate, Sendable {
  let allowedHosts: Set<String>
  init(_ allowedHosts: Set<String>) { self.allowedHosts = allowedHosts }

  static func follows(_ url: URL?, allowedHosts: Set<String>) -> Bool {
    guard let url, url.scheme == "https", let host = url.host else { return false }
    return allowedHosts.contains(host)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
    completionHandler(Self.follows(request.url, allowedHosts: allowedHosts) ? request : nil)
  }
}

final class CoreContext: @unchecked Sendable {
  struct Failure: Error, CustomStringConvertible { let description: String }

  private let queue = DispatchQueue(label: "si.zerofee.core")
  private let context: JSContext
  private let vault: CoreVault
  private let session: URLSession
  private var timers: [Int: DispatchWorkItem] = [:]
  private var nextTimer = 1
  /** Hosts the core may reach. Everything else is refused before any request leaves the phone. */
  private let allowedHosts: Set<String>
  private weak var delegate: CoreHostDelegate?

  /** Every host the core's own code calls (packages/core/src: NEAR nodes and indexes on both networks, 1Click, and the
   *  separate wallets' chains). A new one is added here on purpose, never by the page. */
  static let coreHosts: Set<String> = [
    "test.rpc.fastnear.com", "near-testnet.drpc.org", "testnet-rpc.intea.rs", "test.api.fastnear.com", "tx.test.fastnear.com",
    "rpc.mainnet.fastnear.com", "near.drpc.org", "rpc.intea.rs", "api.fastnear.com", "tx.main.fastnear.com",
    "1click.chaindefuser.com",
    "solana-rpc.publicnode.com", "solana.api.pocket.network",
    "bsc-dataseed.bnbchain.org", "bsc-rpc.publicnode.com", "robinhood.drpc.org", "robinhood-rpc.publicnode.com", "rpc.mainnet.chain.robinhood.com",
    "gnosis-rpc.publicnode.com", "rpc.gnosischain.com",
    "ethereum-rpc.publicnode.com", "eth.drpc.org", "mainnet.base.org", "base-rpc.publicnode.com", "arb1.arbitrum.io", "arbitrum.drpc.org",
    "helper.testnet.near.org",
    // D119 perps: Hyperliquid, its test network (landing 1) and mainnet (landing 3)
    "api.hyperliquid-testnet.xyz",
    "api.hyperliquid.xyz", // D119 landing 3: mainnet (product decision, 3 Nov); the core's PERPS_NETWORK picks one
  ]

  /** Load the bundle (core/dist/zerofee-core.js) and start the core on `network`. Throws if the script doesn't load. */
  init(script: String, network: String, vault: CoreVault, delegate: CoreHostDelegate? = nil, allowedHosts: Set<String> = CoreContext.coreHosts, relay: String? = nil) throws {
    self.vault = vault
    self.delegate = delegate
    self.allowedHosts = allowedHosts
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.urlCache = nil
    config.timeoutIntervalForRequest = 30
    // A redirect is held to the same rule as the first request (the outside study's item 2): https and an allowed host.
    session = URLSession(configuration: config, delegate: RedirectGate(allowedHosts), delegateQueue: nil)
    guard let context = JSContext() else { throw Failure(description: "JavaScriptCore didn't make a context") }
    self.context = context
    context.name = "ZeroFee core"
    var thrown: String?
    context.exceptionHandler = { _, e in thrown = e?.toString() ?? "an unknown error" }
    try queue.sync {
      installNative()
      context.evaluateScript(script, withSourceURL: URL(string: "zerofee-core://core/zerofee-core.js"))
      if let thrown { throw Failure(description: "the core's script failed: \(thrown)") }
      let core = context.objectForKeyedSubscript("ZeroFeeCore")
      guard let core, !core.isUndefined else { throw Failure(description: "the script didn't define ZeroFeeCore") }
      let started = core.invokeMethod("start", withArguments: [Self.json(["network": network, "relay": relay ?? ""])])
      if let thrown { throw Failure(description: "the core didn't start: \(thrown)") }
      guard started?.toString() == "ok" else { throw Failure(description: "the core didn't start") }
      context.exceptionHandler = { _, e in NSLog("[zf-core] uncaught: %@", e?.toString() ?? "?") }
    }
  }

  /** One core method → its BridgeResult ({ ok } | { problem }), as JSON-decoded values. */
  func call(_ method: String, _ params: [String: Any] = [:]) async -> [String: Any] {
    let json = await invoke("call", [method, Self.json(params)])
    return (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? ["problem": ["code": "security.core.unreadable"]]
  }

  /** Two of the network's nodes agree on a recent block: { height, hash } | { error }. */
  func check() async -> [String: Any] {
    let json = await invoke("check", [])
    return (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? ["error": "unreadable"]
  }

  /** The shims, checked inside this context (shims.ts): { name: true | why not }. */
  func checkShims() async -> [String: Any] {
    let json = await invoke("checkShims", [])
    return (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? ["error": "unreadable"]
  }

  private func invoke(_ name: String, _ args: [Any]) async -> String {
    await withCheckedContinuation { (k: CheckedContinuation<String, Never>) in
      queue.async {
        let done: @convention(block) (String) -> Void = { k.resume(returning: $0) }
        let core = self.context.objectForKeyedSubscript("ZeroFeeCore")
        core?.invokeMethod(name, withArguments: args + [JSValue(object: done, in: self.context) as Any])
      }
    }
  }

  // ── What the core's world is made of (apps/ios/core/shims.ts) ─────────────────────────────────────────────────────

  private func installNative() {
    let native = JSValue(newObjectIn: context)!
    let fetch: @convention(block) (String, String, JSValue) -> Void = { [weak self] url, initJSON, done in
      self?.fetch(url, initJSON, done)
    }
    let random: @convention(block) (Int) -> [Int] = { n in
      guard n >= 0, n <= 65536 else { return [] }
      var bytes = [UInt8](repeating: 0, count: n)
      guard SecRandomCopyBytes(kSecRandomDefault, n, &bytes) == errSecSuccess else { return [] }
      return bytes.map(Int.init)
    }
    let setTimer: @convention(block) (Double, JSValue) -> Int = { [weak self] ms, fire in
      self?.setTimer(ms, fire) ?? 0
    }
    let clearTimer: @convention(block) (Int) -> Void = { [weak self] id in
      self?.timers.removeValue(forKey: id)?.cancel()
    }
    let log: @convention(block) (String, String) -> Void = { level, text in
      NSLog("[zf-core] %@ %@", level, text)
    }
    let vault: @convention(block) (String, String, String, JSValue) -> Void = { [weak self] op, name, b64, done in
      self?.vaultOp(op, name, b64, done)
    }
    let approve: @convention(block) (String, JSValue) -> Void = { [weak self] words, done in
      self?.approve(words, done)
    }
    let key: @convention(block) (String, String, JSValue) -> Void = { [weak self] op, params, done in
      self?.key(op, params, done)
    }
    let resource: @convention(block) (String) -> String = { [weak self] name in
      self?.delegate?.coreResource(name)?.base64EncodedString() ?? ""
    }
    let emit: @convention(block) (String, String) -> Void = { [weak self] event, payload in
      let value = (try? JSONSerialization.jsonObject(with: Data(payload.utf8), options: [.fragmentsAllowed])) ?? [:]
      Task { @MainActor in self?.delegate?.coreEmit(event, value) }
    }
    let words: @convention(block) (String, JSValue) -> Void = { [weak self] json, done in
      self?.words(json, done)
    }
    let secret: @convention(block) (String, JSValue) -> Void = { [weak self] json, done in
      self?.secret(json, done)
    }
    let typeWords: @convention(block) (String, JSValue) -> Void = { [weak self] json, done in
      self?.typeWords(json, done)
    }
    let scrypt: @convention(block) (String, JSValue) -> Void = { [weak self] json, done in
      self?.scrypt(json, done)
    }
    for (name, block) in [("fetch", fetch as Any), ("random", random), ("setTimer", setTimer), ("clearTimer", clearTimer), ("log", log), ("vault", vault),
                          ("approve", approve), ("key", key), ("resource", resource), ("emit", emit), ("words", words), ("secret", secret),
                          ("typeWords", typeWords), ("scrypt", scrypt)] {
      native.setObject(block, forKeyedSubscript: name as NSString)
    }
    context.setObject(native, forKeyedSubscript: "__native" as NSString)
  }

  /** HTTPS only, to the allowed hosts only; the answer goes back on the core's queue as JSON with a base64 body. */
  private func fetch(_ urlText: String, _ initJSON: String, _ done: JSValue) {
    let reply: ([String: Any]) -> Void = { [weak self] value in
      self?.queue.async { done.call(withArguments: [Self.json(value)]) }
    }
    guard let url = URL(string: urlText), url.scheme == "https", let host = url.host, allowedHosts.contains(host) else {
      return reply(["error": "the core may not reach \(URL(string: urlText)?.host ?? "that address")"])
    }
    let spec = (try? JSONSerialization.jsonObject(with: Data(initJSON.utf8))) as? [String: Any] ?? [:]
    var request = URLRequest(url: url)
    request.httpMethod = (spec["method"] as? String ?? "GET").uppercased()
    for (k, v) in spec["headers"] as? [String: String] ?? [:] { request.setValue(v, forHTTPHeaderField: k) }
    if let b64 = spec["body"] as? String { request.httpBody = Data(base64Encoded: b64) }
    // At most 2 MB an answer (audit NF-22, the core's net.ts): read as it streams and cancelled past it, never whole.
    let session = self.session
    Task {
      do {
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { return reply(["error": "no answer"]) }
        if http.expectedContentLength > Int64(Self.maxResponseBytes) {
          bytes.task.cancel()
          return reply(["error": "the answer is too large"])
        }
        var data = Data()
        for try await byte in bytes {
          data.append(byte)
          if data.count > Self.maxResponseBytes {
            bytes.task.cancel()
            return reply(["error": "the answer is too large"])
          }
        }
        var headers: [String: String] = [:]
        for (k, v) in http.allHeaderFields { headers[String(describing: k).lowercased()] = String(describing: v) }
        reply(["status": http.statusCode, "headers": headers, "body": data.base64EncodedString()])
      } catch {
        reply(["error": error.localizedDescription])
      }
    }
  }

  /** The most an answer to the core may be (audit NF-22). */
  static let maxResponseBytes = 2 * 1024 * 1024

  /** The native sheet (on the main actor); the answer comes back on the core's queue. No delegate: no. */
  private func approve(_ wordsJSON: String, _ done: JSValue) {
    let words = try? JSONSerialization.jsonObject(with: Data(wordsJSON.utf8))
    Task { @MainActor [weak self] in
      let yes = await self?.delegate?.coreApprove(words) ?? false
      self?.queue.async { done.call(withArguments: [yes]) }
    }
  }

  /** The backup words on the native screen; done(JSON { positions, words } | null). No delegate: null. */
  private func words(_ json: String, _ done: JSValue) {
    let spec = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    let list = spec["words"] as? [String] ?? []
    let kid = spec["kid"] as? Bool ?? false
    let renew = spec["renew"] as? Bool ?? false
    Task { @MainActor [weak self] in
      let picked = await self?.delegate?.coreWords(list, kid: kid, renew: renew)
      let reply: Any = picked.map { ["positions": $0.0, "words": $0.1] } ?? NSNull()
      self?.queue.async { done.call(withArguments: [Self.json(reply)]) }
    }
  }

  /** The 24 words typed on the native screen; done(JSON string[] | null). No delegate: null. They go only to the core. */
  private func typeWords(_ json: String, _ done: JSValue) {
    let spec = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    let asked = spec["purpose"] as? String
    let purpose = asked == "check" || asked == "rearm" || asked == "codes" ? asked! : "restore"
    let wordlist = spec["wordlist"] as? [String] ?? []
    Task { @MainActor [weak self] in
      let typed = wordlist.count == 2048 ? await self?.delegate?.coreTypeWords(purpose, wordlist: wordlist) : nil
      self?.queue.async { done.call(withArguments: [Self.json(typed.map { $0 as Any } ?? NSNull())]) }
    }
  }

  /** An exported key on the native screen; done(true) once shown. No delegate: false (nothing shown, nothing returned). */
  private func secret(_ json: String, _ done: JSValue) {
    let spec = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    let label = spec["label"] as? String ?? "separate wallet"
    let key = spec["secretKey"] as? String ?? ""
    Task { @MainActor [weak self] in
      let shown = key.isEmpty ? false : await self?.delegate?.coreSecret(label, key) ?? false
      self?.queue.async { done.call(withArguments: [shown]) }
    }
  }

  private func key(_ op: String, _ paramsJSON: String, _ done: JSValue) {
    let params = (try? JSONSerialization.jsonObject(with: Data(paramsJSON.utf8))) as? [String: Any] ?? [:]
    Task { @MainActor [weak self] in
      let reply = await self?.delegate?.coreKey(op, params) ?? ["problem": ["code": "security.key.refused", "whatHappened": "This build has no secure chip key.", "money": ["state": "not-involved"], "next": ["kind": "nothing", "label": "Go back"]]]
      self?.queue.async { done.call(withArguments: [Self.json(reply)]) }
    }
  }

  /** scrypt (JSON { password, salt (base64), N, r, p, dkLen }) on its own queue, never this one: done(JSON { key (base64) } | { error }). */
  private func scrypt(_ json: String, _ done: JSValue) {
    let spec = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    let password = (spec["password"] as? String).flatMap { Data(base64Encoded: $0) }
    let salt = (spec["salt"] as? String).flatMap { Data(base64Encoded: $0) }
    let n = spec["N"] as? Int ?? 0, r = spec["r"] as? Int ?? 0, p = spec["p"] as? Int ?? 0, dkLen = spec["dkLen"] as? Int ?? 0
    Scrypt.queue.async { [weak self] in
      var reply: [String: Any] = ["error": "not scrypt's parameters"]
      if let password, let salt, let key = Scrypt.derive(password: [UInt8](password), salt: [UInt8](salt), N: n, r: r, p: p, dkLen: dkLen) {
        reply = ["key": Data(key).base64EncodedString()]
      }
      self?.queue.async { done.call(withArguments: [Self.json(reply)]) }
    }
  }

  private func setTimer(_ ms: Double, _ fire: JSValue) -> Int {
    let id = nextTimer
    nextTimer += 1
    let item = DispatchWorkItem { [weak self] in
      self?.timers.removeValue(forKey: id)
      fire.call(withArguments: [])
    }
    timers[id] = item
    queue.asyncAfter(deadline: .now() + .milliseconds(Int(max(0, ms.isFinite ? ms : 0))), execute: item)
    return id
  }

  private func vaultOp(_ op: String, _ name: String, _ b64: String, _ done: JSValue) {
    var result: [String: Any]
    do {
      switch op {
      case "get": result = ["bytes": try vault.get(name)?.base64EncodedString() as Any? ?? NSNull()]
      case "put":
        guard let data = Data(base64Encoded: b64) else { throw Failure(description: "not base64") }
        try vault.put(name, data)
        result = ["bytes": NSNull()]
      case "delete":
        try vault.delete(name)
        result = ["bytes": NSNull()]
      default: result = ["error": "unknown secure-storage step"]
      }
    } catch {
      result = ["error": "this phone's secure storage didn't answer"]
    }
    queue.async { done.call(withArguments: [Self.json(result)]) }
  }

  private static func json(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return "null" }
    return String(decoding: data, as: UTF8.self)
  }
}

// ── scrypt, natively (RFC 7914) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * scrypt for the core (`__native.scrypt`): linking the laptop's extension opens its box with scrypt N=2^17, r=8, p=1,
 * which took 21 s in plain JS in this context (2 Nov), on the core's one queue, so the whole app waited. Here it is
 * PBKDF2-HMAC-SHA256 from CommonCrypto and Salsa20/8 BlockMix/ROMix on raw buffers, off the core's queue. The same
 * parameters give the same bytes as @noble/hashes' scrypt (RFC 7914's vectors: apps/ios/check/scrypt.sh).
 */
enum Scrypt {
  /** The most memory one derivation may take (128·r·N bytes): the link's is 128 MiB. */
  static let maxMemory = 256 * 1024 * 1024
  /** One derivation at a time (each holds 128·r·N bytes), never on the core's queue or the main thread. */
  static let queue = DispatchQueue(label: "si.zerofee.core.scrypt", qos: .userInitiated)

  /** scrypt(password, salt, N, r, p, dkLen), or nil if the parameters aren't scrypt's (or need more than maxMemory). */
  static func derive(password: [UInt8], salt: [UInt8], N: Int, r: Int, p: Int, dkLen: Int, maxMemory: Int = Scrypt.maxMemory) -> [UInt8]? {
    guard N > 1, N & (N - 1) == 0, r >= 1, p >= 1, dkLen >= 1, dkLen <= 1 << 20, r <= 1 << 16, p <= 1 << 16, r * p < 1 << 30 else { return nil }
    let (memory, over) = (128 * r).multipliedReportingOverflow(by: N)
    guard !over, memory <= maxMemory, N <= Int(UInt32.max) else { return nil }
    let blockBytes = 128 * r, words = 32 * r
    guard var b = pbkdf2(password, salt, p * blockBytes) else { return nil }
    let v = UnsafeMutablePointer<UInt32>.allocate(capacity: words * N)
    let xy = UnsafeMutablePointer<UInt32>.allocate(capacity: 2 * words + 16)
    defer {
      memset_s(v, words * N * 4, 0, words * N * 4)
      memset_s(xy, (2 * words + 16) * 4, 0, (2 * words + 16) * 4)
      v.deallocate()
      xy.deallocate()
    }
    b.withUnsafeMutableBufferPointer { bytes in
      for i in 0..<p {
        let chunk = bytes.baseAddress! + i * blockBytes
        // Little-endian words in, ROMix, little-endian words out.
        for k in 0..<words {
          let o = chunk + 4 * k
          xy[k] = UInt32(o[0]) | UInt32(o[1]) &<< 8 | UInt32(o[2]) &<< 16 | UInt32(o[3]) &<< 24
        }
        roMix(xy, v, xy + words, xy + 2 * words, r, N)
        for k in 0..<words {
          let w = xy[k], o = chunk + 4 * k
          o[0] = UInt8(truncatingIfNeeded: w)
          o[1] = UInt8(truncatingIfNeeded: w &>> 8)
          o[2] = UInt8(truncatingIfNeeded: w &>> 16)
          o[3] = UInt8(truncatingIfNeeded: w &>> 24)
        }
      }
    }
    let key = pbkdf2(password, b, dkLen)
    b.withUnsafeMutableBytes { _ = memset_s($0.baseAddress, $0.count, 0, $0.count) }
    return key
  }

  /** PBKDF2-HMAC-SHA256, one iteration (CommonCrypto). */
  private static func pbkdf2(_ password: [UInt8], _ salt: [UInt8], _ length: Int) -> [UInt8]? {
    var out = [UInt8](repeating: 0, count: length)
    let status = password.withUnsafeBufferPointer { pw in
      salt.withUnsafeBufferPointer { s in
        pw.withMemoryRebound(to: CChar.self) { pwc in
          CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pwc.baseAddress, pw.count, s.baseAddress, s.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 1, &out, length)
        }
      }
    }
    return status == kCCSuccess ? out : nil
  }

  /** ROMix on x (32·r words, in place), with v (32·r·N words), y (32·r words) and t (16 words) as scratch. */
  private static func roMix(_ b: UnsafeMutablePointer<UInt32>, _ v: UnsafeMutablePointer<UInt32>, _ yIn: UnsafeMutablePointer<UInt32>, _ t: UnsafeMutablePointer<UInt32>, _ r: Int, _ n: Int) {
    let words = 32 * r
    var x = b, y = yIn
    for i in 0..<n {
      (v + i * words).update(from: x, count: words)
      blockMix(x, y, t, r)
      swap(&x, &y)
    }
    let last = (2 * r - 1) * 16, mask = n - 1
    for _ in 0..<n {
      let j = Int(x[last]) & mask
      let vj = v + j * words
      for k in 0..<words { x[k] ^= vj[k] }
      blockMix(x, y, t, r)
      swap(&x, &y)
    }
    // After an even number of swaps x is b again (2·N swaps); kept general all the same.
    if x != b { b.update(from: x, count: words) }
  }

  /** BlockMix(input) → output: Salsa20/8 over the 2·r 64-byte blocks, evens first then odds. */
  @inline(__always)
  private static func blockMix(_ input: UnsafeMutablePointer<UInt32>, _ output: UnsafeMutablePointer<UInt32>, _ t: UnsafeMutablePointer<UInt32>, _ r: Int) {
    t.update(from: input + (2 * r - 1) * 16, count: 16)
    for i in 0..<(2 * r) {
      let blk = input + i * 16
      for k in 0..<16 { t[k] ^= blk[k] }
      salsa8(t)
      (output + ((i & 1) * r + (i >> 1)) * 16).update(from: t, count: 16)
    }
  }

  @inline(__always)
  private static func rotl(_ a: UInt32, _ n: UInt32) -> UInt32 { (a &<< n) | (a &>> (32 - n)) }

  /** Salsa20/8's core on 16 words, in place. */
  @inline(__always)
  private static func salsa8(_ b: UnsafeMutablePointer<UInt32>) {
    var x0 = b[0], x1 = b[1], x2 = b[2], x3 = b[3], x4 = b[4], x5 = b[5], x6 = b[6], x7 = b[7]
    var x8 = b[8], x9 = b[9], x10 = b[10], x11 = b[11], x12 = b[12], x13 = b[13], x14 = b[14], x15 = b[15]
    for _ in 0..<4 {
      // columns
      x4 ^= rotl(x0 &+ x12, 7); x8 ^= rotl(x4 &+ x0, 9); x12 ^= rotl(x8 &+ x4, 13); x0 ^= rotl(x12 &+ x8, 18)
      x9 ^= rotl(x5 &+ x1, 7); x13 ^= rotl(x9 &+ x5, 9); x1 ^= rotl(x13 &+ x9, 13); x5 ^= rotl(x1 &+ x13, 18)
      x14 ^= rotl(x10 &+ x6, 7); x2 ^= rotl(x14 &+ x10, 9); x6 ^= rotl(x2 &+ x14, 13); x10 ^= rotl(x6 &+ x2, 18)
      x3 ^= rotl(x15 &+ x11, 7); x7 ^= rotl(x3 &+ x15, 9); x11 ^= rotl(x7 &+ x3, 13); x15 ^= rotl(x11 &+ x7, 18)
      // rows
      x1 ^= rotl(x0 &+ x3, 7); x2 ^= rotl(x1 &+ x0, 9); x3 ^= rotl(x2 &+ x1, 13); x0 ^= rotl(x3 &+ x2, 18)
      x6 ^= rotl(x5 &+ x4, 7); x7 ^= rotl(x6 &+ x5, 9); x4 ^= rotl(x7 &+ x6, 13); x5 ^= rotl(x4 &+ x7, 18)
      x11 ^= rotl(x10 &+ x9, 7); x8 ^= rotl(x11 &+ x10, 9); x9 ^= rotl(x8 &+ x11, 13); x10 ^= rotl(x9 &+ x8, 18)
      x12 ^= rotl(x15 &+ x14, 7); x13 ^= rotl(x12 &+ x15, 9); x14 ^= rotl(x13 &+ x12, 13); x15 ^= rotl(x14 &+ x13, 18)
    }
    b[0] &+= x0; b[1] &+= x1; b[2] &+= x2; b[3] &+= x3; b[4] &+= x4; b[5] &+= x5; b[6] &+= x6; b[7] &+= x7
    b[8] &+= x8; b[9] &+= x9; b[10] &+= x10; b[11] &+= x11; b[12] &+= x12; b[13] &+= x13; b[14] &+= x14; b[15] &+= x15
  }
}
