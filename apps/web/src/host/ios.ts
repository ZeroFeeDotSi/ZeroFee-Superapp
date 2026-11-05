// The iPhone host adapter (apps/ios, D24). When the web app runs inside the ZeroFee iPhone app, WKWebView gives it
// `window.webkit.messageHandlers.zerofee`; every device.* method then goes to Swift instead of the browser:
// - device.store.*  → a UserDefaults suite of its own, keyed by app
// - device.secret.* → the Keychain, this device only (kSecAttrAccessibleWhenUnlockedThisDeviceOnly)
// - device.openUrl  → the partner window (PartnerView.swift; with a compiled recipe, its D29 modes) or the system
//                     browser (external), https only
// - device.wallet.reply / .emit, device.openSite → wallet mode's relay with Browser's engine (Browser only)
// - device.notify.* → local notifications (UNUserNotificationCenter), ids zf.<app>.<id>
// - device.clipboard.read → UIPasteboard.general.string (iOS shows its own paste banner)
// - the camera      → Pay's own getUserMedia loop, with a BarcodeDetector answered by Swift's Vision (below)
// and `device.returned` (a partner's zerofee://<app>/return link, or Done on the sheet) is relayed back from Swift.
//
// Swift answers with the same `{ ok } | { problem }` shapes as the web demo's bridge (docs/interfaces.md).
// In a normal browser `iosHost()` is null and nothing here runs.
import { setCovered } from "@zerofee/shell-api/rest.ts";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { chipKeyCheck } from "./vault.ts";
import { withRecipe } from "./partner.ts";

interface Channel {
  postMessage(message: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, Channel | undefined> };
  }
}

/** The Swift side, as one call/on pair. */
export interface IosHost {
  call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>>;
  on(event: string, handler: (payload: unknown) => void): () => void;
}

const hostProblem = (what: string): Problem => ({
  code: "shell.device.refused",
  whatHappened: what,
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
});

let made: IosHost | null | undefined;
/** What must finish before iOS suspends a backgrounded app (Spending's step under way): Swift asks `settle`. */
const settlers = new Set<() => Promise<unknown>>();
export const beforeSuspend = (f: () => Promise<unknown>) => { settlers.add(f); };

/** The iPhone host, or null when this isn't running inside the ZeroFee iPhone app. */
export function iosHost(): IosHost | null {
  if (made !== undefined) return made;
  const channel = typeof window === "undefined" ? undefined : window.webkit?.messageHandlers?.zerofee;
  if (!channel) return (made = null);
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const host: IosHost = {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      try {
        const reply = (await channel.postMessage({ method, params })) as BridgeResult<T> | null;
        if (reply && typeof reply === "object" && ("ok" in reply || "problem" in reply)) return reply;
        return { problem: hostProblem("This phone gave an answer ZeroFee doesn't understand.") };
      } catch {
        return { problem: hostProblem("This phone didn't answer. Try again.") };
      }
    },
    on(event, handler) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    },
  };
  // Swift's way back in: Host.emit calls window.__zerofeeHost.emit(event, payload); the debug build's
  // zerofee://host/keycheck calls keyCheck(). Fixed once, never replaced.
  Object.defineProperty(window, "__zerofeeHost", {
    value: Object.freeze({
      emit: (event: string, payload: unknown) => listeners.get(String(event))?.forEach((h) => h(payload)),
      keyCheck: () => chipKeyCheck(host),
      // the app is going to the background: Swift keeps it awake (a few seconds) until the step under way has finished
      settle: () => Promise.allSettled([...settlers].map((f) => f())).then(() => true),
    }),
    writable: false,
    configurable: false,
  });
  installBarcodeDetector(host);
  // a site's window is over the shell (device.covered): the shell rests under it like a hidden page (rest.ts)
  host.on("device.covered", (p) => setCovered(!!(p as { on?: unknown } | null)?.on));
  return (made = host);
}

