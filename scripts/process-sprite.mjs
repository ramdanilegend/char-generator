#!/usr/bin/env node
/**
 * process-sprite.mjs
 *
 * Converts a Pokemon trainer sprite PNG into layered sprite sheets for
 * the char-generator animation engine.
 *
 * v6 — Smooth whole-tile animations, no body splitting
 *
 * Key principle: NEVER slice the character into disconnected regions.
 * All animations work by shifting the ENTIRE tile or large connected
 * regions with gradient blending at seams.
 *
 * Tile size: 128×192 pixels (rendered at 2× = 256×384 on screen)
 *
 * Usage:
 *   node scripts/process-sprite.mjs
 */

import sharp from 'sharp';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, 'source-sprite.png');
const OUT_DIR = path.join(__dirname, '../public/sprites');

// --- Tile dimensions ---
const TILE_W = 128;
const TILE_H = 192;

// --- Animation definitions ---
const ANIMATIONS = [
  { name: 'idle', frames: 12, row: 0, duration: 80 },
  { name: 'walk', frames: 16, row: 1, duration: 50 },
  { name: 'wave', frames: 20, row: 2, duration: 40 },
  { name: 'shrug', frames: 16, row: 3, duration: 50 },
  { name: 'nod', frames: 12, row: 4, duration: 50 },
  { name: 'shake-head', frames: 16, row: 5, duration: 40 },
  { name: 'point', frames: 12, row: 6, duration: 60 },
];
const MAX_COLS = 20;
const NUM_ROWS = ANIMATIONS.length;

const MOUTH_SHAPES = [
  'rest', 'open-a', 'mid-e', 'rounded-o', 'neutral-small', 'bilabial-m', 'labiodental-f'
];
const EYE_STATES = ['open', 'close-1', 'close-2', 'close-3', 'close-4', 'closed', 'happy', 'surprised'];

// ---------------------------------------------------------------------------
// PNG writer
// ---------------------------------------------------------------------------
function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
}
const CRC_TABLE = makeCRCTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}
function encodePNG(w, h, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      raw.set(pixels.slice(src, src + 4), y * (1 + w * 4) + 1 + x * 4);
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// PixelCanvas
// ---------------------------------------------------------------------------
class PixelCanvas {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4); }
  clone() { const c = new PixelCanvas(this.w, this.h); c.data.set(this.data); return c; }
  get(x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return [0, 0, 0, 0];
    const i = (Math.round(y) * this.w + Math.round(x)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  getBilinear(x, y) {
    const x1 = Math.floor(x), x2 = x1 + 1;
    const y1 = Math.floor(y), y2 = y1 + 1;
    const fx = x - x1, fy = y - y1;
    const p11 = this.get(x1, y1);
    const p21 = this.get(x2, y1);
    const p12 = this.get(x1, y2);
    const p22 = this.get(x2, y2);
    const interp = (c11, c21, c12, c22) => {
       const top = c11 * (1 - fx) + c21 * fx;
       const bot = c12 * (1 - fx) + c22 * fx;
       return top * (1 - fy) + bot * fy;
    };
    return [
       Math.round(interp(p11[0], p21[0], p12[0], p22[0])),
       Math.round(interp(p11[1], p21[1], p12[1], p22[1])),
       Math.round(interp(p11[2], p21[2], p12[2], p22[2])),
       Math.round(interp(p11[3], p21[3], p12[3], p22[3]))
    ];
  }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  fillRect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color);
  }
  blit(src, sx, sy, sw, sh, dx, dy) {
    for (let row = 0; row < sh; row++)
      for (let col = 0; col < sw; col++)
        this.set(dx + col, dy + row, src.get(sx + col, sy + row));
  }
  /** Alpha-composite src pixel onto dst */
  blitAlpha(src, sx, sy, sw, sh, dx, dy) {
    for (let row = 0; row < sh; row++)
      for (let col = 0; col < sw; col++) {
        const sp = src.get(sx + col, sy + row);
        if (sp[3] < 5) continue;
        const dp = this.get(dx + col, dy + row);
        const sa = sp[3] / 255;
        const da = dp[3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa < 0.001) continue;
        this.set(dx + col, dy + row, [
          Math.round((sp[0] * sa + dp[0] * da * (1 - sa)) / oa),
          Math.round((sp[1] * sa + dp[1] * da * (1 - sa)) / oa),
          Math.round((sp[2] * sa + dp[2] * da * (1 - sa)) / oa),
          Math.round(oa * 255),
        ]);
      }
  }
  /** Filled ellipse using midpoint algorithm */
  fillEllipse(cx, cy, rx, ry, color) {
    if (rx <= 0 || ry <= 0) return;
    for (let dy = -ry; dy <= ry; dy++) {
      const halfW = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
      for (let dx = -halfW; dx <= halfW; dx++) {
        this.set(cx + dx, cy + dy, color);
      }
    }
  }
  /** Stroke (outline only) ellipse */
  strokeEllipse(cx, cy, rx, ry, color) {
    if (rx <= 0 || ry <= 0) return;
    const steps = Math.max(60, Math.round(Math.PI * (rx + ry)));
    for (let i = 0; i < steps; i++) {
      const angle = (2 * Math.PI * i) / steps;
      const x = Math.round(cx + rx * Math.cos(angle));
      const y = Math.round(cy + ry * Math.sin(angle));
      this.set(x, y, color);
    }
  }
  /** Draw an arc (portion of ellipse outline) from startAngle to endAngle (radians) */
  drawArc(cx, cy, rx, ry, startAngle, endAngle, color, thickness = 1) {
    const steps = Math.max(40, Math.round(Math.PI * (rx + ry)));
    const range = endAngle - startAngle;
    for (let i = 0; i <= steps; i++) {
      const angle = startAngle + (range * i) / steps;
      const bx = cx + rx * Math.cos(angle);
      const by = cy + ry * Math.sin(angle);
      for (let t = 0; t < thickness; t++) {
        this.set(Math.round(bx), Math.round(by + t), color);
      }
    }
  }
  /** Filled arc sector (pie slice) */
  fillArcSector(cx, cy, rx, ry, startAngle, endAngle, color) {
    const steps = Math.max(40, Math.round(Math.PI * (rx + ry)));
    const range = endAngle - startAngle;
    for (let i = 0; i <= steps; i++) {
      const angle = startAngle + (range * i) / steps;
      const ex = Math.round(cx + rx * Math.cos(angle));
      const ey = Math.round(cy + ry * Math.sin(angle));
      // Draw line from center to edge
      const dx = ex - cx, dy = ey - cy;
      const len = Math.max(Math.abs(dx), Math.abs(dy), 1);
      for (let j = 0; j <= len; j++) {
        const px = Math.round(cx + (dx * j) / len);
        const py = Math.round(cy + (dy * j) / len);
        this.set(px, py, color);
      }
    }
  }
  isTransparent(x, y) { return this.get(x, y)[3] < 20; }
  toPNG() { return encodePNG(this.w, this.h, this.data); }
}

