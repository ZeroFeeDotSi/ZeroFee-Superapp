// What the chip will sign (S1.6), checked before any sheet: the bytes must start as an unsigned NEAR transaction (the
// core's V0 form) whose signer key is THIS phone's chip key, and the hash is computed here from those bytes, never taken
// from the page. So the page can't get a chip signature over anything else: a delegate action (NEP-366, which anyone
// could relay), a signed message (NEP-413), another key's transaction, or a bare 32-byte hash. One NEP-413 message is
// the exception, built here from its parts (AlertsProof, below): the relay's email-alerts proof, for this build's own
// relay only, four fixed lines, ten minutes at most.
//
// Borsh, as the core writes it (packages/core/src/tx-decode.ts): signer_id (u32 length + text), public_key (u8 type:
// 2 = ML-DSA-65, then its 1,952 bytes), nonce (u64), receiver_id, block_hash (32 bytes), actions (u32 count, then each).
import CryptoKit
import Foundation

enum NearTx {
  static let mlDsa65Tag: UInt8 = 2
  static let mlDsa65Length = 1952
  /** The largest transaction NEAR takes (1.5 MiB). */
  static let maxBytes = 1_572_864

  struct Header: Equatable {
    let signerId: String
    let receiverId: String
    let nonce: UInt64
    let actions: Int
  }

  /** The header, if `bytes` is a NEAR transaction signed by `publicKey` (its 1,952 raw bytes); nil otherwise. */
  static func header(_ bytes: Data, publicKey: Data) -> Header? {
    guard bytes.count <= maxBytes, publicKey.count == mlDsa65Length else { return nil }
    var r = Reader(bytes)
    guard let signer = r.accountId(),
          r.u8() == mlDsa65Tag,
          r.fixed(mlDsa65Length) == publicKey,
          let nonce = r.u64(),
          let receiver = r.accountId(),
          r.fixed(32) != nil,
          let count = r.u32(), (1...1000).contains(count),
          r.remaining > 0
    else { return nil }
    return Header(signerId: signer, receiverId: receiver, nonce: nonce, actions: Int(count))
  }

  /** What the chip signs: sha256 of the exact transaction bytes. */
  static func hash(_ bytes: Data) -> Data { Data(SHA256.hash(data: bytes)) }

  // MARK: The sheet's own reading (iOS audit, finding 1)
  //
  // The sheet's words come from JavaScript. With them comes a structured summary (packages/core/src/sheet-summary.ts):
  // the receiver and every step, and for the account's own execute()/execute_many() each inner receiver and its steps.
  // The bytes are decoded here, in full, and the chip signs only when they say exactly that summary. The key fields
  // (to whom, how much NEAR, which key) are then shown from these bytes, not from the words.

  /** One step, as the summary names it and as the bytes say it. Amounts and gas: whole numbers as text. */
  enum Step: Equatable {
    case transfer(deposit: String)
    case call(method: String, deposit: String, gas: String)
    case addKey(publicKey: String, permission: Permission)
    case deleteKey(publicKey: String)
    case deploy(codeSha256: String)
    case useGlobal(codeHash: String)
  }

  enum Permission: Equatable {
    case full
    case functionCall(receiver: String, methods: [String], allowance: String?)
  }

  struct Group: Equatable {
    let receiver: String
    let steps: [Step]
  }

  struct Summary: Equatable {
    let receiver: String
    let actions: [Step]
    /** Only for a call to the account's own execute() or execute_many(). */
    let inner: [Group]?
  }

  /** What the bytes say: the summary they match, and the lines the sheet shows from them. */
  struct Decoded {
    let signerId: String
    let summary: Summary
    let checked: [String]
  }

