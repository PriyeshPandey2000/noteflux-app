import AVFoundation
import AudioCommon
import Foundation
import Darwin
@preconcurrency import ParakeetASR

// UNVERIFIED SECTION — see the note in Package.swift.
// Everything below marked "ParakeetASR API" mirrors qwen3-asr-cli/Sources/QwenASRCLI/main.swift
// 1:1 (same fromPretrained/transcribe shape used throughout speech-swift's other
// products), but has not been compiled against the real package yet. Confirm:
//   - `ParakeetASRModel.fromPretrained(modelId:offlineMode:)` exists with this signature
//   - `ParakeetDecodingOptions(language:)` is the right options type/field name
//   - the two model IDs below are what `fromPretrained` actually expects
// and fix just this file if any of those are wrong — the CLI protocol (--status/
// --delete/--download/daemon stdin-stdout loop) below is this app's own design,
// not part of the external package, so it doesn't need re-verifying.

// Read model ID from --model <id> arg, defaulting to the v2 (English) model.
let modelId: String = {
    if let idx = CommandLine.arguments.firstIndex(of: "--model"),
       idx + 1 < CommandLine.arguments.count {
        return CommandLine.arguments[idx + 1]
    }
    return "parakeet-v2"
}()

func modelIsDownloaded() -> Bool {
    guard let cacheDir = try? HuggingFaceDownloader.getCacheDirectory(for: modelId) else {
        return false
    }
    return HuggingFaceDownloader.weightsExist(in: cacheDir)
}

// --status: report whether model weights are cached locally, then exit.
if CommandLine.arguments.contains("--status") {
    print(modelIsDownloaded() ? "DOWNLOADED" : "NOT_DOWNLOADED")
    exit(0)
}

// --delete: remove cached model weights from disk, then exit.
if CommandLine.arguments.contains("--delete") {
    do {
        let cacheDir = try HuggingFaceDownloader.getCacheDirectory(for: modelId)
        if FileManager.default.fileExists(atPath: cacheDir.path) {
            try FileManager.default.removeItem(at: cacheDir)
        }
        print("DELETED")
        exit(0)
    } catch {
        fputs("error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

// --download: download model weights with real progress, then exit.
// Protocol: "PROGRESS:<0-100>" lines as bytes arrive, "DONE" on success.
if CommandLine.arguments.contains("--download") {
    // Thread-safe percent tracker — progress callback may fire off-main.
    final class PctBox: @unchecked Sendable {
        private var last = -1
        private let lock = NSLock()
        func updated(_ pct: Int) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard pct != last else { return false }
            last = pct
            return true
        }
    }

    Task {
        do {
            let cacheDir = try HuggingFaceDownloader.getCacheDirectory(for: modelId)
            let box = PctBox()
            try await HuggingFaceDownloader.downloadWeights(
                modelId: modelId,
                to: cacheDir,
                additionalFiles: [],
                progressHandler: { @Sendable fraction in
                    let pct = Int(fraction * 100)
                    if box.updated(pct) {
                        print("PROGRESS:\(pct)")
                        fflush(stdout)
                    }
                }
            )
            print("DONE")
            fflush(stdout)
            exit(0)
        } catch {
            fputs("error: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
    RunLoop.main.run()
}

func loadAudio(from path: String) throws -> (samples: [Float], sampleRate: Int) {
    let url = URL(fileURLWithPath: path)
    let sourceFile = try AVAudioFile(forReading: url)

    let targetRate = 16_000.0
    guard let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: targetRate,
        channels: 1,
        interleaved: false
    ) else {
        throw NSError(domain: "ParakeetASR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create target format"])
    }

    let sourceFrameCount = AVAudioFrameCount(sourceFile.length)
    guard let sourceBuf = AVAudioPCMBuffer(pcmFormat: sourceFile.processingFormat, frameCapacity: sourceFrameCount) else {
        throw NSError(domain: "ParakeetASR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate source buffer"])
    }
    try sourceFile.read(into: sourceBuf)

    guard let converter = AVAudioConverter(from: sourceFile.processingFormat, to: targetFormat) else {
        throw NSError(domain: "ParakeetASR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio converter"])
    }

    let ratio = targetRate / sourceFile.processingFormat.sampleRate
    let targetFrameCount = AVAudioFrameCount(Double(sourceFrameCount) * ratio)
    guard let targetBuf = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: targetFrameCount) else {
        throw NSError(domain: "ParakeetASR", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate target buffer"])
    }

    var conversionError: NSError?
    var sourceConsumed = false
    let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
        if sourceConsumed {
            outStatus.pointee = .endOfStream
            return nil
        }
        outStatus.pointee = .haveData
        sourceConsumed = true
        return sourceBuf
    }

    converter.convert(to: targetBuf, error: &conversionError, withInputFrom: inputBlock)
    if let err = conversionError { throw err }

    let floatPtr = targetBuf.floatChannelData![0]
    let samples = Array(UnsafeBufferPointer(start: floatPtr, count: Int(targetBuf.frameLength)))
    return (samples, 16_000)
}

// Persistent daemon mode: load model once, then read audio paths from stdin line by line.
// Each input line: "<audio_path>\t<language>" — language empty for auto-detect
// (only meaningful for the v3 multilingual model; v2 is English-only).
// Each output line: "OK:<transcript>" or "ERR:<message>".
// This avoids reloading weights on every transcription call — same daemon
// shape as qwen3-asr-cli, so the Rust side can reuse its spawn/IPC logic.
Task {
    let realStdoutFd = dup(STDOUT_FILENO)
    dup2(STDERR_FILENO, STDOUT_FILENO)

    func writeLine(_ s: String) {
        var line = s + "\n"
        line.withUTF8 { ptr in
            _ = Darwin.write(realStdoutFd, ptr.baseAddress!, ptr.count)
        }
    }

    do {
        // offlineMode: weights are guaranteed downloaded before daemon starts
        // (app gates on --status), so never ping HuggingFace — daemon must
        // start even with no internet.
        let model = try await ParakeetASRModel.fromPretrained(modelId: modelId, offlineMode: true)

        fflush(stdout)
        dup2(realStdoutFd, STDOUT_FILENO)

        writeLine("READY")

        while let line = readLine(strippingNewline: true) {
            let parts = line.split(separator: "\t", maxSplits: 1)
            let audioPath = parts.first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
            guard !audioPath.isEmpty else { continue }
            let language: String? = parts.count > 1 && !parts[1].isEmpty ? String(parts[1]) : nil

            do {
                let (samples, sampleRate) = try loadAudio(from: audioPath)
                let options = ParakeetDecodingOptions(language: language)
                let text = model.transcribe(audio: samples, sampleRate: sampleRate, options: options)
                writeLine("OK:" + text.trimmingCharacters(in: .whitespacesAndNewlines))
            } catch {
                writeLine("ERR:" + error.localizedDescription)
            }
        }

        exit(0)
    } catch {
        writeLine("LOAD_ERROR:" + error.localizedDescription)
        fputs("error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

RunLoop.main.run()
