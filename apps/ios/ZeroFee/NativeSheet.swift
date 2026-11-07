// The native approval sheet (S1.6 phase 1). Every chip signature goes through it: `key.sign { id, words, bytes }`.
// Before it opens, the bytes are checked to be a NEAR transaction for this phone's chip key and hashed here
// (NearTx.swift). The sheet shows the words, the same ones the web sheet showed (SheetWords.swift), and on
// "Approve with Face ID" the chip signs THAT hash after Face ID. Nothing else can make the chip sign: no bare hash, and
// no web button.
//
// The web sheet's rules hold here too: Approve is off for its first moments, so a tap meant for something else can't land
// on it, and stays off until long words have been scrolled to the end. One sheet at a time; Not now signs nothing.
// Monument: a solid ground, hairline lines, spaced capitals, air.
import SwiftUI
import UIKit

struct NativeSheetView: View {
  let words: SheetWords
  /** The small line under the buttons: what Approve does on this phone. */
  let footer: String
  /** Face ID, then the chip signs. Nil when signed (the sheet closes); otherwise what to say, and the sheet stays. */
  let approve: @MainActor () async -> ChipKey.Refused?
  let notNow: @MainActor () -> Void
  /** Approve asks Face ID (every chip sheet, and the Safe's). False only for the core's one-tap sheet of a hot key (D143). */
  var faceId = true
  /** What this phone read from the bytes it signs (NearTx.decode): to whom, how much NEAR, which key. Not from the page. */
  var checked: [String] = []

  @State private var armed = false
  @State private var reachedEnd = false
  @State private var busy = false
  @State private var note: ChipKey.Refused?