  /** The bytes, decoded in full: a transaction for `publicKey` whose every action ZeroFee signs; nil otherwise (any other
   *  action kind, a key type it doesn't know, unreadable execute() steps, or bytes left over). */
  static func decode(_ bytes: Data, publicKey: Data) -> Decoded? {
    guard bytes.count <= maxBytes, publicKey.count == mlDsa65Length else { return nil }
    var r = Reader(bytes)
    guard let signer = r.accountId(), r.u8() == mlDsa65Tag, r.fixed(mlDsa65Length) == publicKey, r.u64() != nil,
          let receiver = r.accountId(), r.fixed(32) != nil, let count = r.u32(), (1...1000).contains(count)
    else { return nil }
    var steps: [Step] = []
    var args: [Data?] = []
    for _ in 0..<count {
      guard let tag = r.u8() else { return nil }
      switch tag {
      case 1:
        guard let code = r.vec() else { return nil }
        steps.append(.deploy(codeSha256: hex(Data(SHA256.hash(data: code)))))
        args.append(nil)
      case 2:
        guard let m = r.vec(), let method = String(data: m, encoding: .utf8), method.wholeMatch(of: /[A-Za-z_][A-Za-z0-9_]{0,255}/) != nil,
              let a = r.vec(), let gas = r.u64(), let deposit = r.u128() else { return nil }
        steps.append(.call(method: method, deposit: deposit, gas: String(gas)))
        args.append(a)
      case 3:
        guard let deposit = r.u128() else { return nil }
        steps.append(.transfer(deposit: deposit))
        args.append(nil)
      case 5:
        guard let key = r.key(), r.u64() != nil, let permission = r.permission() else { return nil }
        steps.append(.addKey(publicKey: key, permission: permission))
        args.append(nil)
      case 6:
        guard let key = r.key() else { return nil }
        steps.append(.deleteKey(publicKey: key))
        args.append(nil)
      case 10:
        guard r.u8() == 0, let h = r.fixed(32) else { return nil }
        steps.append(.useGlobal(codeHash: hex(h)))
        args.append(nil)
      default:
        return nil // create-account, stake, delete-account, delegate, …: never what ZeroFee asks the chip to sign
      }
    }
    guard r.remaining == 0 else { return nil }
    var inner: [Group]?
    var innerArgs: [[Data?]] = []
    if steps.count == 1, receiver == signer, case .call(let method, _, _) = steps[0], method == "execute" || method == "execute_many" {
      guard let a = args[0], let json = try? JSONSerialization.jsonObject(with: a) else { return nil }
      let groups: [Any]
      if method == "execute" {
        groups = [json]
      } else {
        guard let g = (json as? [String: Any])?["groups"] as? [Any], !g.isEmpty else { return nil }
        groups = g
      }
      var out: [Group] = []
      for g in groups {
        guard let (group, a) = executeGroup(g) else { return nil }
        out.append(group)
        innerArgs.append(a)
      }
      inner = out
    }
    let summary = Summary(receiver: receiver, actions: steps, inner: inner)
    let lines = inner.map { checkedLines(signer: signer, groups: $0, args: innerArgs) }
      ?? checkedLines(signer: signer, groups: [Group(receiver: receiver, steps: steps)], args: [args])
    return Decoded(signerId: signer, summary: summary, checked: lines)
  }

  /** The summary the core sent with the words (sheet-summary.ts); nil when it isn't one. */
  static func summary(_ any: Any?) -> Summary? {
    guard let o = any as? [String: Any], let receiver = o["receiver"] as? String, let actions = (o["actions"] as? [Any]).flatMap(steps) else { return nil }
    var inner: [Group]?
    if let i = o["inner"], !(i is NSNull) {
      guard let list = i as? [Any] else { return nil }
      var out: [Group] = []
      for g in list {
        guard let g = g as? [String: Any], let r = g["receiver"] as? String, let s = (g["steps"] as? [Any]).flatMap(steps) else { return nil }
        out.append(Group(receiver: r, steps: s))
      }
      inner = out
    }
    return Summary(receiver: receiver, actions: actions, inner: inner)
  }

  /** The bytes say exactly the summary the sheet was built from. */
  static func matches(_ decoded: Decoded, _ summary: Summary) -> Bool { decoded.summary == summary }