const DEVICE_METHODS = new Set(["device.store.get", "device.store.set", "device.secret.get", "device.secret.set", "device.openUrl", "device.notify.schedule", "device.notify.cancel", "device.clipboard.read", "device.haptic", "device.wallet.reply", "device.wallet.emit", "device.wallet.askConnect", "device.wallet.forget", "device.openSite", "device.site.money", "device.warmSite", "device.location.once", "device.shareFile"]);
/** Browser's engine only: wallet mode's relay, its connect sheet, and opening a site in the partner window. */
const BROWSER_ONLY = new Set(["device.wallet.reply", "device.wallet.emit", "device.wallet.askConnect", "device.wallet.forget", "device.openSite", "device.site.money", "device.warmSite"]);

/**
 * The camera. Inside WKWebView the page has getUserMedia (the host allows the camera for this page only) but WebKit
 * has no BarcodeDetector, so Pay's camera loop (packages/pay/src/app/camera.ts) would say "unsupported". This gives
 * the page a BarcodeDetector whose detect() sends one still frame to Swift, where Apple's Vision reads the QR code;
 * only the text comes back. Pay's own screen and loop stay as they are. Installed once, before any screen renders.
 */
function installBarcodeDetector(host: IosHost) {
  const g = globalThis as { BarcodeDetector?: unknown };
  if (g.BarcodeDetector) return;
  const canvas = document.createElement("canvas");
  class HostBarcodeDetector {
    constructor(_options?: { formats?: string[] }) {}
    static async getSupportedFormats() {
      return ["qr_code"];
    }
    async detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> {
      const w = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width || 0;
      const h = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height || 0;
      if (!w || !h) return [];
      const scale = Math.min(1, 960 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
      const jpeg = canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
      const r = await host.call<{ codes: string[] }>("vision.detect", { jpeg });
      if ("problem" in r) throw new Error(r.problem.whatHappened);
      return r.ok.codes.map((rawValue) => ({ rawValue, format: "qr_code" }));
    }
  }
  g.BarcodeDetector = HostBarcodeDetector;
}

/**
 * The device service on the phone: the same contract as the web demo's deviceService (core.ts), answered by Swift.
 * The app id is checked here AND in Swift; Swift keys everything by it.
 */
export function iosDevice(host: IosHost, apps: ReadonlySet<string>, kid: () => boolean = () => false): Bridge {
  const refuse = (what: string): BridgeResult<never> => ({ problem: hostProblem(what) });
  return {
    async call<T>(method: string, p: Record<string, unknown> = {}) {
      const app = String(p.app ?? "");
      if (!app) return refuse("This request didn't say which app it came from.");
      if (!apps.has(app)) return refuse("ZeroFee doesn't know that app.");
      if (!DEVICE_METHODS.has(method)) return refuse("ZeroFee doesn't know that request.");
      // Social trading opens its three sites the same way (device.openSite); the engine's own calls stay Browser's.
      // ST10: Social trading tells the open site window what its wallet holds (device.site.money), and nothing more
      // The Browser thesis, part 2: the Browser tells its own tab that its Top up went ({ host, went }; Swift checks it)
      if (method === "device.site.money" && app !== "social" && app !== "browser") return refuse("Only Social trading can do that.");
      if (BROWSER_ONLY.has(method) && app !== "browser" && !((method === "device.openSite" || method === "device.site.money" || method === "device.warmSite") && app === "social")) {
        return refuse(method === "device.openSite" ? "Only Apps and Browser can open sites." : "Only Browser can do that.");
      }
      // Chat's Nearby only: one coarse fix of where the phone is (Location.swift checks it too).
      if (method === "device.location.once" && app !== "chat") return refuse("Only Chat can ask where you are.");
      // Wallet's statement only: iOS's share sheet (ShareFile.swift checks it too)
      if (method === "device.shareFile" && app !== "wallet") return refuse("Only Wallet can do that.");
      // A partner window's modes come only from the compiled recipes (D29 §A), never from what the app sent.
      if (method === "device.openUrl" || method === "device.openSite" || method === "device.warmSite") return host.call<T>(method, withRecipe(method, p, kid()));
      return host.call<T>(method, p);
    },
    on<T>(event: string, handler: (payload: T) => void) {
      return host.on(event, handler as (payload: unknown) => void);
    },
  };
}
