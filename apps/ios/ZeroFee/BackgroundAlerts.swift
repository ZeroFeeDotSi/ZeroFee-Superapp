// Background alerts (the outside study's item 4): with ZeroFee closed, iOS wakes it now and then (a refresh task), and
// it asks the core what's new on the account: a recovery started, something held by its protection, an heir's claim
// (`alerts.poll`, demo-core.ts; each is told once, and what the open app already showed is never told). Each becomes a
// local notification in the core's own words. iOS decides when the task runs, often every few hours and never
// promised: that is why the self-hosted watcher can also send an email (apps/quotes).
// Registered only when Info.plist permits the task (BGTaskSchedulerPermittedIdentifiers), so a build without that key
// runs as before instead of crashing. Signs nothing.
import BackgroundTasks
import Foundation
import UserNotifications

enum BackgroundAlerts {
  static let taskId = "si.zerofee.app.alerts"
  /** The earliest the next wake is asked for; iOS picks the real time. */
  static let every: TimeInterval = 60 * 60
  /** Notification ids: the host's own namespace, never an app's (Notify.swift uses zf.<app>.<id>). */
  static let idPrefix = "zf.security.alert."

  static var permitted: Bool {
    (Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String])?.contains(taskId) == true
  }

  /** At launch, before the app finishes launching (iOS's rule for a task's handler). `core`: the running core, if any. */
  @MainActor static func register(_ core: @escaping @MainActor () async -> CoreContext?) {
    guard permitted else {
      NSLog("[zf-alerts] Info.plist doesn't permit %@: no background alerts in this build", taskId)
      return
    }
    BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: .main) { task in
      schedule()
      let work = Task { @MainActor in
        let told = await poll(await core())
        task.setTaskCompleted(success: told)
      }
      task.expirationHandler = { work.cancel() }
    }
    schedule()
  }

  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: taskId)
    request.earliestBeginDate = Date(timeIntervalSinceNow: every)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("[zf-alerts] next wake not scheduled: %@", String(describing: error))
    }
  }

  /** Ask the core and tell each new thing. False when the core isn't running or couldn't read the account. */
  @MainActor static func poll(_ core: CoreContext?) async -> Bool {
    guard let core else { return false }
    let reply = await core.call("alerts.poll", ["app": "shell"])
    guard let alerts = (reply["ok"] as? [String: Any])?["alerts"] as? [[String: Any]] else { return false }
    for alert in alerts {
      guard let id = alert["id"] as? String, let title = alert["title"] as? String, let body = alert["body"] as? String else { continue }
      let content = UNMutableNotificationContent()
      // iOS audit finding 3: never an amount or an address on the lock screen, whatever the core said
      content.title = NotifyFilter.title(title)
      content.body = NotifyFilter.body(body)
      content.sound = .default
      content.interruptionLevel = .timeSensitive
      let request = UNNotificationRequest(identifier: idPrefix + id, content: content, trigger: nil)
      try? await UNUserNotificationCenter.current().add(request)
    }
    return true
  }

  /** Once there is an account to protect, ask (once) to be allowed to tell. Nothing is asked before that. */
  @MainActor static func askToTellOnce(_ core: CoreContext?) async {
    guard permitted, let core else { return }
    let center = UNUserNotificationCenter.current()
    guard await center.notificationSettings().authorizationStatus == .notDetermined else { return }
    let state = await core.call("account.state", ["app": "shell"])
    guard (state["ok"] as? [String: Any])?["stage"] as? String == "ready" else { return }
    _ = try? await center.requestAuthorization(options: [.alert, .sound])
  }
}