  private static let gutter: CGFloat = 28
  private let hair = Color.primary.opacity(0.12)

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text(words.testNetwork ? "ZEROFEE · APPROVE · TEST NETWORK" : "ZEROFEE · APPROVE")
            .font(.system(size: 11, weight: .medium))
            .tracking(2)
            .foregroundStyle(.secondary)
            .padding(.bottom, 16)
          Text(words.title)
            .font(.system(size: 24, weight: .regular))
            .tracking(-0.4)
            .padding(.bottom, 8)
          if let amount = words.amount {
            // The payment in dollars, the coin amount after it, before every other line (the web sheet's approval__amount).
            Text("Amount: \(amount)").font(.system(size: 17)).monospacedDigit().padding(.bottom, 6)
          }
          if !checked.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
              Text("CHECKED BY THIS PHONE")
                .font(.system(size: 11, weight: .medium))
                .tracking(2)
                .foregroundStyle(.secondary)
              ForEach(Array(checked.enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(size: 15, weight: .medium))
              }
            }
            .padding(.vertical, 10)
            .overlay(alignment: .top) { hair.frame(height: 1) }
            .overlay(alignment: .bottom) { hair.frame(height: 1) }
            .padding(.bottom, 8)
          }
          ForEach(Array(words.lines.enumerated()), id: \.offset) { _, line in
            // every outside sheet's full address (the copy review's rules, 5 Nov): "To" a 12 pt caption, the address under it in groups
            // of 4; the line saying where it lands, quiet
            if let to = SheetWords.toAddress(line) {
              VStack(alignment: .leading, spacing: 2) {
                Text("To").font(.system(size: 12)).foregroundStyle(.secondary)
                FullAddress(address: to)
              }
              .padding(.top, 4)
            } else if SheetWords.isLands(line) {
              Text(line).font(.system(size: 15)).foregroundStyle(.secondary).padding(.vertical, 2)
            } else {
              Text(line).font(.system(size: 15)).foregroundStyle(Color.primary.opacity(0.72)).padding(.vertical, 2)
            }
            // the payee's address in full, OPEN directly under its To row (the audit and the copy review, 5 Nov), never inside a fold: the
            // money face, groups of 4, one tap copies it
            ForEach(Array(words.details.filter { $0.openAfter == line }.enumerated()), id: \.offset) { _, d in
              ForEach(Array(d.lines.enumerated()), id: \.offset) { _, address in
                FullAddress(address: address)
              }
            }
          }
          // Long parts of what is approved (a rule's every coin, by name), one tap open on the sheet itself: the summary
          // leads and nothing is left off (UI-SIMPLICITY-RULES 6; phone test, 2 Nov).
          ForEach(Array(words.details.filter { $0.openAfter == nil }.enumerated()), id: \.offset) { _, d in
            DisclosureGroup {
              VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(d.lines.enumerated()), id: \.offset) { _, line in
                  Text(line).font(.system(size: 14)).foregroundStyle(Color.primary.opacity(0.72))
                }
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.top, 6)
            } label: {
              Text(d.label).font(.system(size: 15)).foregroundStyle(Color.primary)
            }
            .tint(Color.primary)
            .frame(minHeight: 44)
            .padding(.top, 10)
            .overlay(alignment: .top) { hair.frame(height: 1).padding(.top, 4) }
          }
          ForEach(Array(words.warnings.enumerated()), id: \.offset) { _, warning in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Circle().fill(Color.red).frame(width: 7, height: 7)
              Text(warning).font(.system(size: 14))
            }
            .foregroundStyle(Color.red)
            .padding(.top, 14)
          }
          if !words.effects.isEmpty {
            VStack(spacing: 0) {
              ForEach(Array(words.effects.enumerated()), id: \.offset) { _, e in
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                  Text(e.token).foregroundStyle(.secondary)
                  Spacer(minLength: 0)
                  // an empty `before`: a row that says only where it ends (separate steps' "Your Safe after", 53), no arrow
                  Text(e.before.isEmpty ? e.after : "\(e.before) → \(e.after)").monospacedDigit().multilineTextAlignment(.trailing)
                }
                .font(.system(size: 15))
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) { hair.frame(height: 1) }
              }
            }
            .padding(.top, 14)
          }
          if let protection = words.protection {
            Label(protection, systemImage: "clock").font(.system(size: 14)).padding(.top, 14)
          }
          if let hint = words.hint {
            Text(hint).font(.system(size: 12.5)).foregroundStyle(.secondary).padding(.top, 14)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.disabled)
        .padding(.horizontal, Self.gutter)
        .padding(.top, 28)
        .padding(.bottom, 12)
      }
      .scrollBounceBehavior(.basedOnSize)
      // Read to the end: once the bottom of the words has been on screen, Approve may turn on (and stays on).
      .onScrollGeometryChange(for: Bool.self, of: { g in g.visibleRect.maxY >= g.contentSize.height - 2 }) { _, atEnd in
        if atEnd { reachedEnd = true }
      }

      VStack(spacing: 8) {
        if !reachedEnd {
          Text("Read to the end to approve.").font(.system(size: 12.5)).foregroundStyle(.secondary)
        }
        if let note {
          Text(note.what).font(.system(size: 13)).foregroundStyle(Color.red).multilineTextAlignment(.center)
        }
        // a refusal that says Close (too many steps): Close is the one lit button, nothing to approve again
        if note?.next == .close {
          Button(action: notNow) { Text("Close").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52) }
            .foregroundStyle(Color(uiColor: .systemBackground))
            .background(Color.primary, in: Capsule())
        } else {
        Button {
          busy = true
          note = nil
          Task {
            note = await approve()
            busy = false
          }
        } label: {
          // a timed-out Face ID (copy review, 6 Nov): the button says Try again, never the sentence
          Label(faceId ? (busy ? "Waiting for Face ID…" : note?.next == .tryAgain ? "Try again" : "Approve with Face ID") : "Approve", systemImage: faceId ? "faceid" : "checkmark")
            .font(.system(size: 16, weight: .medium))
            .frame(maxWidth: .infinity, minHeight: 52)
        }
        .foregroundStyle(Color(uiColor: .systemBackground))
        .background(Color.primary.opacity(armed && reachedEnd && !busy ? 1 : 0.3), in: Capsule())
        .disabled(!armed || !reachedEnd || busy)
        Button("Not now", action: notNow)
          .font(.system(size: 15))
          .foregroundStyle(Color.primary)
          .frame(minHeight: 44)
          .disabled(busy)
        }
        Text(footer)
          .font(.system(size: 11.5))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, Self.gutter)
      .padding(.top, 12)
      .padding(.bottom, 8)
      .overlay(alignment: .top) { hair.frame(height: 1) }
    }
    .background(Color(uiColor: .systemBackground))
    .task {
      try? await Task.sleep(for: .milliseconds(700))
      armed = true
    }
  }
}

/** One sheet's single answer: the first of Approve (signed), Not now, the timeout, or the sheet going wins; the rest do
 *  nothing. */
@MainActor
private final class SheetOnce {
  var resumed = false
  weak var sheet: UIViewController?
}

