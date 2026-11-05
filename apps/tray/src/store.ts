// Where the tray keeps what pairing gave it: the macOS Keychain (the login keychain), generic password items under one
// service: AgentZero's key seed; the computer's own 64-byte pairing secret (the bearer token is derived from it); the
// account's id with the stop phrase's hash and this computer's own day limit (D104); and this computer's payments over a
// rolling 24 hours (times and cents only). Nothing else of the tray is ever written to disk.
//
// `security` is run by its path with an args array (spawn, never a shell string), and the secret NEVER goes in its argv
// (any process can read another's argv with `ps`): `add-generic-password … -w` with no value, as the last argument,
// reads the value from stdin. It reads stdin only when it has no terminal to prompt on: run in Terminal, it prompts on
// /dev/tty and ignores the pipe (checked 3 Nov on macOS 27, under a pseudo-terminal). So the child is started detached
// (its own session, no controlling terminal), and then it reads the piped value (twice: "password" and "retype").
// That prompt keeps at most 128 characters and silently drops the rest (checked the same day): hence several items, each
// at most 120 characters, and every write is read back and compared.
//
// What the Keychain doesn't stop: the items' access list trusts /usr/bin/security (it made them), so any program
// running as this user that runs `security find-generic-password -w` reads them without a prompt. Same as any file this
// user can read. The account contract still caps what AgentZero's key can do (its daily limit, its list).
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";

export const SERVICE = "zerofee-tray-agentzero";
const SECURITY = "/usr/bin/security";
/** `security find-generic-password`'s exit when there is no such item (errSecItemNotFound). */
const NOT_FOUND = 44;
/** The prompt keeps at most 128 characters; each item stays under it. */
const ITEM_MAX = 120;
const PARTS = ["agentzero-seed", "computer-secret", "account"] as const;
type Part = (typeof PARTS)[number];
type Item = Part | "spent";
export const DAY_LIMIT_MAX_USD = 1000;

export interface Held {
  /** AgentZero's 32-byte key seed. */
  seed: Uint8Array;
  /** The computer's own 64-byte pairing secret (pair.ts makeOffer's `secret`, its ML-KEM seed): the bearer comes from it. */
  secret: Uint8Array;
  accountId: string;
  /** sha256 (hex) of the stop phrase (stopHashOf). */
  stopHash: string;
  /** This computer's own day limit, whole dollars (D104): on top of the account's, which stays the hard ceiling. */
  dayLimitUsd: number;
}

/** One payment from this computer, for its rolling 24-hour count: when (to the minute, rounded up) and how many cents. */
export interface Spend {
  atMs: number;
  cents: number;
}

export interface SecretStore {
  save(h: Held): Promise<void>;
  load(): Promise<Held | null>;
  /** True when every item is gone. */
  remove(): Promise<boolean>;
  /** This computer's payments in the count; [] when none yet; null when the count can't be read (then nothing is paid). */
  spent(): Promise<Spend[] | null>;
  /** Keeps the count; false when the Keychain didn't. */
  setSpent(list: Spend[]): Promise<boolean>;
}

/** One run of a program: its args array and what goes to its stdin. Tests pass a recorder. */
export type Run = (file: string, args: readonly string[], input?: string) => Promise<{ code: number; stdout: string }>;

/**
 * The program by its path and an args array, no shell, detached (its own session, no controlling terminal: `security`
 * then reads -w from the pipe), 10 s at most. spawn, not execFile: execFile passes only some options on to spawn and
 * drops `detached` (under a terminal, `security` then prompted on the tty: checked 3 Nov).
 */
export const execRun: Run = (file, args, input) =>
  new Promise((resolve) => {
    const child = spawn(file, [...args], { detached: true, shell: false, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(1);
    }, 10_000);
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (c: string) => {
      stdout += c;
      if (stdout.length > 64 * 1024) child.kill("SIGKILL");
    });
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(typeof code === "number" ? code : 1));
    child.stdin!.on("error", () => undefined);
    child.stdin!.end(input ?? "");
  });

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string, n: number): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b = new Uint8Array(Buffer.from(s, "base64url"));
  return b.length === n && b64u(b) === s ? b : null;
};
const limitOk = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= DAY_LIMIT_MAX_USD;

/** The three pairing items' values. */
export const encodeHeld = (h: Held): Record<Part, string> => {
  if (h.seed.length !== 32 || h.secret.length !== 64 || !/^[a-z0-9._-]{2,64}$/.test(h.accountId) || !/^[0-9a-f]{64}$/.test(h.stopHash) || !limitOk(h.dayLimitUsd)) throw new Error("not a pairing to keep");
  const out = { "agentzero-seed": `zf1.${b64u(h.seed)}`, "computer-secret": `zf1.${b64u(h.secret)}`, account: `zf1.${h.accountId}.${b64u(Buffer.from(h.stopHash, "hex"))}.${h.dayLimitUsd}` };
  for (const v of Object.values(out)) if (v.length > ITEM_MAX) throw new Error("not a pairing to keep");
  return out;
};

export const decodeHeld = (v: Partial<Record<Part, string | null>>): Held | null => {
  const seed = /^zf1\.([A-Za-z0-9_-]{43})$/.exec(v["agentzero-seed"]?.trim() ?? "");
  const secret = /^zf1\.([A-Za-z0-9_-]{86})$/.exec(v["computer-secret"]?.trim() ?? "");
  const account = /^zf1\.([a-z0-9._-]{2,64})\.([A-Za-z0-9_-]{43})\.([1-9]\d{0,3})$/.exec(v.account?.trim() ?? "");
  const s = seed && fromB64u(seed[1]!, 32);
  const c = secret && fromB64u(secret[1]!, 64);
  const h = account && fromB64u(account[2]!, 32);
  const limit = account ? Number(account[3]) : NaN;
  return s && c && h && limitOk(limit) ? { seed: s, secret: c, accountId: account[1]!, stopHash: Buffer.from(h).toString("hex"), dayLimitUsd: limit } : null;
};

