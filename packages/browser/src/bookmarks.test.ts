// D131 favourites: kept on the phone, https only, one per address, at most 50, the host read from the address itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bridge } from "@zerofee/core/bridge";
import { addBookmark, BOOKMARKS_KEY, cleanBookmarks, FAVOURITES, isSaved, loadBookmarks, MAX_BOOKMARKS, removeBookmark } from "./bookmarks.ts";

function store(initial?: string) {
  const kv = new Map<string, string | null>(initial === undefined ? [] : [[BOOKMARKS_KEY, initial]]);
  const bridge = {
    call: async (method: string, p: { key: string; value?: string | null }) => {
      if (method === "device.store.get") return { ok: { value: kv.get(p.key) ?? null } };
      if (method === "device.store.set") return kv.set(p.key, p.value ?? null), { ok: {} };
      return { ok: {} };
    },
    on: () => () => {},
  } as unknown as Bridge;
  return { bridge, kv };
}
const NOW = new Date("2026-11-03T12:00:00Z");

test("save, open again, remove: newest first, one per address, kept under the Browser's own key", async () => {
  const s = store();
  assert.ok("list" in (await addBookmark(s.bridge, "https://pump.fun/", NOW)));
  const r = await addBookmark(s.bridge, "https://app.rhea.finance/swap", NOW);
  assert.ok("list" in r && r.list.map((b) => b.host).join() === "app.rhea.finance,pump.fun");
  await addBookmark(s.bridge, "https://pump.fun/", NOW); // saved twice: kept once
  const list = await loadBookmarks(s.bridge);
  assert.equal(list.length, 2);
  assert.ok(isSaved(list, "https://pump.fun/") && !isSaved(list, "https://gmgn.ai/"));
  assert.deepEqual((await removeBookmark(s.bridge, "https://pump.fun/")).map((b) => b.host), ["app.rhea.finance"]);
  assert.ok(s.kv.has(BOOKMARKS_KEY));
});

test("https only: http, a user name in the address, or a bare word is refused with one line (control: https saves)", async () => {
  const s = store();
  for (const bad of ["http://pump.fun/", "https://me:pw@pump.fun/", "pump", "javascript:alert(1)"]) assert.deepEqual(await addBookmark(s.bridge, bad, NOW), { line: FAVOURITES.notSecure }, bad);
  assert.ok("list" in (await addBookmark(s.bridge, "https://pump.fun/", NOW)));
});

test("at most 50: the 51st says to remove one first; a saved one is still fine", async () => {
  const full = Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({ url: `https://s${i}.example.com/`, host: `s${i}.example.com`, atIso: NOW.toISOString() }));
  const s = store(JSON.stringify(full));
  assert.deepEqual(await addBookmark(s.bridge, "https://new.example.com/", NOW), { line: FAVOURITES.full });
  assert.ok("list" in (await addBookmark(s.bridge, "https://s3.example.com/", NOW)), "already saved: no line");
});

test("what the store holds is checked: the host comes from the address, never from the stored record; junk is dropped", () => {
  const list = cleanBookmarks([
    { url: "https://pump.fun/x", host: "bank.example.com", atIso: "2026-11-01T00:00:00Z" },
    { url: "http://pump.fun/", host: "pump.fun" },
    { url: "https://pump.fun/x", host: "pump.fun" },
    null, 7, { url: 5 },
  ]);
  assert.deepEqual(list, [{ url: "https://pump.fun/x", host: "pump.fun", atIso: "2026-11-01T00:00:00Z" }]);
  assert.deepEqual(cleanBookmarks("not a list"), []);
});