/**
 * The sheet's own controller (security audit M2): however it goes (its own buttons, or taken with the window under it),
 * `gone` runs, so the sheet is answered no at once and the next one may open (never stuck "open" for 10 minutes). With
 * `awayInBackground` (an approval, M1), ZeroFee going to the background puts it away, answered no.
 */
private final class SheetHost: UIHostingController<AnyView> {
  var gone: (@MainActor () -> Void)?
  private let approval: Bool

  init(_ root: AnyView, awayInBackground: Bool) {
    approval = awayInBackground
    super.init(rootView: root)
    NotificationCenter.default.addObserver(self, selector: #selector(wentToBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
  }

  required dynamic init?(coder: NSCoder) { fatalError("not from a storyboard") }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    gone?()
  }

  @objc private func wentToBackground() {
    guard SheetRules.putAway(approval: approval, wentToBackground: true) else { return }
    gone?()
  }
}

extension Host {
  /** One native sheet at a time: a second signature request while one is open is refused (nothing signed). */
  @MainActor private static var sheetOpen = false
  /** A native approval (Face ID) sheet is open now: no tab switch may dismiss it unanswered (D131 review L2). */
  @MainActor static var approvalOpen: Bool { sheetOpen }
  /** D146: the app the page has on screen ("" before it says), from shell.screenApp. */
  @MainActor static var screenApp = ""
  /** Review M5: a money sheet is up in the page now, from shell.screenApp. */
  @MainActor static var moneyOpen = false
  /** D146: closes the open sheet as Not now (nothing signed), while one is open. */
  @MainActor private static var closeOpen: (@MainActor () -> Void)?
  /** D146: the person moved to another app: an open sheet belongs to the app they left, so it is answered Not now and put
   *  away (nothing is signed), never shown over the other app, as the web sheet does (ApprovalSheet.tsx). */
  @MainActor static func screenChanged(_ app: String, money: Bool) {
    moneyOpen = money
    guard app != screenApp else { return }
    let was = screenApp
    screenApp = app
    if !was.isEmpty { closeOpen?() }
  }
  /** A sheet nobody answers closes as Not now after this long. */
  private static let sheetTimeout: Duration = .seconds(600)

  /**
   * key.sign { id, words, bytes }: check the bytes, hash them here, show the words natively, and sign only that hash
   * after this sheet's Face ID. → { signature } | { declined: true } | a problem (nothing signed).
   */
  func signOnSheet(_ p: [String: Any]) async -> Reply {
    let refused = { (what: String) in problem("security.key.refused", what) }
    guard !Self.sheetOpen else { return refused("Another approval is open, so ZeroFee didn't approve this one. Your money hasn't moved.") }
    guard let b64 = p["bytes"] as? String, b64.utf8.count <= (NearTx.maxBytes + 2) / 3 * 4, let bytes = Data(base64Encoded: b64) else {
      return refused("ZeroFee couldn't read what to approve, so it didn't approve it. Your money hasn't moved.")
    }
    guard let words = SheetWords(p["words"]) else { return refused("This sheet couldn't show what you'd approve, so ZeroFee didn't approve it. Your money hasn't moved.") }
    let publicKey: Data
    do {
      guard let raw = try ChipKey.publicRaw() else { return refused("This phone has no account key yet.") }
      publicKey = raw
    } catch {
      return refused("This phone's secure chip didn't answer, so ZeroFee didn't approve it. Your money hasn't moved.")
    }
    guard let decoded = NearTx.decode(bytes, publicKey: publicKey) else {
      return refused("This phone's key can't approve that, so ZeroFee didn't. Your money hasn't moved.")
    }
    // iOS audit finding 1: the words come from the page; the bytes, read here, must say what its summary says
    guard let summary = NearTx.summary(p["summary"]), NearTx.matches(decoded, summary) else {
      return refused("What ZeroFee was asked to approve didn't match what it would sign, so it didn't. Your money hasn't moved.")
    }
    let hash = NearTx.hash(bytes)
    #if DEBUG
    NSLog("[zf-host] native sheet %@ opened", String(describing: p["id"] ?? "?"))
    #endif
    guard let signature = await presentSheet(words, footer: "Approved inside this phone's secure chip", checked: decoded.checked, approve: { try await ChipKey.sign(hash: hash) }) else {
      return ok(["declined": true])
    }
    return ok(["signature": signature.base64EncodedString()])
  }

