// device.notify.schedule / device.notify.cancel: local notifications on this phone (UNUserNotificationCenter).
//
// The app sets the words; the host alters them only to drop money or an address (NotifyFilter, HostRules.swift). The system's permission prompt appears the first time an app
// schedules one. Ids are namespaced by the calling app, zf.<app>.<id>, so an app can only ever touch its own.
import Foundation
import UIKit
import UserNotifications

private let maxNotifyText = 120
private let maxNotifyDays = 400.0

/** Shows a notification as a banner even while ZeroFee is open (otherwise iOS keeps quiet in the foreground). */
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
  static let shared = NotificationPresenter()
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
    [.banner, .list, .sound]
  }
}

private func notifyRefused(_ what: String) -> Reply { problem("device.notify.refused", what) }

extension Host {
  func notify(_ method: String, _ app: String, _ p: [String: Any]) async -> Reply {
    let id = p["id"] as? String ?? ""
    guard id.wholeMatch(of: keyPattern) != nil else { return notifyRefused("A reminder's name is 1 to 64 lower-case letters, digits, dots, dashes or underscores.") }
    let identifier = "zf.\(app).\(id)"
    let center = UNUserNotificationCenter.current()
    if method == "device.notify.cancel" {
      center.removePendingNotificationRequests(withIdentifiers: [identifier])
      center.removeDeliveredNotifications(withIdentifiers: [identifier])
      return ok(["ok": true])
    }
    guard let title = p["title"] as? String, !title.isEmpty, title.count <= maxNotifyText,
          let body = p["body"] as? String, body.count <= maxNotifyText else {
      return notifyRefused("A reminder needs a title and a message, each up to \(maxNotifyText) characters.")
    }
    guard let text = p["atIso"] as? String, let at = Self.parseIso(text) else { return notifyRefused("That isn't a time ZeroFee can use for a reminder.") }
    let now = Date()
    guard at > now else { return notifyRefused("Pick a time in the future for a reminder.") }
    guard at.timeIntervalSince(now) <= maxNotifyDays * 86_400 else { return notifyRefused("A reminder can be set up to \(Int(maxNotifyDays)) days ahead.") }

    // Ask once, the first time; after a "Don't Allow" the system never asks again, so say where to switch it on.
    var settings = await center.notificationSettings()
    if settings.authorizationStatus == .notDetermined {
      // iOS can't show its question while ZeroFee is away: never ask from the background (A-6 review L1)
      guard UIApplication.shared.applicationState == .active else { return problem("device.notify.denied", "Reminders aren't on for ZeroFee yet. Open ZeroFee to turn them on.") }
      _ = try? await center.requestAuthorization(options: [.alert, .sound])
      settings = await center.notificationSettings()
    }
    #if DEBUG
    NSLog("[zf-host] notify authorization status = %d", settings.authorizationStatus.rawValue)
    #endif
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral: break
    default: return problem("device.notify.denied", "Reminders are off for ZeroFee. Turn them on in Settings, Notifications.")
    }

    let content = UNMutableNotificationContent()
    // iOS audit finding 3: a backstop under the core's own words; the lock screen never shows an amount or an address
    content.title = NotifyFilter.title(title)
    content.body = NotifyFilter.body(body)
    content.sound = .default
    let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: at)
    let request = UNNotificationRequest(identifier: identifier, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
    do {
      try await center.add(request) // the same id replaces the earlier one
      #if DEBUG
      NSLog("[zf-host] notify scheduled %@ for %@", identifier, text)
      #endif
      return ok(["ok": true])
    } catch {
      #if DEBUG
      NSLog("[zf-host] notify add failed: %@", String(describing: error))
      #endif
      return problem("device.notify.refused", "This phone wouldn't set that reminder. Try again.", next: "Try again")
    }
  }

  /** ISO 8601 with or without fractional seconds ("2026-11-01T09:00:00Z" or JavaScript's "…00.000Z"). */
  static func parseIso(_ text: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: text) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: text)
  }
}
