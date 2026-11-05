// A child's phone has no robot mode and no wallet mode (Security's D29 §A3; the kids rule gives a child no dApp
// signing). The phone reads it from the core, never from anything the page says: the isolated core's `account.state`
// (`kid: true`, Security's eebb350), and the core's own saved record in the Keychain (the core vault's "state", where it
// keeps `kid`). The shell's own flag can only add to it. Foundation only, so apps/ios/check runs it on a Mac.
import Foundation

enum ChildPhone {
  /** The core's saved account record says this is a child's account. Unreadable or missing = not a child's. */
  static func fromCoreState(_ data: Data?) -> Bool {
    guard let data, let record = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return record["kid"] as? Bool == true
  }

  /** The isolated core's account.state answer ({ ok: { stage, account?, kid? } }) says a child's account. */
  static func fromAccountState(_ reply: [String: Any]?) -> Bool {
    (reply?["ok"] as? [String: Any])?["kid"] as? Bool == true
  }

  /** Any source says child: no modes. The page's flag can only take modes away, never give them back. */
  static func isChild(shellSaid: Bool, accountState: [String: Any]? = nil, coreState: Data?) -> Bool {
    shellSaid || fromAccountState(accountState) || fromCoreState(coreState)
  }
}
