#!/usr/bin/env node
// Minimal ISO-BMFF Common Encryption ('cenc', AES-128-CTR, full-sample) for
// CLEAR fragmented-MP4 DASH audio representations. Used ONLY to build the
// ClearKey development/testing fixture: ffmpeg 6.1 writes senc/saiz/saio into
// the movie header instead of each fragment, which browsers reject.
//
// Usage: node scripts/cenc-encrypt.mjs <dir> <representationId> <kidHex> <keyHex>
// Rewrites <dir>/init-<id>.m4s and <dir>/chunk-<id>-*.m4s in place.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [dir, repId, kidHex, keyHex] = process.argv.slice(2);
if (!dir || !repId || !kidHex || !keyHex) {
  console.error('usage: cenc-encrypt.mjs <dir> <representationId> <kidHex> <keyHex>');
  process.exit(1);
}
const KID = Buffer.from(kidHex, 'hex');
const KEY = Buffer.from(keyHex, 'hex');

function readBoxes(buf, start = 0, end = buf.length) {
  const out = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) size = end - off;
    out.push({ type, start: off, size, header, end: off + size });
    off += size;
  }
  return out;
}

function box(type, ...payloads) {
  const body = Buffer.concat(payloads);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function fullBox(type, version, flags, ...payloads) {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, vf, ...payloads);
}

/** Rebuilds a container box with a replaced child list. */
function container(buf, b, children) {
  return box(b.type, buf.subarray(b.start + b.header, b.start + b.header + (b.type === 'stsd' ? 8 : 0)), ...children);
}

// ------------------------------------------------------------------ init segment
function encryptInit(buf) {
  const sinf = box(
    'sinf',
    box('frma', Buffer.from('Opus', 'latin1')),
    fullBox('schm', 0, 0, Buffer.from('cenc', 'latin1'), Buffer.from([0x00, 0x01, 0x00, 0x00])),
    box('schi', fullBox('tenc', 0, 0, Buffer.from([0, 0, 1, 8]), KID)),
  );
  const pssh = fullBox(
    'pssh',
    1,
    0,
    Buffer.from('1077efecc0b24d02ace33c1e52e2fb4b', 'hex'), // W3C Common PSSH (ClearKey key ids)
    Buffer.from([0, 0, 0, 1]),
    KID,
    Buffer.from([0, 0, 0, 0]),
  );
  const rewrite = (b) => {
    if (b.type === 'Opus') {
      // Sample entry → 'enca' with an appended sinf.
      const body = buf.subarray(b.start + b.header, b.end);
      return box('enca', body, sinf);
    }
    const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
    if (!containers.has(b.type)) return buf.subarray(b.start, b.end);
    const childStart = b.start + b.header + (b.type === 'stsd' ? 8 : 0);
    const children = readBoxes(buf, childStart, b.end).map(rewrite);
    if (b.type === 'moov') children.push(pssh);
    return container(buf, b, children);
  };
  return Buffer.concat(readBoxes(buf).map(rewrite));
}

// ------------------------------------------------------------------ media segments
let ivCounter = 1n;
function nextIv() {
  const iv = Buffer.alloc(8);
  iv.writeBigUInt64BE(ivCounter++);
  return iv;
}

