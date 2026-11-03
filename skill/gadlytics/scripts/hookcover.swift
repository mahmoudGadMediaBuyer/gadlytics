// GADLYTICS — write the hook onto a video's opening frame.
// Usage: hookcover IN.jpg OUT.jpg "hook text"
// White, heavy Arabic text (right-to-left, centred) on a dark band at the bottom; the font shrinks to fit 4 lines, then words are cut with «…».
import AppKit

let a = CommandLine.arguments
guard a.count >= 4, let src = NSImage(contentsOfFile: a[1]), let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("usage: hookcover IN.jpg OUT.jpg TEXT\n".data(using: .utf8)!); exit(2) }
let W = cg.width, H = cg.height
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                 isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let full = NSRect(x: 0, y: 0, width: W, height: H)
NSGraphicsContext.current?.cgContext.draw(cg, in: full)

var text = a[3].trimmingCharacters(in: .whitespacesAndNewlines)
let w = CGFloat(W), side = w * 0.07, box = w - side * 2
let para = NSMutableParagraphStyle(); para.alignment = .center; para.baseWritingDirection = .rightToLeft; para.lineHeightMultiple = 1.08
let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.75); shadow.shadowBlurRadius = w * 0.012; shadow.shadowOffset = NSSize(width: 0, height: -w * 0.003)
func attr(_ s: String, _ size: CGFloat) -> NSAttributedString {
  NSAttributedString(string: s, attributes: [.font: NSFont.systemFont(ofSize: size, weight: .heavy), .foregroundColor: NSColor.white,
                                             .paragraphStyle: para, .shadow: shadow])
}
func height(_ s: String, _ size: CGFloat) -> CGFloat { attr(s, size).boundingRect(with: NSSize(width: box, height: 10000), options: [.usesLineFragmentOrigin]).height }
var size = w * 0.068
let maxLines: CGFloat = 4
while size > w * 0.048 && height(text, size) > size * 1.35 * maxLines { size -= 1 }
var words = text.split(separator: " ").map(String.init)
while words.count > 3 && height(text, size) > size * 1.35 * maxLines { words.removeLast(); text = words.joined(separator: " ") + "…" }

let th = height(text, size), bottom = w * 0.07
let bandTop = min(CGFloat(H), bottom + th + w * 0.30)
let g = NSGradient(colors: [NSColor.black.withAlphaComponent(0.88), NSColor.black.withAlphaComponent(0.66), NSColor.black.withAlphaComponent(0)],
                   atLocations: [0, 0.55, 1], colorSpace: .deviceRGB)
g?.draw(in: NSRect(x: 0, y: 0, width: w, height: bandTop), angle: 90)
attr(text, size).draw(with: NSRect(x: side, y: bottom, width: box, height: th + 2), options: [.usesLineFragmentOrigin])
NSGraphicsContext.restoreGraphicsState()
guard let out = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else { exit(1) }
try out.write(to: URL(fileURLWithPath: a[2]))
