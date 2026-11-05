// The backup words, shown natively (S1.6 follow-up). With the isolated core, the 24 words go from the core straight to
// this screen and nowhere else: the page never sees them (the core refuses `recovery.words` there). The same two steps
// as the web screens (apps/web/src/screens/Onboarding.tsx Words + Check): write them down, then three quick checks
// (tap the right word of four). The core checks the three again before it adds the recovery key on chain, on the
// native sheet. "Later" closes it; nothing is added, and the app asks again.
import SwiftUI
import UIKit

struct WordsSheetView: View {
  let words: [String]
  let kid: Bool
  /** New words that replace the old ones (recovery.renew): their own copy. */
  var renew = false
  /** The three positions (1–24) and the words picked for them; nil = Later (closed: nothing is checked or added). */
  let done: @MainActor (([Int], [String])?) -> Void

  private struct Round { let pos: Int; let right: String; let options: [String] }
  @State private var checking = false
  /** The check (the web's word-check.ts, finding 36): passed words, the word asked now, positions already asked (never
   *  asked again), wrong picks so far. A wrong pick brings a new word with new choices; a second one stops the check. */
  @State private var passed: [Round] = []
  @State private var now: Round?
  @State private var asked: [Int] = []
  @State private var misses = 0
  @State private var missed = false
  @State private var stopped = false
  @State private var armed = false
  /** A screenshot was taken while the words were up: say what to do (H33). */
  @State private var shot = false

  private static let gutter: CGFloat = 28
  private let hair = Color.primary.opacity(0.12)

