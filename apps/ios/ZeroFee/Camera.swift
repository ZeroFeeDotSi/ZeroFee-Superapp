// The camera for Pay's Scan (packages/pay/src/app/camera.ts), inside the web view.
//
// Measured on the simulator (ZF_PROBE): the zerofee-app:// page is a secure context and has getUserMedia, but WebKit
// has no BarcodeDetector, so Pay's camera loop would say "unsupported". So the page keeps its own camera and screen
// (getUserMedia, allowed below for the app's own page only, camera only, never the microphone) and gets a
// BarcodeDetector from apps/web/src/host/ios.ts whose detect() sends one still frame here; Apple's Vision framework
// reads the QR code and only its text goes back. Frames are not kept.
import Foundation
import CoreImage
import ImageIO
import Vision
import WebKit

extension Host {
  /** getUserMedia: the camera, for the app's own main frame only. iOS still asks the person once (NSCameraUsageDescription). */
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
    let ours = Self.isOurPage(isMainFrame: frame.isMainFrame, scheme: origin.protocol, host: origin.host)
    if !ours { dropped("a camera request", isMainFrame: frame.isMainFrame, scheme: origin.protocol, host: origin.host) }
    decisionHandler(ours && type == .camera ? .grant : .deny)
  }

  /** vision.detect { jpeg: base64 } → { codes: [string] }: the QR codes in one frame. */
  func detect(_ p: [String: Any]) async -> Reply {
    guard let b64 = p["jpeg"] as? String, b64.count <= 4_000_000, let data = Data(base64Encoded: b64),
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
      return problem("shell.device.refused", "ZeroFee couldn't read that picture. Try again.")
    }
    let codes: [String] = await Task.detached(priority: .userInitiated) {
      let request = VNDetectBarcodesRequest()
      request.symbologies = [.qr]
      do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap(\.payloadStringValue)
      } catch {
        // Vision's reader needs the phone's neural engine; where it can't start (the simulator), Core Image's
        // older QR reader does the same job.
        let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
        return (detector?.features(in: CIImage(cgImage: image)) ?? []).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
      }
    }.value
    return ok(["codes": codes])
  }
}