  /**
   * key.signSet { id, words, txs: [{ bytes, summary }] (1 to 4), pairHash? }: ONE sheet and ONE Face ID for every
   * transaction of one Safe action (D3, the audit's R3/R5). Each tx is decoded here against this phone's chip key, must say what
   * its own summary says, and is hashed here; the sheet shows every tx's checked lines in order. Approve signs them back
   * to back under that one Face ID (ChipKey.signMany). `pairHash` (the core's hash of the Private payment) is echoed
   * exactly, never signed or read here: an extra check only; the core binds that payment by leg 1's paid address and its
   * own hash. More than 4 or none: refused, never split.
   * -> { signatures: [base64], pairHash? } | { declined: true } | a problem (nothing signed).
   */
  func signSetOnSheet(_ p: [String: Any]) async -> Reply {
    let refused = { (what: String) in problem("security.key.refused", what) }
    guard !Self.sheetOpen else { return refused("Another approval is open, so ZeroFee didn't approve this one. Your money hasn't moved.") }
    guard let txs = p["txs"] as? [[String: Any]], !txs.isEmpty else { return refused("ZeroFee couldn't read what to approve, so it didn't approve it. Your money hasn't moved.") }
    guard txs.count <= ChipKey.maxHashes else { return refused("This has more steps than one Face ID covers, so ZeroFee stopped it. Your money hasn't moved.") }
    let pairHash = p["pairHash"] as? String
    if p["pairHash"] != nil, !(pairHash.map(Self.isPairHash) ?? false) {
      return refused("ZeroFee couldn't read what to approve, so it didn't approve it. Your money hasn't moved.")
    }
    guard let words = SheetWords(p["words"]) else { return refused("This sheet couldn't show what you'd approve, so ZeroFee didn't approve it. Your money hasn't moved.") }
    let publicKey: Data
    do {
      guard let raw = try ChipKey.publicRaw() else { return refused("This phone has no account key yet.") }
      publicKey = raw
    } catch {
      return refused("This phone's secure chip didn't answer, so ZeroFee didn't approve it. Your money hasn't moved.")
    }
    var hashes: [Data] = []
    var checked: [String] = []
    for tx in txs {
      guard let b64 = tx["bytes"] as? String, b64.utf8.count <= (NearTx.maxBytes + 2) / 3 * 4, let bytes = Data(base64Encoded: b64) else {
        return refused("ZeroFee couldn't read what to approve, so it didn't approve it. Your money hasn't moved.")
      }
      guard let decoded = NearTx.decode(bytes, publicKey: publicKey) else {
        return refused("This phone's key can't approve that, so ZeroFee didn't. Your money hasn't moved.")
      }
      // iOS audit finding 1, per tx: the bytes, read here, must say what their own summary says
      guard let summary = NearTx.summary(tx["summary"]), NearTx.matches(decoded, summary) else {
        return refused("What ZeroFee was asked to approve didn't match what it would sign, so it didn't. Your money hasn't moved.")
      }
      hashes.append(NearTx.hash(bytes))
      checked.append(contentsOf: decoded.checked)
    }
    #if DEBUG
    NSLog("[zf-host] native sheet %@ opened (%d steps)", String(describing: p["id"] ?? "?"), hashes.count)
    #endif
    guard let signatures = await presentSheet(words, footer: "Approved inside this phone's secure chip", checked: checked, approve: { try await ChipKey.signMany(hashes: hashes) }) else {
      return ok(["declined": true])
    }
    guard signatures.count == hashes.count else { return refused("This phone's secure chip didn't answer, so ZeroFee didn't approve it. Your money hasn't moved.") }
    var out: [String: Any] = ["signatures": signatures.map { $0.base64EncodedString() }]
    if let pairHash { out["pairHash"] = pairHash }
    return ok(out)
  }

  /** 64 lowercase hex: the core's sha256 of the Private payment it holds for this sheet. */
  nonisolated static func isPairHash(_ s: String) -> Bool {
    s.utf8.count == 64 && s.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }

