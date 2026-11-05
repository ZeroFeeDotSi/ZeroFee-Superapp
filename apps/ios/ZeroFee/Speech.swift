// device.speech.listen / device.speech.stop (AgentZero's mic, D122): the person's spoken words as text, turned into text
// ON THIS PHONE only (SFSpeechRecognizer with requiresOnDeviceRecognition): no audio and no words leave the phone, for
// Apple or anyone. Where the phone or its language can't do that on the phone, the mic stays off and says so: never a
// server fallback.
// - only AgentZero (the shell stamps `app`); one listen at a time; it ends on the person's Stop (device.speech.stop),
//   or after 30 seconds; nothing is kept, no audio is saved;
// - the build must carry NSMicrophoneUsageDescription and NSSpeechRecognitionUsageDescription in Info.plist (the
//   app's file). Without them iOS would never ask, so the host refuses at once, in plain words.
import AVFoundation
import Foundation
@preconcurrency import Speech
import UIKit

@MainActor
final class OnDeviceSpeech {
  static let usageKeys = ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]
  /** The longest one listen runs. */
  static let maxSeconds: TimeInterval = 30
  static let shared = OnDeviceSpeech()

  enum Answer { case words(String), refused(String) }

  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var done: CheckedContinuation<Answer, Never>?
  private var timer: Timer?
  private var stopTimer: Timer?
  private var tapped = false
  private var heard = ""
  /** One listen at a time, from its very first line (review M1: two taps during the permission asks). */
  private var busy = false
  /** Stop was tapped before the mic was on: honoured as soon as it is (review M2). */
  private var stopAsked = false
  /** Each listen's own number: a timer or a callback from an earlier one never ends a later one (review M3). */
  private var generation = 0
  private var observers: [NSObjectProtocol] = []

  /** Does this build say why it asks? Without both keys iOS never shows the asks. */
  static var explained: Bool { usageKeys.allSatisfy { (Bundle.main.object(forInfoDictionaryKey: $0) as? String)?.isEmpty == false } }

  func listen() async -> Answer {
    guard !busy else { return .refused("AgentZero is already listening.") }
    busy = true
    stopAsked = false
    generation += 1
    let gen = generation
    defer { if done == nil && generation == gen { busy = false } }
    guard Self.explained else { return .refused("This version of ZeroFee can't use the mic yet.") }
    // the person's yes to speech, then to the mic (iOS asks each once)
    let speech: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { c in
      SFSpeechRecognizer.requestAuthorization { s in c.resume(returning: s) }
    }
    guard speech == .authorized else { return .refused("Speech is off for ZeroFee. Turn it on in Settings, or type.") }
    guard await AVAudioApplication.requestRecordPermission() else { return .refused("The mic is off for ZeroFee. Turn it on in Settings, or type.") }
    if stopAsked { return .refused("Stopped. Nothing was heard.") }
    // on the phone only, never a server (the recognizer for the phone's language; English only where that one can't)
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
          recognizer.supportsOnDeviceRecognition, recognizer.isAvailable
    else { return .refused("This iPhone can't turn speech into words on the phone itself, so the mic is off. Type instead.") }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      // no input (a call holds the mic, a route is changing, no mic at all): refused, never a tap on a 0 Hz format (review H2)
      guard format.sampleRate > 0, format.channelCount > 0 else {
        cleanUp()
        return .refused("The mic isn't free right now. Type instead.")
      }
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in request.append(buffer) }
      tapped = true
      engine.prepare()
      try engine.start()
    } catch {
      cleanUp()
      return .refused("The mic didn't start. Type instead.")
    }
    self.request = request
    heard = ""
    watchInterruptions()
    return await withCheckedContinuation { c in
      done = c
      task = recognizer.recognitionTask(with: request) { result, error in
        let text = result?.bestTranscription.formattedString
        let final = result?.isFinal == true
        let failed = error != nil
        Task { @MainActor in
          let s = OnDeviceSpeech.shared
          guard s.generation == gen else { return }
          if let text { s.heard = text }
          if final || failed { s.finish(s.heard.isEmpty ? .refused("AgentZero didn't hear any words. Try again, or type.") : .words(s.heard)) }
        }
      }
      let t = Timer(timeInterval: Self.maxSeconds, repeats: false) { _ in
        Task { @MainActor in if OnDeviceSpeech.shared.generation == gen { OnDeviceSpeech.shared.stop() } }
      }
      RunLoop.main.add(t, forMode: .common)
      timer = t
      if stopAsked { stop() }
    }
  }

  /** The person's Stop: no more audio; the words heard so far come back as the answer. Safe to call any time. */
  func stop() {
    guard busy else { return }
    guard done != nil else { stopAsked = true; return }
    guard stopTimer == nil else { return }
    // Apple's order: the engine, the tap, then the end of the audio
    if engine.isRunning { engine.stop() }
    if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    request?.endAudio()
    // the final result follows endAudio; if it doesn't come within a second, the words heard so far are the answer
    let gen = generation
    let t = Timer(timeInterval: 1, repeats: false) { _ in
      Task { @MainActor in
        let s = OnDeviceSpeech.shared
        guard s.generation == gen else { return }
        s.finish(s.heard.isEmpty ? .refused("AgentZero didn't hear any words. Try again, or type.") : .words(s.heard))
      }
    }
    RunLoop.main.add(t, forMode: .common)
    stopTimer = t
  }

  /** A call, Siri, a route change or the app leaving the screen ends the listen with what was heard (review L1). */
  private func watchInterruptions() {
    let nc = NotificationCenter.default
    let end: @Sendable (Notification) -> Void = { _ in Task { @MainActor in OnDeviceSpeech.shared.stop() } }
    observers = [
      nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main, using: end),
      nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main, using: end),
      nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main, using: end),
    ]
  }

  private func finish(_ a: Answer) {
    guard let c = done else { return }
    done = nil
    cleanUp()
    busy = false
    c.resume(returning: a)
  }

  private func cleanUp() {
    timer?.invalidate()
    timer = nil
    stopTimer?.invalidate()
    stopTimer = nil
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    task?.cancel()
    task = nil
    if engine.isRunning { engine.stop() }
    if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

extension Host {
  /** device.speech.listen (AgentZero only): { text } heard and turned into words on this phone, or a plain refusal. */
  func speechListen(_ app: String) async -> Reply {
    guard app == "agent" else { return problem("shell.device.refused", "Only AgentZero can listen.") }
    switch await OnDeviceSpeech.shared.listen() {
    case let .words(text): return ok(["text": text])
    case let .refused(why): return problem("device.speech.refused", why, next: "Type instead")
    }
  }

  /** device.speech.stop (AgentZero only): ends the listen under way; its words come back to the listen's own answer. */
  func speechStop(_ app: String) -> Reply {
    guard app == "agent" else { return problem("shell.device.refused", "Only AgentZero can listen.") }
    OnDeviceSpeech.shared.stop()
    return ok(["ok": true])
  }
}
