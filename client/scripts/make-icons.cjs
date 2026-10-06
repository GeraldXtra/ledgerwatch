const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const FIELD_TOP = [28, 51, 88];
const FIELD_BOT = [10, 21, 41];
const CREST = [14, 28, 52];
const GOLD = [192, 160, 83];
const IVORY = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixels(x, y, size);
      raw[o++] = p[0];
      raw[o++] = p[1];
      raw[o++] = p[2];
      raw[o++] = p.length > 3 ? p[3] : 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inCrest(gx, gy, pad) {
  const top = 9 + pad;
  const tip = 59.5 - pad * 1.15;
  if (gy < top || gy > tip) return false;
  const left = 10 + pad;
  const right = 54 - pad;
  if (gy <= 33) {
    if (gx < left || gx > right) return false;
    const r = Math.max(0, 4 - pad * 0.4);
    const cy = top + r;
    if (gy < cy) {
      if (gx < left + r && (gx - (left + r)) ** 2 + (gy - cy) ** 2 > r * r) return false;
      if (gx > right - r && (gx - (right - r)) ** 2 + (gy - cy) ** 2 > r * r) return false;
    }
    return true;
  }
  const t = (gy - 33) / (tip - 33);
  const k = t < 0.25 ? 1 : Math.pow(Math.max(0, (1 - t) / 0.75), 0.62);
  const hw = (22 - pad) * k;
  return Math.abs(gx - 32) <= hw;
}

function paint(x, y, size) {
  const u = x / size;
  const v = y / size;
  const gx = (u * 512 - 80) / 5.5;
  const gy = (v * 512 - 80) / 5.5;

  const field = lerp(FIELD_TOP, FIELD_BOT, v);
  if (!inCrest(gx, gy, 0)) return field;

  if (distSeg(gx, gy, 22.5, 42, 41.5, 42) <= 1.6) return GOLD;
  if (
    distSeg(gx, gy, 21.8, 34, 32, 23.2) <= 2.3 ||
    distSeg(gx, gy, 32, 23.2, 42.2, 34) <= 2.3
  ) {
    return IVORY;
  }
  if (inCrest(gx, gy, 3.4) && !inCrest(gx, gy, 4.6)) return GOLD;
  return CREST;
}

const out = path.join(__dirname, "..", "public");
for (const size of [192, 512]) {
  const file = path.join(out, `icon-${size}.png`);
  fs.writeFileSync(file, png(size, paint));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
