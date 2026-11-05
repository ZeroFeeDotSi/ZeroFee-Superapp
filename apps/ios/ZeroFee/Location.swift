// device.location.once (Chat's Nearby, phone test, 2 Nov B22: "Asking your phone…" for ever). Inside the app's web
// view, navigator.geolocation never prompts and never answers, so Chat asks the host instead:
// - only Chat (the shell stamps `app`); one coarse fix, about a city's size (accuracy 3 km, rounded to 0.01°, about
//   1 km), with the person's own when-in-use permission, asked by iOS on the first tap;
// - an answer within 10 seconds of the person's yes, always: a fix, or a plain refusal (no permission, no fix, the time
//   ran out). While iOS's own ask is on screen the person is reading it: that wait has its own limit (60 s), so a yes
//   after 10 s still finds the place (B27, phone test, 2 Nov);
// - the build must carry NSLocationWhenInUseUsageDescription in Info.plist. Without it iOS would never ask, so the host
//   refuses at once, in plain words, and never calls Core Location.
// Nothing is kept: no history, no background location, no updates after the one fix.
import CoreLocation
import Foundation

@MainActor
final class OneLocation: NSObject, CLLocationManagerDelegate {
  static let usageKey = "NSLocationWhenInUseUsageDescription"
  /** For the fix, from the person's yes (or at once when they said yes before). */
  static let timeout: TimeInterval = 10
  /** For iOS's own ask, while it is on screen: the person reads it; the fix's clock starts at their answer. */
  static let askTimeout: TimeInterval = 60

  enum Answer { case fix(lat: Double, lon: Double), refused(String) }

  private let manager = CLLocationManager()
  private var done: CheckedContinuation<Answer, Never>?
  private var timer: Timer?
  /** The one ask under way (a second tap waits on the same one). */
  private static var current: OneLocation?

  /** Does this build say why it asks? Without the key iOS never shows the ask. */
  static var buildCanAsk: Bool {
    guard let words = Bundle.main.object(forInfoDictionaryKey: usageKey) as? String else { return false }
    return !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  static func once() async -> Answer {
    guard buildCanAsk else { return .refused("This version of ZeroFee can't ask for your location yet.") }
    // asked off the main thread (it can block it)
    guard await Task.detached(operation: { CLLocationManager.locationServicesEnabled() }).value else { return .refused("Location is off on this phone.") }
    if let busy = current { return await busy.wait() }
    let one = OneLocation()
    current = one
    defer { current = nil }
    return await one.start()
  }

  private var waiters: [CheckedContinuation<Answer, Never>] = []
  private var answer: Answer?
  private func wait() async -> Answer {
    if let answer { return answer }
    return await withCheckedContinuation { waiters.append($0) }
  }

  private func start() async -> Answer {
    await withCheckedContinuation { (c: CheckedContinuation<Answer, Never>) in
      done = c
      manager.delegate = self
      manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
      arm(manager.authorizationStatus == .notDetermined ? Self.askTimeout : Self.timeout)
      decide()
    }
  }

  /** The clock: the ask's while iOS asks, then the fix's from the person's answer. */
  private func arm(_ seconds: TimeInterval) {
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated { self?.finish(.refused("Your iPhone didn't answer in time.")) }
    }
  }

  /** From the permission as it is now: ask for it, refuse, or ask for the one fix. */
  private func decide() {
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization() // its answer comes to locationManagerDidChangeAuthorization
    case .denied, .restricted: finish(.refused("Your phone didn't share where you are."))
    default: manager.requestLocation()
    }
  }

  private func finish(_ a: Answer) {
    guard let c = done else { return }
    done = nil
    timer?.invalidate()
    timer = nil
    manager.delegate = nil
    manager.stopUpdatingLocation()
    answer = a
    c.resume(returning: a)
    for w in waiters { w.resume(returning: a) }
    waiters = []
  }

  nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
    MainActor.assumeIsolated {
      guard done != nil, m.authorizationStatus != .notDetermined else { return }
      // the person answered iOS's ask: the fix gets its own 10 s from now
      arm(Self.timeout)
      decide()
    }
  }

  nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let l = locations.last else { return }
    // about a city's size: 0.01° (about 1 km), never the exact spot
    let lat = (l.coordinate.latitude * 100).rounded() / 100, lon = (l.coordinate.longitude * 100).rounded() / 100
    MainActor.assumeIsolated { finish(.fix(lat: lat, lon: lon)) }
  }

  nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
    MainActor.assumeIsolated { finish(.refused("Your phone couldn't find where you are.")) }
  }
}

extension Host {
  /** device.location.once (Chat only): { lat, lon } about a city's size, or a plain refusal; always within 10 s. */
  func locationOnce(_ app: String) async -> Reply {
    guard app == "chat" else { return problem("shell.device.refused", "Only Chat can ask where you are.") }
    // never on a child's phone (from the core, never the page): a city room says where the child is
    if await isChildPhone(shellSaid: nil) { return problem("device.location.refused", "Nearby is off on a child's phone.", next: "Type a city") }
    switch await OneLocation.once() {
    case let .fix(lat, lon): return ok(["lat": lat, "lon": lon])
    case let .refused(why): return problem("device.location.refused", why, next: "Type a city")
    }
  }
}
