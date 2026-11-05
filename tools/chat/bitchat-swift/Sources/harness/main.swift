// BitChat private-message harness (ZeroFee code; BitChat's own code is in
// Sources/harness/BitChat, Sources/BitFoundation and Sources/BitLogger,
// copied by fetch.sh from BitChat iOS at a pinned commit, public domain).
//
// What it is for: ZeroFee Chat ports BitChat's geohash DM ("private
// envelope") to TypeScript. This harness runs BitChat's own Swift code to
// (1) write test vectors the port must reproduce, and (2) open envelopes the
// port makes, with BitChat's own decoder, to prove BitChat would read them.
//
// Run (from anywhere):
//   bash tools/chat/bitchat-swift/run.sh vectors [out.json]
//        default out: packages/core/src/bitchat-dm-vectors.json
//   bash tools/chat/bitchat-swift/run.sh open <file.json>
//        <file.json> is either [{ "recipientPrivateKey": hex, "event": {...} }]
//        ("recipientPrivateKeyHex" is read too; "name" is echoed back)
//        (prints BitChat's reading of each, exit 0) or a vectors file
//        (opens its envelopes, fixtures and rejects; exit 1 on any result
//        that differs from what the file expects).
//
// Deterministic sections (packets, tlv, tlvDecode, xchacha, hkdf, ecdh,
// encrypt) are identical on every run. envelopes and rejects are made fresh
// by BitChat's random generator each run (ephemeral wrap keys, nonces,
// timestamp jitter, Schnorr aux randomness, random packet sender IDs).
//
// Where the harness rebuilds a BitChat function with fixed inputs instead of
// random ones (encodePMForNostrNoRecipient, encodeAckForNostrNoRecipient,
// NostrProtocol.encrypt), it first checks the rebuild against the real
// function: it calls the real one, reads the random values back out of its
// output, rebuilds with them, and stops unless the bytes are identical.
//
// What BitChat's format does that a port can get wrong (all visible in the
// vectors):
// - ECDH output is the 33-byte COMPRESSED shared point (02/03 prefix kept),
//   and that whole thing is HKDF-SHA256's input (salt empty, info
//   "nip44-v2", 32 bytes). Not NIP-44.
// - An x-only peer key is lifted with 02 (even Y) to encrypt; decrypt tries
//   02 then 03, since the two sides' lifts can disagree in sign.
// - v2: payload = "v2:" + base64url-no-pad(nonce24 || ciphertext || tag16),
//   XChaCha20-Poly1305 with no AAD. Decrypt needs > 40 bytes, so an empty
//   plaintext never opens.
// - Packet compression: payload >= 100 bytes and unique-bytes/min(n,256)
//   < 0.9, then raw DEFLATE (Apple COMPRESSION_ZLIB: no zlib header), kept
//   only if smaller. Flag 0x04, a 2-byte original size before the data.
// - Padding: PKCS#7-style to 256/512/1024/2048 once 16 bytes are added, but
//   only when the pad fits in 255 bytes; frames of 241-256 bytes go unpadded.
// - Rumor and seal JSON come from JSONEncoder: key order differs run to run;
//   the iOS rumor carries "id":"" and no sig. Seal and wrap created_at are
//   jittered +-900 s (so up to 15 minutes in the future); the rumor's is not.

import BitFoundation
import CryptoKit
import Foundation
import P256K

// MARK: - Small helpers

struct HarnessError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("harness: \(message)\n".utf8))
    exit(2)
}

func hex(_ d: Data) -> String { d.hexEncodedString() }
func hex(_ bytes: [UInt8]) -> String { Data(bytes).hexEncodedString() }
func unhex(_ s: String) -> Data {
    guard let d = Data(hexString: s) else { fail("bad hex \(s)") }
    return d
}

/// Fixed test private key from a label (sha256 of a namespaced label).
func labelKey(_ label: String) -> Data { Data("zerofee-bitchat-harness:\(label)".utf8).sha256Hash() }

/// 32-byte big-endian scalar.
func scalarKey(_ n: UInt8) -> Data { Data(repeating: 0, count: 31) + Data([n]) }

func identity(_ priv: Data) -> NostrIdentity {
    do { return try NostrIdentity(privateKeyData: priv) } catch { fail("identity: \(error)") }
}

/// 0x02 or 0x03 prefix of the key's real compressed public key.
func compressedPublicKey(_ priv: Data) -> Data {
    do { return try P256K.KeyAgreement.PrivateKey(dataRepresentation: priv).publicKey.dataRepresentation } catch {
        fail("pubkey: \(error)")
    }
}

func parityName(_ priv: Data) -> String { compressedPublicKey(priv).first == 0x02 ? "even" : "odd" }

/// SplitMix64: deterministic bytes for the "high-entropy" cases.
struct SplitMix64 {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    mutating func bytes(_ n: Int) -> Data { Data((0..<n).map { _ in UInt8(truncatingIfNeeded: next()) }) }
}

func printableAscii(count: Int, seed: UInt64) -> String {
    var rng = SplitMix64(state: seed)
    return String((0..<count).map { _ in Character(UnicodeScalar(UInt8(0x20 + rng.next() % 95))) })
}

/// UTF-8 text built to use as many distinct byte values as UTF-8 allows:
/// ASCII (with or without C0 controls and DEL), all 30 two-byte leads, all
/// 16 three-byte leads, four four-byte leads, and all 64 continuation bytes.
/// Shuffled deterministically.
func highEntropyUtf8(includeControls: Bool, seed: UInt64) -> String {
    var scalars: [UInt32] = includeControls ? Array(0x00...0x7F) : Array(0x20...0x7E)
    for i in 0..<30 { // C2..DF leads, continuations 80..9D
        scalars.append(UInt32(0xC2 + i - 0xC0) << 6 | UInt32(i))
    }
    for i in 0..<16 { // E0..EF leads; second byte AE..BD (80 for ED), third 9E..AD
        let lead = 0xE0 + i
        let c1 = lead == 0xED ? 0x80 : 0xAE + i
        let c2 = 0x9E + i
        scalars.append(UInt32(lead & 0x0F) << 12 | UInt32(c1 & 0x3F) << 6 | UInt32(c2 & 0x3F))
    }
    let fourByte: [[Int]] = [[0xF0, 0xBE, 0xBF, 0xBB], [0xF1, 0x80, 0x81, 0x82], [0xF2, 0x83, 0x84, 0x85], [0xF3, 0x86, 0x87, 0x88]]
    for b in fourByte {
        scalars.append(UInt32(b[0] & 0x07) << 18 | UInt32(b[1] & 0x3F) << 12 | UInt32(b[2] & 0x3F) << 6 | UInt32(b[3] & 0x3F))
    }
    var rng = SplitMix64(state: seed)
    for i in stride(from: scalars.count - 1, to: 0, by: -1) { scalars.swapAt(i, Int(rng.next() % UInt64(i + 1))) }
    var s = String.UnicodeScalarView()
    for v in scalars {
        guard let u = UnicodeScalar(v) else { fail("bad scalar \(v)") }
        s.append(u)
    }
    return String(s)
}

