// GADLYTICS — write the opening frame of a video as a JPEG.
// Usage: frame VIDEO OUT.jpg [WIDTH]   (tries 0.4 s; if that frame is almost black, 1.0 s then 1.8 s)
import AVFoundation
import AppKit

let a = CommandLine.arguments
guard a.count >= 3 else { FileHandle.standardError.write("usage: frame VIDEO OUT.jpg [WIDTH]\n".data(using: .utf8)!); exit(2) }
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
if a[2] == "--info" {   // prints: WIDTH HEIGHT SECONDS (after rotation)
  guard let tr = asset.tracks(withMediaType: .video).first else { print("0 0 0"); exit(0) }
  let sz = tr.naturalSize.applying(tr.preferredTransform)
  print(Int(abs(sz.width)), Int(abs(sz.height)), String(format: "%.1f", CMTimeGetSeconds(asset.duration))); exit(0)
}
let width = a.count > 3 ? Double(a[3]) ?? 360 : 360
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = CGSize(width: width, height: width * 2)
gen.requestedTimeToleranceBefore = CMTime(seconds: 0.2, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.2, preferredTimescale: 600)

func brightness(_ img: CGImage) -> Double {
  let w = 16, h = 16
  var px = [UInt8](repeating: 0, count: w * h * 4)
  guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 255 }
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var s = 0.0
  for i in stride(from: 0, to: px.count, by: 4) { s += Double(px[i]) + Double(px[i + 1]) + Double(px[i + 2]) }
  return s / Double(w * h * 3)
}

var chosen: CGImage? = nil
for t in [0.4, 1.0, 1.8] {
  guard let img = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
  chosen = img
  if brightness(img) > 18 { break }
}
guard let img = chosen else { FileHandle.standardError.write("no frame\n".data(using: .utf8)!); exit(1) }
let rep = NSBitmapImageRep(cgImage: img)
guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.78]) else { exit(1) }
try data.write(to: URL(fileURLWithPath: a[2]))
