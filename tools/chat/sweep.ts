// How slice 1's eight relays were picked (slice 2 picks its allow-list with tools/chat/pick-relays.ts), READ ONLY: asks every relay in BitChat's
// directory for the last 6 hours of kind-20000 events, and prints which answer, how much location-channel traffic each
// carries, and the busiest places with the 5 relays BitChat itself uses for each (closestRelays). Posts nothing.
//
//   node tools/chat/sweep.ts            about a minute; 40 sockets at a time, 8 s each at most
import { BITCHAT_DIRECTORY } from "../../packages/chat/src/directory.ts";
import { bitchatRelays } from "../../packages/chat/src/relays.ts";

interface Row { host: string; open: boolean; events: number; places: Record<string, number>; ms: number }
const since = Math.floor(Date.now() / 1000) - 6 * 3600;

function probe(host: string): Promise<Row> {
  return new Promise((resolve) => {
    const row: Row = { host, open: false, events: 0, places: {}, ms: 0 };
    const t0 = Date.now();
    let ws: WebSocket | null = null;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* closed already */
      }
      row.ms = Date.now() - t0;
      resolve(row);
    };
    const timer = setTimeout(done, 8000);
    try {
      ws = new WebSocket(`wss://${host}`);
    } catch {
      return done();
    }
    ws.onopen = () => {
      row.open = true;
      ws!.send(JSON.stringify(["REQ", "sweep", { kinds: [20000], since, limit: 300 }]));
    };
    ws.onclose = done;
    ws.onmessage = (m) => {
      let d: unknown;
      try {
        d = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (!Array.isArray(d)) return;
      if (d[0] === "EVENT") {
        row.events++;
        const g = (d[2] as { tags?: string[][] })?.tags?.find((t) => t[0] === "g")?.[1];
        if (g) row.places[g] = (row.places[g] ?? 0) + 1;
      }
      if (d[0] === "EOSE" || d[0] === "CLOSED") done();
    };
  });
}

const queue = BITCHAT_DIRECTORY.map(([h]) => h);
const rows: Row[] = [];
await Promise.all(Array.from({ length: 40 }, async () => {
  while (queue.length) rows.push(await probe(queue.shift()!));
}));
const open = rows.filter((r) => r.open);
console.log(`${rows.length} relays in BitChat's directory, ${open.length} answered, ${open.filter((r) => r.events > 0).length} carry location-channel traffic`);
for (const r of open.sort((a, b) => b.events - a.events).slice(0, 25)) console.log(`${r.host.padEnd(36)} ${String(r.events).padStart(4)} events  ${Object.keys(r.places).length} places  ${r.ms} ms`);
const places: Record<string, number> = {};
for (const r of rows) for (const [g, n] of Object.entries(r.places)) places[g] = Math.max(places[g] ?? 0, n);
console.log("\nbusiest places, and BitChat's 5 relays for each:");
for (const [g, n] of Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  if (/^[0-9bcdefghjkmnpqrstuvwxyz]{2,12}$/.test(g)) console.log(`#${g.padEnd(8)} ${String(n).padStart(4)}  ${bitchatRelays(g).join(" ")}`);
}
process.exit(0);
