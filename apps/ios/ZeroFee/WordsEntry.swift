// Typing the 24 words on ZeroFee's own screen (S1.6 follow-up; the study's 4.11): for a restore ("I already have
// one") or "Check my words". With the isolated core the words go from here straight to the core, never to the page
// (the core then refuses words from the page). The same steps as the web screen (apps/web/src/screens/Recovery.tsx
// RestoreWords): 24 numbered slots, each checked against the backup-word list as it's typed, the list's first matches
// to tap, a whole phrase pasted at once. Done only when all 24 are on the list; the core checks them again.
import SwiftUI
import UIKit

struct WordsEntryView: View {
  let purpose: String
  let wordlist: [String]
  let done: @MainActor ([String]?) -> Void

  @State private var words = Array(repeating: "", count: 24)
  @State private var at = 0
  @FocusState private var focused: Bool
  private static let gutter: CGFloat = 28
  private let hair = Color.primary.opacity(0.12)

  private var known: Set<String> { Set(wordlist) }
  private var current: String { words[at] }
  private var suggestions: [String] { current.isEmpty ? [] : Array(wordlist.lazy.filter { $0.hasPrefix(current) }.prefix(3)) }
  private var complete: Bool { words.allSatisfy { known.contains($0) } }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(purpose == "check" ? "ZEROFEE · CHECK MY WORDS" : purpose == "rearm" ? "ZEROFEE · FACE ID CHANGED" : purpose == "codes" ? "ZEROFEE · FACE ID CHANGED" : "ZEROFEE · BRING BACK MY ACCOUNT").font(.system(size: 11, weight: .medium)).tracking(2).foregroundStyle(.secondary)
        Spacer()
        Button("Cancel") { done(nil) }.font(.system(size: 15)).foregroundStyle(Color.primary)
      }
      .padding(.horizontal, Self.gutter)
      .padding(.top, 20)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text("Your 24 words").font(.system(size: 24)).tracking(-0.4).padding(.top, 20)
          Text(purpose == "check" ? "Type them from your paper. This only checks them. Nothing leaves this phone." : purpose == "rearm" ? "They turn approvals back on. No money moves." : purpose == "codes" ? "They bring back your sites' two-factor codes. No money moves." : "Type them in order, or paste them all at once.")
            .font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 6)
          if purpose == "rearm" || purpose == "codes" {
            // A new approval key (or codes sealed again) takes every face enrolled now: one someone else added would count too.
            Text("Didn't change Face ID yourself? Stop here. Reset it in Settings, Face ID & Passcode, then set up only your face.")
              .font(.system(size: 13)).foregroundStyle(Color.red).padding(.top, 8)
          }
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 18), GridItem(.flexible())], spacing: 0) {
            ForEach(0..<24, id: \.self) { i in
              Button { at = i; focused = true } label: {
                HStack(spacing: 10) {
                  Text("\(i + 1)").font(.system(size: 12)).foregroundStyle(.secondary).monospacedDigit().frame(width: 20, alignment: .trailing)
                  Text(words[i].isEmpty ? " " : words[i]).font(.system(size: 17))
                    .foregroundStyle(!words[i].isEmpty && !known.contains(words[i]) && i != at ? Color.red : Color.primary)
                  Spacer(minLength: 0)
                }
                .padding(.vertical, 9)
                .overlay(alignment: .bottom) { (i == at ? Color.primary : hair).frame(height: i == at ? 2 : 1) }
              }
              .buttonStyle(.plain)
            }
          }
          .padding(.top, 18)
        }
        .padding(.horizontal, Self.gutter)
      }
      VStack(spacing: 10) {
        // A secure field (audit H3): iOS types into it only with its own keyboard, never a third-party one (Full Access
        // could keep the 24 words), and gives it no dictation and no autocorrect learning. Only this field: every other
        // field in ZeroFee keeps whatever keyboard the person uses. The word typed still shows, in its slot above.
        SecureField("Word \(at + 1)", text: Binding(get: { current }, set: { typed($0) }))
          .font(.system(size: 17)).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.asciiCapable)
          .textContentType(.oneTimeCode) // keeps the keyboard's own suggestions (and their learning) away from the words
          .focused($focused)
          .padding(.horizontal, 16).frame(height: 50)
          .overlay(RoundedRectangle(cornerRadius: 14).stroke(hair, lineWidth: 1))
          .onSubmit { if let first = suggestions.first { accept(first) } }
        HStack(spacing: 10) {
          ForEach(suggestions, id: \.self) { w in
            Button(w) { accept(w) }.font(.system(size: 15)).padding(.horizontal, 14).frame(height: 36)
              .overlay(Capsule().stroke(hair, lineWidth: 1)).foregroundStyle(Color.primary)
          }
        }
        .frame(minHeight: 36)
        Button { done(words) } label: {
          Text(purpose == "check" ? "Check them" : purpose == "rearm" ? "Turn approvals back on" : purpose == "codes" ? "Bring back my codes" : "Bring back my account").font(.system(size: 16, weight: .medium)).frame(maxWidth: .infinity, minHeight: 52)
        }
        .disabled(!complete)
        .foregroundStyle(Color(uiColor: .systemBackground))
        .background(Capsule().fill(Color.primary.opacity(complete ? 1 : 0.3)))
      }
      .padding(.horizontal, Self.gutter)
      .padding(.vertical, 16)
    }
    .background(Color(uiColor: .systemBackground))
    .privacyCover()
    .onAppear { focused = true }
  }

  /** A letter typed, or a phrase pasted (which fills from here on). Four letters always pin one word: then it moves on. */
  private func typed(_ raw: String) {
    let parts = raw.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
    if parts.count > 1 {
      for (n, part) in parts.enumerated() where at + n < 24 { words[at + n] = part.filter(\.isLetter) }
      at = min(23, at + parts.count)
      return
    }
    let w = raw.lowercased().filter { $0.isLetter && $0.isASCII }
    words[at] = w
    let matches = wordlist.filter { $0.hasPrefix(w) }
    if w.count >= 4, matches.count == 1 { accept(matches[0]) }
  }

  private func accept(_ word: String) {
    words[at] = word
    if at < 23 { at += 1 }
  }
}

extension Host {
  /** The 24 words typed here, for the core only: the words, or nil if the person cancelled. */
  func coreTypeWords(_ purpose: String, wordlist: [String]) async -> [String]? {
    await presentModal { (finish: @escaping @MainActor ([String]?) -> Void) in
      // the typed words stay out of screenshots and recordings too (audit H3): drawn inside a secure field's canvas, as
      // the shown words are (ScreenshotProof); the cover over the whole sheet hides them when ZeroFee isn't the app on
      // screen (iOS audit finding 5: outside the secure canvas, as the shown words' and an exported key's sheets)
      AnyView(ScreenshotProof(content: WordsEntryView(purpose: purpose, wordlist: wordlist, done: finish)).ignoresSafeArea().privacyCover())
    }
  }
}
