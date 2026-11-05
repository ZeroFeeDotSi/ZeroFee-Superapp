// Serves the built web app (the `web/` folder in the app bundle) at zerofee-app://app/.
//
// The app is served at the ROOT of its own origin, so the absolute paths Vite writes (`/assets/…`, `/favicon.svg`)
// resolve unchanged. Mounting it under a sub-path broke logos once; never do that here.
// Nothing outside `web/` can be read: the path is resolved, symlinks included, and must stay inside the folder.
import Foundation
import UniformTypeIdentifiers
import WebKit

final class WebFiles: NSObject, WKURLSchemeHandler {
  static let scheme = "zerofee-app"
  static let host = "app"

  private let root: URL? = Bundle.main.url(forResource: "web", withExtension: nil)?.resolvingSymlinksInPath()

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    let url = task.request.url
    guard let url, url.scheme == Self.scheme, url.host == Self.host, let root else {
      return fail(task, url, status: 404)
    }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    var file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
    // Inside web/ only.
    guard file.path == root.path || file.path.hasPrefix(root.path + "/") else { return fail(task, url, status: 403) }
    var isDir: ObjCBool = false
    if !FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir) || isDir.boolValue {
      // A screen's address (no file extension) gets the app; a missing file is a real 404.
      guard file.pathExtension.isEmpty else { return fail(task, url, status: 404) }
      file = root.appendingPathComponent("index.html")
    }
    guard let data = try? Data(contentsOf: file) else { return fail(task, url, status: 404) }
    let headers = [
      "Content-Type": Self.mime(file.pathExtension),
      "Content-Length": String(data.count),
      "Cache-Control": "no-cache",
    ]
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
    #if DEBUG
    NSLog("[zf-files] 200 %@ (%d bytes)", url.path.isEmpty ? "/" : url.path, data.count)
    #endif
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

  private func fail(_ task: any WKURLSchemeTask, _ url: URL?, status: Int) {
    #if DEBUG
    NSLog("[zf-files] %d %@", status, url?.path ?? "?")
    #endif
    let u = url ?? URL(string: "\(Self.scheme)://\(Self.host)/")!
    task.didReceive(HTTPURLResponse(url: u, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!)
    task.didReceive(Data())
    task.didFinish()
  }

  static func mime(_ ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "webmanifest": return "application/json"
    case "svg": return "image/svg+xml"
    case "wasm": return "application/wasm"
    default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
  }
}
