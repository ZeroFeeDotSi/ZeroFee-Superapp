// The logo of a coin by its address, for the quotes relay's GET /v0/market/logo?c=<sol|bsc|hood|near>&a=<address>.
// NEAR (TN1): GeckoTerminal's own image only, the coin named by its contract account.
// Ported from the V1 wallet's market-logo (read-only reference): the sources are asked at once and the best one with an image wins.
//   Solana: the mint's Metaplex (or Token-2022) metadata uri -> its JSON (<= 64 KB) -> the image, IPFS asked of three gateways at once
//           under 1.5 s, plus arweave.net; then Trust Wallet's assets repo.
//   BNB: Trust Wallet by checksum address, PancakeSwap's list, the Uniswap list.   Robinhood: the Uniswap list.
//   GeckoTerminal's own image is last. Images: png/jpeg/webp/gif only, never svg, at most 400 KB; every upstream body is capped
//   and every fetch has a timeout and an allowlisted host (redirects checked by hand, per hop).

export const IMG_HOSTS = ["assets.geckoterminal.com", "coin-images.coingecko.com", "assets.coingecko.com", "raw.githubusercontent.com", "tokens.pancakeswap.finance", "assets.pancakeswap.finance", "ipfs.io", "cf-ipfs.com", "gateway.pinata.cloud", "ipfs.filebase.io", "arweave.net", "nftstorage.link", "dweb.link", "edge.uxento.io"];
export const IMG_HOST_SUFFIXES = [".mypinata.cloud", ".ipfs.dweb.link", ".ipfs.nftstorage.link", ".arweave.net", ".axiom-cdn.io"];
export const LIST_HOSTS = ["tokens.pancakeswap.finance", "tokens.uniswap.org"];
export const META_HOSTS = ["ipfs.io", "cf-ipfs.com", "gateway.pinata.cloud", "ipfs.filebase.io", "arweave.net", "nftstorage.link", "dweb.link", "raw.githubusercontent.com", "meta.uxento.io", "metadata.j7tracker.io"];
export const META_HOST_SUFFIXES = [".mypinata.cloud", ".ipfs.dweb.link", ".ipfs.nftstorage.link", ".arweave.net"];
const LIMITS = { img: 400 * 1024, meta: 64 * 1024, list: 1536 * 1024 };
const IMG_TYPES = /^image\/(png|jpeg|jpg|webp|gif)(;|$)/i;
const TIMEOUT_MS = 6000;
const MAX_HOPS = 3;
/** Gateways that answered a plain fetch on 21 Oct (ipfs.io and dweb.link answered 429 "service worker gateway only"). All are asked at once. */
export const IPFS_GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.filebase.io/ipfs/", "https://cf-ipfs.com/ipfs/"];
export const IPFS_RACE_MS = 1500;
const SOURCE_MS = 2500; // one source (an RPC read, a list) never holds the answer longer
const RESOLVE_MS = 6000;
const RPC_MAX = 128 * 1024;
const SOL_RPC = ["https://solana-rpc.publicnode.com", "https://solana.api.pocket.network"];
const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export function hostAllowed(host, kind) {
  const h = String(host).toLowerCase();
  const [exact, suffixes] = kind === "img" ? [IMG_HOSTS, IMG_HOST_SUFFIXES] : kind === "meta" ? [META_HOSTS, META_HOST_SUFFIXES] : [LIST_HOSTS, []];
  return exact.includes(h) || suffixes.some((s) => h.endsWith(s) && h.length > s.length);
}

