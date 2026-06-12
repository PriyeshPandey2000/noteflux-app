import AVFoundation
import AudioCommon
import Foundation
import Darwin
@preconcurrency import Qwen3ASR

// Read model ID from --model <id> arg, defaulting to the 0.6B model.
let modelId: String = {
    if let idx = CommandLine.arguments.firstIndex(of: "--model"),
       idx + 1 < CommandLine.arguments.count {
        return CommandLine.arguments[idx + 1]
    }
    return "aufklarer/Qwen3-ASR-0.6B-MLX-4bit"
}()
let tokenizerFiles = ["vocab.json", "merges.txt", "tokenizer_config.json"]

func modelIsDownloaded() -> Bool {
    guard let cacheDir = try? HuggingFaceDownloader.getCacheDirectory(for: modelId) else {
        return false
    }
    let vocabExists = FileManager.default.fileExists(
        atPath: cacheDir.appendingPathComponent("vocab.json").path
    )
    return HuggingFaceDownloader.weightsExist(in: cacheDir) && vocabExists
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
                additionalFiles: tokenizerFiles,
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
        throw NSError(domain: "QwenASR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create target format"])
    }

    let sourceFrameCount = AVAudioFrameCount(sourceFile.length)
    guard let sourceBuf = AVAudioPCMBuffer(pcmFormat: sourceFile.processingFormat, frameCapacity: sourceFrameCount) else {
        throw NSError(domain: "QwenASR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate source buffer"])
    }
    try sourceFile.read(into: sourceBuf)

    guard let converter = AVAudioConverter(from: sourceFile.processingFormat, to: targetFormat) else {
        throw NSError(domain: "QwenASR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio converter"])
    }

    let ratio = targetRate / sourceFile.processingFormat.sampleRate
    let targetFrameCount = AVAudioFrameCount(Double(sourceFrameCount) * ratio)
    guard let targetBuf = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: targetFrameCount) else {
        throw NSError(domain: "QwenASR", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate target buffer"])
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
// Each input line: an audio file path.
// Each output line: "OK:<transcript>" or "ERR:<message>".
// This avoids reloading weights (~3-5s) on every transcription call.
Task {
    do {
        // Silence stdout during model load so progress logs don't pollute the protocol.
        let realStdoutFd = dup(STDOUT_FILENO)
        freopen("/dev/null", "w", stdout)

        // offlineMode: weights are guaranteed downloaded before daemon starts
        // (app gates on --status), so never ping HuggingFace — daemon must
        // start even with no internet.
        let model = try await Qwen3ASRModel.fromPretrained(modelId: modelId, offlineMode: true)

        // Restore stdout and signal readiness to Rust.
        fflush(stdout)
        dup2(realStdoutFd, STDOUT_FILENO)

        func writeLine(_ s: String) {
            var line = s + "\n"
            line.withUTF8 { ptr in
                _ = Darwin.write(realStdoutFd, ptr.baseAddress!, ptr.count)
            }
        }

        writeLine("READY")

        // Process requests one at a time until stdin closes.
        // Input format: "<audio_path>\t<language>" — language is empty for auto-detect.
        while let line = readLine(strippingNewline: true) {
            let parts = line.split(separator: "\t", maxSplits: 1)
            let audioPath = parts.first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
            guard !audioPath.isEmpty else { continue }
            let language: String? = parts.count > 1 && !parts[1].isEmpty ? String(parts[1]) : nil

            do {
                let (samples, sampleRate) = try loadAudio(from: audioPath)
                let text = model.transcribe(audio: samples, sampleRate: sampleRate, language: language)
                writeLine("OK:" + text.trimmingCharacters(in: .whitespacesAndNewlines))
            } catch {
                writeLine("ERR:" + error.localizedDescription)
            }
        }

        exit(0)
    } catch {
        fputs("error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

RunLoop.main.run()
