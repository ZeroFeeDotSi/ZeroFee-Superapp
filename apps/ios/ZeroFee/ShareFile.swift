// device.shareFile (H-3, the statement): a file Wallet built on this phone (its monthly CSV) handed to iOS's own share
// sheet, so it leaves the phone only by the person's own choice there (Save to Files, Mail, AirDrop, …). Nothing is
// sent by ZeroFee. Wallet only; plain text only (CSV or text), at most 2 MB, a plain file name; one share at a time.
// The file is written to a folder of its own in this app's temporary folder and deleted when the sheet closes, when it
// can't be shown, or after 15 minutes; a folder a crash left behind is deleted at launch (ShareFiles.sweep, from Host's
// init) and before each share (a cleanup only on the success path leaks).
import UIKit

private let shareNamePattern = /[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.(csv|txt)/
private let shareMimes: Set<String> = ["text/csv", "text/plain"]
private let maxShared = 2 * 1024 * 1024
/** A sheet left open this long gives up its file (the answer is "not shared"). */
private let shareTimeout: UInt64 = 15 * 60 * 1_000_000_000

@MainActor enum ShareFiles {
  static let prefix = "zf-share-"
  /** A share is on screen: a second one is refused, never stacked (and never sweeps the first one's file away). */
  static var open = false

  /** Every folder a share left in the temporary folder (a crash, a kill): deleted. */
  static func sweep() {
    let fm = FileManager.default
    for old in (try? fm.contentsOfDirectory(at: fm.temporaryDirectory, includingPropertiesForKeys: nil)) ?? [] where old.lastPathComponent.hasPrefix(prefix) {
      try? fm.removeItem(at: old)
    }
  }
}

/** Answered once: the sheet's own end, a sheet that couldn't be shown, or the timeout, whichever is first. */
@MainActor private final class ShareOnce {
  var done = false
  var timeout: Task<Void, Never>?
}

extension Host {
  /** The person's own share of a file Wallet made: { shared: true } when they picked where it went, false if they closed. */
  func shareFile(_ app: String, _ p: [String: Any]) async -> Reply {
    guard app == "wallet" else { return problem("shell.device.refused", "Only Wallet can do that.") }
    guard !ShareFiles.open else { return problem("shell.device.refused", "A file is already being shared. Finish that one first.") }
    guard let name = p["name"] as? String, name.wholeMatch(of: shareNamePattern) != nil else {
      return problem("shell.device.refused", "ZeroFee can't make a file with that name. Nothing was shared.")
    }
    guard let mime = p["mime"] as? String, shareMimes.contains(mime) else {
      return problem("shell.device.refused", "ZeroFee shares only text files. Nothing was shared.")
    }
    guard let text = p["text"] as? String, let data = text.data(using: .utf8), data.count <= maxShared else {
      return problem("shell.device.refused", "That file is too big to share. Nothing was shared.")
    }
    ShareFiles.open = true
    defer { ShareFiles.open = false }
    // a folder a crash left behind goes first (none is open: one share at a time)
    ShareFiles.sweep()
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent(ShareFiles.prefix + UUID().uuidString, isDirectory: true)
    let file = dir.appendingPathComponent(name)
    do {
      try fm.createDirectory(at: dir, withIntermediateDirectories: false)
      try data.write(to: file, options: [.atomic, .completeFileProtection])
    } catch {
      try? fm.removeItem(at: dir)
      return problem("shell.device.refused", "This phone couldn't make the file. Nothing was shared.")
    }
    let shared: Bool = await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
      let once = ShareOnce()
      let finish: @MainActor (Bool) -> Void = { completed in
        guard !once.done else { return }
        once.done = true
        once.timeout?.cancel()
        try? FileManager.default.removeItem(at: dir)
        answer.resume(returning: completed)
      }
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      // The sheet's end only: a sub-activity cancelled (Mail's compose closed) leaves the sheet up with its file, so that
      // answer (an activity named, not completed) is not the end (review M2).
      sheet.completionWithItemsHandler = { activity, completed, _, _ in
        guard completed || activity == nil else { return }
        Task { @MainActor in finish(completed) }
      }
      // an iPad shows it as a popover: anchored on the middle of ZeroFee's screen
      let view = controller.view!
      sheet.popoverPresentationController?.sourceView = view
      sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
      var top: UIViewController = controller
      while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
      top.present(sheet, animated: true)
      // a sheet that couldn't be shown (something else was on its way in or out) is "not shared", at once (review M3)
      guard sheet.presentingViewController != nil else { return finish(false) }
      once.timeout = Task { @MainActor in
        try? await Task.sleep(nanoseconds: shareTimeout)
        guard !Task.isCancelled, !once.done else { return }
        sheet.dismiss(animated: true)
        finish(false)
      }
    }
    return ok(["shared": shared])
  }
}