const MINUTE = 60_000;
/**
 * The count as one item: "zf1." and, per payment, its minute and cents in base 36. Past what an item holds, the two oldest
 * are merged into one at the later minute: it then counts longer, never less (stricter, never looser).
 */
export const encodeSpent = (list: Spend[]): string => {
  let rows = list
    .filter((r) => Number.isFinite(r.atMs) && Number.isInteger(r.cents) && r.cents > 0)
    .map((r) => ({ m: Math.ceil(r.atMs / MINUTE), c: r.cents }))
    .sort((a, b) => a.m - b.m);
  const text = () => `zf1.${rows.map((r) => `${r.m.toString(36)}~${r.c.toString(36)}`).join(",")}`;
  while (rows.length > 1 && text().length > ITEM_MAX) rows = [{ m: rows[1]!.m, c: rows[0]!.c + rows[1]!.c }, ...rows.slice(2)];
  if (text().length > ITEM_MAX) throw new Error("not a count to keep");
  return text();
};

export const decodeSpent = (text: string): Spend[] | null => {
  const m = /^zf1\.((?:[0-9a-z]{1,9}~[0-9a-z]{1,6})(?:,[0-9a-z]{1,9}~[0-9a-z]{1,6})*)?$/.exec(text.trim());
  if (!m) return null;
  return (m[1] ? m[1].split(",") : []).map((r) => {
    const [at, cents] = r.split("~");
    return { atMs: parseInt(at!, 36) * MINUTE, cents: parseInt(cents!, 36) };
  });
};

/** The stop phrase's hash: the words lower case, one space between. */
export const stopHashOf = (phrase: string): string => createHash("sha256").update(`zerofee-tray-stop:${phrase.trim().toLowerCase().split(/\s+/).join(" ")}`).digest("hex");

/** Constant time, whatever the lengths. */
export const sameHash = (a: string, b: string): boolean => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** The login keychain, through /usr/bin/security. `service`: only a live test's own items. */
export function keychainStore({ run = execRun, service = SERVICE }: { run?: Run; service?: string } = {}): SecretStore {
  const ITEMS = [...PARTS, "spent"] as const;
  const id = (item: Item) => ["-s", service, "-a", item];
  /** The item: its value, "none" only when `security` says there is no such item (exit 44), or "failed" (any other exit,
   *  the 10 s timeout): a failed read is never taken as an empty one. */
  const look = async (item: Item): Promise<{ value: string } | "none" | "failed"> => {
    const r = await run(SECURITY, ["find-generic-password", ...id(item), "-w"]);
    return r.code === 0 ? { value: r.stdout.trim() } : r.code === NOT_FOUND ? "none" : "failed";
  };
  const read = async (item: Item) => {
    const r = await look(item);
    return typeof r === "object" ? r.value : null;
  };
  /** -U: replaces an earlier item. -w last, with no value: read from stdin (twice), never from argv. Read back to compare. */
  const write = async (item: Item, value: string) => {
    const r = await run(SECURITY, ["add-generic-password", "-U", ...id(item), "-l", `ZeroFee AgentZero (${item})`, "-w"], `${value}\n${value}\n`);
    return r.code === 0 && (await read(item)) === value;
  };
  const store: SecretStore = {
    async save(h) {
      const values = encodeHeld(h);
      // A new pairing starts a new count.
      const all: [Item, string][] = [...PARTS.map((p): [Item, string] => [p, values[p]]), ["spent", encodeSpent([])]];
      for (const [item, value] of all) {
        if (!(await write(item, value))) {
          await store.remove();
          throw new Error("The Keychain didn't keep it.");
        }
      }
    },
    async load() {
      const v: Partial<Record<Part, string | null>> = {};
      for (const part of PARTS) v[part] = await read(part);
      return decodeHeld(v);
    },
    async remove() {
      for (const item of ITEMS) await run(SECURITY, ["delete-generic-password", ...id(item)]);
      for (const item of ITEMS) if ((await look(item)) !== "none") return false;
      return true;
    },
    async spent() {
      // Empty only when the item isn't there at all; any failure is unreadable (null), and the pay refuses, so a count
      // is never overwritten after a read that failed.
      const r = await look("spent");
      return r === "none" ? [] : r === "failed" ? null : decodeSpent(r.value);
    },
    setSpent: (list) => write("spent", encodeSpent(list)),
  };
  return store;
}

/** In memory: tests only. */
export function memoryStore(): SecretStore & { value: Record<Part, string> | null; spentValue: string | null } {
  const s = {
    value: null as Record<Part, string> | null,
    spentValue: null as string | null,
    async save(h: Held) {
      s.value = encodeHeld(h);
      s.spentValue = encodeSpent([]);
    },
    async load() {
      return s.value ? decodeHeld(s.value) : null;
    },
    async remove() {
      s.value = null;
      s.spentValue = null;
      return true;
    },
    async spent() {
      return s.spentValue === null ? [] : decodeSpent(s.spentValue);
    },
    async setSpent(list: Spend[]) {
      s.spentValue = encodeSpent(list);
      return true;
    },
  };
  return s;
}
