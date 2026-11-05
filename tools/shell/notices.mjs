// Settings > Open source: the third-party notices for the libraries the web app ships.
//
//   node tools/shell/notices.mjs          writes apps/web/src/shell/third-party-notices.json
//   node tools/shell/notices.mjs --check  exits 1 when that file is out of date
//
// What "ships" means here: every package the app's code imports, followed from apps/web/src/main.tsx through our own
// workspace packages (type-only imports are left out: they never reach the bundle), plus everything those packages
// depend on in package-lock.json (a superset of what the bundler keeps, so nothing that ships is missed). Version and
// licence come from the lockfile (the package's own package.json when the lockfile has none); the licence and NOTICE
// files are copied as the package ships them. No machine paths, no dates: the output is the same on every computer.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = join(ROOT, "apps/web/src/shell/third-party-notices.json");
const ENTRY = join(ROOT, "apps/web/src/main.tsx");

/**
 * Listed whether or not they are in the bundle yet. vite: its small module loader is written into the app's code by the
 * build. lightweight-charts: TradingView's licence asks for this attribution wherever its charts are shown, and Trade's
 * charts bring it in; the entry is here before the package lands so the notice is never missing.
 */
export const PINNED = ["vite", "lightweight-charts"];
// noticeText: TradingView's NOTICE for lightweight-charts v5.2.1, verbatim. The npm package ships no NOTICE file, so it
// is written here; check it again when the version Trade brings in changes.
export const TRADINGVIEW = {
  name: "lightweight-charts",
  notice: "Charts by TradingView",
  noticeText: "TradingView Lightweight Charts™\nCopyright (c) 2025 TradingView, Inc. https://www.tradingview.com/",
  url: "https://www.tradingview.com/",
};

/** A package.json "repository" as a plain https address ("git+https://…/x.git" → "https://…/x"); null otherwise. */
export function repositoryUrl(repo) {
  const raw = typeof repo === "string" ? repo : repo && typeof repo.url === "string" ? repo.url : "";
  const url = raw.replace(/^git\+/, "").replace(/\.git$/, "");
  return /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

/**
 * Repositories for packages that name a licence and ship no licence file but declare no "repository" of their own, so
 * the licence link still has somewhere to go. Used only when the package has no repository field.
 */
export const KNOWN_REPOSITORIES = { "fancy-canvas": "https://github.com/tradingview/fancy-canvas" };

const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const IMPORT_RE = /(?:^|[;\n}])\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const pkgName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
const isFile = (p) => existsSync(p) && statSync(p).isFile();

function tryFile(base) {
  for (const e of EXTS) if (isFile(base + e)) return base + e;
  return null;
}

/** "@zerofee/core/problem" → that workspace's file, through its package.json "exports" pattern. */
function resolveWorkspace(spec) {
  const name = pkgName(spec);
  const link = join(ROOT, "node_modules", name);
  if (!existsSync(link)) return null;
  const dir = realpathSync(link);
  const sub = spec.slice(name.length + 1);
  const exp = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).exports ?? {};
  for (const [key, target] of Object.entries(exp)) {
    if (typeof target !== "string") continue;
    if (key === "./*" && sub) {
      const hit = tryFile(join(dir, target.replace("*", sub))) ?? tryFile(join(dir, target.replace("*", sub).replace(/\.ts$/, "")));
      if (hit) return hit;
    } else if (key === `./${sub}` || (key === "." && !sub)) return tryFile(join(dir, target));
  }
  return tryFile(join(dir, sub || "index"));
}

/** Third-party package names the app's code imports, with the workspace folder each was imported from. */
export function importedPackages() {
  const seen = new Set();
  const found = new Map(); // name → workspace dir (relative to ROOT) it was first imported from
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|m?js)$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[2]) continue; // `import type` / `export type`: erased before bundling
      const spec = (m[3] ?? m[4]).split("?")[0];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        const hit = tryFile(resolve(dirname(file), spec));
        if (hit) queue.push(hit);
      } else if (spec.startsWith("@zerofee/")) {
        const hit = resolveWorkspace(spec);
        if (hit) queue.push(hit);
      } else if (!spec.startsWith("/")) {
        const name = pkgName(spec);
        if (!found.has(name)) found.set(name, workspaceOf(file));
      }
    }
  }
  return found;
}

function workspaceOf(file) {
  let d = dirname(file);
  while (d.startsWith(ROOT) && d !== ROOT) {
    if (isFile(join(d, "package.json"))) return relative(ROOT, d);
    d = dirname(d);
  }
  return "";
}

/** The lockfile key npm would load `name` from, asked from lockfile key `from` (nearest node_modules upwards). */
function locate(lock, from, name) {
  let base = from;
  for (;;) {
    const key = (base ? `${base}/` : "") + `node_modules/${name}`;
    if (lock.packages[key]) return key;
    if (!base) return null;
    const i = base.lastIndexOf("/node_modules/");
    base = i >= 0 ? base.slice(0, i) : base.startsWith("node_modules/") ? "" : dirname(base) === "." ? "" : dirname(base);
  }
}

function readLicenceFiles(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f)).sort() : [];
  const pick = (re) => files.filter((f) => re.test(f)).map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n?/g, "\n").trim()).join("\n\n") || null;
  return { licenceText: pick(/^(licen[cs]e|copying)/i), noticeText: pick(/^notice/i) };
}

/** Every shipped package, sorted, with version, licence and the licence/NOTICE text as shipped. */
export function buildNotices() {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const keys = new Set();
  const walk = (key) => {
    if (!key || keys.has(key)) return;
    keys.add(key);
    const e = lock.packages[key];
    for (const d of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) walk(locate(lock, key, d));
  };
  for (const [name, ws] of importedPackages()) walk(locate(lock, ws, name));
  // Pinned entries are listed on their own: vite's own dependencies are build tools and never reach the app.
  for (const name of PINNED) {
    const key = locate(lock, "", name);
    if (key) keys.add(key);
  }
  const byId = new Map();
  for (const key of keys) {
    const e = lock.packages[key];
    if (e.link) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    if (name.startsWith("@zerofee/")) continue;
    const dir = join(ROOT, key);
    const own = isFile(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
    const licence = e.license ?? (typeof own.license === "string" ? own.license : null);
    const files = readLicenceFiles(dir);
    // vite's LICENSE.md goes on to list the licences of the build tools it bundles into itself; only vite's own code
    // (its module loader) reaches the app, so only vite's own licence is copied.
    if (name === "vite" && files.licenceText) files.licenceText = files.licenceText.split(/\n# Licenses of bundled dependencies/)[0].trim();
    // A licence named but no licence file shipped: the package's own repository, where its licence text lives.
    const licenceUrl = licence && !files.licenceText ? repositoryUrl(own.repository ?? KNOWN_REPOSITORIES[name]) : null;
    byId.set(`${name}@${e.version}`, { name, version: e.version, licence, ...files, licenceUrl });
  }
  const packages = [...byId.values()];
  for (const name of PINNED) {
    if (!packages.some((p) => p.name === name)) packages.push({ name, version: null, licence: name === TRADINGVIEW.name ? "Apache-2.0" : null, licenceText: null, noticeText: null, licenceUrl: null });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)));
  return { tradingview: TRADINGVIEW, packages };
}

export const render = (notices) => `${JSON.stringify(notices, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render(buildNotices());
  if (process.argv.includes("--check")) {
    const now = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (now !== text) {
      console.error("third-party-notices.json is out of date: run node tools/shell/notices.mjs");
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${relative(ROOT, OUT)} (${JSON.parse(text).packages.length} packages)`);
  }
}
