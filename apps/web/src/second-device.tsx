// The second device's own build (H13), made with VITE_ZEROFEE_TARGET=second-device. Retired by D54: no site serves it
// (the second device is the real app's own /laptop page). This entry replaces main.tsx in that build (vite.config.ts), so its bundle holds the
// laptop page and nothing else: the second device's own core and key (made here, in this browser, kept in its vault
// behind the person's passkey or passcode), and its yes-or-no screens. No app, no demo, no account core: the build fails
// if any of them is reached (vite.config.ts SECOND_DEVICE_NEVER), so nothing on this site can make, fund or spend from
// an account. It runs on NEAR mainnet only, whatever the address says (mode.ts parseMode).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@zerofee/design/tokens.css";
import "@zerofee/design/ui.css";
import "./app.css";
import { LaptopGate } from "./laptop/LaptopGate.tsx";

// The person's own light or dark choice on this site (the app's key; this origin has its own storage).
try {
  if (localStorage.getItem("zf.theme") === "dark") document.documentElement.dataset.theme = "dark";
} catch {
  // storage blocked: light
}
document.documentElement.dataset.mode = "laptop";
document.documentElement.dataset.site = "second-device";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LaptopGate />
  </StrictMode>,
);
