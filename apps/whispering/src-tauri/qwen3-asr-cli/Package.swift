// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "qwen3-asr-cli",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/soniqo/speech-swift", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "QwenASRCLI",
            dependencies: [
                .product(name: "Qwen3ASR", package: "speech-swift"),
            ],
            path: "Sources/QwenASRCLI"
        ),
    ]
)
