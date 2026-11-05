// Every Problem the Extension app (inside ZeroFee) can produce itself, each listed in packages/extension-app/errors.md.
// Linking problems from the core (security.link.expired, security.link.wrong) and funding problems from Trade and Wallet
// are shown as those layers wrote them.
import type { Problem } from "@zerofee/core/problem";

export const appProblems = {
  codeRanOut: (): Problem => ({
    code: "extension-app.code.ran-out",
    whatHappened: "That code ran out before you scanned the laptop's code.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Get a new code" },
    more: "Each code works once, for 5 minutes.",
  }),
  notPanelCode: (): Problem => ({
    code: "extension-app.code.not-panel",
    whatHappened: "That isn't the code from the ZeroFee panel.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Scan again" },
    more: "In the panel, type the code from this phone, then scan the square code it shows.",
  }),
  walletUnread: (): Problem => ({
    code: "extension-app.wallet.unread",
    whatHappened: "Your laptop wallet isn't read yet.",
    money: { state: "safe", where: "in the laptop wallet" },
    next: { kind: "retry", label: "Try again" },
    more: "Nothing moved. Check your internet connection, then try again.",
  }),
  cameraOff: (): Problem => ({
    code: "extension-app.camera.off",
    whatHappened: "The camera isn't available to ZeroFee.",
    money: { state: "not-involved" },
    next: { kind: "retry", label: "Try again" },
    more: "Allow the camera for ZeroFee in your phone's settings, then try again.",
  }),
};