/** `{ok:true,url}` when `raw` is an https url on an allowed host (no credentials, default port, sane length); otherwise `{ok:false}`. */
export function checkUrl(raw, kind) {
  if (kind !== "img" && kind !== "meta" && kind !== "list") return { ok: false };
  if (typeof raw !== "string" || raw.length > 600) return { ok: false };
  let u;
  try { u = new URL(raw); } catch { return { ok: false }; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return { ok: false };
  if (!hostAllowed(u.hostname, kind)) return { ok: false };
  return { ok: true, url: u };
}

/** A coingecko "/large/" image (200 px, up to 130 KB) is served from its "/small/" twin (64 px, ~13 KB): a logo is drawn at 32 to 64 px. */
export function variantOf(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === "coin-images.coingecko.com" && /\/coins\/images\/\d+\/large\//.test(u.pathname)) { u.pathname = u.pathname.replace("/large/", "/small/"); return u.toString(); }
  } catch { /* not a url */ }
  return raw;
}

/** "<cid>/file?x" of an ipfs gateway-style url (gateway/ipfs/<cid>..., <cid>.ipfs.<gateway>), or undefined. */
export function ipfsPathOf(raw) {
  try {
    const u = new URL(raw);
    const m = /^\/ipfs\/(.+)$/.exec(u.pathname);
    if (m && /(^|\.)(ipfs\.io|dweb\.link|cf-ipfs\.com|nftstorage\.link|gateway\.pinata\.cloud|filebase\.io|mypinata\.cloud)$/.test(u.hostname)) return m[1] + u.search;
    const sub = /^([a-z0-9]{40,})\.ipfs\./i.exec(u.hostname);
    if (sub) return sub[1] + u.pathname.replace(/^\/$/, "") + u.search;
  } catch { /* not a url */ }
  return undefined;
}

async function readLimited(res, max) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The image type the first bytes say (png, jpeg, gif or webp), or undefined when they are none of the four. */
export function sniffImage(b) {
  if (!b || b.length < 4) return undefined;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return undefined;
}

/** One url, redirects followed by hand (at most 3, every hop on the allowlist). `o` = { timeoutMs, signal, maxBytes }. */
async function fetchHops(raw, kind, fetchImpl, o) {
  let cur = checkUrl(raw, kind);
  if (!cur.ok) return { status: 400, error: "bad_url" };
  const max = o.maxBytes ?? LIMITS[kind];
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    if (o.signal?.aborted) ctl.abort(); else o.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      let res;
      try {
        res = await fetchImpl(cur.url.toString(), { redirect: "manual", signal: ctl.signal, headers: { accept: kind === "img" ? "image/*" : "application/json" } });
      } catch (e) {
        return { status: 502, error: "upstream_unreachable", why: e?.cause?.code || e?.name || "error" };
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        let next;
        try { next = loc ? new URL(loc, cur.url) : undefined; } catch { next = undefined; }
        const chk = next ? checkUrl(next.toString(), kind) : { ok: false };
        if (!chk.ok) return { status: 502, error: "redirect_refused" };
        cur = chk;
        continue;
      }
      if (res.status === 404 || res.status === 403 || res.status === 410) return { status: 404, error: "not_found" };
      if (!res.ok) return { status: 502, error: "upstream_error" };
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (kind === "img" && !IMG_TYPES.test(type)) return { status: 415, error: "not_an_image" };
      if (kind !== "img" && !/json|text\/plain/.test(type)) return { status: 415, error: "not_json" };
      let body;
      try { body = await readLimited(res, max); } catch (e) { return { status: 502, error: "upstream_unreachable", why: e?.name || "error" }; }
      if (!body) return { status: 413, error: "too_large" };
      let sniffed;
      if (kind === "img") {
        sniffed = sniffImage(body);
        if (!sniffed || sniffed !== type.split(";")[0].replace("image/jpg", "image/jpeg")) return { status: 415, error: "not_an_image" };
      }
      return { status: 200, type: kind === "img" ? sniffed : "application/json; charset=utf-8", body, ttl: kind === "img" ? 7 * 86400 : kind === "list" ? 3600 : 86400 };
    } finally { clearTimeout(timer); o.signal?.removeEventListener("abort", onAbort); }
  }
  return { status: 502, error: "too_many_redirects" };
}

