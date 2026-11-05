// A-4 Siri and Shortcuts (master plan row 11): two App Intents. Each one only OPENS ZeroFee and hands over what was
// asked; the page takes it once it is showing (shell.intent.take, apps/web/src/host/intent.ts):
// - "Ask AgentZero": the words go in AgentZero's field. The person taps Send there.
// - "Send money with ZeroFee": Wallet's Send opens on Hidden with the payee filled in when one was said. The person
//   types the dollars, taps Send and approves with Face ID on the core's sheet. Siri never hears or speaks an amount.
// Nothing here signs, sends or reads money. App Intents in the app target need no Info.plist key and no entitlement;
// this file joins the target through its synchronized folder (no project.pbxproj change).
// Siri's words (its dialogs) never carry a dollar figure, a coin amount or an address (apps/web/src/host/intent.test.ts).
import AppIntents
import Foundation

/** What an intent asked for, held until the page takes it. One at a time: the newest wins. Memory only. */
@MainActor
final class IntentInbox {
  static let shared = IntentInbox()
  /** An ask not taken within this long is dropped: it never opens much later, out of the blue (review L1). */
  static let keepSeconds: TimeInterval = 120
  private var pending: (ask: [String: String], at: Date)?
  weak var host: Host?

  func put(_ ask: [String: String]) {
    pending = (ask, Date())
    // a page already showing takes it now; a page still loading takes it when it starts. While the app lock is up it
    // waits: the page is told once the lock is open (AppLock.whenOpen), and take() gives nothing until then.
    AppLock.shared.whenOpen { [weak self] in self?.host?.emit("shell.intent", [:]) }
  }

  /** The page's one read: what was asked (if still fresh), then nothing until the next intent. */
  func take() -> [String: String]? {
    guard !AppLock.shared.locked else { return nil }
    defer { pending = nil }
    guard let p = pending, Date().timeIntervalSince(p.at) < Self.keepSeconds else { return nil }
    return p.ask
  }
}

struct AskAgentZeroIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask AgentZero"
  static let description = IntentDescription("Opens AgentZero with your words. You tap Send there.")
  static let openAppWhenRun = true
  /** Never on a locked phone (review L2): the phone is unlocked first. */
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Words", requestValueDialog: IntentDialog("What should AgentZero do?"))
  var words: String

  @MainActor
  func perform() async throws -> some IntentResult {
    // at most 500 code points, so a pile of combining marks can't make it large (review L3)
    let said = String(String.UnicodeScalarView(words.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.prefix(500)))
    if !said.isEmpty { IntentInbox.shared.put(["kind": "ask", "words": said]) }
    return .result()
  }
}

struct SendMoneyIntent: AppIntent {
  static let title: LocalizedStringResource = "Send money with ZeroFee"
  static let description = IntentDescription("Opens Send. You type how much, then hold to send.")
  static let openAppWhenRun = true
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "To", requestValueDialog: IntentDialog("Who do you want to pay?"))
  var to: String?

  @MainActor
  func perform() async throws -> some IntentResult {
    let who = (to ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    IntentInbox.shared.put(who.isEmpty || who.count > 128 ? ["kind": "send"] : ["kind": "send", "to": who])
    return .result()
  }
}

struct ZeroFeeShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: AskAgentZeroIntent(), phrases: ["Ask AgentZero in \(.applicationName)", "Ask \(.applicationName)"], shortTitle: "Ask AgentZero", systemImageName: "sparkles")
    AppShortcut(intent: SendMoneyIntent(), phrases: ["Send money with \(.applicationName)", "Pay someone with \(.applicationName)"], shortTitle: "Send money", systemImageName: "paperplane")
  }
}
