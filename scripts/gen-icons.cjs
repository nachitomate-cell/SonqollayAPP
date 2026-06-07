#!/usr/bin/env node
// Genera íconos PWA cuadrados (PNG) a partir de logo.png usando solo Node + zlib.
// No requiere ImageMagick/sharp/PIL. Reproducible: `node scripts/gen-icons.cjs`.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'logo.png');

// ---- CRC32 (para chunks PNG) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Decodificar PNG (colorType 2/6, bitDepth 8, sin interlace) ----
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('no es PNG');
  let off = 8, width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('PNG entrelazado no soportado');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`formato no soportado: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  // Salida siempre RGBA para uniformar el composite
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    raw.copy(cur, 0, p, p + stride); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      cur[i] = v;
    }
    cur.copy(prev);
    for (let x = 0; x < width; x++) {
      const si = x * channels, di = (y * width + x) * 4;
      out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2];
      out[di + 3] = channels === 4 ? cur[si + 3] : 255;
    }
  }
  return { width, height, data: out }; // RGBA
}

// ---- Codificar PNG RGBA (colorType 6) ----
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Helpers de imagen (todo en RGBA) ----
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i+1], img.data[i+2], img.data[i+3]]; };

// Pega src (RGBA) sobre dst (RGBA) en (dx,dy) escalando a (dw,dh) con promedio de área.
function drawScaled(dst, src, dx, dy, dw, dh) {
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * src.height / dh), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * src.height / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * src.width / dw), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * src.width / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const [pr, pg, pb, pa] = px(src, sx, sy); r += pr; g += pg; b += pb; a += pa; n++;
      }
      const di = ((dy + y) * dst.width + (dx + x)) * 4;
      dst.data[di] = r / n; dst.data[di+1] = g / n; dst.data[di+2] = b / n; dst.data[di+3] = a / n;
    }
  }
}

function solid(width, height, [r, g, b, a = 255]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i*4]=r; data[i*4+1]=g; data[i*4+2]=b; data[i*4+3]=a; }
  return { width, height, data };
}

// Redondea esquinas poniendo alpha=0 fuera del radio (para íconos purpose "any").
function roundCorners(img, radius) {
  const { width: w, height: h } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let cx = -1, cy = -1;
    if (x < radius && y < radius) { cx = radius; cy = radius; }
    else if (x >= w - radius && y < radius) { cx = w - radius; cy = radius; }
    else if (x < radius && y >= h - radius) { cx = radius; cy = h - radius; }
    else if (x >= w - radius && y >= h - radius) { cx = w - radius; cy = h - radius; }
    if (cx >= 0) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > radius) img.data[(y * w + x) * 4 + 3] = 0;
      else if (d > radius - 1.5) img.data[(y * w + x) * 4 + 3] = Math.round(255 * (radius - d) / 1.5);
    }
  }
  return img;
}

// ---- Main ----
const logo = decodePNG(fs.readFileSync(SRC));
console.log(`logo.png decodificado: ${logo.width}x${logo.height}`);

// Color de fondo = promedio de las 4 esquinas (la mayoría de logos tienen fondo uniforme)
const corners = [px(logo,0,0), px(logo,logo.width-1,0), px(logo,0,logo.height-1), px(logo,logo.width-1,logo.height-1)];
const bg = [0,1,2].map(c => Math.round(corners.reduce((s,p)=>s+p[c],0)/4));
bg.push(255);
console.log('fondo (esquinas):', bg);

// 1) Lienzo cuadrado "contain": logo centrado sobre fondo de esquinas.
const side = Math.max(logo.width, logo.height);
const squareAny = solid(side, side, bg);
drawScaled(squareAny, logo, Math.floor((side - logo.width) / 2), Math.floor((side - logo.height) / 2), logo.width, logo.height);

// 2) Variante maskable: logo al 78% (zona segura) sobre fondo sólido a sangre.
const squareMask = solid(side, side, bg);
const mScale = 0.78, mw = Math.round(logo.width * mScale), mh = Math.round(logo.height * mScale);
drawScaled(squareMask, logo, Math.floor((side - mw) / 2), Math.floor((side - mh) / 2), mw, mh);

function emit(name, srcSquare, size, { rounded = false } = {}) {
  const out = solid(size, size, [0, 0, 0, 0]);
  drawScaled(out, srcSquare, 0, 0, size, size);
  if (rounded) roundCorners(out, Math.round(size * 0.22)); // esquinas estilo iOS/Android
  fs.writeFileSync(path.join(ROOT, name), encodePNG(size, size, out.data));
  console.log('escrito', name, `${size}x${size}`);
}

emit('icon-192.png', squareAny, 192, { rounded: true });
emit('icon-512.png', squareAny, 512, { rounded: true });
emit('icon-maskable-512.png', squareMask, 512); // a sangre, sin redondear
emit('apple-touch-icon.png', squareAny, 180);   // iOS recorta a su gusto; sin alpha extra