/** The same IPFS content from every gateway at once; the first 200 wins and the others are cancelled. Each attempt (headers and body) has IPFS_RACE_MS. */
function raceIpfs(path, kind, fetchImpl, o) {
  const ctl = new AbortController();
  return new Promise((resolve) => {
    let left = IPFS_GATEWAYS.length, best;
    for (const g of IPFS_GATEWAYS) {
      fetchHops(g + path, kind, fetchImpl, { ...o, timeoutMs: Math.min(o.timeoutMs ?? IPFS_RACE_MS, IPFS_RACE_MS), signal: ctl.signal }).then((r) => {
        if (r.status === 200) { ctl.abort(); resolve(r); return; }
        if (!best || (r.status === 404 && best.status !== 404)) best = r;
        if (--left === 0) resolve(best);
      });
    }
  });
}

/**
 * Fetches `raw` for `kind` and returns { status, type, body, ttl }. Redirects are followed by hand (at most 3), every hop must be on the allowlist.
 * 4xx/5xx from the upstream become 404/502 so the client treats "no logo" as a normal answer. IPFS content is raced over three gateways; a coingecko /large/
 * image comes from its /small/ twin when that exists. `fetchImpl` is for tests; `o` = { timeoutMs, maxBytes, signal }.
 */
export async function fetchAllowed(raw, kind, fetchImpl = fetch, o = {}) {
  if (!checkUrl(raw, kind).ok) return { status: 400, error: "bad_url" };
  if (kind === "img") {
    const v = variantOf(raw);
    if (v !== raw) { const r = await fetchAllowed(v, kind, fetchImpl, o); if (r.status === 200) return r; }
  }
  if (kind !== "list" && !o.noRace) { const p = ipfsPathOf(raw); if (p) return raceIpfs(p, kind, fetchImpl, o); }
  return fetchHops(raw, kind, fetchImpl, o);
}

// ---------- the logo of a coin by address (?c=&a=) ----------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58dec(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.push(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c === "1") out.push(0); else break; }
  return Uint8Array.from(out.reverse());
}
function b58enc(b) {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x === 0) s = "1" + s; else break; }
  return s;
}
const P = 2n ** 255n - 19n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const powmod = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
/** Is the 32-byte string a valid ed25519 point (a Solana PDA must NOT be)? x^2 = (y^2 - 1) / (d y^2 + 1) has a square root. */
export function onCurve(b) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]);
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const x2 = (((y2 - 1n + P) % P) * powmod((D * y2 + 1n) % P, P - 2n, P)) % P;
  return x2 === 0n || powmod(x2, (P - 1n) / 2n, P) === 1n;
}
/** The Metaplex metadata account of a mint (the PDA the client used to derive with web3.js). */
export async function metadataPdaOf(mint) {
  const m = b58dec(mint), prog = b58dec(METAPLEX);
  if (!m || m.length !== 32 || !prog) return undefined;
  const meta = new TextEncoder().encode("metadata"), tag = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array([...meta, ...prog, ...m, bump, ...prog, ...tag])));
    if (!onCurve(h)) return b58enc(h);
  }
  return undefined;
}
/** key(1) update_authority(32) mint(32) name(4+n) symbol(4+n) uri(4+n), Borsh strings. */
export function metaplexUri(data) {
  try {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 65;
    const str = () => { const n = dv.getUint32(o, true); if (n > 400) throw new Error("bad length"); const s = new TextDecoder().decode(data.subarray(o + 4, o + 4 + n)); o += 4 + n; return s.replace(/\0+$/g, "").trim(); };
    str(); str();
    return str() || undefined;
  } catch { return undefined; }
}
export function normalizeUri(uri) {
  const t = String(uri).trim().replace(/\0/g, "");
  if (/^ipfs:\/\//i.test(t)) return IPFS_GATEWAYS[0] + t.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
  if (/^ar:\/\//i.test(t)) return "https://arweave.net/" + t.slice(5);
  return /^https:\/\//i.test(t) ? t : undefined;
}

const withLimit = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(undefined), ms))]);
function rpcSol(method, params, f) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return Promise.any(SOL_RPC.map(async (u) => {
    const r = await f(u, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(SOURCE_MS) });
    if (!r.ok) throw new Error("rpc " + r.status);
    const raw = await readLimited(r, RPC_MAX);
    if (!raw) throw new Error("rpc too large");
    const j = JSON.parse(raw.toString("utf8"));
    if (j.error) throw new Error("rpc error");
    return j.result;
  }));
}
/** The metadata uri on chain: Metaplex account and the Token-2022 extension are read at once (the first one that has a uri wins). */
async function solUri(mint, f) {
  const pda = await metadataPdaOf(mint);
  const mp = pda ? rpcSol("getAccountInfo", [pda, { encoding: "base64", commitment: "confirmed" }], f).then((r) => { const d = r?.value?.data?.[0]; return d ? metaplexUri(Buffer.from(d, "base64")) : undefined; }).catch(() => undefined) : Promise.resolve(undefined);
  const t22 = rpcSol("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }], f).then((r) => r?.value?.data?.parsed?.info?.extensions?.find((e) => e.extension === "tokenMetadata")?.state?.uri).catch(() => undefined);
  return (await mp) || (await t22);
}
/** The image url a metadata uri leads to: the uri itself when it is an image, else the JSON's "image". */
async function imageOfUri(uri, f) {
  const url = uri ? normalizeUri(uri) : undefined;
  if (!url) return undefined;
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) && checkUrl(url, "img").ok) return url;
  const m = await fetchAllowed(url, "meta", f, { timeoutMs: SOURCE_MS });
  if (m.status !== 200) return undefined;
  let j;
  try { j = JSON.parse(m.body.toString("utf8")); } catch { return undefined; }
  const img = typeof j?.image === "string" ? normalizeUri(j.image) : undefined;
  return img && checkUrl(img, "img").ok ? img : undefined;
}

