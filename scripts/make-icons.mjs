// Gera os ícones do app (PWA) sem dependências: fundo burgundy, "M" creme. Uso: node scripts/make-icons.mjs
import fs from "node:fs";
import zlib from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const distSeg = (px, py, [ax, ay, bx, by]) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };

function render(size, { bg, fg, scale, radius }) {
  const SS = 3, buf = Buffer.alloc(size * size * 4);
  const half = 0.23 * scale, top = 0.5 - half, bot = 0.5 + half, l = 0.5 - half * 1.05, r = 0.5 + half * 1.05, mid = 0.5 + half * 0.15;
  const segs = [[l, top, l, bot], [r, top, r, bot], [l, top, 0.5, mid + 0.02], [r, top, 0.5, mid + 0.02]];
  const sw = 0.045 * scale;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inBg = 0, inFg = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
      let inside = 1;
      if (radius > 0) { const cx = Math.min(Math.max(u, radius), 1 - radius), cy = Math.min(Math.max(v, radius), 1 - radius); inside = Math.hypot(u - cx, v - cy) <= radius ? 1 : 0; }
      if (bg === null) inside = 0;
      inBg += inside;
      if (segs.some((s) => distSeg(u, v, s) <= sw)) inFg++;
    }
    const n = SS * SS, i = (y * size + x) * 4;
    const fa = inFg / n, ba = inBg / n;
    const outA = fa + ba * (1 - fa);
    for (let c = 0; c < 3; c++) {
      const f = fg[c], b = bg ? bg[c] : 0;
      buf[i + c] = outA ? Math.round((f * fa + b * ba * (1 - fa)) / outA) : 0;
    }
    buf[i + 3] = Math.round(outA * 255);
  }
  return png(size, size, buf);
}
const burgundy = [0x59, 0x1d, 0x27], cream = [0xf6, 0xf1, 0xe7];
const out = new URL("../public/icons/", import.meta.url);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(new URL("icon-192.png", out), render(192, { bg: burgundy, fg: cream, scale: 1.25, radius: 0.22 }));
fs.writeFileSync(new URL("icon-512.png", out), render(512, { bg: burgundy, fg: cream, scale: 1.25, radius: 0.22 }));
fs.writeFileSync(new URL("maskable-512.png", out), render(512, { bg: burgundy, fg: cream, scale: 1.0, radius: 0 }));
fs.writeFileSync(new URL("badge-96.png", out), render(96, { bg: null, fg: [255, 255, 255], scale: 1.6, radius: 0 }));
console.log("ícones gerados");
