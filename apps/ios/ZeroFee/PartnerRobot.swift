// Robot mode in the partner window: the Sign-up Robot's host side (D29; Security's rules, backlog/security.md §D).
// The model loop runs in OUR page (Pay's run, Agent's thinker on the person's own key); it reaches this through
// `partner.snapshot`, `partner.act`, `partner.yourTurn`, `partner.done`, and hears `partner.event`. The partner page
// never sees the key, the prompt, or any of this.
//
// robot.js (PartnerScripts) runs in its own content world "zf-robot", main frame only, and is put in only while a run
// is live; the run's end removes its scripts and its handler and clears what it held. Every action is checked here,
// natively, against the latest snapshot before robot.js does it. Secrets travel only as slots: the host fetches the
// value from the ZeroFee Keychain after ONE Face ID per run (an LAContext for that run only) and hands it straight to
// robot.js; it never goes to our page, the model, a log or the pasteboard. Snapshots and actions are never logged.
import LocalAuthentication
import UIKit
import UserNotifications
import WebKit

@MainActor
final class PartnerRobot: NSObject, WKScriptMessageHandlerWithReply {
  enum State: Equatable { case idle, running, paused(String), ended(String) }

  static let maxActions = 60
  static let maxSeconds: TimeInterval = 600
  /** AgentZero's browser (D114): longer tasks, and it waits for the person after 5 minutes with nothing done. */
  static let agentMaxActions = 200
  static let agentMaxSeconds: TimeInterval = 1800
  static let agentIdleSeconds: TimeInterval = 300
  /** AgentZero's own window (D114): any host, or its sign-in sites with its own wallet (ruling a). */
  var agentMode: Bool { recipe.agent }
  private var runMaxActions: Int { agentMode ? Self.agentMaxActions : Self.maxActions }
  private var runMaxSeconds: TimeInterval { agentMode ? Self.agentMaxSeconds : Self.maxSeconds }
  private var idleTimer: Timer?
  /** Paused because the app left the front: back in front, AgentZero goes on by itself (D114). */
  private var pausedForBackground = false
  static let maxSnapshotBytes = 8192
  static let firstRunLine = "Claude reads this page's form so it can fill it in. It never sees your passwords."
  private static let firstRunKey = "zf.partner.robot.firstRunShown"

  weak var view: PartnerView?
  unowned let host: Host
  let recipe: PartnerRecipe
  private(set) var state: State = .idle
  private(set) var actions = 0
  private var startedAt: Date?
  private var timer: Timer?
  private var failures: [String: Int] = [:]
  /** The latest snapshot's elements by id; cleared at every navigation and at the end. */
  private(set) var latest: [String: [String: Any]] = [:]
  /** The latest snapshot's declared language: the robot acts on English pages only. */
  private var latestLang = ""
  private var runContext: LAContext?
  /** {{login.new}}: one new password per host per run, made and saved on the first fill (MUST 2). */
  private var newPasswords = RunPasswords()
  private var clickedAt: Date?
  private var turn: CheckedContinuation<String, Never>?
  /** The page left the recipe during a run: back on a recipe host, the strip offers Continue (it never restarts itself). */
  private(set) var offerContinue = false
  /** Why the robot is waiting for the person, for the strip (Agent's words or ours). */
  private(set) var waitingWhy: String?
  /** The page after each step since the last turn (M17): three the same in a row is stuck. Cleared at every turn and end. */
  private var prints: [String] = []
  private var actedSinceShot = false
  /** One "AgentZero paused" notice per pause in the background (M5). */
  private var pauseNotice1 = OncePerPause()
  var showFirstRunLine = false
  private var observers: [NSObjectProtocol] = []

