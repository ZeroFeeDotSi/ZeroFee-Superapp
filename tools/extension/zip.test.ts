// The extension zip's writer (D157): sorted entries, fixed dates and permissions, the same bytes every time.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { collect, dosTime, sortEntries, writeZip, type Entry } from "./zip.ts";

type Read = { name: string; time: number; date: number; attrs: number; madeBy: number; extra: number; data: Buffer };

/** Reads a zip back through its central directory, inflating each entry, and checks each local header agrees. */
function readZip(zip: Buffer): Read[] {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: Read[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    const at = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    assert.equal(zip.readUInt32LE(at), 0x04034b50);
    assert.equal(zip.readUInt16LE(at + 28), 0, "no extra field in the local header");
    assert.equal(zip.subarray(at + 30, at + 30 + nameLen).toString("utf8"), name);
    const body = zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(zlib.crc32(data), zip.readUInt32LE(p + 16), `crc of ${name}`);
    out.push({ name, time: zip.readUInt16LE(p + 12), date: zip.readUInt16LE(p + 14), attrs: zip.readUInt32LE(p + 38), madeBy: zip.readUInt16LE(p + 4), extra, data });
    p += 46 + nameLen + extra;
  }
  return out;
}

const EPOCH = 1793721149; // 3 Nov 2026 15:52:29 UTC

function folder(order: string[], mtime: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zf-zip-"));
  for (const f of order) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), `file ${f}\n`.repeat(50));
    fs.chmodSync(path.join(dir, f), f.endsWith(".sh") ? 0o755 : 0o600);
    fs.utimesSync(path.join(dir, f), mtime, mtime);
  }
  return dir;
}

test("entries come out sorted by their bytes, whatever order the files were made in", () => {
  const dir = folder(["panel.js", "chunks/seal.js", "Z.txt", "assets/panel.css", "a.sh", "chunks/near.js"], 1_000_000_000);
  // The disk's own order differs by file system (APFS lists sorted, ext4 by hash): list it backwards here, so only
  // collect()'s sort can give the sorted zip.
  const readdir = fs.readdirSync;
  (fs as { readdirSync: unknown }).readdirSync = (...args: Parameters<typeof fs.readdirSync>) => (readdir(...args) as unknown[]).reverse();
  try {
    const names = readZip(writeZip(collect(dir, "top"), EPOCH)).map((e) => e.name);
    assert.deepEqual(names, ["top/", "top/Z.txt", "top/a.sh", "top/assets/", "top/assets/panel.css", "top/chunks/", "top/chunks/near.js", "top/chunks/seal.js", "top/panel.js"]);
  } finally {
    (fs as { readdirSync: unknown }).readdirSync = readdir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("control: writeZip keeps the order it is given, so the sort is what orders the zip", () => {
  const unsorted: Entry[] = [{ name: "b", data: Buffer.from("b") }, { name: "a", data: Buffer.from("a") }];
  assert.deepEqual(readZip(writeZip(unsorted, EPOCH)).map((e) => e.name), ["b", "a"]);
  assert.deepEqual(readZip(writeZip(sortEntries(unsorted), EPOCH)).map((e) => e.name), ["a", "b"]);
  assert.notDeepEqual(writeZip(unsorted, EPOCH), writeZip(sortEntries(unsorted), EPOCH));
});

test("every date is SOURCE_DATE_EPOCH in UTC and every permission is fixed, whatever the files on disk say", () => {
  const files = ["x/y.js", "run.sh", "m.json"];
  const a = folder(files, 1_000_000_000);
  const b = folder([...files].reverse(), 1_600_000_000); // other mtimes, other permissions order, other creation order
  try {
    const za = writeZip(collect(a, "top"), EPOCH);
    const zb = writeZip(collect(b, "top"), EPOCH);
    assert.deepEqual(za, zb, "same contents, same bytes");
    const { time, date } = dosTime(EPOCH);
    assert.equal(date, ((2026 - 1980) << 9) | (11 << 5) | 3);
    assert.equal(time, (15 << 11) | (52 << 5) | (29 >> 1));
    for (const e of readZip(za)) {
      assert.equal(e.time, time, e.name);
      assert.equal(e.date, date, e.name);
      assert.equal(e.extra, 0, `${e.name}: no extra fields, no comment`);
      assert.equal(e.madeBy >> 8, 3, "made on Unix, so unzip reads the permissions");
      assert.equal(e.attrs >>> 16, e.name.endsWith("/") ? 0o040755 : 0o100644, e.name);
    }
    assert.equal(readZip(za).find((e) => e.name === "top/m.json")?.data.toString(), "file m.json\n".repeat(50));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test("control: another SOURCE_DATE_EPOCH or another file's contents gives other bytes", () => {
  const entries: Entry[] = [{ name: "top/", data: null }, { name: "top/a.js", data: Buffer.from("one") }];
  const base = writeZip(entries, EPOCH);
  const later = writeZip(entries, EPOCH + 86400);
  assert.notDeepEqual(base, later);
  assert.notEqual(readZip(later)[1].date, readZip(base)[1].date);
  assert.notDeepEqual(base, writeZip([entries[0], { name: "top/a.js", data: Buffer.from("two") }], EPOCH));
});

test("a link in the folder stops the zip (it would depend on what the link points at)", () => {
  const dir = folder(["a.js"], 1_000_000_000);
  try {
    fs.symlinkSync(path.join(dir, "a.js"), path.join(dir, "b.js"));
    assert.throws(() => collect(dir, "top"), /not a file or folder/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