const listMaps = new Map();
function listMap(url, chainId, f) {
  const k = url + "#" + chainId;
  const hit = listMaps.get(k);
  if (hit && Date.now() - hit.at < 3600_000) return hit.p;
  const p = fetchAllowed(url, "list", f, { timeoutMs: 5000 }).then((r) => {
    const m = new Map();
    if (r.status !== 200) { listMaps.delete(k); return m; } // a failed list is asked again next time
    let j; try { j = JSON.parse(r.body.toString("utf8")); } catch { return m; }
    for (const t of j?.tokens ?? []) if (t.chainId === chainId && t.logoURI && t.address) { const u = normalizeUri(t.logoURI); if (u && checkUrl(u, "img").ok) m.set(String(t.address).toLowerCase(), u); }
    return m;
  });
  listMaps.set(k, { at: Date.now(), p });
  return p;
}

/**
 * NEAR (re-check, 5 Nov: New on NEAR showed one coin): a NEAR coin's own contract holds its logo, ft_metadata's `icon`,
 * as a data url (the launchpads' coins: a webp of 3-6 KB; GeckoTerminal has no image for them, so every one was out of the
 * list, which shows only coins with a logo). Read as a view on FastNEAR (the relay's paid key when it has one); only a
 * base64 png, jpeg, gif or webp whose bytes say so, at most 400 KB; an svg or anything else is none (GeckoTerminal's image next).
 */
export const NEAR_ICON = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)$/;
export function nearIconImage(icon) {
  if (typeof icon !== "string" || icon.length > Math.ceil(LIMITS.img * 4 / 3) + 64) return undefined;
  const m = NEAR_ICON.exec(icon.trim());
  if (!m) return undefined;
  const body = Buffer.from(m[1], "base64");
  const type = sniffImage(body);
  return type && body.length <= LIMITS.img ? { status: 200, type, body } : undefined;
}
async function nearIcon(a, f, near) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: a, method_name: "ft_metadata", args_base64: "e30=" } });
  const r = await f(near?.rpc ?? "https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json", ...(near?.headers ?? {}) }, body, redirect: "error", signal: AbortSignal.timeout(SOURCE_MS) });
  if (!r.ok) return undefined;
  const raw = await readLimited(r, RPC_MAX * 8);
  const bytes = raw ? JSON.parse(raw.toString("utf8"))?.result?.result : undefined;
  if (!Array.isArray(bytes)) return undefined;
  return nearIconImage(JSON.parse(Buffer.from(bytes).toString("utf8"))?.icon);
}