  /**
   * key.signAlertsProof { accountId, email, deadline, nonce (base64) }: the relay's email-alerts proof (AlertsProof),
   * built here from those parts with this build's own relay as its recipient, never taken whole from the core; shown on
   * this sheet and signed after its Face ID. → { signature } | { declined: true } | a problem (nothing signed).
   */
  func signAlertsProof(_ p: [String: Any]) async -> Reply {
    let refused = { (what: String) in problem("security.key.refused", what) }
    guard !Self.sheetOpen else { return refused("Another approval is open, so ZeroFee didn't approve this one. Your money hasn't moved.") }
    guard let relay = RelaySetting.parse(Bundle.main.url(forResource: "relay", withExtension: "json").flatMap { try? Data(contentsOf: $0) }) else {
      return refused("Email alerts aren't ready in this version of ZeroFee yet. ZeroFee approved nothing.")
    }
    guard let accountId = p["accountId"] as? String, let email = p["email"] as? String, let deadline = p["deadline"] as? String,
          let nonce = (p["nonce"] as? String).flatMap({ Data(base64Encoded: $0) }),
          let bytes = AlertsProof.bytes(accountId: accountId, email: email, deadline: deadline, nonce: nonce, recipient: relay.host, now: Date().timeIntervalSince1970),
          let words = SheetWords(["title": "Turn on email alerts to \(email)", "lines": ["For \(accountId)", "ZeroFee's alert server emails this address about activity on your account.", "You approve a note for \(relay.host) only. No money moves."], "warnings": [Any](), "effect": [Any]()])
    else { return refused("ZeroFee couldn't read this email-alerts request, so it didn't approve it.") }
    let hash = NearTx.hash(bytes)
    guard let signature = await presentSheet(words, footer: "Approved inside this phone's secure chip", approve: { try await ChipKey.sign(hash: hash) }) else {
      return ok(["declined": true])
    }
    return ok(["signature": signature.base64EncodedString()])
  }

  /**
   * key.signChatName { accountId, chatKey, until, nonce (base64) }: ZeroFee Chat's name note (ChatName, J3 part 2), built
   * here from those parts with its own recipient, never taken whole from the core; shown on this sheet and signed after
   * its Face ID. → { signature } | { declined: true } | a problem (nothing signed).
   */
  func signChatName(_ p: [String: Any]) async -> Reply {
    let refused = { (what: String) in problem("security.key.refused", what) }
    guard !Self.sheetOpen else { return refused("Another approval is open, so ZeroFee didn't approve this one. Your money hasn't moved.") }
    guard let accountId = p["accountId"] as? String, let chatKey = p["chatKey"] as? String, let until = p["until"] as? String,
          let nonce = (p["nonce"] as? String).flatMap({ Data(base64Encoded: $0) }),
          let bytes = ChatName.bytes(accountId: accountId, chatKey: chatKey, until: until, nonce: nonce, now: Date().timeIntervalSince1970),
          let words = SheetWords(["title": "Use your NEAR account in Chat", "lines": ["People in Chat see you as \(accountId).", "It's only for Chat. No money moves.", "It lasts until \(until.prefix(10))."], "warnings": [Any](), "effect": [Any]()])
    else { return refused("ZeroFee couldn't read this Chat name request, so it didn't approve it.") }
    let hash = NearTx.hash(bytes)
    guard let signature = await presentSheet(words, footer: "Approved inside this phone's secure chip", approve: { try await ChipKey.sign(hash: hash) }) else {
      return ok(["declined": true])
    }
    return ok(["signature": signature.base64EncodedString()])
  }

  /**
   * Present the sheet over whatever is showing. Approve runs `approve` (Face ID, and the chip's signature for a chip
   * approval); its result closes the sheet, its Refused stays on it as a note. Nil for Not now or no answer.
   */
  func presentSheet<T>(_ words: SheetWords, footer: String, faceId: Bool = true, checked: [String] = [], approve: @escaping () async throws -> T) async -> T? {
    // D146: asked by an app the person isn't on (a late ask), it never shows: Not now, nothing signed
    guard SheetWords.mayShow(asker: words.asker, onScreen: Self.screenApp, moneyOpen: Self.moneyOpen) else {
      NSLog("[zf-host] a sheet asked by an app that isn't on screen: answered Not now")
      return nil
    }
    return await presentModal(approval: true) { (finish: @escaping @MainActor (T?) -> Void) in
      AnyView(NativeSheetView(
        words: words,
        footer: footer,
        approve: {
          do {
            finish(try await approve())
            return nil
          } catch let refused as ChipKey.Refused {
            return refused
          } catch {
            return ChipKey.Refused(what: "The secure chip didn't approve it. Try again, or tap Not now.")
          }
        },
        notNow: { finish(nil) },
        faceId: faceId,
        checked: checked
      ))
    }
  }