  /** The web screen's copy (apps/web/src/words-copy.ts WORDS_COPY and RENEW_WORDS_COPY; kid.ts for a child's words).
   *  Product decision, 2 Nov: at most two one-line notes; every fact behind them one tap down, under "What these words can do". */
  private var copy: (title: String, sub: String, notes: [String], more: [String]) {
    let lost = "If you lose your phone, your words and your second device, nobody can bring your money back. Not even ZeroFee."
    if renew {
      return ("Write these down", "24 new words, in order, on new paper. Never a photo.",
              ["Tear up the old paper once these take over.", "Anyone with these can take your Trading and Hidden."],
              ["Your old words keep working until these take over.",
               "Your Trading and Hidden: these words open them at once, from now on. They don't open your Safe.", lost])
    }
    return kid
      ? ("Parent: write these 24 words down.", "Your child never needs them. In order, on paper. Never a photo.",
         ["They can't spend your child's money.", "Lose both phones and these: money gone."],
         ["They can only add a new phone after a wait.",
          "If your child's phone, these words and your own phone are all lost, nobody can bring the money back. Not even ZeroFee."])
      : ("Write these down", "24 words, in order, on paper. Never a photo.",
         ["Anyone with these can take your Trading and Hidden.", "Lose phone, words and second device: money gone."],
         ["Your Safe: they can only add a new phone after a wait. This phone can stop it.",
          "Your Trading and Hidden: they open them at once. They don't open your Safe.", lost])
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(renew ? "ZEROFEE · NEW BACKUP WORDS" : "ZEROFEE · BACKUP WORDS").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary)
        Spacer()
        Button("Later") { done(nil) }.font(.system(size: 15)).foregroundStyle(Color.primary)
      }
      .padding(.horizontal, Self.gutter)
      .padding(.top, 20)
      if checking, stopped { stoppedView } else if checking, let r = now { check(r) } else { list }
    }
    .background(Color(uiColor: .systemBackground))
    .overlay(alignment: .top) {
      if shot {
        Text("You took a screenshot. If your words show in it, delete it, then empty Recently Deleted.")
          .font(.system(size: 13)).multilineTextAlignment(.leading).padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color(uiColor: .systemBackground))
          .overlay(alignment: .bottom) { hair.frame(height: 1) }
          .onTapGesture { shot = false }
          .padding(.top, 52)
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in shot = true }
    .task {
      try? await Task.sleep(for: .seconds(2))
      armed = true
    }
  }

  private var list: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text(copy.title).font(.system(size: 24)).tracking(-0.4).padding(.top, 20)
          Text(copy.sub).font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 6)
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 18), GridItem(.flexible())], spacing: 0) {
            ForEach(Array(words.enumerated()), id: \.offset) { i, word in
              HStack(spacing: 10) {
                Text("\(i + 1)").font(.system(size: 12)).foregroundStyle(.secondary).monospacedDigit().frame(width: 20, alignment: .trailing)
                Text(word).font(.system(size: 17))
                Spacer(minLength: 0)
              }
              .padding(.vertical, 9)
              .overlay(alignment: .bottom) { hair.frame(height: 1) }
            }
          }
          .padding(.top, 18)
        }
        .padding(.horizontal, Self.gutter)
        .textSelection(.disabled)
      }
      VStack(spacing: 10) {
        // Two one-line notes (D43 and H49); the full facts one tap down.
        ForEach(copy.notes, id: \.self) { note in
          Text(note).font(.system(size: 13)).foregroundStyle(Color.primary).multilineTextAlignment(.center)
        }
        DisclosureGroup("What these words can do") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(copy.more, id: \.self) { line in Text(line).font(.system(size: 13)).foregroundStyle(.secondary) }
          }
          .padding(.top, 6)
        }
        .font(.system(size: 13)).tint(Color.primary)
        Button { startCheck(); checking = true } label: {
          Text("I've written them down").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52)
        }
        .foregroundStyle(Color(uiColor: .systemBackground))
        .background(Color.primary.opacity(armed ? 1 : 0.3), in: Capsule())
        .disabled(!armed)
      }
      .padding(.horizontal, Self.gutter)
      .padding(.vertical, 12)
      .overlay(alignment: .top) { hair.frame(height: 1) }
    }
  }

  private var stoppedView: some View {
    VStack(spacing: 0) {
      Text("Look at your paper. Then try again.").font(.system(size: 24)).tracking(-0.4).multilineTextAlignment(.center).padding(.top, 96)
      Text("Two picks were wrong. The check starts again with new words.")
        .font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.top, 8)
      Spacer()
      Button("See my words again") { checking = false }
        .font(.system(size: 15)).foregroundStyle(Color.primary).padding(.bottom, 20)
    }
    .padding(.horizontal, Self.gutter)
  }

  private func check(_ r: Round) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        ForEach(0..<3, id: \.self) { i in Circle().fill(Color.primary.opacity(i <= passed.count ? 1 : 0.15)).frame(width: 7, height: 7) }
      }
      .padding(.top, 48)
      Text("Which is word \(r.pos)?").font(.system(size: 24)).tracking(-0.4).padding(.top, 28)
      Text(missed ? "Not that one. Here is a new word. Look at your paper." : "Tap the one on your paper. Three checks.")
        .font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 8)
      VStack(spacing: 10) {
        ForEach(r.options, id: \.self) { w in
          Button { pick(w) } label: {
            Text(w).font(.system(size: 17)).frame(maxWidth: .infinity, minHeight: 52)
          }
          .foregroundStyle(Color.primary)
          .overlay(Capsule().stroke(hair, lineWidth: 1))
        }
      }
      .padding(.horizontal, Self.gutter)
      .padding(.top, 36)
      Spacer()
      // No "Check later" (J2, B2): once checked the words leave this phone and can't be shown again, so the check is
      // never skipped, and this screen says so (the web's Check: CANT_SHOW_AGAIN).
      if !renew {
        Text("After this check, your words never show again.")
          .font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, Self.gutter)
      }
      Button("Show my words again") { checking = false }
        .font(.system(size: 15)).foregroundStyle(Color.primary).padding(.top, 10).padding(.bottom, 20)
    }
  }

  /** A fresh check each time it opens: new words, nothing passed, no wrong picks. */
  private func startCheck() {
    passed = []; asked = []; misses = 0; missed = false; stopped = false
    now = Self.round(words, asked: asked)
    if let n = now { asked.append(n.pos) }
  }

  /** Right: the next new word, or done after three. Wrong: a new word with new choices; past one wrong pick, the check
   *  stops (the same four choices never come back, so a guess can't be fixed by the next tap). */
  private func pick(_ w: String) {
    guard let r = now, !stopped else { return }
    if w == r.right {
      passed.append(r)
      missed = false
      if passed.count >= 3 {
        let order = passed.sorted { $0.pos < $1.pos }
        done((order.map(\.pos), order.map(\.right)))
        return
      }
    } else {
      misses += 1
      missed = true
      if misses > 1 { stopped = true; return }
    }
    now = Self.round(words, asked: asked)
    if let n = now { asked.append(n.pos) }
  }

  /** A position not asked yet, its word and three other words from the list, shuffled (the web's roundFor). */
  private static func round(_ words: [String], asked: [Int]) -> Round? {
    guard let pos = Array(1...words.count).filter({ !asked.contains($0) }).randomElement() else { return nil }
    let right = words[pos - 1]
    let others = Array(Array(Set(words.filter { $0 != right })).shuffled().prefix(3))
    return Round(pos: pos, right: right, options: ([right] + others).shuffled())
  }
}

extension Host {
  /** The core's backup words, shown and checked here: the three positions and words, or nil for Later. */
  func coreWords(_ words: [String], kid: Bool, renew: Bool) async -> ([Int], [String])? {
    guard words.count == 24, words.allSatisfy({ $0.wholeMatch(of: /[a-z]{3,8}/) != nil }) else {
      NSLog("[zf-host] the backup words weren't 24 plain words: not shown")
      return nil
    }
    return await presentModal { (finish: @escaping @MainActor (([Int], [String])?) -> Void) in
      // Out of screenshots and recordings (ScreenshotProof), covered in the app switcher (PrivacyCover).
      // The cover (app switcher, recording) over the shield (screenshots).
      AnyView(ScreenshotProof(content: WordsSheetView(words: words, kid: kid, renew: renew, done: finish)).ignoresSafeArea().privacyCover())
    }
  }
}
