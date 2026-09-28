// swift-tools-version: 6.0
import PackageDescription

// NOTE: mirrors qwen3-asr-cli/Package.swift. `speech-swift` (the same package
// that provides Qwen3ASR) also ships a `ParakeetASR` product (CoreML, batch
// transcription) per its README. The exact product name below is unverified
// against the actual package source — this session has no Swift toolchain to
// `swift package resolve` and confirm it — so the first thing to check when
// building this locally is that `ParakeetASR` is really the product name and
// that it exposes `ParakeetASRModel.fromPretrained(modelId:)` /
// `.transcribe(audio:sampleRate:options:)` the way main.swift assumes below.
// If the real API differs, main.swift is the only file that needs to change.
let package = Package(
    name: "parakeet-cli",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(url: "https://github.com/soniqo/speech-swift", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "ParakeetCLI",
            dependencies: [
                .product(name: "ParakeetASR", package: "speech-swift"),
            ],
            path: "Sources/ParakeetCLI",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
