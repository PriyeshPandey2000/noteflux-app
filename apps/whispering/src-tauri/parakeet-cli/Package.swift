// swift-tools-version: 6.0
import PackageDescription

// Mirrors qwen3-asr-cli/Package.swift. `speech-swift` (the same package that
// provides Qwen3ASR) ships `ParakeetASR` (CoreML, batch transcription) as a
// separate product. Verified against the real package source: the real API
// is `ParakeetASRModel.fromPretrained(modelId:cacheDir:offlineMode:encoderVariant:progressHandler:)`
// and `.transcribeAudio(_:sampleRate:language:) throws -> String` — see
// main.swift.
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
