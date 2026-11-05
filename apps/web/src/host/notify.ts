// device.notify.schedule / device.notify.cancel are the phone's (apps/ios/ZeroFee/Notify.swift). The web demo has no host,
// so it answers this Problem instead: a web page can't promise a reminder will arrive.
import type { Problem } from "@zerofee/core/problem";

export const NOTIFY_UNAVAILABLE: Problem = {
  code: "device.notify.unavailable",
  whatHappened: "This browser can't remind you. The phone app can.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
};