/** The sources of a coin, best first. Each is an async function returning a fetched image ({status:200,...}) or undefined. */
function sourcesOf(c, a, f, near) {
  const img = async (url) => { if (!url) return undefined; const r = await fetchAllowed(url, "img", f, { timeoutMs: SOURCE_MS }); return r.status === 200 ? r : undefined; };
  const trust = (folder, addr = a) => () => img(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${addr}/logo.png`);
  const lc = a.toLowerCase();
  if (c === "sol") return [async () => img(await withLimit(solUri(a, f).then((u) => imageOfUri(u, f)), RESOLVE_MS - 1000)), trust("solana")];
  const list = (url, id) => async () => img((await withLimit(listMap(url, id, f), SOURCE_MS))?.get(lc));
  if (c === "bsc") return [trust("smartchain", checksum(a)), list("https://tokens.pancakeswap.finance/pancakeswap-extended.json", 56), list("https://tokens.uniswap.org", 56)];
  if (c === "near") return [() => nearIcon(a, f, near)];
  return [list("https://tokens.uniswap.org", 4663)];
}


// ---- keccak-256, for the EIP-55 checksum address Trust Wallet's repo is keyed by (node:crypto's sha3-256 pads differently) ----
const M64 = (1n << 64n) - 1n;
const RC = [];
{ let r = 1; for (let i = 0; i < 24; i++) { let c = 0n; for (let j = 0; j < 7; j++) { if (r & 1) c ^= 1n << BigInt((1 << j) - 1); r = r & 0x80 ? (r << 1) ^ 0x171 : r << 1; } RC.push(c); } }
const rotl = (x, n) => (((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
function keccakF(st) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map((x) => st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20]);
    for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) st[y + x] ^= d; }
    const B = new Array(25);
    let x = 1, y = 0, cur = st[1];
    for (let t = 0; t < 24; t++) { const nx = y, ny = (2 * x + 3 * y) % 5; const tmp = st[nx + 5 * ny]; B[nx + 5 * ny] = rotl(cur, ((t + 1) * (t + 2) / 2) % 64); cur = tmp; x = nx; y = ny; }
    B[0] = st[0];
    for (let yy = 0; yy < 25; yy += 5) for (let xx = 0; xx < 5; xx++) st[yy + xx] = (B[yy + xx] ?? st[yy + xx]) ^ (~(B[yy + (xx + 1) % 5] ?? st[yy + (xx + 1) % 5]) & M64 & (B[yy + (xx + 2) % 5] ?? st[yy + (xx + 2) % 5]));
    st[0] ^= RC[round];
  }
}
export function keccak256(bytes) {
  const rate = 136, st = new Array(25).fill(0n);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes); padded[bytes.length] ^= 0x01; padded[padded.length - 1] ^= 0x80;
  for (let o = 0; o < padded.length; o += rate) { for (let i = 0; i < rate / 8; i++) { let w = 0n; for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(padded[o + i * 8 + b]); st[i] ^= w; } keccakF(st); }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number((st[i >> 3] >> BigInt(8 * (i & 7))) & 255n);
  return out;
}
/** EIP-55 checksum form of a 0x + 40 hex address. */
export function checksum(addr) {
  const lc = addr.toLowerCase().slice(2);
  const h = Array.from(keccak256(new TextEncoder().encode(lc)), (b) => b.toString(16).padStart(2, "0")).join("");
  return "0x" + Array.from(lc, (ch, i) => (parseInt(h[i], 16) >= 8 ? ch.toUpperCase() : ch)).join("");
}

export const LOGO_TTL = 7 * 86400;
const GT_NET = { sol: "solana", bsc: "bsc", hood: "robinhood", near: "near" };
/** The last resort: GeckoTerminal's own image for the coin. `gt` = { root, headers, spend? } (the relay's keyed CoinGecko /onchain with its budget, else the public API). */
async function gtImage(c, a, f, gt) {
  try {
    // A keyed call only inside the relay's CoinGecko budget (gt.spend, NF-07); past it, no call at all.
    if (gt.spend && !(await gt.spend())) return undefined;
    // never followed (audit 4 Nov #20): a redirect would carry the CoinGecko key's header to another host
    const r = await f(`${gt.root}/networks/${GT_NET[c]}/tokens/${a}/info`, { headers: { accept: "application/json;version=20230302", ...gt.headers }, redirect: "error", signal: AbortSignal.timeout(SOURCE_MS) });
    if (!r.ok) return undefined;
    const raw = await readLimited(r, LIMITS.meta);
    const u = raw ? JSON.parse(raw.toString("utf8"))?.data?.attributes?.image_url : undefined;
    if (typeof u !== "string" || /missing/i.test(u) || !checkUrl(u, "img").ok) return undefined;
    const img = await fetchAllowed(u, "img", f, { timeoutMs: SOURCE_MS });
    return img.status === 200 ? img : undefined;
  } catch { return undefined; }
}

/**
 * Native coins (Trade, 5 Nov): a coin NEAR Intents lists is named by CoinGecko's id, and its logo is CoinGecko's own image,
 * asked by its path only: GET /v0/market/logo?cg=<n>/<thumb|small|large>/<file>. The host is fixed here, so no URL from
 * the request is ever fetched; the path is checked strictly first.
 */
export const CG_IMAGE_PATH = /^\d{1,8}\/(?:thumb|small|large)\/[A-Za-z0-9_.%-]{1,96}\.(?:png|jpe?g|webp|gif)$/;
export const cgImageOk = (p) => typeof p === "string" && CG_IMAGE_PATH.test(p) && !p.includes("..");
/** { status: 200, type, body } or { status: 404 } or { status: 400 }. */
export async function resolveCgLogo(p, f = fetch) {
  if (!cgImageOk(p)) return { status: 400 };
  try {
    const r = await fetchAllowed(`https://coin-images.coingecko.com/coins/images/${p}`, "img", f, { timeoutMs: SOURCE_MS });
    return r.status === 200 ? r : { status: 404 };
  } catch { return { status: 404 }; }
}