  init(view: PartnerView, host: Host, recipe: PartnerRecipe) {
    self.view = view
    self.host = host
    self.recipe = recipe
    super.init()
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.leftFront() } })
    observers.append(nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.backInFront() } })
    observers.append(nc.addObserver(forName: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.end("locked") } })
  }

  /** The Sign-up Robot ends when the app leaves the front; AgentZero's browser pauses and goes on when it's back (D114). */
  private func leftFront() {
    guard agentMode else { return end("background") }
    guard state == .running else { return }
    pausedForBackground = true
    pause("ZeroFee left the screen. AgentZero waits.")
    pauseNotice()
  }

  static let pauseNoticeId = "zf.agent.paused"
  /** M5: once per pause, "AgentZero paused. Open ZeroFee to go on." Only if notifications are already on: never a
   *  permission prompt from the background. */
  private func pauseNotice() {
    guard pauseNotice1.shouldSend() else { return }
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
      let content = UNMutableNotificationContent()
      content.title = OncePerPause.title
      content.body = OncePerPause.body
      center.add(UNNotificationRequest(identifier: Self.pauseNoticeId, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
    }
  }

  private func backInFront() {
    guard agentMode, pausedForBackground, case .paused = state else { return }
    pausedForBackground = false
    pauseNotice1.resumed()
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.pauseNoticeId])
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Self.pauseNoticeId])
    continueTapped()
  }

  /** AgentZero's browser waits for the person after 5 minutes with no step (D114). */
  private func touchIdle() {
    guard agentMode else { return }
    idleTimer?.invalidate()
    idleTimer = Timer.scheduledTimer(withTimeInterval: Self.agentIdleSeconds, repeats: false) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, self.state == .running else { return }
        self.pause("AgentZero waited 5 minutes. Tap Continue to go on.")
      }
    }
  }

  var isLive: Bool { state == .running || { if case .paused = state { return true } else { return false } }() }
  var stripHost: String { PartnerView.displayHost(view?.web.url) }

  // ── Words that are always the person's (§D5) ──────────────────────────────────────────────────────────────

  private static let stopWords = /\b(pay|send|buy|order|purchase|checkout|confirm|delete|withdraw|transfer|subscribe|sign|agree|accept|consent)\b/
  private static let consentWords = /\b(agree|terms|consent|accept|privacy|conditions|authori[sz]e)\b/

  /** Is this a commit button (the recipe's words, or a word that pays, confirms, deletes or agrees)? */
  static func isCommit(_ text: String, recipe: PartnerRecipe) -> Bool {
    let t = text.lowercased()
    return recipe.commitButtons.contains { t.contains($0) } || t.firstMatch(of: stopWords) != nil || (recipe.agent && AgentPageRules.isMoneyStep(t))
  }

  // ── The slot rules (§D4, §D6), as a plain function the probe checks too ──────────────────────────────────────

  /** Why a slot was refused, in the words the robot's run hears. */
  struct Why: Error, Equatable, ExpressibleByStringInterpolation {
    let text: String
    init(_ text: String) { self.text = text }
    init(stringLiteral value: String) { text = value }
    init(stringInterpolation: DefaultStringInterpolation) { text = String(stringInterpolation: stringInterpolation) }
  }

  enum SlotPlan: Equatable { case profile(String), loginUsername(String), loginPassword(String), loginNew(String) }

  static func isSecretField(_ e: [String: Any]) -> Bool {
    let type = (e["type"] as? String ?? "").lowercased(), ac = (e["autocomplete"] as? String ?? "").lowercased()
    return type == "password" || ac.contains("one-time-code") || ac.split(separator: " ").contains { $0.hasPrefix("cc-") }
  }

  static func isTextField(_ e: [String: Any]) -> Bool {
    guard e["kind"] as? String == "field" else { return false }
    let tag = e["tag"] as? String ?? "", type = (e["type"] as? String ?? "").lowercased()
    return tag == "textarea" || (tag == "input" && !["checkbox", "radio", "file", "submit", "button", "reset", "image", "range", "color"].contains(type))
  }

  /** What a fill's slot means here, or why it is refused. `stripHost` is WebKit's, never the page's. */
  static func plan(slot: String, field e: [String: Any], stripHost: String, recipe: PartnerRecipe) -> Result<SlotPlan, Why> {
    guard let inner = slot.wholeMatch(of: /\{\{([A-Za-z0-9.\-]+)\}\}/)?.1 else { return .failure("That isn't one of the slots.") }
    let parts = inner.split(separator: ".").map(String.init)
    let password = (e["type"] as? String ?? "").lowercased() == "password"
    if parts.first == "profile", parts.count == 2 {
      guard recipe.slots.contains(slot) else { return .failure("This partner's recipe doesn't use {{\(inner)}}.") }
      guard !isSecretField(e) else { return .failure("Your details never go into a password, code or card field.") }
      return .success(.profile(parts[1]))
    }
    guard parts.first == "login", parts.count >= 2 else { return .failure("That isn't one of the slots.") }
    let field = parts.last!
    let named = parts.count > 2 ? parts.dropFirst().dropLast().joined(separator: ".") : nil
    guard let login = recipe.login else { return .failure("This partner has no login in its recipe.") }
    if field == "new" {
      guard named == nil, recipe.slots.contains("{{login.new}}"), login.create else { return .failure("This partner's recipe doesn't make a new password.") }
      guard login.host == stripHost else { return .failure("A new password is only for \(login.host).") }
      guard password else { return .failure("A password only goes into a password box.") }
      return .success(.loginNew(login.host))
    }
    let h = named ?? login.host
    // An exact match, as password managers do: the login's own host, and the page really on it now.
    guard h == login.host, h == stripHost else { return .failure("That login is only for \(login.host).") }
    guard recipe.slots.contains("{{login.\(field)}}") || recipe.slots.contains(slot) else { return .failure("This partner's recipe doesn't use {{login.\(field)}}.") }
    switch field {
    case "password":
      guard password else { return .failure("A password only goes into a password box.") }
      return .success(.loginPassword(h))
    case "username":
      guard !isSecretField(e) else { return .failure("A username never goes into a password, code or card field.") }
      return .success(.loginUsername(h))
    default:
      return .failure(Why("That isn't one of the slots."))
    }
  }

  // ── A run ────────────────────────────────────────────────────────────────────────────────────────────────

  /** The first snapshot starts the run: robot.js goes in (its world only) and the strip says so. */
  private func start() async -> String? {
    guard let view, let script = PartnerScripts.robotScript(), let source = PartnerScripts.robotSource() else { end("hash"); return "The robot's script didn't pass its check, so the window stays plain." }
    let ucc = view.web.configuration.userContentController
    ucc.addScriptMessageHandler(self, contentWorld: PartnerScripts.robotWorld, name: "zfRobot")
    ucc.addUserScript(script)
    _ = try? await view.web.evaluateJavaScript(source, in: nil, contentWorld: PartnerScripts.robotWorld)
    state = .running
    actions = 0
    failures = [:]
    startedAt = Date()
    offerContinue = false
    timer = Timer.scheduledTimer(withTimeInterval: runMaxSeconds, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.end("limit-time") } }
    if !UserDefaults.standard.bool(forKey: Self.firstRunKey) {
      UserDefaults.standard.set(true, forKey: Self.firstRunKey)
      showFirstRunLine = true
    }
    view.modesChanged()
    return nil
  }

  /** Ends robot mode (§D10): its scripts and handler go, the run's Face ID is dropped, the snapshots are cleared. */
  func end(_ why: String) {
    guard isLive || state == .idle else { return }
    let wasLive = isLive
    state = .ended(why)
    prints = []
    actedSinceShot = false
    timer?.invalidate()
    timer = nil
    idleTimer?.invalidate()
    idleTimer = nil
    pausedForBackground = false
    runContext?.invalidate()
    runContext = nil
    newPasswords.clear()
    latest = [:]
    failures = [:]
    waitingWhy = nil
    turn?.resume(returning: "stop")
    turn = nil
    if let view {
      let ucc = view.web.configuration.userContentController
      ucc.removeAllScriptMessageHandlers(from: PartnerScripts.robotWorld)
      // WebKit removes user scripts only all at once (every page's own go straight back in): the provider goes back in
      // when wallet mode is on here.
      view.removeUserScripts()
      view.setProvider(forLoading: stripHost)
      view.web.evaluateJavaScript("globalThis.__zfRobot && globalThis.__zfRobot.end(); true", in: nil, in: PartnerScripts.robotWorld) { _ in }
      if why == "left-recipe" { offerContinue = true }
      view.modesChanged()
    }
    if wasLive { host.emit("partner.event", ["kind": "ended", "why": why]) }
  }

  /** The person tapped Continue: after a pause the run goes on; after leaving the recipe, a new run may start. */
  func continueTapped() {
    if offerContinue {
      offerContinue = false
      state = .idle
      host.emit("partner.event", ["kind": "navigated", "host": stripHost])
    } else if case .paused = state {
      state = .running
      waitingWhy = nil
      prints = []
      turn?.resume(returning: "continue")
      turn = nil
    }
    view?.modesChanged()
  }

  func stopTapped() {
    offerContinue = false
    end("stopped")
  }

  /** The person touched the page: they take over; it waits for Continue (D9 ends nothing). */
  func touched() {
    guard state == .running else { return }
    pause("You took over. Tap Continue when you want ZeroFee to go on.")
  }

  /** A call from AgentZero while its tab is in the back: a running task pauses; nothing starts or acts. */
  private func inBack() -> Reply {
    if state == .running { pause(TabRules.inBackLine) }
    return refusal("partner.robot.paused", TabRules.inBackLine)
  }

  /** D131: its tab went to the back: AgentZero waits there until the person comes back and taps Continue. */
  func pauseInBack() {
    guard state == .running else { return }
    pause(TabRules.inBackLine)
  }

  /** A wallet sheet is about to show: it is always the person's, never the robot's (§C6, §D5). */
  func pauseForSheet() {
    guard state == .running else { return }
    pause("A wallet question is yours to answer.")
  }

  private func pause(_ why: String) {
    state = .paused(why)
    waitingWhy = why
    host.emit("partner.event", ["kind": "paused", "why": why])
    view?.modesChanged()
  }

  /** The top frame's host changed (the strip's KVO). */
  func hostChanged(_ newHost: String) {
    latest = [:] // ids meant something only on that page
    if isLive {
      if !recipe.covers(newHost) { return end("left-recipe") }
      host.emit("partner.event", ["kind": "navigated", "host": newHost])
    }
    view?.modesChanged()
  }

  /** A main-frame navigation is about to happen: off the recipe after a robot click, it is cancelled and the mode ends. */
  func shouldCancelNavigation(to target: String) -> Bool {
    guard isLive, !recipe.covers(target) else { return false }
    let byRobot = clickedAt.map { Date().timeIntervalSince($0) < 3 } ?? false
    end("left-recipe")
    return byRobot
  }

  func crashed() { if isLive { end("crash") } }
  func closing() { end("closed") }

  // ── The methods ──────────────────────────────────────────────────────────────────────────────────────────

  private func refusal(_ code: String, _ what: String) -> Reply { problem(code, what) }

  private var limitsHit: String? {
    if actions >= runMaxActions { return "limit-actions" }
    if let s = startedAt, Date().timeIntervalSince(s) >= runMaxSeconds { return "limit-time" }
    return nil
  }

  func snapshot() async -> Reply {
    guard let view else { return refusal("partner.robot.off", "No partner window is open.") }
    // D131 review M-a: a tab in the back never starts or reads for AgentZero: it waits for the person
    if !view.isOnScreen { return inBack() }
    guard !view.kid, recipe.active(.robot, host: stripHost, kid: view.kid) else { return refusal("partner.robot.off", "ZeroFee can't act on this page.") }
    if case .ended = state { return refusal("partner.robot.ended", "This run has ended.") }
    if state == .idle, let why = await start() { return refusal("partner.robot.off", why) }
    if let hit = limitsHit { end(hit); return refusal("partner.robot.limit", "The robot's run reached its limit.") }
    var raw = try? await view.web.callAsyncJavaScript("return globalThis.__zfRobot ? globalThis.__zfRobot.snapshot() : null", arguments: [:], in: nil, contentWorld: PartnerScripts.robotWorld)
    if raw == nil || raw is NSNull, let source = PartnerScripts.robotSource() {
      // A page that loaded before the user script was added: the same pinned bytes, in the robot's world only.
      _ = try? await view.web.evaluateJavaScript(source, in: nil, contentWorld: PartnerScripts.robotWorld)
      raw = try? await view.web.callAsyncJavaScript("return globalThis.__zfRobot ? globalThis.__zfRobot.snapshot() : null", arguments: [:], in: nil, contentWorld: PartnerScripts.robotWorld)
    }
    guard let shot = raw as? [String: Any], let items = shot["items"] as? [[String: Any]] else { return refusal("partner.snapshot.failed", "ZeroFee couldn't read this page.") }
    guard let bytes = try? JSONSerialization.data(withJSONObject: items), bytes.count <= Self.maxSnapshotBytes else { return refusal("partner.snapshot.failed", "This page is too big to read.") }
    var byId: [String: [String: Any]] = [:]
    for item in items { if let id = item["id"] as? String { byId[id] = item } }
    latest = byId
    latestLang = shot["lang"] as? String ?? ""
    guard agentMode else { return ok(["host": stripHost, "lang": shot["lang"] as? String ?? "", "elements": items, "more": shot["more"] as? Bool ?? false]) }
    // AgentZero's browser (D114): the page's visible words too, and a picture only when the words are thin and no secret
    // box is on screen (QA); a bot check is the person's turn before Claude sees anything more.
    touchIdle()
    let text = String((shot["text"] as? String ?? "").prefix(AgentPageRules.maxTextChars))
    var reply: [String: Any] = ["host": stripHost, "lang": shot["lang"] as? String ?? "", "elements": items, "more": shot["more"] as? Bool ?? false, "text": text]
    if AgentPageRules.isBotCheck(text) {
      if state == .running { pause("This page wants to check you're a person. Your turn.") }
      reply["yourTurn"] = "person-check"
      return ok(reply)
    }
    // M17: a page that refuses AgentZero, or one that didn't change after 3 steps, is handed to the person with why.
    if AgentPageRules.isRefusal(text) {
      if state == .running { pause(AgentPageRules.refusalLine) }
      reply["yourTurn"] = "refused"
      return ok(reply)
    }
    if actedSinceShot || prints.isEmpty {
      actedSinceShot = false
      prints.append(AgentPageRules.pagePrint(host: stripHost, text: text, ids: items.compactMap { $0["id"] as? String }))
      if prints.count > AgentPageRules.stuckTries + 1 { prints.removeFirst() }
    }
    if AgentPageRules.isStuck(prints) {
      if state == .running { pause(AgentPageRules.stuckLine) }
      prints = []
      reply["yourTurn"] = "stuck"
      return ok(reply)
    }
    if AgentPageRules.wantsPicture(textChars: text.count, elements: items), let jpeg = await picture(of: view) { reply["picture"] = jpeg }
    return ok(reply)
  }

  /** The page as a small JPEG (base64), at most 200 KB, or nil. Never logged, never kept. */
  private func picture(of view: PartnerView) async -> String? {
    let config = WKSnapshotConfiguration()
    config.snapshotWidth = 600
    guard let image = try? await view.web.takeSnapshot(configuration: config) else { return nil }
    for quality in [0.5, 0.3, 0.15] as [CGFloat] {
      if let data = image.jpegData(compressionQuality: quality), data.count <= AgentPageRules.maxPictureBytes { return data.base64EncodedString() }
    }
    return nil
  }

  func yourTurn(_ why: String) async -> Reply {
    guard isLive else { return ok(["answer": "stop"]) }
    if state == .running { pause(String(why.prefix(200))) } else { waitingWhy = String(why.prefix(200)); view?.modesChanged() }
    turn?.resume(returning: "stop")
    let answer = await withCheckedContinuation { turn = $0 }
    return ok(["answer": answer])
  }

  func done(_ summary: String?) -> Reply {
    end("done")
    return ok(["ended": true])
  }

  func act(_ p: [String: Any]) async -> Reply {
    let kind = p["kind"] as? String ?? ""
    let known: Set<String> = ["fill", "select", "check", "click", "scroll", "wait", "yourTurn", "done"]
    guard known.contains(kind) else { return refusal("partner.act.unknown", "That isn't an action the robot has.") }
    if kind == "yourTurn" { return await yourTurn(p["why"] as? String ?? p["reason"] as? String ?? "") }
    // D131 review M-a: a tab in the back never clicks, fills or scrolls for AgentZero
    if let view, !view.isOnScreen { return inBack() }
    if kind == "done" { return done(p["summary"] as? String) }
    guard state == .running else { return refusal("partner.robot.paused", state == .idle ? "The run hasn't started: read the page first." : "It's the person's turn.") }
    guard let view, recipe.active(.robot, host: stripHost, kid: view.kid) else { end("left-recipe"); return refusal("partner.robot.off", "ZeroFee can't act on this page.") }
    if let hit = limitsHit { end(hit); return refusal("partner.robot.limit", "The robot's run reached its limit.") }
    actions += 1
    actedSinceShot = true
    touchIdle()
    if kind == "wait" {
      let ms = min(5000, max(0, (p["ms"] as? NSNumber)?.intValue ?? 1000))
      try? await Task.sleep(for: .milliseconds(ms))
      return ok(["ok": true])
    }
    let id = p["id"] as? String ?? p["target"] as? String ?? ""
    guard let e = latest[id] else { return refusal("partner.act.refused", "That isn't on the page ZeroFee last read.") }
    let words = [e["text"] as? String, e["label"] as? String].compactMap { $0 }.joined(separator: " ")
    // The second lock, natively: a page that isn't in English, and any declaration (PEP, source of funds, tax…), are
    // the person's.
    if !RobotWords.englishPage(latestLang) {
      pause("This page isn't in English, so it's yours to fill in.")
      return refusal("partner.act.yours", "The robot only acts on pages in English.")
    }
    if ["select", "check", "fill"].contains(kind), RobotWords.isDeclaration(words) {
      pause("\"\(String(words.prefix(60)))\" is a question only you can answer.")
      return refusal("partner.act.yours", "That question is the person's to answer.")
    }
    // The document that acts must still be the one on the strip (audit IOS-7): robot.js checks its own host first.
    var command: [String: Any] = ["kind": kind, "target": id, "mustBeHost": stripHost]
    switch kind {
    case "fill":
      guard Self.isTextField(e) else { return refusal("partner.act.refused", "That isn't a box to type in.") }
      let value = p["value"] as? String ?? p["slot"] as? String ?? ""
      if value.contains("{{") || value.contains("}}") {
        switch Self.plan(slot: value, field: e, stripHost: stripHost, recipe: recipe) {
        case .failure(let why): return refusal("partner.slot.refused", why.text)
        case .success(let plan):
          switch await secret(for: plan) {
          case .failure(let why): return refusal("partner.slot.refused", why.text)
          case .success(let v):
            command["value"] = v
            if case .loginPassword = plan { command["mustBePassword"] = true }
            if case .loginNew = plan { command["mustBePassword"] = true }
          }
        }
      } else {
        // Fills are slots only (Agent's Security-reviewed robot, 6a4c605): a literal never goes in, least of all into a
        // password, one-time-code or card field.
        return refusal("partner.act.refused", Self.isSecretField(e) ? "Only a saved login goes into a password, code or card box." : "The robot fills only from your saved details (a slot), never typed words.")
      }
    case "select":
      guard e["tag"] as? String == "select", let option = p["option"] as? String, option.count <= 100 else { return refusal("partner.act.refused", "That isn't a list to pick from.") }
      command["option"] = option
    case "check":
      guard e["kind"] as? String == "field", ["checkbox", "radio"].contains(e["type"] as? String ?? "") else { return refusal("partner.act.refused", "That isn't a box to tick.") }
      if words.lowercased().firstMatch(of: Self.consentWords) != nil || Self.isCommit(words, recipe: recipe) {
        pause("Terms and consent are yours to read and tick.")
        return refusal("partner.act.yours", "That box is the person's to tick.")
      }
    case "click":
      guard ["button", "link"].contains(e["kind"] as? String ?? "") else { return refusal("partner.act.refused", "That isn't a button or a link.") }
      if Self.isCommit(words, recipe: recipe) {
        pause("That button is yours to tap.")
        return refusal("partner.act.yours", "That button is the person's to tap.")
      }
      if e["kind"] as? String == "link", let to = e["host"] as? String, !recipe.covers(to) {
        // M10: AgentZero stays on the task's site; another site is the person's to open (they tap the link themselves).
        if agentMode {
          let safe = PartnerRecipe.isExactHost(to) ? to : "another site"
          clickedAt = nil // review L5: the person's own tap on that link is theirs, never cancelled as the robot's
          pause("That link goes to \(safe). It's yours to open.")
          return refusal("partner.act.yours", "That link goes to \(safe). It's yours to open.")
        }
        end("left-recipe")
        return refusal("partner.act.refused", "That link leaves \(recipe.partner): ZeroFee stopped acting.")
      }
      clickedAt = Date()
    default: break
    }
    let result = try? await view.web.callAsyncJavaScript("return globalThis.__zfRobot ? globalThis.__zfRobot.act(a) : { error: 'not-installed' }", arguments: ["a": command], in: nil, contentWorld: PartnerScripts.robotWorld)
    command["value"] = nil
    if let r = result as? [String: Any], r["ok"] as? Bool == true {
      failures["\(kind):\(id)"] = nil
      return ok(["ok": true])
    }
    let key = "\(kind):\(id)"
    failures[key, default: 0] += 1
    if failures[key]! >= 3 {
      failures[key] = nil
      pause("ZeroFee couldn't do that step. It's your turn.")
    }
    return refusal("partner.act.failed", "That didn't work on the page.")
  }

  /** A slot's value: one Face ID per run (the run's own LAContext), then the ZeroFee Keychain. Never logged. */
  private func secret(for plan: SlotPlan) async -> Result<String, Why> {
    switch plan {
    case .profile(let name):
      return .failure(Why("ZeroFee doesn't have your \(name) yet. It's your turn to type it."))
    case .loginNew(let h):
      guard Logins.available else { return .failure("Passwords need this phone's secure chip.") }
      // A half-filled pair (one password box filled, its pair empty) in a run that hasn't made the password: an earlier
      // run typed one and stopped. The person finishes it; a second new password would lock them out.
      let boxes = latest.values.filter { ($0["type"] as? String)?.lowercased() == "password" }.map { $0["filled"] as? Bool == true }
      if !newPasswords.has(h), RobotWords.halfFilledPair(boxes) {
        pause("A password is half typed from before. Finish it yourself, then tap Continue.")
        return .failure("A password is already half typed here: it's the person's turn.")
      }
      // The first {{login.new}} of the run makes the password and saves it FIRST (sealing needs no Face ID), then it is
      // typed; a later one in the same run ("Confirm password") types the same password and saves nothing.
      guard let password = try? newPasswords.password(for: h, make: {
        let p = Logins.generate(length: 24)
        try Logins.add(host: h, username: "", password: p, by: "robot")
        return p
      }) else { return .failure("The new password couldn't be saved, so it wasn't typed.") }
      return .success(password)
    case .loginUsername(let h), .loginPassword(let h):
      guard Logins.available else { return .failure("Passwords need this phone's secure chip.") }
      guard let item = try? Logins.forHost(h) else { return .failure("There's no saved login for \(h).") }
      if case .loginUsername = plan { Logins.touch(item.id); return .success(item.username) }
      if runContext == nil {
        do {
          runContext = try await Logins.approvedContext(reason: "Let ZeroFee fill your \(h) login")
        } catch {
          end("declined")
          return .failure(Why("Face ID didn't approve it, so ZeroFee stopped."))
        }
      }
      guard let ctx = runContext, let password = try? Logins.open(item.sealed, context: ctx) else { return .failure("The saved login couldn't be opened.") }
      Logins.touch(item.id)
      return .success(password)
    }
  }

  // robot.js's own handler, in the robot's world only: it says it is ready. Nothing it sends is acted on.
  /**
   * robot.js's own handler, in the robot's world only. Before EVERY act robot.js asks "may-act": "go" only while the
   * run is running in this window's main frame; "ended" otherwise, and robot.js then does nothing. Nothing else it sends
   * is acted on.
   */
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
    guard let view, message.webView === view.web, message.frameInfo.isMainFrame, message.world == PartnerScripts.robotWorld else { return replyHandler("ended", nil) }
    // The frame's own origin, as WebKit knows it (audit IOS-7), must be the page the strip shows, on the recipe: the
    // strip's webView.url can already name the next page while the asking document is still the last one.
    let o = message.frameInfo.securityOrigin
    let origin = o.port == 0 || o.port == 443 ? o.host.lowercased() : "\(o.host.lowercased()):\(o.port)"
    let onRecipe = o.protocol == "https" && origin == stripHost && recipe.active(.robot, host: origin, kid: view.kid)
    replyHandler(Self.gate(state: state, onRecipe: onRecipe), nil)
  }

  /** The stop path's answer, as a plain function: "go" only while running on a recipe host. */
  static func gate(state: State, onRecipe: Bool) -> String { state == .running && onRecipe ? "go" : "ended" }
}