func eventDict(_ e: NostrEvent) -> [String: Any] {
    var d: [String: Any] = [
        "id": e.id, "pubkey": e.pubkey, "created_at": e.created_at,
        "kind": e.kind, "tags": e.tags, "content": e.content,
    ]
    if let sig = e.sig { d["sig"] = sig }
    return d
}

func jsonData(_ value: Any) -> Data {
    do {
        return try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    } catch { fail("json: \(error)") }
}

func errorName(_ error: Error) -> String { String(describing: error) }

// MARK: - Packet building (mirrors NostrEmbeddedBitChat with fixed inputs)

/// Body of NostrEmbeddedBitChat.encodePMForNostrNoRecipient with the random
/// sender ID and the wall-clock timestamp passed in.
func pmPacket(senderID: Data, timestampMs: UInt64, content: String, messageID: String) -> BitchatPacket? {
    let pm = PrivateMessagePacket(messageID: messageID, content: content)
    guard let tlv = pm.encode() else { return nil }
    var payload = Data([NoisePayloadType.privateMessage.rawValue])
    payload.append(tlv)
    return BitchatPacket(
        type: MessageType.noiseEncrypted.rawValue, senderID: senderID, recipientID: nil,
        timestamp: timestampMs, payload: payload, signature: nil, ttl: 7
    )
}

/// Body of NostrEmbeddedBitChat.encodeAckForNostrNoRecipient, same seam.
func ackPacket(type: NoisePayloadType, senderID: Data, timestampMs: UInt64, messageID: String) -> BitchatPacket? {
    guard type == .delivered || type == .readReceipt else { return nil }
    var payload = Data([type.rawValue])
    payload.append(Data(messageID.utf8))
    return BitchatPacket(
        type: MessageType.noiseEncrypted.rawValue, senderID: senderID, recipientID: nil,
        timestamp: timestampMs, payload: payload, signature: nil, ttl: 7
    )
}

func bitchat1(_ packet: BitchatPacket) -> String {
    guard let data = packet.toBinaryData() else { fail("toBinaryData returned nil") }
    return "bitchat1:" + Base64URLCoding.encode(data)
}

/// Mirror of NostrInboundPipeline.decodeEmbeddedBitChatPacket (private in a
/// file we do not copy): same bounds, same decoder.
func decodeEmbedded(_ content: String) -> (raw: Data, packet: BitchatPacket)? {
    guard content.hasPrefix("bitchat1:") else { return nil }
    let encoded = String(content.dropFirst("bitchat1:".count))
    let maxBytes = FileTransferLimits.maxFramedFileBytes
    let maxEncoded = ((maxBytes + 2) / 3) * 4
    guard encoded.count <= maxEncoded else { return nil }
    guard let data = Base64URLCoding.decode(encoded), data.count <= maxBytes else { return nil }
    guard let packet = BitchatPacket.from(data) else { return nil }
    return (data, packet)
}

/// Prove the fixed-input rebuild equals the real BitChat function.
func checkMirror(real: String?, rebuild: (Data, UInt64) -> BitchatPacket?, what: String) {
    guard let real else { return }
    guard let (_, pkt) = decodeEmbedded(real) else { fail("\(what): real output did not decode") }
    guard let again = rebuild(pkt.senderID, pkt.timestamp) else { fail("\(what): rebuild nil") }
    guard bitchat1(again) == real else { fail("\(what): rebuild differs from BitChat's own encoder") }
}

/// What BitChat reads out of a decrypted envelope content (the app path:
/// decodeEmbeddedBitChatPacket, NoisePayload.decode, then
/// PrivateMessagePacket.decode for PMs or a UTF-8 messageID for acks).
func readContent(_ content: String) -> [String: Any] {
    guard content.hasPrefix("bitchat1:") else { return ["bitchat1": false] }
    guard let (raw, packet) = decodeEmbedded(content) else {
        return ["bitchat1": true, "packetError": "BinaryProtocol.decode returned nil"]
    }
    var out: [String: Any] = ["bitchat1": true]
    let flags = raw.count > BinaryProtocol.Offsets.flags ? raw[raw.startIndex + BinaryProtocol.Offsets.flags] : 0
    out["packet"] = [
        "version": Int(packet.version), "type": Int(packet.type), "ttl": Int(packet.ttl),
        "timestampMs": packet.timestamp, "flags": Int(flags),
        "compressed": (flags & BinaryProtocol.Flags.isCompressed) != 0,
        "hasRecipient": packet.recipientID != nil, "hasSignature": packet.signature != nil,
        "senderIDHex": hex(packet.senderID), "wireBytes": raw.count,
        "payloadHex": hex(packet.payload),
    ] as [String: Any]
    guard packet.type == MessageType.noiseEncrypted.rawValue else {
        out["payloadError"] = "not noiseEncrypted"
        return out
    }
    guard let payload = NoisePayload.decode(packet.payload) else {
        out["payloadError"] = "NoisePayload.decode returned nil"
        return out
    }
    out["payloadType"] = payload.type.description
    out["payloadTypeRaw"] = Int(payload.type.rawValue)
    switch payload.type {
    case .privateMessage:
        if let pm = PrivateMessagePacket.decode(from: payload.data) {
            out["messageID"] = pm.messageID
            out["text"] = pm.content
        } else {
            out["payloadError"] = "PrivateMessagePacket.decode returned nil"
        }
    case .delivered, .readReceipt:
        if let id = String(data: payload.data, encoding: .utf8) {
            out["messageID"] = id
        } else {
            out["payloadError"] = "ack messageID is not UTF-8"
        }
    default:
        break
    }
    return out
}

// MARK: - Envelope helpers (built from BitChat's own private helpers via the seam)

func signed(_ e: NostrEvent, _ key: P256K.Schnorr.PrivateKey) throws -> NostrEvent { try e.sign(with: key) }

/// A gift wrap made like createGiftWrap but with knobs for reject cases.
func manualWrap(
    sealJSON: String, recipientPubkey: String, kind: NostrProtocol.EventKind = .giftWrap,
    tags: [[String]]? = nil, content transform: (String) -> String = { $0 }
) throws -> NostrEvent {
    let wrapKey = try P256K.Schnorr.PrivateKey()
    let encrypted = try NostrProtocol.harnessEncrypt(plaintext: sealJSON, recipientPubkey: recipientPubkey, senderKey: wrapKey)
    let event = NostrEvent(
        pubkey: hex(wrapKey.xonly.bytes), createdAt: Date(), kind: kind,
        tags: tags ?? [["p", recipientPubkey]], content: transform(encrypted)
    )
    return try signed(event, wrapKey)
}