// ---------------------------------------------------------------------------
// Background / skin detection
// ---------------------------------------------------------------------------
function isBackground(r, g, b, a) {
  if (a < 20) return true;
  return r > 230 && g > 230 && b > 230;
}
function isSkin(r, g, b, a) {
  if (a < 100) return false;
  return r > 170 && g > 110 && b > 70 && r > g && r > b && (r - b) > 30 && g < 230;
}

// ---------------------------------------------------------------------------
// Analyze source at native resolution
// ---------------------------------------------------------------------------
async function analyzeSource() {
  console.log('Loading:', SOURCE);
  const rawBuf = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = rawBuf;
  const { width, height } = info;

  // Remove white/light bg
  for (let i = 0; i < data.length; i += 4)
    if (isBackground(data[i], data[i + 1], data[i + 2], data[i + 3])) data[i + 3] = 0;

  // Bounding box
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
  const cropW = maxX - minX + 1, cropH = maxY - minY + 1;

  const getPixel = (rx, ry) => {
    const nx = minX + rx, ny = minY + ry;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) return [0, 0, 0, 0];
    const i = (ny * width + nx) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  // Scale mapping: fit character into tile
  const scale = Math.min(TILE_W / cropW, TILE_H / cropH);
  const scaledW = Math.round(cropW * scale);
  const scaledH = Math.round(cropH * scale);
  const offsetX = Math.floor((TILE_W - scaledW) / 2);
  const offsetY = Math.floor((TILE_H - scaledH) / 2);
  const mapX = (rx) => Math.max(0, Math.min(TILE_W - 1, Math.round(rx * scale) + offsetX));
  const mapY = (ry) => Math.max(0, Math.min(TILE_H - 1, Math.round(ry * scale) + offsetY));

  console.log(`  Native: ${cropW}×${cropH}  Scale: ${scale.toFixed(4)}  Tile: ${scaledW}×${scaledH} offset:(${offsetX},${offsetY})`);

  // --- Face detection via center-column skin blocks ---
  const cx = Math.round(cropW / 2);
  let skinBlocks = [], inBlock = false, bStart = -1, bEnd = -1;
  for (let ry = 0; ry < Math.round(cropH * 0.30); ry++) {
    let sc = 0;
    for (let dx = -20; dx <= 20; dx++) {
      const [r, g, b, a] = getPixel(cx + dx, ry);
      if (isSkin(r, g, b, a)) sc++;
    }
    if (sc >= 3) { if (!inBlock) { bStart = ry; inBlock = true; } bEnd = ry; }
    else { if (inBlock) { skinBlocks.push({ start: bStart, end: bEnd }); inBlock = false; } }
  }
  if (inBlock) skinBlocks.push({ start: bStart, end: bEnd });

  const faceBlock = skinBlocks.find(b => (b.end - b.start) >= 8) || skinBlocks[0];
  if (!faceBlock) { console.error('No face found!'); process.exit(1); }

  // Refine face bounds by skin width
  let maxFaceW = 0, skinWidths = [];
  for (let ry = faceBlock.start; ry <= faceBlock.end; ry++) {
    let lm = cropW, rm = 0;
    for (let rx = Math.round(cropW * 0.15); rx <= Math.round(cropW * 0.85); rx++) {
      const [r, g, b, a] = getPixel(rx, ry);
      if (isSkin(r, g, b, a)) { if (rx < lm) lm = rx; if (rx > rm) rm = rx; }
    }
    const w = rm > lm ? rm - lm + 1 : 0;
    skinWidths.push({ ry, w, left: lm, right: rm });
    if (w > maxFaceW) maxFaceW = w;
  }
  const wideRows = skinWidths.filter(r => r.w >= maxFaceW * 0.50);
  const faceTopY = wideRows[0]?.ry ?? faceBlock.start;
  const faceBottomY = wideRows[wideRows.length - 1]?.ry ?? faceBlock.end;
  const widestRow = skinWidths.reduce((a, b) => a.w > b.w ? a : b);
  const faceLeftX = widestRow.left;
  const faceRightX = widestRow.right;
  const faceW = faceRightX - faceLeftX + 1;
  const faceH = faceBottomY - faceTopY + 1;
  const faceCenterX = Math.round((faceLeftX + faceRightX) / 2);

  console.log(`  Face: x=${faceLeftX}-${faceRightX} y=${faceTopY}-${faceBottomY} (${faceW}×${faceH})`);

  // --- Eye detection ---
  // Search within the refined face region (top 70% of face height) to avoid
  // picking up mouth/chin pixels as eye candidates.
  const faceBlockH = faceBlock.end - faceBlock.start;
  const eyeSearchTop = faceTopY;
  const eyeSearchBottom = Math.min(
    Math.round(cropH * 0.55),                  // never search past 55% of sprite
    faceTopY + Math.round(faceH * 0.70)        // top 70% of detected face
  );

  function isWhitish(r, g, b, a) {
    return a > 100 && r > 200 && g > 200 && b > 200;
  }

  // Use ±2 px center dead zone (was ±5) so small pixel-art sprites aren't excluded
  const CENTER_DEAD = 2;

  let leftEyeWhite = [], rightEyeWhite = [];
  for (let ry = eyeSearchTop; ry <= eyeSearchBottom; ry++)
    for (let rx = faceLeftX; rx <= faceRightX; rx++) {
      const [r, g, b, a] = getPixel(rx, ry);
      if (isWhitish(r, g, b, a)) {
        if (rx < faceCenterX - CENTER_DEAD) leftEyeWhite.push({ x: rx, y: ry });
        else if (rx > faceCenterX + CENTER_DEAD) rightEyeWhite.push({ x: rx, y: ry });
      }
    }

  let eyeLCX, eyeLCY, eyeRCX, eyeRCY;

  // Lower threshold from 20 → 3 so sparse white pixels (small sprites) still qualify
  if (leftEyeWhite.length > 3 || rightEyeWhite.length > 3) {
    if (leftEyeWhite.length > 0) {
      eyeLCX = Math.round(leftEyeWhite.reduce((s, p) => s + p.x, 0) / leftEyeWhite.length);
      eyeLCY = Math.round(leftEyeWhite.reduce((s, p) => s + p.y, 0) / leftEyeWhite.length);
    } else {
      eyeLCX = Math.round(faceLeftX + faceW * 0.25);
      eyeLCY = Math.round(faceTopY + faceH * 0.2);
    }
    if (rightEyeWhite.length > 0) {
      eyeRCX = Math.round(rightEyeWhite.reduce((s, p) => s + p.x, 0) / rightEyeWhite.length);
      eyeRCY = Math.round(rightEyeWhite.reduce((s, p) => s + p.y, 0) / rightEyeWhite.length);
    } else {
      eyeRCX = Math.round(faceLeftX + faceW * 0.70);
      eyeRCY = Math.round(faceTopY + faceH * 0.2);
    }
    console.log(`  Eyes (white clusters): left=(${eyeLCX},${eyeLCY})[${leftEyeWhite.length}px] right=(${eyeRCX},${eyeRCY})[${rightEyeWhite.length}px]`);
  } else {
    let leftDark = [], rightDark = [];
    for (let ry = eyeSearchTop; ry <= eyeSearchBottom; ry++)
      for (let rx = faceLeftX; rx <= faceRightX; rx++) {
        const [r, g, b, a] = getPixel(rx, ry);
        if (a < 100) continue;
        if (r < 80 && g < 80 && b < 80) {
          if (rx < faceCenterX - CENTER_DEAD) leftDark.push({ x: rx, y: ry });
          else if (rx > faceCenterX + CENTER_DEAD) rightDark.push({ x: rx, y: ry });
        }
      }

    if (leftDark.length > 0) {
      eyeLCX = Math.round(leftDark.reduce((s, p) => s + p.x, 0) / leftDark.length);
      eyeLCY = Math.round(leftDark.reduce((s, p) => s + p.y, 0) / leftDark.length);
    } else {
      eyeLCX = Math.round(faceLeftX + faceW * 0.25);
      eyeLCY = Math.round(faceTopY + faceH * 0.2);
    }
    if (rightDark.length > 0) {
      eyeRCX = Math.round(rightDark.reduce((s, p) => s + p.x, 0) / rightDark.length);
      eyeRCY = Math.round(rightDark.reduce((s, p) => s + p.y, 0) / rightDark.length);
    } else {
      eyeRCX = Math.round(faceLeftX + faceW * 0.70);
      eyeRCY = Math.round(faceTopY + faceH * 0.2);
    }
    console.log(`  Eyes (dark clusters): left=(${eyeLCX},${eyeLCY}) right=(${eyeRCX},${eyeRCY})`);
  }

  // --- Compute actual eye bounding boxes ---
  // Filter white/dark pixel clusters to only include pixels near the eye center,
  // then compute tight bounding box. This avoids capturing hat/hair highlights.
  function computeEyeBBox(centerX, centerY, eyePixels) {
    // Max reasonable eye size: ~20% of face width, ~30% of face height
    const maxEyeHalfW = Math.round(faceW * 0.10);
    const maxEyeHalfH = Math.round(faceH * 0.15);

    if (eyePixels && eyePixels.length > 2) {
      // Filter to pixels within reasonable distance of the eye center
      const nearby = eyePixels.filter(p => {
        const dx = Math.abs(p.x - centerX);
        const dy = Math.abs(p.y - centerY);
        return dx <= maxEyeHalfW && dy <= maxEyeHalfH;
      });

      if (nearby.length > 2) {
        let minEX = Infinity, maxEX = -Infinity, minEY = Infinity, maxEY = -Infinity;
        for (const p of nearby) {
          if (p.x < minEX) minEX = p.x;
          if (p.x > maxEX) maxEX = p.x;
          if (p.y < minEY) minEY = p.y;
          if (p.y > maxEY) maxEY = p.y;
        }
        // Add small padding
        const pad = 2;
        minEX = Math.max(faceLeftX, minEX - pad);
        maxEX = Math.min(faceRightX, maxEX + pad);
        minEY = Math.max(faceTopY, minEY - pad);
        maxEY = Math.min(faceBottomY, maxEY + pad);
        return { minX: minEX, maxX: maxEX, minY: minEY, maxY: maxEY,
                 w: maxEX - minEX + 1, h: maxEY - minEY + 1 };
      }
    }
    // Fallback: estimate from face proportions
    const estW = Math.round(faceW * 0.18);
    const estH = Math.round(faceH * 0.30);
    return {
      minX: centerX - Math.floor(estW / 2), maxX: centerX + Math.ceil(estW / 2),
      minY: centerY - Math.floor(estH / 2), maxY: centerY + Math.ceil(estH / 2),
      w: estW, h: estH
    };
  }

  const leftEyeBBox = computeEyeBBox(eyeLCX, eyeLCY, leftEyeWhite.length > 0 ? leftEyeWhite : null);
  const rightEyeBBox = computeEyeBBox(eyeRCX, eyeRCY, rightEyeWhite.length > 0 ? rightEyeWhite : null);
  console.log(`  Left eye bbox: (${leftEyeBBox.minX},${leftEyeBBox.minY})-(${leftEyeBBox.maxX},${leftEyeBBox.maxY}) ${leftEyeBBox.w}×${leftEyeBBox.h}`);
  console.log(`  Right eye bbox: (${rightEyeBBox.minX},${rightEyeBBox.minY})-(${rightEyeBBox.maxX},${rightEyeBBox.maxY}) ${rightEyeBBox.w}×${rightEyeBBox.h}`);

  // --- Detect iris and outline colors from the eye region ---
  let irisR = 50, irisG = 80, irisB = 180, irisCnt = 0;
  let outR = 30, outG = 30, outB = 30, outCnt = 0;
  for (const bbox of [leftEyeBBox, rightEyeBBox]) {
    for (let ry = bbox.minY; ry <= bbox.maxY; ry++) {
      for (let rx = bbox.minX; rx <= bbox.maxX; rx++) {
        const [r, g, b, a] = getPixel(rx, ry);
        if (a < 100) continue;
        if (isSkin(r, g, b, a) || isBackground(r, g, b, a)) continue;
        // Dark outlines (very dark pixels)
        if (r < 60 && g < 60 && b < 60) {
          outR += r; outG += g; outB += b; outCnt++;
        }
        // Iris/pupil: colored, not white, not skin
        else if (!isWhitish(r, g, b, a) && (r < 170 || g < 170 || b < 170)) {
          irisR += r; irisG += g; irisB += b; irisCnt++;
        }
      }
    }
  }
  const irisColor = irisCnt > 0
    ? [Math.round(irisR / irisCnt), Math.round(irisG / irisCnt), Math.round(irisB / irisCnt), 255]
    : [50, 80, 180, 255];
  const outlineColor = outCnt > 0
    ? [Math.round(outR / outCnt), Math.round(outG / outCnt), Math.round(outB / outCnt), 255]
    : [30, 30, 30, 255];
  console.log(`  Iris color: rgb(${irisColor[0]},${irisColor[1]},${irisColor[2]}) from ${irisCnt} px`);
  console.log(`  Outline color: rgb(${outlineColor[0]},${outlineColor[1]},${outlineColor[2]}) from ${outCnt} px`);

  // --- Mouth detection ---
  // Search below the eye center, up to (and slightly past) the bottom of the
  // detected face region. The old cap of cropH*0.25 could make the window
  // empty when the face sits high in the sprite.
  const eyeCenterYNative = Math.round((eyeLCY + eyeRCY) / 2);
  const mouthSearchTop = eyeCenterYNative + 3;
  const mouthSearchBottom = Math.min(
    faceBottomY + Math.round(faceH * 0.25),   // allow slightly below face bottom
    Math.round(cropH * 0.60)                   // generous absolute cap
  );
  const insetX = Math.round(faceW * 0.15);
  let bestRow = -1, bestScore = 0;
  for (let ry = mouthSearchTop; ry <= mouthSearchBottom; ry++) {
    let dc = 0;
    for (let rx = faceLeftX + insetX; rx <= faceRightX - insetX; rx++) {
      const [r, g, b, a] = getPixel(rx, ry);
      if (a > 100 && r < 100 && g < 80) dc++;
    }
    if (dc >= 2 && dc < 20 && dc > bestScore) { bestScore = dc; bestRow = ry; }
  }
  const mouthCY = bestRow >= 0 ? bestRow : Math.round(eyeCenterYNative + faceBlockH * 0.15);
  console.log(`  Mouth center: y=${mouthCY} (searched ${mouthSearchTop}-${mouthSearchBottom})`);

  // --- Skin color ---
  const faceMidY = Math.round((faceTopY + faceBottomY) / 2);
  let sr = 0, sg = 0, sb = 0, sc = 0;
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++) {
      const [r, g, b, a] = getPixel(faceCenterX + dx, faceMidY + dy);
      if (isSkin(r, g, b, a)) { sr += r; sg += g; sb += b; sc++; }
    }
  const skinColor = sc > 0 ? [Math.round(sr / sc), Math.round(sg / sc), Math.round(sb / sc), 255] : [200, 150, 110, 255];

  // --- Map to tile coords ---
  // Use the ACTUAL detected eye bounding boxes for sizing instead of guessing
  const avgEyeW = Math.round((leftEyeBBox.w + rightEyeBBox.w) / 2);
  const avgEyeH = Math.round((leftEyeBBox.h + rightEyeBBox.h) / 2);

  const eyeCY = Math.round((eyeLCY + eyeRCY) / 2);
  const tileEyeLX = mapX(eyeLCX);
  const tileEyeRX = mapX(eyeRCX);
  const tileEyeY = mapY(eyeCY);
  const tileMouthCX = mapX(faceCenterX);
  const tileMouthCY = mapY(mouthCY);

  // Eye sizing: use actual detected dimensions scaled to tile, with padding
  const tileEyeW = Math.max(6, Math.round(avgEyeW * scale) + 4);
  const tileEyeH = Math.max(5, Math.round(avgEyeH * scale) + 4);

  // Mouth sizing: substantially larger for visible phoneme shapes
  const tileMouthW = Math.max(8, Math.round(faceW * 0.35 * scale));
  const tileMouthH = Math.max(6, Math.round(faceH * 0.18 * scale));

  const headBottom = mapY(faceBlock.end + Math.round(faceH * 0.5));
  const charTop = offsetY;
  const charBottom = offsetY + scaledH - 1;
  const charLeft = offsetX;
  const charRight = offsetX + scaledW - 1;
  const charCenterX = Math.round(offsetX + scaledW / 2);

  const bodyMidY = mapY(Math.round(cropH * 0.45));
  const waistY = mapY(Math.round(cropH * 0.55));
  const legTop = waistY;

  const face = {
    eyeY: tileEyeY - Math.floor(tileEyeH / 2),
    eyeLX: tileEyeLX - Math.floor(tileEyeW / 2),
    eyeRX: tileEyeRX - Math.floor(tileEyeW / 2),
    eyeW: tileEyeW, eyeH: tileEyeH,
    mouthX: tileMouthCX - Math.floor(tileMouthW / 2),
    mouthY: tileMouthCY - Math.floor(tileMouthH / 2),
    mouthW: tileMouthW, mouthH: tileMouthH,
    skinColor,
    irisColor, outlineColor,
    headBottom, bodyMidY, waistY, legTop,
    charTop, charBottom, charLeft, charRight, charCenterX,
  };

  face.eyeY = Math.max(0, face.eyeY);
  face.eyeLX = Math.max(0, face.eyeLX);
  face.eyeRX = Math.max(0, face.eyeRX);
  face.mouthX = Math.max(0, face.mouthX);
  face.mouthY = Math.max(0, face.mouthY);

  console.log(`\n  Tile coords:`);
  console.log(`    Eyes: left=(${face.eyeLX},${face.eyeY}) right=(${face.eyeRX},${face.eyeY}) ${face.eyeW}×${face.eyeH}`);
  console.log(`    Mouth: (${face.mouthX},${face.mouthY}) ${face.mouthW}×${face.mouthH}`);
  console.log(`    Head bottom: ${headBottom}  Waist: ${waistY}  Char: ${charTop}-${charBottom}`);

  return { nativeBBox: { minX, minY, cropW, cropH }, data, width, height, face };
}

