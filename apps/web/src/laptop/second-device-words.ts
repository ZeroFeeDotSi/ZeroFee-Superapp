// What the second device says about a move to a new device and its own removal (the laptop page and the web demo's
// laptop). Its own module, imported by no rules or core code, so the second device's site (second-device.tsx) carries
// only these words. recovery-words.ts re-exports it, so the words have one home.
export const LAPTOP_ANSWERS = {
  title: "A move to a new device",
  ask: "Someone used your 24 words on a new device. Was it you?",
  approve: { button: "Approve: this is me", what: "The new device gets your account when the wait ends." },
  refuse: { button: "Refuse: this isn't me", what: "The move ends and payments pause for a while. Then get new words." },
  // Re-audit 7 (R7-9): with the phone's stop waiting, the two ends of the move are said apart. Refusing and freezing is
  // the default: the phone that asked may be in a thief's hands.
  refuseAndFreeze: { button: "Refuse and freeze payments", what: "Safest if someone might have your main device. Payments pause." },
  // Re-audit 7 (R7-1): removing a second device of age waits the fallback, so the owner has time to see it here.
  removal: "Only your 24 words can stop it: start a move, then approve it here.",
  approved: "You said yes. Changed your mind? Refuse it now.",
  stopAsked: "Your main device asked to stop this move to a new device.",
  confirmStop: { button: "Approve my main device's stop (no freeze)", what: "Only if your main device is with you. Payments don't pause." },
};