/// A seal made like createSeal but with knobs for reject cases.
func manualSeal(
    rumorJSON: String, recipientPubkey: String, sender: NostrIdentity,
    kind: NostrProtocol.EventKind = .seal, tags: [[String]] = []
) throws -> NostrEvent {
    let key = try sender.schnorrSigningKey()
    let encrypted = try NostrProtocol.harnessEncrypt(plaintext: rumorJSON, recipientPubkey: recipientPubkey, senderKey: key)
    let seal = NostrEvent(pubkey: sender.publicKeyHex, createdAt: Date(), kind: kind, tags: tags, content: encrypted)
    return try signed(seal, key)
}

func rumor(_ sender: NostrIdentity, content: String, kind: NostrProtocol.EventKind = .dm, tags: [[String]] = []) -> NostrEvent {
    NostrEvent(pubkey: sender.publicKeyHex, createdAt: Date(), kind: kind, tags: tags, content: content)
}

/// Peel an envelope with BitChat's decrypt (no checks) to show the inner JSON.
func peel(_ wrap: NostrEvent, recipient: NostrIdentity) -> (sealJSON: String, rumorJSON: String)? {
    guard let key = try? recipient.schnorrSigningKey(),
          let sealJSON = try? NostrProtocol.harnessDecrypt(ciphertext: wrap.content, senderPubkey: wrap.pubkey, recipientKey: key),
          let sealObj = try? JSONSerialization.jsonObject(with: Data(sealJSON.utf8)) as? [String: Any],
          let seal = try? NostrEvent(from: sealObj),
          let rumorJSON = try? NostrProtocol.harnessDecrypt(ciphertext: seal.content, senderPubkey: seal.pubkey, recipientKey: key)
    else { return nil }
    return (sealJSON, rumorJSON)
}

// MARK: - Open (BitChat reads an envelope)

func openOne(recipientPrivateKey: String, event eventObj: Any) -> [String: Any] {
    guard let priv = Data(hexString: recipientPrivateKey), let recipient = try? NostrIdentity(privateKeyData: priv) else {
        return ["ok": false, "stage": "input", "error": "bad recipientPrivateKey"]
    }
    guard let dict = eventObj as? [String: Any] else { return ["ok": false, "stage": "input", "error": "event is not an object"] }
    let event: NostrEvent
    do { event = try NostrEvent(from: dict) } catch {
        return ["ok": false, "stage": "parse", "error": errorName(error)]
    }
    do {
        let r = try NostrProtocol.decryptPrivateMessage(giftWrap: event, recipientIdentity: recipient)
        var out: [String: Any] = ["ok": true, "content": r.content, "senderPubkey": r.senderPubkey, "timestamp": r.timestamp]
        for (k, v) in readContent(r.content) { out[k] = v }
        return out
    } catch {
        return ["ok": false, "stage": "decryptPrivateMessage", "error": errorName(error)]
    }
}

/// Input key field: "recipientPrivateKey" or (as the vectors file spells it,
/// so the repo's secret-shape guard does not take test keys for secrets)
/// "recipientPrivateKeyHex".
func recipientKeyOf(_ item: [String: Any]) -> String {
    (item["recipientPrivateKey"] as? String) ?? (item["recipientPrivateKeyHex"] as? String) ?? ""
}

func runOpen(path: String) -> Int32 {
    guard let data = FileManager.default.contents(atPath: path),
          let top = try? JSONSerialization.jsonObject(with: data) else { fail("cannot read JSON from \(path)") }

    if let items = top as? [[String: Any]] {
        let results: [[String: Any]] = items.enumerated().map { i, item in
            var r = openOne(recipientPrivateKey: recipientKeyOf(item), event: item["event"] ?? NSNull())
            r["index"] = i
            if let name = item["name"] { r["name"] = name }
            return r
        }
        let ok = results.filter { $0["ok"] as? Bool == true }.count
        FileHandle.standardOutput.write(jsonData(["bitchatCommit": bitchatCommit, "results": results, "opened": ok, "total": results.count]))
        FileHandle.standardOutput.write(Data("\n".utf8))
        return 0
    }

    // A vectors file: every envelope and fixture must open to its expected
    // result, every reject must fail with its expected error.
    guard let vectors = top as? [String: Any] else { fail("expected an array or a vectors object") }
    var results: [[String: Any]] = []
    var mismatches = 0
    for group in ["envelopes", "fixtures"] {
        for item in vectors[group] as? [[String: Any]] ?? [] {
            var r = openOne(recipientPrivateKey: recipientKeyOf(item), event: item["event"] ?? NSNull())
            let expect = item["expect"] as? [String: Any] ?? [:]
            var match = r["ok"] as? Bool == true
            for key in ["content", "senderPubkey", "timestamp", "payloadType", "messageID", "text"] where expect[key] != nil {
                if "\(expect[key]!)" != "\(r[key] ?? "<missing>")" { match = false }
            }
            r["group"] = group; r["name"] = item["name"] ?? ""; r["matchesExpected"] = match
            if !match { mismatches += 1 }
            results.append(r)
        }
    }
    for item in vectors["rejects"] as? [[String: Any]] ?? [] {
        var r = openOne(recipientPrivateKey: recipientKeyOf(item), event: item["event"] ?? NSNull())
        let match = r["ok"] as? Bool == false && (r["error"] as? String) == (item["expectedError"] as? String)
        r["group"] = "rejects"; r["name"] = item["name"] ?? ""; r["matchesExpected"] = match
        if !match { mismatches += 1 }
        results.append(r)
    }
    FileHandle.standardOutput.write(jsonData(["bitchatCommit": bitchatCommit, "results": results, "total": results.count, "mismatches": mismatches]))
    FileHandle.standardOutput.write(Data("\n".utf8))
    return mismatches == 0 ? 0 : 1
}

// MARK: - Vectors

let baseTimestampMs: UInt64 = 1_798_761_600_000 // 2027-01-01T00:00:00Z