/** `c` and `a` checked strictly BEFORE any fetch. */
export function logoRequestOk(c, a) {
  if (c !== "sol" && c !== "bsc" && c !== "hood" && c !== "near") return false;
  if (typeof a !== "string") return false;
  // a NEAR account: 2 to 64 of a-z 0-9 - _ ., a dot only between parts (never "..", never first or last)
  if (c === "near") return a.length >= 2 && a.length <= 64 && /^(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/.test(a);
  if (c === "sol") { const b = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? b58dec(a) : null; return !!b && b.length === 32; }
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** { status: 200, type, body } or { status: 404 } (every source says none) or { status: 400 }. All sources run at once; the best one with an image wins. */
/** `near` = { rpc, headers } (the relay's FastNEAR door for a NEAR coin's own icon; none: FastNEAR's free door). */
export async function resolveLogo(c, a, f = fetch, gt = { root: "https://api.geckoterminal.com/api/v2", headers: {} }, near) {
  if (!logoRequestOk(c, a)) return { status: 400 };
  const tasks = sourcesOf(c, a, f, near).map((s) => s().catch(() => undefined));
  const walk = (async () => {
    for (const t of tasks) { const r = await t; if (r) return r; }
    return (await gtImage(c, a, f, gt)) ?? { status: 404 };
  })();
  let timer;
  const r = await Promise.race([walk, new Promise((res) => { timer = setTimeout(() => res({ status: 404 }), RESOLVE_MS); })]);
  clearTimeout(timer);
  return r;
}
