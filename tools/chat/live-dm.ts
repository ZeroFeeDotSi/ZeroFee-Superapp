// ZeroFee Chat's private messages against the real relays BitChat uses for them (D55 slice 2).
//
// READ ONLY by default: asks each of BitChat's four private-message relays (DM_RELAYS) for the latest kind-1059 wraps,
// with the app's own RelayPool rules, and reports how many answer, how many wraps verify (id and signature), and how
// many have BitChat's outer shape (exactly one ["p", <64 hex>] tag, "v2:" content). It can't read them: they are
// sealed to other people. Posts nothing.
//
// With --one-test-dm: ONE clearly marked test message to ourselves, never to anyone else: from a key made here for
// this run in one place to the same seed's key in another place, sealed by the core (sealChatDm) and posted to the four
// relays; then read back from each relay and opened by the core (openChatDm). Its text says what it is.
//
//   node tools/chat/live-dm.ts [--one-test-dm]
import { verifyEvent, type NostrEvent } from "../../packages/core/src/nostr.ts";
import { openChatDm, readDmContent, sealChatDm } from "../../packages/core/src/bitchat-dm.ts";
import { placeKey, publicKeyHex } from "../../packages/core/src/nostr.ts";
import { DM_RELAYS } from "../../packages/chat/src/relays.ts";

const send = process.argv.includes("--one-test-dm");

function ask(url: string, frames: unknown[][], until: (d: unknown[]) => boolean, ms = 8000): Promise<{ open: boolean; got: unknown[][]; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const got: unknown[][] = [];
    let open = false;
    let ws: WebSocket;
    const end = () => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* closed */ }
      resolve({ open, got, ms: Date.now() - t0 });
    };
    const timer = setTimeout(end, ms);
    try {
      ws = new WebSocket(url);
    } catch {
      return end();
    }
    ws.onopen = () => {
      open = true;
      for (const f of frames) ws.send(JSON.stringify(f));
    };
    ws.onerror = () => end();
    ws.onmessage = (m) => {
      let d: unknown;
      try { d = JSON.parse(String(m.data)); } catch { return; }
      if (!Array.isArray(d)) return;
      got.push(d);
      if (until(d)) end();
    };
  });
}

const report: Record<string, unknown> = { readAtIso: new Date().toISOString(), relays: {} };
for (const url of DM_RELAYS) {
  const r = await ask(url, [["REQ", "dm", { kinds: [1059], limit: 25 }]], (d) => d[0] === "EOSE" || d[0] === "CLOSED");
  const events = r.got.filter((d) => d[0] === "EVENT").map((d) => d[2] as NostrEvent);
  (report.relays as Record<string, unknown>)[url] = {
    open: r.open,
    ms: r.ms,
    eose: r.got.some((d) => d[0] === "EOSE"),
    closed: r.got.find((d) => d[0] === "CLOSED")?.[2] ?? null,
    wraps: events.length,
    verified: events.filter((e) => verifyEvent(e)).length,
    bitchatShape: events.filter((e) => e.tags.length === 1 && e.tags[0]![0] === "p" && /^[0-9a-f]{64}$/.test(e.tags[0]![1] ?? "") && e.content.startsWith("v2:")).length,
  };
}

if (send) {
  const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const [from, to] = ["u0qj", "u0qm"];
  const me = publicKeyHex(placeKey(seed, to));
  const text = `ZeroFee Chat test: one private message to ourselves (${new Date().toISOString()}). Please ignore.`;
  const { event, messageId } = sealChatDm(seed, { geohash: from, to: me, kind: "message", text });
  const results: Record<string, unknown> = {};
  for (const url of DM_RELAYS) {
    const posted = await ask(url, [["EVENT", event]], (d) => d[0] === "OK");
    const ok = posted.got.find((d) => d[0] === "OK");
    await new Promise((r) => setTimeout(r, 800));
    const back = await ask(url, [["REQ", "back", { kinds: [1059], "#p": [me], limit: 5 }]], (d) => d[0] === "EOSE");
    const wrap = back.got.find((d) => d[0] === "EVENT" && (d[2] as NostrEvent).id === event.id)?.[2] as NostrEvent | undefined;
    const opened = wrap ? openChatDm(seed, { geohash: to, event: wrap }) : null;
    const read = opened ? await readDmContent(opened.content) : null;
    results[url] = { accepted: ok?.[2] ?? null, why: ok?.[3] ?? null, servedBack: !!wrap, openedAs: read && read.kind === "message" && read.messageId === messageId && read.text === text ? "our text, our id" : read };
  }
  report.testDm = { id: event.id, to: me, outerCreatedAt: event.created_at, results };
}
console.log(JSON.stringify(report, null, 2));
process.exit(0);