func packetVectors() -> [[String: Any]] {
    struct PMCase { let name: String; let messageID: String; let content: String }
    let thumbs = String(repeating: "👋", count: 63) + "abc" // 63*4 + 3 = 255 bytes
    let maxAscii = String("The quick brown fox jumps over the lazy dog; ZeroFee Chat speaks BitChat. ".prefix(255))
    let max255 = maxAscii + String(repeating: ".", count: 255 - maxAscii.utf8.count)
    var rng95 = SplitMix64(state: 95)
    var all95 = (0..<95).map { Character(UnicodeScalar(UInt8(0x20 + $0))) }
    for i in stride(from: all95.count - 1, to: 0, by: -1) { all95.swapAt(i, Int(rng95.next() % UInt64(i + 1))) }

    let cases: [PMCase] = [
        PMCase(name: "shortAscii", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A01", content: "hello from bitchat"),
        PMCase(name: "emptyContent", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A02", content: ""),
        PMCase(name: "emptyMessageIDAndContent", messageID: "", content: ""),
        PMCase(name: "multiByteEmojiAccents", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A03", content: "Café ☕️ naïve 👋🏽 Zürich 東京"),
        PMCase(name: "max255AsciiCompressed", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A04", content: max255),
        PMCase(name: "max255EmojiCompressed", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A05", content: thumbs),
        PMCase(name: "longRepetitiveCompressed", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A06", content: String(repeating: "ha", count: 120)),
        // 102-byte payload of 98 distinct byte values: shouldCompress says no
        // (unique/min(count,256) >= 0.9), so it travels uncompressed.
        PMCase(name: "distinctBytesNotCompressed", messageID: "m1", content: String(all95)),
        // Random printable ASCII still compresses (95 symbols, ~6.6 bits each).
        // At 245 wire bytes this one also shows the padding gap: 245+16 > 256
        // and 512-245 > 255, so MessagePadding leaves it unpadded.
        PMCase(name: "randomAsciiCompressedUnpadded", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A07", content: printableAscii(count: 185, seed: 7)),
        PMCase(name: "randomAscii255Compressed", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A08", content: printableAscii(count: 255, seed: 255)),
        // 252 bytes using 242 distinct byte values (every ASCII byte incl.
        // controls, every 2-byte lead, every continuation byte...):
        // shouldCompress says no.
        PMCase(name: "allByteValuesNotCompressed", messageID: "m1", content: highEntropyUtf8(includeControls: true, seed: 1)),
        // Same idea without control characters, behind a UUID: shouldCompress
        // says yes (ratio < 0.9) but zlib cannot make it smaller, so
        // compress() returns nil and it travels uncompressed.
        PMCase(name: "highEntropyUtf8DeflateNotSmaller", messageID: "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A09", content: highEntropyUtf8(includeControls: false, seed: 2)),
    ]
    let expectCompressed: Set<String> = [
        "max255AsciiCompressed", "max255EmojiCompressed", "longRepetitiveCompressed",
        "randomAsciiCompressedUnpadded", "randomAscii255Compressed",
    ]

    var out: [[String: Any]] = []
    var rng = SplitMix64(state: 0xB17C_4A7)
    func record(_ name: String, kind: String, messageID: String, content: String?, packet: BitchatPacket) {
        guard let unpadded = packet.toBinaryData(padding: false), let padded = packet.toBinaryData(padding: true) else {
            fail("\(name): encode nil")
        }
        let flags = unpadded[BinaryProtocol.Offsets.flags]
        let compressed = flags & BinaryProtocol.Flags.isCompressed != 0
        var row: [String: Any] = [
            "name": name, "kind": kind, "senderIDHex": hex(packet.senderID), "timestampMs": packet.timestamp,
            "messageID": messageID, "noisePayloadHex": hex(packet.payload), "noisePayloadBytes": packet.payload.count,
            "flags": Int(flags), "compressed": compressed,
            "unpaddedHex": hex(unpadded), "unpaddedBytes": unpadded.count,
            "packetHex": hex(padded), "packetBytes": padded.count, "padded": padded.count != unpadded.count,
            "padByte": padded.count != unpadded.count ? Int(padded.last!) as Any : NSNull(),
            "bitchat1": "bitchat1:" + Base64URLCoding.encode(padded),
        ]
        if let content {
            row["content"] = content
            row["contentUtf8Bytes"] = content.utf8.count
            row["tlvHex"] = hex(PrivateMessagePacket(messageID: messageID, content: content).encode()!)
        }
        // CompressionUtil.shouldCompress's test, recomputed here for reference
        // (compress only if payload >= 100 bytes and this is < 0.9).
        row["uniqueByteRatio"] = Double(Set(packet.payload).count) / Double(min(packet.payload.count, 256))
        if content != nil, expectCompressed.contains(name) != compressed {
            fail("\(name): BitChat compressed=\(compressed), the case name says otherwise")
        }
        if compressed {
            // [14-byte v1 header][8 sender][2 original size][raw DEFLATE]
            let payloadLength = Int(unpadded[12]) << 8 | Int(unpadded[13])
            row["originalSize"] = Int(unpadded[22]) << 8 | Int(unpadded[23])
            row["deflateHex"] = hex(Data(unpadded[24..<(22 + payloadLength)]))
        }
        guard let decoded = BitchatPacket.from(padded), decoded.payload == packet.payload,
              decoded.senderID == packet.senderID, decoded.timestamp == packet.timestamp
        else { fail("\(name): BitChat cannot decode its own packet") }
        out.append(row)
    }

    for (i, c) in cases.enumerated() {
        let sender = rng.bytes(8)
        let ts = baseTimestampMs + UInt64(i) * 1000
        checkMirror(real: NostrEmbeddedBitChat.encodePMForNostrNoRecipient(content: c.content, messageID: c.messageID),
                    rebuild: { pmPacket(senderID: $0, timestampMs: $1, content: c.content, messageID: c.messageID) },
                    what: c.name)
        guard let p = pmPacket(senderID: sender, timestampMs: ts, content: c.content, messageID: c.messageID) else {
            fail("\(c.name): PM encode returned nil")
        }
        record(c.name, kind: "privateMessage", messageID: c.messageID, content: c.content, packet: p)
    }
    for (i, t) in [NoisePayloadType.delivered, .readReceipt].enumerated() {
        let id = "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A01"
        checkMirror(real: NostrEmbeddedBitChat.encodeAckForNostrNoRecipient(type: t, messageID: id),
                    rebuild: { ackPacket(type: t, senderID: $0, timestampMs: $1, messageID: id) }, what: t.description)
        let p = ackPacket(type: t, senderID: rng.bytes(8), timestampMs: baseTimestampMs + 100_000 + UInt64(i), messageID: id)!
        record("\(t.description)Ack", kind: t.description, messageID: id, content: nil, packet: p)
    }
    return out
}

func tlvVectors() -> (encode: [[String: Any]], decode: [[String: Any]]) {
    let encodeCases: [(String, String, String)] = [
        ("simple", "6B1F0D2E-4C1A-4E8B-9A57-3F2D7C9E1A01", "hi"),
        ("emptyContent", "id", ""),
        ("emptyMessageID", "", "x"),
        ("utf8", "id-é", "日本語 🎉"),
        ("content255", "id", String(repeating: "z", count: 255)),
        ("content256Rejected", "id", String(repeating: "z", count: 256)),
        ("content256BytesFrom128TwoByteChars", "id", String(repeating: "é", count: 128)),
        ("messageID255", String(repeating: "i", count: 255), "ok"),
        ("messageID256Rejected", String(repeating: "i", count: 256), "ok"),
    ]
    let enc: [[String: Any]] = encodeCases.map { name, id, content in
        let tlv = PrivateMessagePacket(messageID: id, content: content).encode()
        let nostr = NostrEmbeddedBitChat.encodePMForNostrNoRecipient(content: content, messageID: id)
        return [
            "name": name, "messageID": id, "content": content,
            "messageIDUtf8Bytes": id.utf8.count, "contentUtf8Bytes": content.utf8.count,
            "tlvHex": tlv.map { hex($0) as Any } ?? NSNull(), "encodePMForNostrNoRecipientReturnsNil": nostr == nil,
        ]
    }
    // Decoder edge cases: what PrivateMessagePacket.decode accepts.
    let decodeCases: [(String, String)] = [
        ("canonical", "000269640102686900"), // trailing lone byte ignored
        ("contentFirst", "01026869000269 64".replacingOccurrences(of: " ", with: "")),
        ("duplicateMessageIDLastWins", "00016100016201026869"),
        ("missingContent", "00026964"),
        ("missingMessageID", "01026869"),
        ("unknownType", "0002696402026869"),
        ("lengthOverrun", "0005696401026869"),
        ("invalidUtf8Content", "000269640102ff fe".replacingOccurrences(of: " ", with: "")),
        ("emptyBoth", "00000100"),
        ("empty", ""),
    ]
    let dec: [[String: Any]] = decodeCases.map { name, h in
        let pm = PrivateMessagePacket.decode(from: unhex(h))
        var row: [String: Any] = ["name": name, "tlvHex": h, "ok": pm != nil]
        if let pm { row["messageID"] = pm.messageID; row["content"] = pm.content }
        return row
    }
    return (enc, dec)
}

func xchachaVectors() throws -> [[String: Any]] {
    var rows: [[String: Any]] = []
    // draft-irtf-cfrg-xchacha-03 A.3.1 (AEAD_XChaCha20_Poly1305), with AAD.
    let key = Data((0x80...0x9f).map { UInt8($0) })
    let nonce = Data((0x40...0x57).map { UInt8($0) })
    let aad = unhex("50515253c0c1c2c3c4c5c6c7")
    let pt = Data("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.".utf8)
    let s = try XChaCha20Poly1305Compat.seal(plaintext: pt, key: key, nonce24: nonce, aad: aad)
    let draftCT = "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e"
    let draftTag = "c0875924c1c7987947deafd8780acf49"
    rows.append([
        "name": "draftIrtfCfrgXchachaA31WithAad", "keyHex": hex(key), "nonceHex": hex(nonce), "aadHex": hex(aad),
        "plaintextHex": hex(pt), "ciphertextHex": hex(s.ciphertext), "tagHex": hex(s.tag),
        "matchesDraftVector": hex(s.ciphertext) == draftCT && hex(s.tag) == draftTag,
    ])
    // BitChat's use: no AAD.
    var rng = SplitMix64(state: 0xC4AC4A)
    for (name, plaintext) in [("empty", ""), ("short", "hello"), ("rumorLike", #"{"id":"","pubkey":"ab","created_at":1,"kind":14,"tags":[],"content":"bitchat1:AQ"}"#), ("utf8", "Grüße 🌍")] {
        let k = rng.bytes(32), n = rng.bytes(24), p = Data(plaintext.utf8)
        let sealed = try XChaCha20Poly1305Compat.seal(plaintext: p, key: k, nonce24: n)
        let opened = try XChaCha20Poly1305Compat.open(ciphertext: sealed.ciphertext, tag: sealed.tag, key: k, nonce24: n)
        guard opened == p else { fail("xchacha round trip") }
        rows.append([
            "name": name, "keyHex": hex(k), "nonceHex": hex(n), "aadHex": "", "plaintext": plaintext, "plaintextHex": hex(p),
            "ciphertextHex": hex(sealed.ciphertext), "tagHex": hex(sealed.tag),
        ])
    }
    return rows
}

struct KeyCase { let name: String; let priv: Data }
let ecdhKeys: [KeyCase] = [
    KeyCase(name: "scalar1", priv: scalarKey(1)),
    KeyCase(name: "scalar2", priv: scalarKey(2)),
    KeyCase(name: "scalar3", priv: scalarKey(3)),
    KeyCase(name: "alice", priv: labelKey("alice")),
    KeyCase(name: "bob", priv: labelKey("bob")),
    KeyCase(name: "carol", priv: labelKey("carol")),
    KeyCase(name: "dave", priv: labelKey("dave")),
]

func ecdhVectors() throws -> [[String: Any]] {
    var rows: [[String: Any]] = []
    let pairs: [(Int, Int)] = [(0, 1), (1, 0), (2, 3), (3, 4), (4, 3), (4, 5), (5, 6), (6, 3)]
    for (a, b) in pairs {
        let me = ecdhKeys[a], peer = ecdhKeys[b]
        let peerX = identity(peer.priv).publicKey
        let key = try identity(me.priv).schnorrSigningKey()
        let viaXonly = try NostrProtocol.harnessDeriveSharedSecret(privateKey: key, publicKey: peerX)
        let even = try NostrProtocol.harnessDeriveSharedSecret(privateKey: key, publicKey: Data([0x02]) + peerX)
        let odd = try NostrProtocol.harnessDeriveSharedSecret(privateKey: key, publicKey: Data([0x03]) + peerX)
        guard viaXonly == even, viaXonly.count == 33, odd.dropFirst() == even.dropFirst(), odd.first != even.first else {
            fail("ecdh shape")
        }
        rows.append([
            "name": "\(me.name)->\(peer.name)", "privateKeyHex": hex(me.priv),
            "privateKeyPublicParity": parityName(me.priv),
            "peerPublicKeyXonlyHex": hex(peerX), "peerActualParity": parityName(peer.priv),
            "sharedSecretHex": hex(viaXonly), "sharedSecretWithOddLiftHex": hex(odd),
        ])
    }
    return rows
}

func hkdfVectors(_ ecdh: [[String: Any]]) throws -> [[String: Any]] {
    var inputs: [(String, Data)] = ecdh.prefix(4).map { ($0["name"] as! String, unhex($0["sharedSecretHex"] as! String)) }
    inputs.append(("oddLiftOf:\(ecdh[0]["name"]!)", unhex(ecdh[0]["sharedSecretWithOddLiftHex"] as! String)))
    inputs.append(("fixed02x11", Data([0x02]) + Data(repeating: 0x11, count: 32)))
    inputs.append(("fixed03x11", Data([0x03]) + Data(repeating: 0x11, count: 32)))
    return try inputs.map { name, ikm in
        ["name": name, "ikmHex": hex(ikm), "saltHex": "", "info": "nip44-v2", "length": 32,
         "keyHex": hex(try NostrProtocol.harnessDerivePrivateEnvelopeKey(from: ikm))]
    }
}

/// NostrProtocol.encrypt with the nonce passed in (encrypt itself draws it
/// from SecRandomCopyBytes). Same steps, same BitChat functions.
func encryptWithNonce(plaintext: String, recipientPubkey: String, senderKey: P256K.Schnorr.PrivateKey, nonce24: Data) throws
    -> (out: String, sharedSecret: Data, key: Data) {
    let ss = try NostrProtocol.harnessDeriveSharedSecret(privateKey: senderKey, publicKey: unhex(recipientPubkey))
    let key = try NostrProtocol.harnessDerivePrivateEnvelopeKey(from: ss)
    let sealed = try XChaCha20Poly1305Compat.seal(plaintext: Data(plaintext.utf8), key: key, nonce24: nonce24)
    var combined = Data()
    combined.append(nonce24); combined.append(sealed.ciphertext); combined.append(sealed.tag)
    return ("v2:" + Base64URLCoding.encode(combined), ss, key)
}

func encryptVectors() throws -> [[String: Any]] {
    var rows: [[String: Any]] = []
    var rng = SplitMix64(state: 0xE4C)
    let cases: [(Int, Int, String)] = [
        (3, 4, "hello"), (4, 3, ""), (5, 6, #"{"id":"","pubkey":"x","created_at":1798761600,"kind":14,"tags":[],"content":"bitchat1:AQ"}"#),
        (6, 3, "Grüße 🌍 — émoji"), (0, 1, String(repeating: "A", count: 300)), (2, 5, "odd/even mix"),
    ]
    for (s, r, plaintext) in cases {
        let sender = identity(ecdhKeys[s].priv), recipient = identity(ecdhKeys[r].priv)
        let senderKey = try sender.schnorrSigningKey(), recipientKey = try recipient.schnorrSigningKey()
        // 1. Our fixed-nonce rebuild must equal BitChat's encrypt given its nonce.
        let real = try NostrProtocol.harnessEncrypt(plaintext: plaintext, recipientPubkey: recipient.publicKeyHex, senderKey: senderKey)
        let realNonce = Base64URLCoding.decode(String(real.dropFirst(3)))!.prefix(24)
        let again = try encryptWithNonce(plaintext: plaintext, recipientPubkey: recipient.publicKeyHex, senderKey: senderKey, nonce24: Data(realNonce))
        guard again.out == real else { fail("encrypt rebuild differs from NostrProtocol.encrypt") }
        // 2. The fixed vector.
        let nonce = rng.bytes(24)
        let v = try encryptWithNonce(plaintext: plaintext, recipientPubkey: recipient.publicKeyHex, senderKey: senderKey, nonce24: nonce)
        // BitChat's decrypt needs more than nonce+tag (data.count > 40), so it
        // refuses an empty plaintext; every other vector must open.
        let opened = try? NostrProtocol.harnessDecrypt(ciphertext: v.out, senderPubkey: sender.publicKeyHex, recipientKey: recipientKey)
        guard opened == plaintext || (plaintext.isEmpty && opened == nil) else {
            fail("BitChat decrypt cannot open the vector")
        }
        // Which lift of the sender's x-only key the recipient's decrypt needs.
        let evenSS = try NostrProtocol.harnessDeriveSharedSecret(privateKey: recipientKey, publicKey: Data([0x02]) + sender.publicKey)
        rows.append([
            "name": "\(ecdhKeys[s].name)->\(ecdhKeys[r].name)",
            "senderPrivateKeyHex": hex(ecdhKeys[s].priv), "senderPublicKeyHex": sender.publicKeyHex,
            "recipientPrivateKeyHex": hex(ecdhKeys[r].priv), "recipientPublicKeyHex": recipient.publicKeyHex,
            "plaintext": plaintext, "nonceHex": hex(nonce),
            "sharedSecretHex": hex(v.sharedSecret), "keyHex": hex(v.key), "payload": v.out,
            "recipientDecryptOpensWithLift": evenSS == v.sharedSecret ? "02" : "03",
            "bitchatDecryptAccepts": opened != nil,
        ])
    }
    return rows
}

struct EnvCase { let name: String; let content: String; let innerTags: [[String]]? }

func envelopeVectors() throws -> [[String: Any]] {
    let senders = [identity(labelKey("env-sender-1")), identity(labelKey("env-sender-2"))]
    let recipients = [identity(labelKey("env-recipient-1")), identity(labelKey("env-recipient-2"))]
    func pm(_ text: String, _ id: String) -> String {
        guard let s = NostrEmbeddedBitChat.encodePMForNostrNoRecipient(content: text, messageID: id) else { fail("pm nil") }
        return s
    }
    func ack(_ t: NoisePayloadType, _ id: String) -> String { NostrEmbeddedBitChat.encodeAckForNostrNoRecipient(type: t, messageID: id)! }
    let cases: [EnvCase] = [
        EnvCase(name: "pmShort", content: pm("hello geohash dm", "A1B2C3D4-0001-4000-8000-000000000001"), innerTags: nil),
        EnvCase(name: "pmEmoji", content: pm("Café ☕️ 👋🏽 東京", "A1B2C3D4-0002-4000-8000-000000000002"), innerTags: nil),
        EnvCase(name: "pmCompressed", content: pm(String(repeating: "ping ", count: 50), "A1B2C3D4-0003-4000-8000-000000000003"), innerTags: nil),
        EnvCase(name: "deliveredAck", content: ack(.delivered, "A1B2C3D4-0001-4000-8000-000000000001"), innerTags: nil),
        EnvCase(name: "readReceiptAck", content: ack(.readReceipt, "A1B2C3D4-0002-4000-8000-000000000002"), innerTags: nil),
        EnvCase(name: "pmAndroidInnerPTag", content: pm("inner p tag (current Android shape)", "A1B2C3D4-0006-4000-8000-000000000006"), innerTags: []),
    ]
    var rows: [[String: Any]] = []
    for (i, c) in cases.enumerated() {
        let sender = senders[i % 2], recipient = recipients[(i / 2) % 2]
        let wrap: NostrEvent
        if c.innerTags != nil {
            wrap = try NostrProtocol.createPrivateMessageWithInnerTagsForTesting(
                content: c.content, recipientPubkey: recipient.publicKeyHex, senderIdentity: sender,
                innerMessageTags: [["p", recipient.publicKeyHex]])
        } else {
            wrap = try NostrProtocol.createPrivateMessage(content: c.content, recipientPubkey: recipient.publicKeyHex, senderIdentity: sender)
        }
        let r = try NostrProtocol.decryptPrivateMessage(giftWrap: wrap, recipientIdentity: recipient)
        guard r.content == c.content, r.senderPubkey == sender.publicKeyHex else { fail("\(c.name): round trip") }
        var expect: [String: Any] = ["content": r.content, "senderPubkey": r.senderPubkey, "timestamp": r.timestamp]
        let read = readContent(r.content)
        for k in ["payloadType", "messageID", "text"] { if let v = read[k] { expect[k] = v } }
        let layers = peel(wrap, recipient: recipient)
        rows.append([
            "name": c.name, "recipientPrivateKeyHex": hex(recipient.privateKey), "recipientPublicKey": recipient.publicKeyHex,
            "senderPrivateKeyHex": hex(sender.privateKey), "senderPublicKey": sender.publicKeyHex,
            "event": eventDict(wrap), "expect": expect, "decoded": read,
            "sealJSON": layers.map { $0.sealJSON as Any } ?? NSNull(), "rumorJSON": layers.map { $0.rumorJSON as Any } ?? NSNull(),
        ])
    }
    return rows
}

func fixtureVectors() throws -> [[String: Any]] {
    func load(_ name: String) -> [String: Any] {
        guard let b64 = bitchatFixturesBase64[name], let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { fail("fixture \(name)") }
        return obj
    }
    // name, event fixture, recipient key, what BitChat's own tests expect
    // (bitchatTests/NostrProtocolTests.swift at the pinned commit).
    let ios = load("LegacyPrivateEnvelope733098bb")
    let iosKey = load("LegacyPrivateEnvelope733098bbRecipientKey")["recipient_private_key"] as! String
    let android = load("AndroidLegacyPrivateEnvelopeB7f0b33d")
    let meta = load("AndroidLegacyPrivateEnvelopeB7f0b33dMetadata")
    let cases: [(String, [String: Any], String, String, String, [String: Any])] = [
        ("LegacyPrivateEnvelope733098bb", ios, iosKey, "legacy fixture from 733098bb",
         "2e3d79df7047204f02b726c574e256f8de1dd80510f7dcb8b0d12df13acb87e6", [:]),
        ("AndroidLegacyPrivateEnvelopeB7f0b33d", android, meta["recipient_private_key"] as! String,
         "legacy fixture from Android b7f0b33d", meta["sender_public_key"] as! String, meta),
    ]
    return try cases.map { name, eventObj, key, testContent, testSender, metadata in
        let recipient = identity(unhex(key))
        let event = try NostrEvent(from: eventObj)
        let r = try NostrProtocol.decryptPrivateMessage(giftWrap: event, recipientIdentity: recipient)
        guard r.content == testContent, r.senderPubkey == testSender else { fail("\(name): differs from BitChat's test") }
        var row: [String: Any] = [
            "name": name, "recipientPrivateKeyHex": key, "event": eventObj,
            "expect": ["content": r.content, "senderPubkey": r.senderPubkey, "timestamp": r.timestamp],
            "decoded": readContent(r.content),
            "outerCreatedAt": event.created_at,
        ]
        if !metadata.isEmpty { row["metadata"] = metadata.filter { $0.key != "recipient_private_key" } }
        if let layers = peel(event, recipient: recipient) { row["sealJSON"] = layers.sealJSON; row["rumorJSON"] = layers.rumorJSON }
        return row
    }
}

func rejectVectors() throws -> [[String: Any]] {
    let sender = identity(labelKey("rej-sender")), recipient = identity(labelKey("rej-recipient"))
    let other = identity(labelKey("rej-other"))
    let R = recipient.publicKeyHex
    let senderKey = try sender.schnorrSigningKey()
    let pm = NostrEmbeddedBitChat.encodePMForNostrNoRecipient(content: "should be rejected", messageID: "REJ-0001")!
    func good() throws -> NostrEvent { try NostrProtocol.createPrivateMessage(content: pm, recipientPubkey: R, senderIdentity: sender) }
    func goodSealJSON() throws -> String {
        try NostrProtocol.harnessCreateSeal(rumor: rumor(sender, content: pm), recipientPubkey: R, senderKey: senderKey).jsonString()
    }
    func wrapRumor(_ rum: NostrEvent) throws -> NostrEvent {
        let seal = try NostrProtocol.harnessCreateSeal(rumor: rum, recipientPubkey: R, senderKey: senderKey)
        return try NostrProtocol.harnessCreateGiftWrap(seal: seal, recipientPubkey: R)
    }
    func wrapSeal(_ seal: NostrEvent) throws -> NostrEvent { try NostrProtocol.harnessCreateGiftWrap(seal: seal, recipientPubkey: R) }
    func withField(_ e: NostrEvent, _ key: String, _ value: Any) -> [String: Any] {
        var d = eventDict(e); d[key] = value; return d
    }

    var cases: [(String, String, Any)] = [] // name, recipient key hex, event object
    let base = try good()
    cases.append(("wrongRecipient", hex(other.privateKey), eventDict(base)))
    cases.append(("wrongOuterKindUnsigned", hex(recipient.privateKey), eventDict(NostrEvent(
        pubkey: base.pubkey, createdAt: Date(timeIntervalSince1970: TimeInterval(base.created_at)),
        kind: .textNote, tags: base.tags, content: base.content))))
    cases.append(("wrongOuterKindSigned", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, kind: .textNote))))
    var badSig = eventDict(base)
    var sigChars = Array(base.sig!); sigChars[10] = sigChars[10] == "0" ? "1" : "0"
    badSig["sig"] = String(sigChars)
    cases.append(("outerSignatureFlipped", hex(recipient.privateKey), badSig))
    cases.append(("outerSignatureMissing", hex(recipient.privateKey), { var d = eventDict(base); d.removeValue(forKey: "sig"); return d }()))
    cases.append(("outerIdTampered", hex(recipient.privateKey), withField(base, "id", String(repeating: "0", count: 64))))
    cases.append(("outerTagsEmpty", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, tags: []))))
    cases.append(("outerExtraTag", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, tags: [["p", R], ["expiration", "1900000000"]]))))
    cases.append(("outerDuplicatePTag", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, tags: [["p", R], ["p", R]]))))
    cases.append(("outerPTagUppercaseHex", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, tags: [["p", R.uppercased()]]))))
    cases.append(("outerCiphertextTampered", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, content: { c in
        var chars = Array(c); let i = chars.count - 30; chars[i] = chars[i] == "A" ? "B" : "A"; return String(chars)
    }))))
    cases.append(("outerMissingV2Prefix", hex(recipient.privateKey), eventDict(try manualWrap(sealJSON: goodSealJSON(), recipientPubkey: R, content: { String($0.dropFirst(3)) }))))
    cases.append(("outerOversizedContent", hex(recipient.privateKey), eventDict(try {
        let w = try P256K.Schnorr.PrivateKey()
        let e = NostrEvent(pubkey: hex(w.xonly.bytes), createdAt: Date(), kind: .giftWrap, tags: [["p", R]],
                           content: "v2:" + String(repeating: "A", count: NostrProtocol.maximumPrivateEnvelopeCiphertextBytes))
        return try e.sign(with: w)
    }())))
    cases.append(("standardNip44Payload", hex(recipient.privateKey), eventDict(try {
        let w = try P256K.Schnorr.PrivateKey()
        let e = NostrEvent(pubkey: hex(w.xonly.bytes), createdAt: Date(), kind: .giftWrap, tags: [["p", R]],
                           content: "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb")
        return try e.sign(with: w)
    }())))
    cases.append(("invalidSealSignature", hex(recipient.privateKey), eventDict(try NostrProtocol.createPrivateMessageWithInvalidSealSignatureForTesting(
        content: pm, recipientPubkey: R, senderIdentity: sender))))
    cases.append(("sealRumorPubkeyMismatch", hex(recipient.privateKey), eventDict(try NostrProtocol.createPrivateMessageWithMismatchedSealRumorPubkeyForTesting(
        content: pm, recipientPubkey: R, rumorIdentity: other, sealSignerIdentity: sender))))
    cases.append(("sealWithTags", hex(recipient.privateKey), eventDict(try wrapSeal(manualSeal(
        rumorJSON: rumor(sender, content: pm).jsonString(), recipientPubkey: R, sender: sender, tags: [["p", R]])))))
    cases.append(("sealWrongKind", hex(recipient.privateKey), eventDict(try wrapSeal(manualSeal(
        rumorJSON: rumor(sender, content: pm).jsonString(), recipientPubkey: R, sender: sender, kind: .dm)))))
    cases.append(("sealUnsigned", hex(recipient.privateKey), eventDict(try {
        let enc = try NostrProtocol.harnessEncrypt(plaintext: rumor(sender, content: pm).jsonString(), recipientPubkey: R, senderKey: senderKey)
        let seal = NostrEvent(pubkey: sender.publicKeyHex, createdAt: Date(), kind: .seal, tags: [], content: enc)
        return try wrapSeal(seal)
    }())))
    cases.append(("rumorWrongKind", hex(recipient.privateKey), eventDict(try wrapRumor(rumor(sender, content: pm, kind: .textNote)))))
    cases.append(("rumorSigned", hex(recipient.privateKey), eventDict(try wrapRumor(rumor(sender, content: pm).sign(with: senderKey)))))
    let innerShapes: [(String, [[String]])] = [
        ("innerPTagOtherRecipient", [["p", other.publicKeyHex]]),
        ("innerPTagDuplicated", [["p", R], ["p", R]]),
        ("innerPTagExtraValue", [["p", R, "unexpected"]]),
        ("innerXTag", [["x", R]]),
    ]
    for (name, tags) in innerShapes {
        cases.append((name, hex(recipient.privateKey), eventDict(try NostrProtocol.createPrivateMessageWithInnerTagsForTesting(
            content: pm, recipientPubkey: R, senderIdentity: sender, innerMessageTags: tags))))
    }
    cases.append(("tooManyOuterTags", hex(recipient.privateKey),
                  withField(base, "tags", [["p", R]] + Array(repeating: ["t", "x"], count: TransportConfig.nostrMaxEventTags))))

    return cases.map { name, key, eventObj in
        let r = openOne(recipientPrivateKey: key, event: eventObj)
        guard r["ok"] as? Bool == false, let err = r["error"] as? String else { fail("reject \(name) was accepted by BitChat") }
        return ["name": name, "recipientPrivateKeyHex": key, "event": eventObj, "expectedError": err, "stage": r["stage"] ?? ""]
    }
}