  private static func steps(_ list: [Any]) -> [Step]? {
    var out: [Step] = []
    for item in list {
      guard let s = item as? [String: Any], let kind = s["kind"] as? String else { return nil }
      let text = { (k: String) in s[k] as? String }
      switch kind {
      case "transfer":
        guard let d = text("deposit") else { return nil }
        out.append(.transfer(deposit: d))
      case "call":
        guard let m = text("method"), let d = text("deposit"), let g = text("gas") else { return nil }
        out.append(.call(method: m, deposit: d, gas: g))
      case "add-key":
        guard let k = text("publicKey") else { return nil }
        if s["permission"] as? String == "full" {
          out.append(.addKey(publicKey: k, permission: .full))
          continue
        }
        guard let p = s["permission"] as? [String: Any], let r = p["receiver"] as? String, let m = p["methods"] as? [String] else { return nil }
        let allowance: String?
        if p["allowance"] == nil || p["allowance"] is NSNull {
          allowance = nil
        } else {
          guard let a = p["allowance"] as? String else { return nil }
          allowance = a
        }
        out.append(.addKey(publicKey: k, permission: .functionCall(receiver: r, methods: m, allowance: allowance)))
      case "delete-key":
        guard let k = text("publicKey") else { return nil }
        out.append(.deleteKey(publicKey: k))
      case "deploy":
        guard let h = text("codeSha256") else { return nil }
        out.append(.deploy(codeSha256: h))
      case "use-global":
        guard let h = text("codeHash") else { return nil }
        out.append(.useGlobal(codeHash: h))
      default:
        return nil
      }
    }
    return out
  }

  /** One group of execute()'s JSON ({ receiver_id, steps: [{Transfer}|{FunctionCall}] }), read as the contract reads it. */
  private static func executeGroup(_ any: Any) -> (Group, [Data?])? {
    guard let g = any as? [String: Any], let receiver = g["receiver_id"] as? String, isAccountId(receiver), let list = g["steps"] as? [Any] else { return nil }
    let whole = { (v: Any?) -> String? in (v as? String).flatMap { $0.wholeMatch(of: /\d{1,39}/) != nil ? $0 : nil } }
    var steps: [Step] = []
    var args: [Data?] = []
    for item in list {
      guard let s = item as? [String: Any], s.count == 1 else { return nil }
      if let t = s["Transfer"] as? [String: Any], let d = whole(t["deposit"]) {
        steps.append(.transfer(deposit: d))
        args.append(nil)
      } else if let f = s["FunctionCall"] as? [String: Any], let m = f["method_name"] as? String, let d = whole(f["deposit"]), let gas = whole(f["gas"]),
                let a = (f["args"] as? String).flatMap({ Data(base64Encoded: $0) }) {
        steps.append(.call(method: m, deposit: d, gas: gas))
        args.append(a)
      } else {
        return nil
      }
    }
    return (Group(receiver: receiver, steps: steps), args)
  }

  /** The key fields, from the bytes: to whom, how much NEAR, a coin's recipient, a key added or taken off. */
  private static func checkedLines(signer: String, groups: [Group], args: [[Data?]]) -> [String] {
    var lines: [String] = []
    for (g, a) in zip(groups, args) {
      lines.append(g.receiver == signer ? "On your own account" : "To \(g.receiver)")
      var near: UInt128 = 0
      for (i, step) in g.steps.enumerated() {
        switch step {
        case .transfer(let d):
          near &+= UInt128(d) ?? 0
        case .call(let method, let d, _):
          near &+= UInt128(d) ?? 0
          if method == "ft_transfer" || method == "ft_transfer_call", let data = a[i],
             let to = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["receiver_id"] as? String {
            lines.append("Coin goes to \(to)")
          }
        case .addKey(_, .full): lines.append("Adds a key that can do anything")
        case .addKey(_, .functionCall(let r, _, _)): lines.append("Adds a key for \(r) only")
        case .deleteKey: lines.append("Removes a key")
        case .deploy, .useGlobal: lines.append("Changes your account's code")
        }
      }
      if near > 0 { lines.append("Sends \(nearText(near)) NEAR") }
    }
    return lines
  }

