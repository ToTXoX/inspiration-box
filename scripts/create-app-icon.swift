import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for (size, name) in [(16, "icon_16x16"), (32, "icon_16x16@2x"), (32, "icon_32x32"),
                     (64, "icon_32x32@2x"), (128, "icon_128x128"), (256, "icon_128x128@2x"),
                     (256, "icon_256x256"), (512, "icon_256x256@2x"),
                     (512, "icon_512x512"), (1024, "icon_512x512@2x")] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(size) / 1024
    let transform = NSAffineTransform()
    transform.scale(by: scale)
    transform.concat()
    NSColor(calibratedRed: 52/255, green: 169/255, blue: 172/255, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 200, yRadius: 200).fill()
    // The existing heart.svg path, transformed from SVG coordinates into AppKit coordinates.
    let heart = NSBezierPath()
    heart.move(to: NSPoint(x: 12, y: 20.5))
    heart.curve(to: NSPoint(x: 3.2, y: 8.6), controlPoint1: NSPoint(x: 12, y: 20.5), controlPoint2: NSPoint(x: 3.2, y: 14.2))
    heart.curve(to: NSPoint(x: 7.6, y: 4), controlPoint1: NSPoint(x: 3.2, y: 5.9), controlPoint2: NSPoint(x: 5.3, y: 4))
    heart.curve(to: NSPoint(x: 12, y: 6.4), controlPoint1: NSPoint(x: 9.5, y: 4), controlPoint2: NSPoint(x: 11.3, y: 5.4))
    heart.curve(to: NSPoint(x: 16.4, y: 4), controlPoint1: NSPoint(x: 12.7, y: 5.4), controlPoint2: NSPoint(x: 14.5, y: 4))
    heart.curve(to: NSPoint(x: 20.8, y: 8.6), controlPoint1: NSPoint(x: 18.7, y: 4), controlPoint2: NSPoint(x: 20.8, y: 5.9))
    heart.curve(to: NSPoint(x: 12, y: 20.5), controlPoint1: NSPoint(x: 20.8, y: 14.2), controlPoint2: NSPoint(x: 12, y: 20.5))
    heart.close()
    heart.transform(using: AffineTransform(m11: 32, m12: 0, m21: 0, m22: -32, tX: 128, tY: 896))
    NSColor.white.withAlphaComponent(0.9).setFill()
    heart.fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent(name + ".png"))
}
