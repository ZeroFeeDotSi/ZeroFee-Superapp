// shims.swift - ZeroFee code, not BitChat's. The smallest stand-ins for app
// symbols the copied files name but that live in BitChat files we do not copy.
// None of them is on the private-message path except TransportConfig's three
// tag limits, which carry BitChat's values verbatim.
import Foundation

/// bitchat/Services/TransportConfig.swift @ 04995f68, only the constants the
/// copied files read. Values copied as-is.
enum TransportConfig {
    static let nostrMaxEventTags: Int = 64
    static let nostrMaxEventTagValues: Int = 16
    static let nostrMaxEventTagValueBytes: Int = 1024
    // Not read by the copied files; recorded in the vectors because the app
    // drops a decrypted DM whose rumor timestamp falls outside this window
    // (NostrInboundPipeline.isPlausibleRumorTimestamp).
    static let nostrDMSubscribeLookbackSeconds: TimeInterval = 86400
    static let nostrDMMaxClockSkewSeconds: TimeInterval = 900
}

/// Stand-in for bitchat/Nostr/NostrPoW.swift. Only geohash *public* messages
/// (createMinedEphemeralGeohashEvent) mine; the harness never calls that.
enum NostrPoW {
    static let targetBits = 8
    static func mineNonceTag(
        pubkey: String, createdAt: Int, kind: Int, tags: [[String]], content: String, targetBits: Int = NostrPoW.targetBits
    ) async -> [String]? {
        fatalError("NostrPoW is not part of the private-message harness")
    }
}

/// Stand-in for bitchat/Protocols/MeshMessageIdentity.swift (mesh bridge
/// events only; the harness never calls createBridgeMeshEvent).
enum MeshMessageIdentity {
    static func stableID(senderIDHex: String, timestampMs: UInt64, content: String) -> String {
        fatalError("MeshMessageIdentity is not part of the private-message harness")
    }
}