  /** yoctoNEAR as NEAR, exact, no trailing zeros. */
  static func nearText(_ yocto: UInt128) -> String {
    let unit: UInt128 = 1_000_000_000_000_000_000_000_000
    let whole = yocto / unit, frac = yocto % unit
    guard frac > 0 else { return String(whole) }
    var f = String(frac)
    f = String(repeating: "0", count: 24 - f.count) + f
    while f.hasSuffix("0") { f.removeLast() }
    return "\(whole).\(f)"
  }

  static func isAccountId(_ s: String) -> Bool {
    s.count >= 2 && s.count <= 64 && s.wholeMatch(of: /(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+/) != nil
  }

  static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

  /** NEAR's base58 (Bitcoin alphabet), for a key's text form. */
  static func base58(_ d: Data) -> String {
    let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".utf8)
    let zeros = d.prefix { $0 == 0 }.count
    var digits: [UInt8] = []
    for byte in d {
      var carry = Int(byte)
      for i in 0..<digits.count {
        carry += Int(digits[i]) << 8
        digits[i] = UInt8(carry % 58)
        carry /= 58
      }
      while carry > 0 {
        digits.append(UInt8(carry % 58))
        carry /= 58
      }
    }
    return String(repeating: "1", count: zeros) + String(decoding: digits.reversed().map { alphabet[Int($0)] }, as: UTF8.self)
  }

  private struct Reader {
    private let bytes: [UInt8]
    private var at = 0
    init(_ data: Data) { bytes = [UInt8](data) }
    var remaining: Int { bytes.count - at }

    mutating func fixed(_ n: Int) -> Data? {
      guard n >= 0, remaining >= n else { return nil }
      defer { at += n }
      return Data(bytes[at..<(at + n)])
    }

    mutating func u8() -> UInt8? { fixed(1)?.first }

    mutating func vec() -> Data? {
      guard let n = u32() else { return nil }
      return fixed(Int(n))
    }

    /** A u128 as whole-number text. */
    mutating func u128() -> String? {
      guard let lo = u64(), let hi = u64() else { return nil }
      return String(UInt128(hi) << 64 | UInt128(lo))
    }

    /** A public key in NEAR's text form ("ed25519:…", "secp256k1:…", "ml-dsa-65:…"). */
    mutating func key() -> String? {
      let kinds: [UInt8: (String, Int)] = [0: ("ed25519", 32), 1: ("secp256k1", 64), 2: ("ml-dsa-65", 1952)]
      guard let tag = u8(), let (name, n) = kinds[tag], let k = fixed(n) else { return nil }
      return "\(name):\(NearTx.base58(k))"
    }

    mutating func permission() -> NearTx.Permission? {
      switch u8() {
      case 1: return .full
      case 0:
        var allowance: String?
        switch u8() {
        case 0: allowance = nil
        case 1:
          guard let a = u128() else { return nil }
          allowance = a
        default: return nil
        }
        guard let r = vec().flatMap({ String(data: $0, encoding: .utf8) }), let n = u32(), n <= 1000 else { return nil }
        var methods: [String] = []
        for _ in 0..<n {
          guard let m = vec().flatMap({ String(data: $0, encoding: .utf8) }) else { return nil }
          methods.append(m)
        }
        return .functionCall(receiver: r, methods: methods, allowance: allowance)
      default: return nil
      }
    }

    mutating func u32() -> UInt32? {
      guard let d = fixed(4) else { return nil }
      return d.reversed().reduce(0) { $0 << 8 | UInt32($1) }
    }

    mutating func u64() -> UInt64? {
      guard let d = fixed(8) else { return nil }
      return d.reversed().reduce(0) { $0 << 8 | UInt64($1) }
    }

    /** A NEAR account name: 2 to 64 of a-z, 0-9, ".", "_", "-". */
    mutating func accountId() -> String? {
      guard let n = u32(), (2...64).contains(n), let d = fixed(Int(n)),
            d.allSatisfy({ (0x61...0x7a).contains($0) || (0x30...0x39).contains($0) || $0 == 0x2e || $0 == 0x5f || $0 == 0x2d })
      else { return nil }
      return String(decoding: d, as: UTF8.self)
    }
  }
}

/**
 * ZeroFee Chat's name note (J3 part 2, packages/core/src/chat-near.ts): the second NEP-413 message the chip signs, built
 * here from its parts, never taken whole from the core. Four lines, the recipient a constant (chat.zerofee.si), an end
 * at most 90 days ahead, no callback. It names one chat key (64 hex) as this account's in ZeroFee Chat; no money moves.
 */
enum ChatName {
  static let recipient = "chat.zerofee.si"