// ---------------------------------------------------------------------------
// Create scaled tile (face intact — no clearing)
// ---------------------------------------------------------------------------
async function createScaledTile(analysis) {
  const { nativeBBox, data, width, height } = analysis;
  const { minX, minY, cropW, cropH } = nativeBBox;

  const croppedBuf = await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .resize(TILE_W, TILE_H, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  const canvas = new PixelCanvas(TILE_W, TILE_H);
  for (let i = 0; i < croppedBuf.length; i += 4) {
    const x = (i / 4) % TILE_W;
    const y = Math.floor((i / 4) / TILE_W);
    canvas.set(x, y, [croppedBuf[i], croppedBuf[i + 1], croppedBuf[i + 2], croppedBuf[i + 3]]);
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Animation frame generators — WHOLE-TILE approaches to prevent body splitting
// ---------------------------------------------------------------------------

/**
 * Shift the ENTIRE tile vertically. Pixels shifted off-edge are lost;
 * new rows are transparent. This keeps the character as one piece.
 */
function shiftWholeTile(baseTile, dx, dy) {
  if (dx === 0 && dy === 0) return baseTile.clone();
  const tile = new PixelCanvas(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      tile.set(x, y, baseTile.getBilinear(x - dx, y - dy));
    }
  }
  return tile;
}

/**
 * Shift the upper portion of the character (above splitY) by (dx, dy)
 * with a smooth blending zone of `blendH` pixels to prevent visible seams.
 */
function shiftUpperRegion(baseTile, face, dx, dy, blendH = 3) {
  if (dx === 0 && dy === 0) return baseTile.clone();
  const tile = new PixelCanvas(TILE_W, TILE_H);
  const splitY = face.headBottom;

  // Draw lower body (unchanged)
  for (let y = splitY; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++)
      tile.set(x, y, baseTile.get(x, y));

  // Draw upper body (shifted with subpixel precision)
  for (let y = 0; y < splitY - blendH; y++) {
    for (let x = 0; x < TILE_W; x++) {
      tile.set(x, y, baseTile.getBilinear(x - dx, y - dy));
    }
  }

  // Blend zone
  for (let y = splitY - blendH; y < splitY; y++) {
    const t = (y - (splitY - blendH)) / blendH;
    for (let x = 0; x < TILE_W; x++) {
      const shiftedPx = baseTile.getBilinear(x - dx, y - dy);
      const unshiftedPx = baseTile.get(x, y);
      const r = Math.round(shiftedPx[0] * (1 - t) + unshiftedPx[0] * t);
      const g = Math.round(shiftedPx[1] * (1 - t) + unshiftedPx[1] * t);
      const b = Math.round(shiftedPx[2] * (1 - t) + unshiftedPx[2] * t);
      const a = Math.round(shiftedPx[3] * (1 - t) + unshiftedPx[3] * t);
      tile.set(x, y, [r, g, b, a]);
    }
  }

  return tile;
}

// ---------------------------------------------------------------------------
// Eye / mouth overlays (drawn at correct tile positions)
// "open" eye and "rest" mouth = transparent (original face shows through)
// ---------------------------------------------------------------------------
// v7 — Shape-aware overlays using elliptical geometry
// Colors use detected values when available, with sensible defaults.

const WHITE = [240, 240, 235, 255];
const PUP_C = [20, 20, 25, 255];
const MOUTH_IN = [140, 50, 50, 255];
const TONGUE_C = [180, 80, 80, 255];
const TEETH_C = [245, 245, 240, 255];
const LIP_DARK = [120, 45, 45, 255];

function drawEyesOnTile(tile, face, state, baseTile) {
  if (state === 'open') return;

  const ew = face.eyeW, eh = face.eyeH;
  const OL = face.outlineColor || [30, 30, 30, 255];

  const drawOne = (ex, ey) => {
    let minEY = eh, maxEY = 0;
    let minEX = ew, maxEX = 0;
    const leftX = new Array(eh).fill(ew);
    const rightX = new Array(eh).fill(-1);

    for (let y = 0; y < eh; y++) {
      for (let x = 0; x < ew; x++) {
        const p = baseTile.get(ex + x, ey + y);
        const isSkin = Math.abs(p[0]-face.skinColor[0])<40 && Math.abs(p[1]-face.skinColor[1])<40 && Math.abs(p[2]-face.skinColor[2])<40;
        if (!isSkin && p[3] > 0) {
          if (y < minEY) minEY = y;
          if (y > maxEY) maxEY = y;
          if (x < minEX) minEX = x;
          if (x > maxEX) maxEX = x;
          if (x < leftX[y]) leftX[y] = x;
          if (x > rightX[y]) rightX[y] = x;
        }
      }
    }
    if (minEY > maxEY) { minEY = Math.floor(eh/4); maxEY = Math.floor(eh*3/4); minEX = 1; maxEX = ew-2; }
    
    let topCenter = 0, numTop = 0;
    for (let y = minEY; y < minEY + 4 && y <= maxEY; y++) {
       if (leftX[y] <= rightX[y]) {
          topCenter += (leftX[y] + rightX[y]) / 2;
          numTop++;
       }
    }
    topCenter = numTop > 0 ? topCenter / numTop : ew / 2;

    let botCenter = 0, numBot = 0;
    for (let y = maxEY; y > maxEY - 4 && y >= minEY; y--) {
       if (leftX[y] <= rightX[y]) {
          botCenter += (leftX[y] + rightX[y]) / 2;
          numBot++;
       }
    }
    botCenter = numBot > 0 ? botCenter / numBot : ew / 2;

    const slope = (maxEY > minEY) ? (botCenter - topCenter) / (maxEY - minEY) : 0;

    const actualEyeH = maxEY - minEY + 1;
    const actualEyeW = maxEX - minEX + 1;

    if (state.startsWith('close-') || state === 'closed') {
      let pct = 1.0;
      if (state.startsWith('close-')) {
        const matches = state.match(/close-(\d+)/);
        if (matches) pct = parseInt(matches[1]) / 4.0;
      }

      const thickness = Math.max(1, Math.round(actualEyeH * 0.35));
      const maxDrop = Math.max(1, maxEY - minEY - thickness + 1);
      const drop = Math.round(maxDrop * pct);
      const shiftX = drop * slope;

      for (let y = minEY; y <= maxEY; y++) {
        let lx = minEX, rx = maxEX;
        if (leftX[y] <= rightX[y]) {
           lx = leftX[y];
           rx = rightX[y];
        } else {
           const dy = y - minEY;
           lx = minEX + dy * slope;
           rx = maxEX + dy * slope;
        }
        
        lx = Math.floor(lx) - 3;
        rx = Math.ceil(rx) + 3;

        for (let x = lx; x <= rx; x++) {
           if (y < minEY + drop + thickness) {
              let srcY = ey + y - drop;
              let srcX = ex + x - shiftX;
              
              if (srcY < ey + minEY - 1) {
                 srcY = ey + minEY - 1; 
              }
              tile.set(ex + x, ey + y, baseTile.getBilinear(srcX, srcY));
           }
        }
      }
    } else if (state === 'happy') {
      const skinTopY = Math.max(0, ey + minEY - 1);
      const midY = minEY + Math.floor(actualEyeH / 2);
      for (let y = 0; y < eh; y++) {
        for (let x = 0; x < ew; x++) {
          tile.set(ex + x, ey + y, baseTile.get(ex + x, skinTopY));
        }
      }
      for (let x = minEX; x <= maxEX; x++) {
        const dx = x - (minEX + actualEyeW/2);
        const dy = Math.abs(dx) < actualEyeW/3 ? 0 : 1; 
        tile.set(ex + x, ey + midY + dy, OL);
      }
    } else if (state === 'surprised') {
      const skinBotY = Math.min(TILE_H - 1, ey + maxEY + 1);
      for (let y = 0; y < eh; y++) {
        for (let x = 0; x < ew; x++) {
          if (y >= minEY - 1 && y <= maxEY) {
             tile.set(ex + x, ey + y, baseTile.get(ex + x, ey + y + 1));
          } else if (y === maxEY + 1) {
             tile.set(ex + x, ey + y, baseTile.get(ex + x, skinBotY));
          }
        }
      }
    }
  };

  drawOne(face.eyeLX, face.eyeY);
  drawOne(face.eyeRX, face.eyeY);
}

function drawMouthOnTile(tile, face, shape, baseTile) {
  if (shape === 'rest') return;

  const mx = face.mouthX, my = face.mouthY;
  const mw = face.mouthW, mh = face.mouthH;

  let minMY = mh, maxMY = 0;
  let minMX = mw, maxMX = 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const p = baseTile.get(mx + x, my + y);
      const isSkin = Math.abs(p[0]-face.skinColor[0])<40 && Math.abs(p[1]-face.skinColor[1])<40 && Math.abs(p[2]-face.skinColor[2])<40;
      if (!isSkin && p[3] > 0) {
        if (y < minMY) minMY = y;
        if (y > maxMY) maxMY = y;
        if (x < minMX) minMX = x;
        if (x > maxMX) maxMX = x;
      }
    }
  }
  if (minMY > maxMY) { minMY = Math.floor(mh/4); maxMY = Math.floor(mh*3/4); minMX = 2; maxMX = mw-3; }

  const actualW = maxMX - minMX + 1;
  const actualH = maxMY - minMY + 1;
  const midMY = minMY + Math.floor(actualH / 2);

  if (shape === 'open-a') {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (y < midMY) {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
        } else if (y === midMY) {
          const p = baseTile.get(mx + x, my + y);
          const isSkin = Math.abs(p[0]-face.skinColor[0])<40 && Math.abs(p[1]-face.skinColor[1])<40 && Math.abs(p[2]-face.skinColor[2])<40;
          if (x >= minMX + 1 && x <= maxMX - 1 && !isSkin) {
            tile.set(mx + x, my + y, [60, 20, 20, 255]);
          } else {
            tile.set(mx + x, my + y, p);
          }
        } else {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y - 1));
        }
      }
    }
  } else if (shape === 'mid-e') {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
         tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
      }
    }
    tile.set(mx + minMX - 1, my + midMY, baseTile.get(mx + minMX, my + midMY));
    tile.set(mx + maxMX + 1, my + midMY, baseTile.get(mx + maxMX, my + midMY));
  } else if (shape === 'rounded-o') {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (x === minMX || x === maxMX) {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + (y < midMY ? minMY-1 : maxMY+1)));
        } else if (y === midMY) {
          if (x > minMX && x < maxMX) tile.set(mx + x, my + y, [60, 20, 20, 255]);
        } else if (y > midMY) {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y - 1));
        } else {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
        }
      }
    }
  } else if (shape === 'neutral-small') {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (y > midMY && x > minMX && x < maxMX) {
           tile.set(mx + x, my + y, baseTile.get(mx + x, my + y - 1));
        } else if (y === midMY && x > minMX && x < maxMX) {
           tile.set(mx + x, my + y, [60, 20, 20, 255]);
        } else {
           tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
        }
      }
    }
  } else if (shape === 'bilabial-m') {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (y === midMY) {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
        } else if (y >= minMY && y <= maxMY) {
          const p = baseTile.get(mx + x, my + y);
          const isSkin = Math.abs(p[0]-face.skinColor[0])<40 && Math.abs(p[1]-face.skinColor[1])<40 && Math.abs(p[2]-face.skinColor[2])<40;
          if (!isSkin) {
             tile.set(mx + x, my + y, baseTile.get(mx + x, y < midMY ? my + minMY - 1 : my + maxMY + 1));
          } else {
             tile.set(mx + x, my + y, p); 
          }
        }
      }
    }
  } else if (shape === 'labiodental-f') {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (y < midMY) {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
        } else if (y === midMY && x > minMX && x < maxMX) {
          tile.set(mx + x, my + y, [245, 245, 240, 255]); 
        } else if (y > midMY && y <= maxMY + 1) {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y - 1));
        } else {
          tile.set(mx + x, my + y, baseTile.get(mx + x, my + y));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Build sprite sheets — v6: whole-tile transforms
// ---------------------------------------------------------------------------

function buildBodySheet(charCanvas, face) {
  const sheetW = MAX_COLS * TILE_W;
  const sheetH = NUM_ROWS * TILE_H;
  const sheet = new PixelCanvas(sheetW, sheetH);
  const baseTile = charCanvas.clone();

  // Collect headShifts for metadata so the engine can position eyes/mouth
  const headShifts = {};

  function interpolateArray(arr) {
    const res = [];
    for (let i = 0; i < arr.length; i++) {
      const next = arr[(i + 1) % arr.length];
      res.push(arr[i]);
      res.push(arr[i] + (next - arr[i]) / 2);
    }
    return res;
  }

  // Row 0: IDLE
  const idleBobs = Array(12).fill(0);
  headShifts['idle'] = [];
  for (let i = 0; i < 12; i++) {
    const tile = shiftWholeTile(baseTile, 0, idleBobs[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 0);
    headShifts['idle'].push({ x: 0, y: idleBobs[i] });
  }

  // Row 1: WALK
  const walkBobY = interpolateArray([0, -1, -2, -1, 0, -1, -2, -1]);
  const walkSwayX = interpolateArray([0, 1, 2, 1, 0, -1, -2, -1]);
  headShifts['walk'] = [];
  for (let i = 0; i < 16; i++) {
    const tile = shiftWholeTile(baseTile, walkSwayX[i], walkBobY[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, TILE_H);
    headShifts['walk'].push({ x: walkSwayX[i], y: walkBobY[i] });
  }

  // Row 2: WAVE
  const waveLean = interpolateArray([0, 0, -1, -1, -1, -1, -1, -1, 0, 0]);
  headShifts['wave'] = [];
  for (let i = 0; i < 20; i++) {
    const tile = shiftWholeTile(baseTile, 0, waveLean[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 2 * TILE_H);
    headShifts['wave'].push({ x: 0, y: waveLean[i] });
  }

  // Row 3: SHRUG
  const shrugShift = interpolateArray([0, -1, -2, -3, -3, -2, -1, 0]);
  headShifts['shrug'] = [];
  for (let i = 0; i < 16; i++) {
    const tile = shiftWholeTile(baseTile, 0, shrugShift[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 3 * TILE_H);
    headShifts['shrug'].push({ x: 0, y: shrugShift[i] });
  }

  // Row 4: NOD
  const nodShifts = interpolateArray([0, 2, 3, 3, 2, 0]);
  headShifts['nod'] = [];
  for (let i = 0; i < 12; i++) {
    const tile = shiftUpperRegion(baseTile, face, 0, nodShifts[i], 4);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 4 * TILE_H);
    headShifts['nod'].push({ x: 0, y: nodShifts[i] });
  }

  // Row 5: SHAKE-HEAD
  const shakeShifts = interpolateArray([0, -2, -3, -2, 0, 2, 3, 2]);
  headShifts['shake-head'] = [];
  for (let i = 0; i < 16; i++) {
    const tile = shiftUpperRegion(baseTile, face, shakeShifts[i], 0, 4);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 5 * TILE_H);
    headShifts['shake-head'].push({ x: shakeShifts[i], y: 0 });
  }

  // Row 6: POINT
  const pointLean = interpolateArray([0, -1, -1, -1, -1, 0]);
  headShifts['point'] = [];
  for (let i = 0; i < 12; i++) {
    const tile = shiftWholeTile(baseTile, 0, pointLean[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 6 * TILE_H);
    headShifts['point'].push({ x: 0, y: pointLean[i] });
  }

  return { sheet, headShifts };
}

function buildMouthSheet(face, baseTile) {
  const sheet = new PixelCanvas(MOUTH_SHAPES.length * TILE_W, TILE_H);
  for (let i = 0; i < MOUTH_SHAPES.length; i++) {
    const tile = new PixelCanvas(TILE_W, TILE_H); // Overlay
    drawMouthOnTile(tile, face, MOUTH_SHAPES[i], baseTile);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 0);
  }
  return sheet;
}

function buildEyesSheet(face, baseTile) {
  const sheet = new PixelCanvas(EYE_STATES.length * TILE_W, TILE_H);
  for (let i = 0; i < EYE_STATES.length; i++) {
    const tile = new PixelCanvas(TILE_W, TILE_H); // Overlay
    drawEyesOnTile(tile, face, EYE_STATES[i], baseTile);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 0);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// JSON metadata
// ---------------------------------------------------------------------------
function makeBodyJSON() {
  const frames = {}, animations = {};
  for (const anim of ANIMATIONS) {
    animations[anim.name] = [];
    for (let i = 0; i < anim.frames; i++) {
      const key = `${anim.name} ${i}`;
      frames[key] = {
        frame: { x: i * TILE_W, y: anim.row * TILE_H, w: TILE_W, h: TILE_H },
        spriteSourceSize: { x: 0, y: 0, w: TILE_W, h: TILE_H },
        sourceSize: { w: TILE_W, h: TILE_H },
        duration: anim.duration,
      };
      animations[anim.name].push(key);
    }
  }
  return { frames, animations, meta: { image: 'body.png', size: { w: MAX_COLS * TILE_W, h: NUM_ROWS * TILE_H }, scale: '1' } };
}

function makeMouthJSON() {
  const frames = {}, animations = {};
  MOUTH_SHAPES.forEach((shape, i) => {
    const key = `mouth-${shape} 0`;
    frames[key] = { frame: { x: i * TILE_W, y: 0, w: TILE_W, h: TILE_H }, spriteSourceSize: { x: 0, y: 0, w: TILE_W, h: TILE_H }, sourceSize: { w: TILE_W, h: TILE_H }, duration: 100 };
    animations[`mouth-${shape}`] = [key];
  });
  return { frames, animations, meta: { image: 'mouth.png', size: { w: MOUTH_SHAPES.length * TILE_W, h: TILE_H }, scale: '1' } };
}

function makeEyesJSON() {
  const frames = {}, animations = {};
  EYE_STATES.forEach((state, i) => {
    const key = `eyes-${state} 0`;
    frames[key] = { frame: { x: i * TILE_W, y: 0, w: TILE_W, h: TILE_H }, spriteSourceSize: { x: 0, y: 0, w: TILE_W, h: TILE_H }, sourceSize: { w: TILE_W, h: TILE_H }, duration: 100 };
    animations[`eyes-${state}`] = [key];
  });
  return { frames, animations, meta: { image: 'eyes.png', size: { w: EYE_STATES.length * TILE_W, h: TILE_H }, scale: '1' } };
}

function buildExpressionsSheet(face, baseTile) {
  const sheet = new PixelCanvas(MOUTH_SHAPES.length * TILE_W, EYE_STATES.length * TILE_H);
  for (let r = 0; r < EYE_STATES.length; r++) {
    for (let c = 0; c < MOUTH_SHAPES.length; c++) {
      const compositeTile = baseTile.clone();
      drawMouthOnTile(compositeTile, face, MOUTH_SHAPES[c], baseTile);
      drawEyesOnTile(compositeTile, face, EYE_STATES[r], baseTile);
      sheet.blit(compositeTile, 0, 0, TILE_W, TILE_H, c * TILE_W, r * TILE_H);
    }
  }
  return sheet;
}

function makeExpressionsJSON() {
  const frames = {}, animations = {};
  EYE_STATES.forEach((eyeState, r) => {
    MOUTH_SHAPES.forEach((mouthShape, c) => {
      const key = `face-${eyeState}-${mouthShape} 0`;
      frames[key] = { frame: { x: c * TILE_W, y: r * TILE_H, w: TILE_W, h: TILE_H }, spriteSourceSize: { x: 0, y: 0, w: TILE_W, h: TILE_H }, sourceSize: { w: TILE_W, h: TILE_H }, duration: 100 };
      animations[`face-${eyeState}-${mouthShape}`] = [key];
    });
  });
  return { frames, animations, meta: { image: 'expressions.png', size: { w: MOUTH_SHAPES.length * TILE_W, h: EYE_STATES.length * TILE_H }, scale: '1' } };
}

function writeSpriteMeta(face, headShifts) {
  fs.writeFileSync(path.join(OUT_DIR, 'sprite-meta.json'), JSON.stringify({
    tileW: TILE_W, tileH: TILE_H,
    face: {
      eyeY: face.eyeY, eyeLX: face.eyeLX, eyeRX: face.eyeRX, eyeW: face.eyeW, eyeH: face.eyeH,
      mouthY: face.mouthY, mouthX: face.mouthX, mouthW: face.mouthW, mouthH: face.mouthH
    },
    headShifts,
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (!fs.existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const analysis = await analyzeSource();
const face = analysis.face;

console.log('\nCreating scaled tile...');
const charCanvas = await createScaledTile(analysis);

console.log('Building body sheet...');
const { sheet: bodySheet, headShifts } = buildBodySheet(charCanvas, face);
fs.writeFileSync(path.join(OUT_DIR, 'body.png'), bodySheet.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'body.json'), JSON.stringify(makeBodyJSON(), null, 2));

console.log('Building mouth sheet...');
const mouthSheet = buildMouthSheet(face, charCanvas);
fs.writeFileSync(path.join(OUT_DIR, 'mouth.png'), mouthSheet.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'mouth.json'), JSON.stringify(makeMouthJSON(), null, 2));

console.log('Building eyes sheet...');
const eyesSheet = buildEyesSheet(face, charCanvas);
fs.writeFileSync(path.join(OUT_DIR, 'eyes.png'), eyesSheet.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'eyes.json'), JSON.stringify(makeEyesJSON(), null, 2));

console.log('Building full-face expressions sheet...');
const expressionsSheet = buildExpressionsSheet(face, charCanvas);
fs.writeFileSync(path.join(OUT_DIR, 'expressions.png'), expressionsSheet.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'expressions.json'), JSON.stringify(makeExpressionsJSON(), null, 2));

writeSpriteMeta(face, headShifts);

console.log('\n✓ Done! → ' + OUT_DIR);
console.log(`  Tile: ${TILE_W}×${TILE_H}px (display at 2×: ${TILE_W * 2}×${TILE_H * 2})`);
console.log(`  7 animations: idle, walk, wave, shrug, nod, shake-head, point`);
