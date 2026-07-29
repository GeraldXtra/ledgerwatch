/**
 * Generates the PWA PNG icons from the LedgerWatch logo mark.
 *
 * Android requires real PNGs for install prompts and notification badges (SVG is
 * unreliable there), so these are encoded here rather than shipped as SVG only.
 * Uses nothing but Node built-ins — no image dependency to install or audit.
 *
 *   node scripts/make-icons.cjs
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Brand: navy tile, white ledger-to-chart bars, accent dot.
const NAVY = [22, 41, 74];
const WHITE = [255, 255, 255];
const ACCENT = [34, 64, 111]; // --navy-600, the chart/indicator tone

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Raw scanlines, each prefixed with filter byte 0.
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

// The mark, drawn in a 32x32 design space and scaled to the target size.
// Full-bleed navy so it survives Android's circular maskable crop.
function paint(x, y, size) {
  const u = size / 32;
  const gx = x / u;
  const gy = y / u;

  const inRect = (rx, ry, rw, rh) => gx >= rx && gx < rx + rw && gy >= ry && gy < ry + rh;
  const inCircle = (cx, cy, r) => (gx - cx) ** 2 + (gy - cy) ** 2 <= r * r;

  if (inCircle(22, 7.5, 2.6)) return ACCENT;
  if (inRect(8, 19, 4, 6)) return WHITE;
  if (inRect(14, 15, 4, 10)) return WHITE;
  if (inRect(20, 11, 4, 14)) return WHITE;
  return NAVY;
}

const out = path.join(__dirname, "..", "public");
for (const size of [192, 512]) {
  const file = path.join(out, `icon-${size}.png`);
  fs.writeFileSync(file, png(size, paint));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
