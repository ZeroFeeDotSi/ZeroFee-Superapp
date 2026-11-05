// swift-tools-version: 5.9
// ZeroFee's BitChat harness. Builds BitChat iOS's own (public-domain) source
// files, copied in by fetch.sh, next to our main.swift + shims.swift.
// Swift 5 language mode on purpose: that is how BitChat builds these files.

import PackageDescription

let package = Package(
    name: "bitchat-swift",
    platforms: [.macOS(.v13)],
    dependencies: [
        // The exact secp256k1 package and version BitChat's Package.swift pins.
        .package(url: "https://github.com/21-DOT-DEV/swift-secp256k1", exact: "0.24.0")
    ],
    targets: [
        .target(name: "BitLogger", path: "Sources/BitLogger"),
        .target(name: "BitFoundation", dependencies: ["BitLogger"], path: "Sources/BitFoundation"),
        .executableTarget(
            name: "harness",
            dependencies: [
                "BitFoundation",
                "BitLogger",
                .product(name: "P256K", package: "swift-secp256k1")
            ],
            path: "Sources/harness",
            // BitChat's reject-path test generators
            // (createPrivateMessageWith...ForTesting) sit under #if DEBUG.
            swiftSettings: [.define("DEBUG")]
        )
    ]
)