function encryptSegment(buf) {
  const top = readBoxes(buf);
  const out = [];
  for (let i = 0; i < top.length; i++) {
    const b = top[i];
    if (b.type !== 'moof') {
      out.push(buf.subarray(b.start, b.end));
      continue;
    }
    const mdat = top[i + 1];
    if (!mdat || mdat.type !== 'mdat') throw new Error('expected mdat after moof');
    const moofChildren = readBoxes(buf, b.start + 8, b.end);
    const traf = moofChildren.find((c) => c.type === 'traf');
    const trafChildren = readBoxes(buf, traf.start + 8, traf.end);
    const trun = trafChildren.find((c) => c.type === 'trun');
    const tfhd = trafChildren.find((c) => c.type === 'tfhd');
    const tfhdFlags = buf.readUInt32BE(tfhd.start + 8) & 0xffffff;
    let defaultSize = 0;
    {
      let p = tfhd.start + 16; // after track_ID
      if (tfhdFlags & 0x1) p += 8;
      if (tfhdFlags & 0x2) p += 4;
      if (tfhdFlags & 0x8) p += 4;
      if (tfhdFlags & 0x10) defaultSize = buf.readUInt32BE(p);
    }
    const trunFlags = buf.readUInt32BE(trun.start + 8) & 0xffffff;
    const count = buf.readUInt32BE(trun.start + 12);
    let p = trun.start + 16;
    const dataOffsetPos = trunFlags & 0x1 ? p : -1;
    const dataOffset = trunFlags & 0x1 ? buf.readInt32BE(p) : 0;
    if (trunFlags & 0x1) p += 4;
    if (trunFlags & 0x4) p += 4;
    const sizes = [];
    for (let s = 0; s < count; s++) {
      if (trunFlags & 0x100) p += 4;
      if (trunFlags & 0x200) {
        sizes.push(buf.readUInt32BE(p));
        p += 4;
      } else sizes.push(defaultSize);
      if (trunFlags & 0x400) p += 4;
      if (trunFlags & 0x800) p += 4;
    }
    // Encrypt samples (full-sample AES-128-CTR, 8-byte IV + 8-byte counter).
    const mdatBody = Buffer.from(buf.subarray(mdat.start + mdat.header, mdat.end));
    const firstSample = b.start + dataOffset - (mdat.start + mdat.header);
    const ivs = [];
    let cursor = firstSample;
    for (const size of sizes) {
      const iv = nextIv();
      ivs.push(iv);
      const cipher = crypto.createCipheriv('aes-128-ctr', KEY, Buffer.concat([iv, Buffer.alloc(8)]));
      const sample = mdatBody.subarray(cursor, cursor + size);
      Buffer.concat([cipher.update(sample), cipher.final()]).copy(mdatBody, cursor);
      cursor += size;
    }
    const sencPayload = Buffer.alloc(4);
    sencPayload.writeUInt32BE(count, 0);
    const senc = fullBox('senc', 0, 0, sencPayload, ...ivs);
    const saizPayload = Buffer.alloc(5);
    saizPayload.writeUInt8(8, 0);
    saizPayload.writeUInt32BE(count, 1);
    const saiz = fullBox('saiz', 0, 0, saizPayload);
    // saio offset (from moof start) points at the first IV inside senc.
    const saioPayload = Buffer.alloc(8);
    saioPayload.writeUInt32BE(1, 0);
    const saioPlaceholder = fullBox('saio', 0, 0, saioPayload);
    const added = senc.length + saiz.length + saioPlaceholder.length;
    const trafBytes = buf.subarray(traf.start + 8, traf.end);
    const newTrafBody = Buffer.concat([trafBytes, senc, saiz, saioPlaceholder]);
    const newTraf = box('traf', newTrafBody);
    const otherMoof = moofChildren.filter((c) => c !== traf).map((c) => buf.subarray(c.start, c.end));
    const moofBody = Buffer.concat([...otherMoof.slice(0, moofChildren.indexOf(traf)), newTraf, ...otherMoof.slice(moofChildren.indexOf(traf))]);
    const newMoof = box('moof', moofBody);
    // Offsets inside the new moof.
    const trafOffsetInMoof = 8 + otherMoof.slice(0, moofChildren.indexOf(traf)).reduce((n, x) => n + x.length, 0);
    const sencOffsetInMoof = trafOffsetInMoof + 8 + trafBytes.length;
    const firstIvOffset = sencOffsetInMoof + 16; // box header(8) + version/flags(4) + sample_count(4)
    const saioOffsetInMoof = sencOffsetInMoof + senc.length + saiz.length;
    newMoof.writeUInt32BE(firstIvOffset, saioOffsetInMoof + 16);
    if (dataOffsetPos >= 0) {
      const trunOffsetInNew = trafOffsetInMoof + 8 + (trun.start - (traf.start + 8));
      newMoof.writeInt32BE(dataOffset + added, trunOffsetInNew + 16);
    }
    out.push(newMoof, box('mdat', mdatBody));
    i++; // mdat consumed
  }
  return Buffer.concat(out);
}

const initFile = path.join(dir, `init-${repId}.m4s`);
fs.writeFileSync(initFile, encryptInit(fs.readFileSync(initFile)));
const chunks = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith(`chunk-${repId}-`))
  .sort();
for (const f of chunks) {
  const file = path.join(dir, f);
  fs.writeFileSync(file, encryptSegment(fs.readFileSync(file)));
}
console.log(`[cenc] encrypted representation ${repId}: init + ${chunks.length} segments`);
