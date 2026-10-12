// swift-tools-version: 6.0
import PackageDescription

// No external dependency — Vision is a system framework, text recognition
// (VNRecognizeTextRequest) is on-device and has shipped since macOS 10.15,
// well before Apple Intelligence existed, so there's no eligibility gate.
let package = Package(
    name: "ocr-cli",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "OCRCLI",
            path: "Sources/OCRCLI"
        ),
    ]
)
