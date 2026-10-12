import Vision
import Foundation
import ImageIO

// Protocol: PNG bytes on stdin, recognized text (one line per text region) on
// stdout, nothing printed if no text is found. VNImageRequestHandler.perform
// is synchronous for this request type — results are populated by the time
// perform returns, no completion-handler/async dance needed.
let inputData = FileHandle.standardInput.readDataToEndOfFile()

guard !inputData.isEmpty else {
    fputs("error: no image data on stdin\n", stderr)
    exit(1)
}

guard let source = CGImageSourceCreateWithData(inputData as CFData, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("error: failed to decode image data\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    fputs("error: \(error.localizedDescription)\n", stderr)
    exit(1)
}

guard let observations = request.results else {
    exit(0)
}

// Vision doesn't guarantee results come back in reading order, and gives no
// document structure (no bold/tables/bullets — it only detects text
// regions). Sorting purely by vertical position breaks anything laid out
// side-by-side in the original image (a form's "Name: John   Age: 25", a
// table row, adjacent UI labels) — two blocks at nearly the same height can
// come back from Vision in arbitrary left/right order. Fix: cluster into
// rows by vertical proximity first, sort left-to-right within each row, and
// join same-row blocks onto one output line instead of splitting them.
struct TextLine {
    let text: String
    let box: CGRect
}

let lines: [TextLine] = observations.compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    return TextLine(text: candidate.string, box: observation.boundingBox)
}

let topToBottom = lines.sorted { $0.box.midY > $1.box.midY }

// Row clustering compares against the row's running average center and its
// tallest member so far, not just whichever line happened to be sorted in
// first — a single box's own height is noisy (a descender like "g" or "j"
// makes Vision report a taller box than a line without one), so anchoring
// the tolerance to one line at a time made rows merge inconsistently.
var rows: [[TextLine]] = []
for line in topToBottom {
    if let lastIndex = rows.indices.last {
        let row = rows[lastIndex]
        let avgMidY = row.map { $0.box.midY }.reduce(0, +) / CGFloat(row.count)
        let maxHeight = row.map { $0.box.height }.max() ?? 0
        if abs(line.box.midY - avgMidY) < maxHeight * 0.7 {
            rows[lastIndex].append(line)
            continue
        }
    }
    rows.append([line])
}

for i in rows.indices {
    rows[i].sort { $0.box.minX < $1.box.minX }
}

struct RowBounds {
    let minY: CGFloat
    let maxY: CGFloat
}
let rowBounds: [RowBounds] = rows.map { row in
    RowBounds(
        minY: row.map { $0.box.minY }.min() ?? 0,
        maxY: row.map { $0.box.maxY }.max() ?? 0
    )
}

// A paragraph break is a gap clearly bigger than the document's own normal
// line-to-line spacing — a table or bulleted list with generous but uniform
// spacing shouldn't read as a new paragraph after every row just because the
// pitch is wide. The baseline must be the document's MINIMUM row-to-row gap,
// not its median: a heading-heavy document can have more "big" transition
// gaps than tight body-line gaps, which would pull a median estimate up
// until it's indistinguishable from the real breaks it's supposed to catch.
// The minimum only needs one tightly-spaced pair anywhere to anchor a
// reliable "this is what one normal line gap looks like" baseline.
let gaps: [CGFloat] = rowBounds.count > 1
    ? (1..<rowBounds.count).map { max(rowBounds[$0 - 1].minY - rowBounds[$0].maxY, 0) }
    : []
let minGap = gaps.min() ?? 0

var output = ""
for (i, row) in rows.enumerated() {
    if i > 0 {
        let gap = rowBounds[i - 1].minY - rowBounds[i].maxY
        if minGap > 0 && gap > minGap * 1.6 {
            output += "\n"
        }
    }
    output += row.map { $0.text }.joined(separator: "   ") + "\n"
}

print(output.trimmingCharacters(in: .whitespacesAndNewlines))
exit(0)