/// Name the section a BitChat error came from.
func section<T>(_ name: String, _ body: () throws -> T) throws -> T {
    do { return try body() } catch { throw HarnessError("\(name): \(error)") }
}

func runVectors(outPath: String) throws {
    let packets = packetVectors()
    let tlv = tlvVectors()
    let ecdh = try section("ecdh") { try ecdhVectors() }
    let doc: [String: Any] = [
        "about": "BitChat private-message (geohash DM) vectors computed by BitChat iOS's own Swift code. Made by tools/chat/bitchat-swift (run.sh vectors). Deterministic: packets, tlv, tlvDecode, xchacha, hkdf, ecdh, encrypt. Random per run: envelopes, rejects.",
        "bitchatCommit": bitchatCommit,
        "bitchatRepo": "https://github.com/permissionlesstech/bitchat",
        "bitchatSourceSha256": Dictionary(uniqueKeysWithValues: bitchatSourceFiles.map { ($0.path, $0.sha256) }),
        "constants": [
            "maximumPrivateEnvelopeCiphertextBytes": NostrProtocol.maximumPrivateEnvelopeCiphertextBytes,
            "nostrMaxEventTags": TransportConfig.nostrMaxEventTags,
            "nostrMaxEventTagValues": TransportConfig.nostrMaxEventTagValues,
            "nostrMaxEventTagValueBytes": TransportConfig.nostrMaxEventTagValueBytes,
            "outerAndSealCreatedAtJitterSeconds": 900,
            "appRumorTimestampMaxAgeSeconds": Int(TransportConfig.nostrDMSubscribeLookbackSeconds + TransportConfig.nostrDMMaxClockSkewSeconds),
            "appRumorTimestampMaxFutureSeconds": Int(TransportConfig.nostrDMMaxClockSkewSeconds),
            "compressionThresholdBytes": 100,
            "paddingBlockSizes": [256, 512, 1024, 2048],
            "packetTTL": 7, "packetVersion": 1, "packetType": Int(MessageType.noiseEncrypted.rawValue),
            "flagHasRecipient": Int(BinaryProtocol.Flags.hasRecipient), "flagHasSignature": Int(BinaryProtocol.Flags.hasSignature),
            "flagIsCompressed": Int(BinaryProtocol.Flags.isCompressed),
            "noisePayloadPrivateMessage": 1, "noisePayloadReadReceipt": 2, "noisePayloadDelivered": 3,
            "hkdfInfo": "nip44-v2", "hkdfSalt": "",
        ] as [String: Any],
        "packets": packets,
        "tlv": tlv.encode,
        "tlvDecode": tlv.decode,
        "xchacha": try section("xchacha") { try xchachaVectors() },
        "ecdh": ecdh,
        "hkdf": try section("hkdf") { try hkdfVectors(ecdh) },
        "encrypt": try section("encrypt") { try encryptVectors() },
        "envelopes": try section("envelope") { try envelopeVectors() },
        "fixtures": try section("fixture") { try fixtureVectors() },
        "rejects": try section("reject") { try rejectVectors() },
    ]
    var data = jsonData(doc)
    data.append(Data("\n".utf8))
    try data.write(to: URL(fileURLWithPath: outPath))
    FileHandle.standardError.write(Data("harness: wrote \(outPath)\n".utf8))
}

// MARK: - Main

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "vectors":
    do { try runVectors(outPath: args.count > 2 ? args[2] : "bitchat-dm-vectors.json") } catch { fail("vectors: \(error)") }
case "open":
    guard args.count > 2 else { fail("usage: harness open <file.json>") }
    exit(runOpen(path: args[2]))
default:
    fail("usage: harness vectors [out.json] | harness open <file.json>")
}
