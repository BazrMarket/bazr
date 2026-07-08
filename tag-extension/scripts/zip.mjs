/**
 * zip.mjs -- a zero-dependency ZIP writer (Node standard library only)
 *
 * The build environment has no `zip` CLI (only `unzip`). Rather than pull in a new
 * package, the archive is written by hand on top of deflateRawSync from node:zlib.
 *
 * Layout: Local File Header(0x04034b50) + data + Central Directory(0x02014b50) + EOCD(0x06054b50)
 *  - CRC-32 is implemented here table-driven (get it wrong and `unzip -t` catches it)
 *  - deflate (method 8), falling back to store (method 0) when the result is no smaller than the input
 *  - no directory entries are created (file entries only)
 *  - timestamps are fixed -- the same input yields the same bytes (reproducible builds)
 *  - the UTF-8 filename flag (general purpose bit 11) is set
 *  - ZIP64 is not implemented. Crossing a limit throws instead of quietly producing a broken archive
 *
 * Public interface
 *   crc32(buf) -> number
 *   buildZipBuffer(entries) -> Buffer
 *   writeZip(entries, outPath) -> Promise<{ path, bytes, entries }>
 *   readZipEntries(buf) -> Array<{ name, method, crc32, compressedSize, size, localHeaderOffset }>
 *   entries: [{ name: 'manifest.json', data: Buffer|string }, ...]  name is the path inside the zip, always '/'-separated
 */

import { deflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const FLAG_UTF8 = 0x0800; // general purpose bit 11 -- the filename is UTF-8
const VERSION_NEEDED = 20; // 2.0 -- the lowest version that can read deflate
const VERSION_MADE_BY = 0x0314; // high byte 3 = UNIX, low byte = 2.0
const EXTERNAL_ATTR_FILE = (0o100644 << 16) >>> 0; // S_IFREG | 0644

// Fixed timestamp: 1980-01-01 00:00:00 (the floor of the DOS time fields).
// DOS date = ((year-1980) << 9) | (month << 5) | day  => (0 << 9) | (1 << 5) | 1 = 0x0021
// DOS time = (hour << 11) | (min << 5) | (sec >> 1)   => 0x0000
export const FIXED_DOS_DATE = 0x0021;
export const FIXED_DOS_TIME = 0x0000;

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/** CRC-32 (IEEE 802.3, polynomial 0xEDB88320) */
export function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function normalizeName(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('zip: an entry name must be a non-empty string');
  }
  const n = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (n.length === 0) throw new Error(`zip: entry name is empty after normalization: ${JSON.stringify(raw)}`);
  if (n.endsWith('/')) throw new Error(`zip: directory entries are not created: ${n}`);
  if (n.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`zip: relative path segments are not allowed: ${n}`);
  }
  return n;
}

function toBuffer(data, name) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  throw new TypeError(`zip: entry data must be a Buffer, Uint8Array or string: ${name}`);
}

/** Turn entries into ZIP bytes. The given order is preserved exactly. */
export function buildZipBuffer(entries) {
  if (!Array.isArray(entries)) throw new TypeError('zip: entries must be an array');
  if (entries.length === 0) throw new Error('zip: zero entries -- an empty zip is not written');
  if (entries.length > U16_MAX) {
    throw new Error(`zip: ${entries.length} entries exceeds what is representable without ZIP64 (${U16_MAX})`);
  }

  const chunks = [];
  const centrals = [];
  const seen = new Set();
  let offset = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new TypeError('zip: every entry must be a { name, data } object');
    const name = normalizeName(entry.name);
    if (seen.has(name)) throw new Error(`zip: duplicate entry name: ${name}`);
    seen.add(name);

    const data = toBuffer(entry.data, name);
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > U16_MAX) throw new Error(`zip: filename is too long: ${name}`);
    if (data.length > U32_MAX) throw new Error(`zip: file is larger than 4GiB (no ZIP64): ${name}`);

    const crc = crc32(data);

    // If deflate does not shrink the input, fall back to store (an empty file is stored too)
    let method = 8;
    let payload = data.length === 0 ? Buffer.alloc(0) : deflateRawSync(data, { level: 9 });
    if (payload.length >= data.length) {
      method = 0;
      payload = data;
    }

    const localOffset = offset;
    if (localOffset > U32_MAX) throw new Error('zip: the archive is larger than 4GiB (no ZIP64)');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOCAL, 0);
    lh.writeUInt16LE(VERSION_NEEDED, 4);
    lh.writeUInt16LE(FLAG_UTF8, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(FIXED_DOS_TIME, 10);
    lh.writeUInt16LE(FIXED_DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra field length
    chunks.push(lh, nameBuf, payload);
    offset += 30 + nameBuf.length + payload.length;

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CENTRAL, 0);
    ch.writeUInt16LE(VERSION_MADE_BY, 4);
    ch.writeUInt16LE(VERSION_NEEDED, 6);
    ch.writeUInt16LE(FLAG_UTF8, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(FIXED_DOS_TIME, 12);
    ch.writeUInt16LE(FIXED_DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra field length
    ch.writeUInt16LE(0, 32); // file comment length
    ch.writeUInt16LE(0, 34); // disk number start
    ch.writeUInt16LE(0, 36); // internal file attributes
    ch.writeUInt32LE(EXTERNAL_ATTR_FILE, 38);
    ch.writeUInt32LE(localOffset, 42);
    centrals.push(ch, nameBuf);
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(centrals);
  if (cdOffset > U32_MAX || cdOffset + cdBuf.length > U32_MAX) {
    throw new Error('zip: the central directory offset is past 4GiB (no ZIP64)');
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total records
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

/** Write entries to outPath as a ZIP. */
export async function writeZip(entries, outPath) {
  if (typeof outPath !== 'string' || outPath.length === 0) {
    throw new TypeError('zip: outPath must be a non-empty string');
  }
  const buf = buildZipBuffer(entries);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return { path: outPath, bytes: buf.length, entries: entries.length };
}

/**
 * Parse the central directory directly and return the entry list.
 * This reads through code separate from the writing path, so it can serve as a
 * "read back what was written" check.
 */
export function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('zip: readZipEntries takes a Buffer');
  if (buf.length < 22) throw new Error(`zip: file is too short (${buf.length} bytes) -- an EOCD cannot fit`);

  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - U16_MAX);
  for (let i = buf.length - 22; i >= minStart; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no EOCD signature found');

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buf.length) {
    throw new Error(`zip: the central directory range (${cdOffset}+${cdSize}) runs past the file size (${buf.length})`);
  }

  const out = [];
  let p = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (p + 46 > buf.length) throw new Error(`zip: central directory record ${i} is truncated`);
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`zip: central directory record ${i} carries the wrong signature`);
    }
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    out.push({ name, method, crc32: crc, compressedSize, size, localHeaderOffset });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
