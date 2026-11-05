// D145 (speed, the Browser's native side): a step's own time, from where it starts to each mark after it, so a test
// phone run gives numbers for what the web build can't show (a site window's first byte and load, a tab coming on screen,
// Tor's circuit before a private page). Each mark is a signpost (Instruments, "si.zerofee" / "speed") and, in a debug build,
// one console line: "[zf-speed] <step> <mark> <ms> ms". Names and times only: never an address, a host or a page.
import Foundation
import os

final class SpeedMark {
  private static let signposter = OSSignposter(subsystem: "si.zerofee", category: "speed")
  private static let log = Logger(subsystem: "si.zerofee", category: "speed")
  private let step: StaticString
  private let start = ContinuousClock.now
  private let interval: OSSignpostIntervalState
  private var marked = Set<String>()
  private var ended = false

  private init(_ step: StaticString) {
    self.step = step
    interval = Self.signposter.beginInterval(step, id: Self.signposter.makeSignpostID())
  }

  /** A step starts now (a tap, a window asked for). */
  static func start(_ step: StaticString) -> SpeedMark { SpeedMark(step) }

  /** The time since the start, once per mark name (a second call with the same name does nothing). */
  func mark(_ name: String) {
    guard !ended, marked.insert(name).inserted else { return }
    let ms = Self.ms(ContinuousClock.now - start)
    Self.signposter.emitEvent(step, id: Self.signposter.makeSignpostID(), "\(name, privacy: .public) \(ms, privacy: .public) ms")
    #if DEBUG
    Self.log.info("[zf-speed] \(String(describing: self.step), privacy: .public) \(name, privacy: .public) \(ms, privacy: .public) ms")
    #endif
  }

  /** The last mark: the step's interval ends here. */
  func end(_ name: String) {
    mark(name)
    guard !ended else { return }
    ended = true
    Self.signposter.endInterval(step, interval)
  }

  private static func ms(_ d: Duration) -> Int {
    let (s, atto) = d.components
    return Int(s) * 1000 + Int(atto / 1_000_000_000_000_000)
  }
}
