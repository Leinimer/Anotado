const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create PNG buffer from RGBA pixels
function createPng(width, height, getPixel) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth 8
  ihdr.writeUInt8(6, 9); // color type RGBA (6)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT (Pixel data with filter byte per scanline)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData.writeUInt8(0, offset++); // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      rawData.writeUInt8(r, offset++);
      rawData.writeUInt8(g, offset++);
      rawData.writeUInt8(b, offset++);
      rawData.writeUInt8(a, offset++);
    }
  }

  const compressedData = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);

  const crcVal = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal >>> 0, 0);

  return Buffer.concat([len, body, crcBuf]);
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
}

// Brand Colors:
// Background Canvas: #fbf9f4 -> [251, 249, 244]
// Brand Brown: #68594d -> [104, 89, 77]
// Accent Cream: #f4dfcb -> [244, 223, 203]
// White: #ffffff -> [255, 255, 255]

// Draw Serif Letter 'A' and '!'
function renderBrandIcon(isMaskable) {
  return (x, y, w, h) => {
    const nx = x / w;
    const ny = y / h;

    if (isMaskable) {
      // Solid brand background with subtle warm gradient
      const bgR = Math.round(104 + (ny - 0.5) * 8);
      const bgG = Math.round(89 + (ny - 0.5) * 8);
      const bgB = Math.round(77 + (ny - 0.5) * 8);

      // Check letter glyph coordinates
      const inA = isInsideLetterA(nx, ny, 0.46, 0.50, 0.44);
      const inExclamation = isInsideExclamation(nx, ny, 0.72, 0.50, 0.44);

      if (inA || inExclamation) {
        return [255, 255, 255, 255];
      }
      return [bgR, bgG, bgB, 255];
    } else {
      // Rounded Card on canvas
      const cornerRadius = 0.22;
      const margin = 0.06;
      const cardLeft = margin;
      const cardRight = 1 - margin;
      const cardTop = margin;
      const cardBottom = 1 - margin;

      const inCard = isInsideRoundedRect(nx, ny, cardLeft, cardTop, cardRight - cardLeft, cardBottom - cardTop, cornerRadius);

      if (inCard) {
        const inA = isInsideLetterA(nx, ny, 0.45, 0.50, 0.42);
        const inExclamation = isInsideExclamation(nx, ny, 0.71, 0.50, 0.42);

        if (inA || inExclamation) {
          return [255, 255, 255, 255];
        }
        return [104, 89, 77, 255];
      } else {
        // Transparent outside rounded card
        return [0, 0, 0, 0];
      }
    }
  };
}

function isInsideRoundedRect(x, y, rx, ry, rw, rh, rad) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const cx = x < rx + rad ? rx + rad : (x > rx + rw - rad ? rx + rw - rad : x);
  const cy = y < ry + rad ? ry + rad : (y > ry + rh - rad ? ry + rh - rad : y);
  const dx = x - cx;
  const dy = y - cy;
  return (dx * dx + dy * dy) <= (rad * rad);
}

function isInsideLetterA(x, y, centerX, centerY, scale) {
  const topY = centerY - scale * 0.46;
  const bottomY = centerY + scale * 0.46;
  const barY1 = centerY + scale * 0.08;
  const barY2 = centerY + scale * 0.20;

  if (y < topY || y > bottomY) return false;

  const t = (y - topY) / (bottomY - topY); // 0 at top, 1 at bottom
  const outerHalfWidth = 0.03 + t * (scale * 0.38);
  const innerHalfWidth = -0.01 + t * (scale * 0.23);

  const dx = Math.abs(x - centerX);

  // Outer triangle boundary
  if (dx > outerHalfWidth) return false;

  // Crossbar
  if (y >= barY1 && y <= barY2 && dx <= outerHalfWidth) {
    return true;
  }

  // Inner cutout
  if (y > topY + scale * 0.22 && y < barY1 && dx < innerHalfWidth) {
    return false;
  }
  if (y > barY2 && dx < innerHalfWidth) {
    return false;
  }

  // Left & Right stems
  return true;
}

function isInsideExclamation(x, y, centerX, centerY, scale) {
  const topY = centerY - scale * 0.46;
  const stemBottomY = centerY + scale * 0.16;
  const dotTopY = centerY + scale * 0.30;
  const dotBottomY = centerY + scale * 0.46;
  const width = scale * 0.12;

  // Stem (tapered)
  if (y >= topY && y <= stemBottomY) {
    const t = (y - topY) / (stemBottomY - topY);
    const w = (width * 0.5) * (1 - t * 0.25);
    if (Math.abs(x - centerX) <= w) return true;
  }

  // Dot
  if (y >= dotTopY && y <= dotBottomY) {
    const dotCenterY = (dotTopY + dotBottomY) / 2;
    const rad = (dotBottomY - dotTopY) / 2;
    const dx = x - centerX;
    const dy = y - dotCenterY;
    if (dx * dx + dy * dy <= rad * rad) return true;
  }

  return false;
}

// Generate files
const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Generating PWA icons in /public...');

// 1. icon-192.png
const icon192 = createPng(192, 192, renderBrandIcon(false));
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), icon192);

// 2. icon-512.png
const icon512 = createPng(512, 512, renderBrandIcon(false));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), icon512);

// 3. icon-maskable-192.png
const iconMaskable192 = createPng(192, 192, renderBrandIcon(true));
fs.writeFileSync(path.join(publicDir, 'icon-maskable-192.png'), iconMaskable192);

// 4. icon-maskable-512.png
const iconMaskable512 = createPng(512, 512, renderBrandIcon(true));
fs.writeFileSync(path.join(publicDir, 'icon-maskable-512.png'), iconMaskable512);

// 5. apple-touch-icon.png (180x180)
const appleTouchIcon = createPng(180, 180, renderBrandIcon(true));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouchIcon);

// 6. SVG Icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#68594d"/>
  <path d="M170 380 L235 150 L277 150 L342 380 L298 380 L283 325 L229 325 L214 380 Z M240 285 L272 285 L256 220 Z" fill="#ffffff"/>
  <path d="M370 150 L395 150 L388 300 L377 300 Z" fill="#ffffff"/>
  <circle cx="382.5" cy="360" r="15" fill="#ffffff"/>
</svg>`;
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svgContent);
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent);

console.log('Icons generated successfully!');
