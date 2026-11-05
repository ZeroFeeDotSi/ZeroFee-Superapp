// device.secret.*: an app's own small secrets, such as the API key Agent thinks with, kept by the device, never by
// the app's own storage.
//
// `forApps` stamps the calling app's id as `app`, so an app only ever reaches its own secrets. Values are never logged
// and never sent anywhere by this code.
// - On the phone, the iPhone host keeps them in the Keychain, this device only, readable while unlocked.
// - In a browser, they go in a BrowserVault: encrypted under the unlock (the person's passkey or passcode, unlock.ts),
//   readable only while it is open. Code running on the same page while it is open can still ask, so the web says
//   "kept on this device, encrypted with your passkey", never "sealed by the chip".
import type { Bridge, BridgeResult } from "./bridge.ts";
import { securityProblems } from "./security-problems.ts";
import type { Vault } from "./vault.ts";

const APPS = ["wallet", "pay", "trade", "extension", "browser", "social", "agent", "earn", "chat"];
const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_VALUE = 4096;

const refused = (what: string) => ({ problem: securityProblems.secretRefused(what) });

/** The host's device.secret.get / device.secret.set, on top of a vault. The host routes `device.secret.*` here. */
export function deviceSecrets(vault: Vault): Bridge {
  return {
    async call<T>(method: string, p: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
      const app = String(p.app ?? "");
      const key = String(p.key ?? "");
      if (!APPS.includes(app)) return refused("This request didn't say which app it came from.");
      if (!KEY.test(key)) return refused("Name it with 1 to 64 small letters, digits, dots, dashes or underscores.");
      const name = `app-secret:${app}:${key}`;
      try {
        if (method === "device.secret.get") {
          const bytes = await vault.get(name);
          return { ok: { value: bytes ? new TextDecoder().decode(bytes) : null } as T };
        }
        if (method === "device.secret.set") {
          if (p.value === null) await vault.delete(name);
          else if (typeof p.value !== "string" || p.value.length === 0 || p.value.length > MAX_VALUE) return refused(`A secret is 1 to ${MAX_VALUE} characters.`);
          else await vault.put(name, new TextEncoder().encode(p.value));
          return { ok: { ok: true } as T };
        }
      } catch {
        return refused("This device won't keep that secret right now.");
      }
      return refused("This device can't do that.");
    },
    on() {
      return () => {};
    },
  };
}
