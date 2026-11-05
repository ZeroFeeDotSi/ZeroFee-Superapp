// device.clipboard.read is the phone's (apps/ios/ZeroFee/Bridge.swift, UIPasteboard). iOS shows its own paste banner the first
// time an app reads what another app copied. The web demo answers this Problem: a browser's clipboard is asked in the app's
// own screen (navigator.clipboard), which the person can refuse, so the app says "Use Paste instead." and keeps its field.
import type { Problem } from "@zerofee/core/problem";

export const CLIPBOARD_UNAVAILABLE: Problem = {
  code: "device.clipboard.unavailable",
  whatHappened: "Use Paste instead.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
};