  static func message(accountId: String, chatKey: String, until: String) -> String {
    "ZeroFee Chat name\nAccount: \(accountId)\nChat key: \(chatKey)\nUntil: \(until)"
  }

  /** The bytes NEP-413 hashes, or nil when a part isn't one the note takes. `now` in seconds since 1970. */
  static func bytes(accountId: String, chatKey: String, until: String, nonce: Data, now: TimeInterval) -> Data? {
    guard accountId.count >= 2, accountId.count <= 64,
          accountId.wholeMatch(of: /(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+/) != nil,
          chatKey.wholeMatch(of: /[0-9a-f]{64}/) != nil,
          until.wholeMatch(of: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/) != nil,
          nonce.count == 32
    else { return nil }
    let parse = ISO8601DateFormatter()
    parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let end = parse.date(from: until)?.timeIntervalSince1970, end > now, end <= now + 90 * 86_400 else { return nil }
    var out = Data()
    let u32 = { (v: UInt32) in withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
    let text = { (s: String) in let b = Data(s.utf8); u32(UInt32(b.count)); out.append(b) }
    u32(AlertsProof.tag)
    text(message(accountId: accountId, chatKey: chatKey, until: until))
    out.append(nonce)
    text(recipient)
    out.append(0) // no callback
    return out
  }
}

/**
 * The relay's email-alerts proof (apps/quotes/README.md "Proof of the account", audit NF-01): one of the two NEP-413
 * messages the chip signs, built here from its parts, never taken whole from the core. Its message is exactly four lines,
 * its recipient this build's own relay (relay.json), its deadline at most ten minutes ahead, no callback.
 */
enum AlertsProof {
  /** NEP-413's tag: 2^31 + 413, u32 little-endian (9d 01 00 80). */
  static let tag: UInt32 = 2_147_484_061

  static func message(accountId: String, email: String, deadline: String) -> String {
    "ZeroFee email alerts\nAccount: \(accountId)\nEmail: \(email)\nUntil: \(deadline)"
  }

  /** The bytes NEP-413 hashes, or nil when a part isn't one the proof takes. `now` in seconds since 1970. */
  static func bytes(accountId: String, email: String, deadline: String, nonce: Data, recipient: String, now: TimeInterval) -> Data? {
    guard accountId.wholeMatch(of: /[a-z0-9._-]{2,64}/) != nil,
          email.count <= 254, email.wholeMatch(of: /[^\s@<>"'(),;:\\]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}/) != nil,
          deadline.wholeMatch(of: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/) != nil,
          nonce.count == 32, !recipient.isEmpty
    else { return nil }
    let parse = ISO8601DateFormatter()
    parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let until = parse.date(from: deadline)?.timeIntervalSince1970, until > now, until <= now + 11 * 60 else { return nil }
    var out = Data()
    let u32 = { (v: UInt32) in withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
    let text = { (s: String) in let b = Data(s.utf8); u32(UInt32(b.count)); out.append(b) }
    u32(tag)
    text(message(accountId: accountId, email: email, deadline: deadline))
    out.append(nonce)
    text(recipient)
    out.append(0) // no callback
    return out
  }
}

