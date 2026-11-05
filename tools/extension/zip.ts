// A reproducible zip of a folder (D157: the extension ships as a zip the website hosts). Only Node's built-ins.
//   node tools/extension/zip.ts <folder> <out.zip> <top folder name in the zip>
// The same folder always gives the same bytes: entries sorted by path (bytes, not locale), every date set to
// SOURCE_DATE_EPOCH (UTC), files 0644 and folders 0755, no extra fields, no comment, deflate at level 9. The deflate
// bytes come from Node's own zlib, so build-zip.sh pins the Node version.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

export type Entry = { name: string; data: Buffer | null }; // data null: a folder (its name ends with "/")

/** Every file and folder under root, as zip names under top/, sorted by their bytes. */
export function collect(root: string, top: string): Entry[] {
  const out: Entry[] = [{ name: `${top}/`, data: null }];
  const walk = (dir: string, rel: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      const name = `${rel}/${d.name}`;
      if (d.isDirectory()) { out.push({ name: `${name}/`, data: null }); walk(abs, name); }
      else if (d.isFile()) out.push({ name, data: fs.readFileSync(abs) });
      else throw new Error(`not a file or folder: ${abs}`); // a link would make the zip depend on what it points at
    }
  };
  walk(root, top);
  return sortEntries(out);
}

export const sortEntries = (entries: Entry[]): Entry[] =>
  [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.name, "utf8"), Buffer.from(b.name, "utf8")));

/** MS-DOS date and time of a Unix time, read in UTC (zip's dates have no zone; local time would differ by machine). */
export function dosTime(epochSeconds: number): { time: number; date: number } {
  const d = new Date(Math.max(epochSeconds, 315532800) * 1000); // DOS dates start 1 Jan 1980
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** The zip's bytes. Entries are written in the order given; collect() and sortEntries() give the sorted order. */
export function writeZip(entries: Entry[], epochSeconds: number): Buffer {
  const { time, date } = dosTime(epochSeconds);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const dir = e.data === null;
    const raw = e.data ?? Buffer.alloc(0);
    const crc = zlib.crc32(raw);
    const deflated = dir ? raw : zlib.deflateRawSync(raw, { level: 9, memLevel: 8, windowBits: 15, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
    const store = dir || deflated.length >= raw.length;
    const body = store ? raw : deflated;
    const method = store ? 0 : 8;
    const flags = 0x0800; // names are UTF-8
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0 (so the permissions below are read)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((((dir ? 0o040755 : 0o100644) << 16) | (dir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  if (entries.length > 0xffff || offset > 0xffffffff) throw new Error("too big for a plain zip");
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

if (import.meta.main) {
  const [folder, out, top] = process.argv.slice(2);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (!folder || !out || !top || !Number.isInteger(epoch) || epoch <= 0) {
    console.error("usage: SOURCE_DATE_EPOCH=<seconds> node tools/extension/zip.ts <folder> <out.zip> <top folder>");
    process.exit(2);
  }
  const zip = writeZip(collect(folder, top), epoch);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip);
  const sha = crypto.createHash("sha256").update(zip).digest("hex");
  fs.writeFileSync(`${out}.sha256`, `${sha}  ${path.basename(out)}\n`);
  console.log(sha);
}