  /**
   * One native screen over whatever is showing, answered once: the view calls `finish` with its result (nil: closed),
   * and one left open 10 minutes closes as nil. One at a time: a second one while one is open is nil at once.
   * Security audit M1: only while ZeroFee is the app in front (SheetRules; inactive for a moment, as just after a Face ID
   * prompt, waits up to 1 s for active; the usual case waits 0 ms); otherwise nil and nothing shows. An `approval` sheet
   * is put away, answered no, when ZeroFee goes to the background. M2: a sheet that goes any other way (taken with the
   * window under it) is answered no at once.
   */
  func presentModal<T>(approval: Bool = false, _ make: (@escaping @MainActor (T?) -> Void) -> AnyView) async -> T? {
    guard !Self.sheetOpen else { return nil }
    Self.sheetOpen = true
    defer { Self.sheetOpen = false }
    guard await Self.inFront() else {
      NSLog("[zf-host] a native sheet wasn't shown: ZeroFee isn't the app in front (answered Not now)")
      return nil
    }
    return await withCheckedContinuation { (done: CheckedContinuation<T?, Never>) in
      let once = SheetOnce()
      let finish: @MainActor (T?) -> Void = { result in
        guard !once.resumed else { return }
        once.resumed = true
        Self.closeOpen = nil
        Self.putAway(once.sheet)
        done.resume(returning: result)
      }
      // D146: the app that asked left the screen: the open sheet is answered Not now (screenChanged)
      Self.closeOpen = { finish(nil) }
      let sheet = SheetHost(make(finish), awayInBackground: approval)
      // Gone (dismissed with the window under it, or put away): answered no. Put away a moment later, once UIKit has
      // finished the dismissal that took it, and only if it is still the one shown there.
      sheet.gone = { [weak sheet] in
        guard !once.resumed else { return }
        once.resumed = true
        Self.closeOpen = nil
        DispatchQueue.main.async { Self.putAway(sheet) }
        done.resume(returning: nil)
      }
      sheet.modalPresentationStyle = .pageSheet
      sheet.isModalInPresentation = true // closed only by its own buttons
      sheet.sheetPresentationController?.detents = [.large()]
      sheet.sheetPresentationController?.prefersGrabberVisible = false
      once.sheet = sheet
      var top: UIViewController = controller
      while let next = top.presentedViewController { top = next }
      // an approval sheet takes the page's Getting-ready sheet's place without motion (the copy review's W2): no slide up
      top.present(sheet, animated: !approval)
      Task { @MainActor in
        try? await Task.sleep(for: Self.sheetTimeout)
        finish(nil)
      }
    }
  }

  /** The sheet goes from what presented it, with anything over it; only if it is still shown there (never a dismiss
   *  that could reach the window under it). */
  @MainActor private static func putAway(_ sheet: UIViewController?) {
    guard let sheet, !sheet.isBeingDismissed, let presenter = sheet.presentingViewController, presenter.presentedViewController === sheet else { return }
    presenter.dismiss(animated: true)
  }

  /** ZeroFee is the app in front now, or becomes it within SheetRules.activeWithinMs (no wait when it already is). */
  @MainActor private static func inFront() async -> Bool {
    let state = appState()
    if SheetRules.mayShow(state) { return true }
    guard SheetRules.waitsForActive(state) else { return false }
    var waited = 0
    while waited < SheetRules.activeWithinMs {
      try? await Task.sleep(for: .milliseconds(50))
      waited += 50
      if SheetRules.mayShow(appState()) { return true }
      if !SheetRules.waitsForActive(appState()) { return false }
    }
    return false
  }

  @MainActor private static func appState() -> SheetRules.AppState {
    switch UIApplication.shared.applicationState {
    case .active: return .active
    case .inactive: return .inactive
    default: return .background
    }
  }
}

/** The payee's full address on the sheet, open (the audit and the copy review, 5 Nov): mono, 15 pt, ink, in groups of 4 with thin spaces,
 *  wrapping freely, never truncated; one tap copies the address itself, without the spaces. */
struct FullAddress: View {
  let address: String
  @State private var copied = false
  var body: some View {
    Button {
      UIPasteboard.general.string = address
      copied = true
    } label: {
      Text(SheetWords.grouped(address) + (copied ? " · Copied" : ""))
        .font(.system(size: 15, design: .monospaced))
        .foregroundStyle(Color.primary)
        .lineLimit(nil)
        .fixedSize(horizontal: false, vertical: true)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .buttonStyle(.plain)
    .padding(.vertical, 4)
    .accessibilityLabel("The address in full: \(address). Tap to copy.")
  }
}
