// Self-host: the built web app (apps/web/dist) and the quote relay (apps/quotes) on ONE local port, so the page and its
// relay share an origin. It reads the repo's .env (see .env.example; every key is optional and yours), never prints a
// value, and holds no money or keys of its own: the relay only passes quotes and market reads on.
//   node tools/selfhost/serve.mjs            (after tools/selfhost/run.sh has built apps/web/dist)
// PORT (default 5180) and HOST (default localhost) set where it listens. The relay's routes are the same as the hosted
// relay's (apps/quotes/vercel.json), mounted at /v0/... on this port.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = join(ROOT, "apps/web/dist");

/** KEY=value lines from .env; blank lines and # comments skipped; a value already in the environment wins. */
export function loadEnv(file) {
  if (!existsSync(file)) return [];
  const set = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^(["'])(.*)\1$/, "$2");
    if (value === "" || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = value;
    set.push(m[1]);
  }
  return set;
}

/** apps/quotes/vercel.json's rewrites as matchers: "/v0/market/:src/:mpath*" → a RegExp and its destination. */
export function rewritesOf(rules) {
  return rules.map(({ source, destination }) => {
    const names = [];
    const pattern = source.replace(/\/:([a-z]+)(\*?)/gi, (_, name, star) => {
      names.push(name);
      return star ? "(?:/(.*))?" : "/([^/]+)";
    });
    return { re: new RegExp(`^${pattern}$`), names, destination };
  });
}

/** The relay URL a request maps to (/api/relay?route=...), or null when no rewrite matches. */
export function relayUrl(url, rules) {
  for (const { re, names, destination } of rules) {
    const m = re.exec(url.pathname);
    if (!m) continue;
    let dest = destination;
    names.forEach((name, i) => {
      dest = dest.replace(new RegExp(`:${name}\\*?`, "g"), encodeURIComponent(m[i + 1] ?? "").replace(/%2F/g, "/"));
    });
    const out = new URL(dest, url);
    for (const [k, v] of url.searchParams) if (!out.searchParams.has(k)) out.searchParams.append(k, v);
    return out;
  }
  return null;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".wasm": "application/wasm" };

/** The hosted page's own safety headers (apps/web/vercel.json, "/(.*)"), without HSTS: this is plain http on localhost. */
function pageHeaders() {
  const v = JSON.parse(readFileSync(join(ROOT, "apps/web/vercel.json"), "utf8"));
  const all = (v.headers ?? []).find((h) => h.source === "/(.*)")?.headers ?? [];
  return Object.fromEntries(all.filter((h) => h.key !== "Strict-Transport-Security").map((h) => [h.key, h.value]));
}

function serveFile(res, path, headers) {
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  res.writeHead(200, { ...headers, "content-type": type });
  res.end(readFileSync(path));
}

async function main() {
  // The repo's .env first, then apps/quotes/.env (the relay's own list, apps/quotes/.env.example): the first value wins.
  const set = [...loadEnv(join(ROOT, ".env")), ...loadEnv(join(ROOT, "apps/quotes/.env"))];
  // No built app: the relay alone (relay dev: run the web app with `npm run dev` and VITE_ZEROFEE_RELAY at this port).
  const page = existsSync(join(DIST, "index.html"));
  const relay = await import(join(ROOT, "apps/quotes/api/relay.mjs"));
  const rules = rewritesOf(JSON.parse(readFileSync(join(ROOT, "apps/quotes/vercel.json"), "utf8")).rewrites);
  const headers = pageHeaders();
  const port = Number(process.env.PORT ?? 5180);
  const host = process.env.HOST ?? "localhost";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
      const target = url.pathname.startsWith("/v0/") ? relayUrl(url, rules) : null;
      if (target) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
        const request = new Request(target, { method: req.method, headers: req.headers, body });
        const handler = relay[req.method ?? "GET"];
        const response = handler ? await handler(request) : new Response(null, { status: 405 });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!page) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Relay only: no apps/web/dist here (bash tools/selfhost/run.sh builds it).");
      }
      const file = normalize(join(DIST, decodeURIComponent(url.pathname)));
      if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file, headers);
      return serveFile(res, join(DIST, "index.html"), headers);
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Something went wrong on this server.");
    }
  });
  server.listen(port, host, () => {
    console.log(page ? `ZeroFee is running: http://${host}:${port}/` : `ZeroFee's relay is running (no page): http://${host}:${port}/v0/health`);
    console.log(`Keys read from .env: ${set.length ? set.join(", ") : "none (every key is optional)"}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
