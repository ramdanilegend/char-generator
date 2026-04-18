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
  { name: 'idle', frames: 6, row: 0, duration: 160 },
  { name: 'walk', frames: 8, row: 1, duration: 100 },
  { name: 'wave', frames: 10, row: 2, duration: 80 },
  { name: 'shrug', frames: 8, row: 3, duration: 100 },
  { name: 'nod', frames: 6, row: 4, duration: 100 },
  { name: 'shake-head', frames: 8, row: 5, duration: 80 },
  { name: 'point', frames: 6, row: 6, duration: 120 },
];
const MAX_COLS = 10;
const NUM_ROWS = ANIMATIONS.length;

const MOUTH_SHAPES = [
  'rest', 'open-a', 'mid-e', 'rounded-o', 'neutral-small', 'bilabial-m', 'labiodental-f'
];
const EYE_STATES = ['open', 'half', 'closed', 'happy', 'surprised'];

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
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
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
  const faceBlockH = faceBlock.end - faceBlock.start;
  const eyeSearchTop = faceBlock.start;
  const eyeSearchBottom = Math.min(Math.round(cropH * 0.30), faceBlock.end + Math.round(faceBlockH * 0.5));

  function isWhitish(r, g, b, a) {
    return a > 100 && r > 200 && g > 200 && b > 200;
  }

  let leftEyeWhite = [], rightEyeWhite = [];
  for (let ry = eyeSearchTop; ry <= eyeSearchBottom; ry++)
    for (let rx = faceLeftX; rx <= faceRightX; rx++) {
      const [r, g, b, a] = getPixel(rx, ry);
      if (isWhitish(r, g, b, a)) {
        if (rx < faceCenterX - 5) leftEyeWhite.push({ x: rx, y: ry });
        else if (rx > faceCenterX + 5) rightEyeWhite.push({ x: rx, y: ry });
      }
    }

  let eyeLCX, eyeLCY, eyeRCX, eyeRCY;

  if (leftEyeWhite.length > 20 || rightEyeWhite.length > 20) {
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
          if (rx < faceCenterX - 5) leftDark.push({ x: rx, y: ry });
          else if (rx > faceCenterX + 5) rightDark.push({ x: rx, y: ry });
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

  // --- Mouth detection ---
  const eyeCenterYNative = Math.round((eyeLCY + eyeRCY) / 2);
  const mouthSearchTop = eyeCenterYNative + 5;
  const mouthSearchBottom = Math.min(Math.round(cropH * 0.25), eyeSearchBottom + Math.round(faceBlockH * 0.3));
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
  const eyeCY = Math.round((eyeLCY + eyeRCY) / 2);
  const tileEyeLX = mapX(eyeLCX);
  const tileEyeRX = mapX(eyeRCX);
  const tileEyeY = mapY(eyeCY);
  const tileMouthCX = mapX(faceCenterX);
  const tileMouthCY = mapY(mouthCY);

  const tileEyeW = Math.max(3, Math.round(faceW * 0.15 * scale));
  const tileEyeH = Math.max(3, Math.round(faceH * 0.12 * scale));
  const tileMouthW = Math.max(4, Math.round(faceW * 0.25 * scale));
  const tileMouthH = Math.max(2, Math.round(faceH * 0.06 * scale));

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
  const sx = Math.round(dx);
  const sy = Math.round(dy);
  for (let y = 0; y < TILE_H; y++) {
    const fromY = y - sy;
    if (fromY < 0 || fromY >= TILE_H) continue;
    for (let x = 0; x < TILE_W; x++) {
      const fromX = x - sx;
      if (fromX < 0 || fromX >= TILE_W) continue;
      tile.set(x, y, baseTile.get(fromX, fromY));
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
  const sx = Math.round(dx);
  const sy = Math.round(dy);
  const splitY = face.headBottom;

  // Draw lower body (unchanged)
  for (let y = splitY; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++)
      tile.set(x, y, baseTile.get(x, y));

  // Draw upper body (shifted)
  for (let y = 0; y < splitY - blendH; y++) {
    const fromY = y - sy;
    for (let x = 0; x < TILE_W; x++) {
      const fromX = x - sx;
      tile.set(x, y, baseTile.get(fromX, fromY));
    }
  }

  // Blend zone: interpolate between shifted and unshifted
  for (let y = splitY - blendH; y < splitY; y++) {
    const t = (y - (splitY - blendH)) / blendH; // 0 at top of blend, 1 at splitY
    for (let x = 0; x < TILE_W; x++) {
      const fromX = x - sx;
      const fromY = y - sy;
      const shiftedPx = baseTile.get(fromX, fromY);
      const unshiftedPx = baseTile.get(x, y);
      // Blend: t=0 → shifted, t=1 → unshifted
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
const OL = [30, 30, 30, 255];
const WHITE = [240, 240, 235, 255];
const MOUTH_IN = [140, 50, 50, 255];
const EYE_W_C = [245, 245, 245, 255];
const IRIS_C = [50, 80, 180, 255];
const PUP_C = [20, 20, 25, 255];

function drawEyesOnTile(tile, face, state) {
  if (state === 'open') return; // transparent = original face shown

  const ew = face.eyeW, eh = face.eyeH;
  const drawOne = (x, y) => {
    if (state === 'half') {
      tile.fillRect(x, y, ew, eh, face.skinColor);
      const halfY = y + Math.floor(eh * 0.6);
      tile.fillRect(x, halfY, ew, eh - Math.floor(eh * 0.6), EYE_W_C);
      tile.fillRect(x, halfY, ew, 1, OL);
    } else if (state === 'closed') {
      tile.fillRect(x, y, ew, eh, face.skinColor);
      const midY = y + Math.floor(eh / 2);
      tile.fillRect(x, midY, ew, 1, OL);
      if (ew > 3) tile.fillRect(x + 1, midY + 1, ew - 2, 1, OL);
    } else if (state === 'happy') {
      tile.fillRect(x, y, ew, eh, face.skinColor);
      const midY = y + Math.floor(eh / 2);
      tile.set(x, midY, OL);
      tile.set(x + ew - 1, midY, OL);
      for (let dx = 1; dx < ew - 1; dx++) tile.set(x + dx, midY + 1, OL);
    } else if (state === 'surprised') {
      tile.fillRect(x - 1, y - 1, ew + 2, eh + 2, EYE_W_C);
      tile.fillRect(x - 1, y - 1, ew + 2, 1, OL);
      tile.fillRect(x - 1, y + eh, ew + 2, 1, OL);
      const pcx = x + Math.floor(ew / 2), pcy = y + Math.floor(eh / 2);
      tile.set(pcx, pcy, PUP_C);
      tile.set(pcx - 1, pcy, IRIS_C);
      tile.set(pcx + 1, pcy, IRIS_C);
      tile.set(pcx, pcy - 1, IRIS_C);
    }
  };

  drawOne(face.eyeLX, face.eyeY);
  drawOne(face.eyeRX, face.eyeY);
}

function drawMouthOnTile(tile, face, shape) {
  if (shape === 'rest') return;

  const mx = face.mouthX, my = face.mouthY;
  const mw = face.mouthW, mh = face.mouthH;

  tile.fillRect(mx - 1, my - 1, mw + 2, mh + 2, face.skinColor);

  if (shape === 'open-a') {
    tile.fillRect(mx, my, mw, 1, OL);
    tile.fillRect(mx, my + 1, mw, mh, MOUTH_IN);
    if (mh > 1) tile.fillRect(mx + 1, my + 1, Math.max(1, mw - 2), 1, WHITE);
    tile.fillRect(mx, my + mh + 1, mw, 1, OL);
  } else if (shape === 'mid-e') {
    tile.fillRect(mx, my, mw, 1, OL);
    tile.fillRect(mx, my + 1, mw, Math.max(1, Math.floor(mh * 0.5)), MOUTH_IN);
    tile.fillRect(mx + 1, my + 1, Math.max(1, mw - 2), 1, WHITE);
  } else if (shape === 'rounded-o') {
    const ow = Math.max(2, Math.round(mw * 0.5));
    const ox = mx + Math.round((mw - ow) / 2);
    tile.fillRect(ox, my, ow, 1, OL);
    tile.fillRect(ox, my + 1, ow, Math.max(1, mh), MOUTH_IN);
    tile.fillRect(ox, my + mh + 1, ow, 1, OL);
  } else if (shape === 'neutral-small') {
    tile.fillRect(mx + 1, my + Math.floor(mh / 2), Math.max(1, mw - 2), 1, OL);
  } else if (shape === 'bilabial-m') {
    tile.fillRect(mx, my + Math.floor(mh / 2), mw, 1, OL);
    tile.fillRect(mx, my + Math.floor(mh / 2) + 1, mw, 1, OL);
  } else if (shape === 'labiodental-f') {
    const hw = Math.max(2, Math.round(mw * 0.7));
    const ox = mx + Math.round((mw - hw) / 2);
    tile.fillRect(ox, my + Math.floor(mh / 2), hw, 1, WHITE);
    tile.fillRect(ox, my + Math.floor(mh / 2) + 1, hw, 1, OL);
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

  // Row 0: IDLE — gentle breathing bob (whole tile vertical shift)
  const idleBobs = [0, -1, -2, -2, -1, 0];
  headShifts['idle'] = [];
  for (let i = 0; i < 6; i++) {
    const tile = shiftWholeTile(baseTile, 0, idleBobs[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 0);
    headShifts['idle'].push({ x: 0, y: idleBobs[i] });
  }

  // Row 1: WALK — whole tile shift (slight left-right sway + vertical bob)
  // Simulates walking motion without splitting the character
  const walkBobY = [0, -1, -2, -1, 0, -1, -2, -1];
  const walkSwayX = [0, 1, 2, 1, 0, -1, -2, -1];
  headShifts['walk'] = [];
  for (let i = 0; i < 8; i++) {
    const tile = shiftWholeTile(baseTile, walkSwayX[i], walkBobY[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, TILE_H);
    headShifts['walk'].push({ x: walkSwayX[i], y: walkBobY[i] });
  }

  // Row 2: WAVE — whole tile stays, no body splitting
  // Simple subtle lean + the body stays intact
  const waveLean = [0, 0, -1, -1, -1, -1, -1, -1, 0, 0];
  headShifts['wave'] = [];
  for (let i = 0; i < 10; i++) {
    const tile = shiftWholeTile(baseTile, 0, waveLean[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 2 * TILE_H);
    headShifts['wave'].push({ x: 0, y: waveLean[i] });
  }

  // Row 3: SHRUG — whole tile shift up slightly (raising shoulders = entire body rises)
  const shrugShift = [0, -1, -2, -3, -3, -2, -1, 0];
  headShifts['shrug'] = [];
  for (let i = 0; i < 8; i++) {
    const tile = shiftWholeTile(baseTile, 0, shrugShift[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 3 * TILE_H);
    headShifts['shrug'].push({ x: 0, y: shrugShift[i] });
  }

  // Row 4: NOD — shift head/upper body down with blending
  const nodShifts = [0, 2, 3, 3, 2, 0];
  headShifts['nod'] = [];
  for (let i = 0; i < 6; i++) {
    const tile = shiftUpperRegion(baseTile, face, 0, nodShifts[i], 4);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 4 * TILE_H);
    headShifts['nod'].push({ x: 0, y: nodShifts[i] });
  }

  // Row 5: SHAKE-HEAD — shift head/upper body left-right with blending
  const shakeShifts = [0, -2, -3, -2, 0, 2, 3, 2];
  headShifts['shake-head'] = [];
  for (let i = 0; i < 8; i++) {
    const tile = shiftUpperRegion(baseTile, face, shakeShifts[i], 0, 4);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 5 * TILE_H);
    headShifts['shake-head'].push({ x: shakeShifts[i], y: 0 });
  }

  // Row 6: POINT — whole tile slight lean forward
  const pointLean = [0, -1, -1, -1, -1, 0];
  headShifts['point'] = [];
  for (let i = 0; i < 6; i++) {
    const tile = shiftWholeTile(baseTile, 0, pointLean[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 6 * TILE_H);
    headShifts['point'].push({ x: 0, y: pointLean[i] });
  }

  return { sheet, headShifts };
}

function buildMouthSheet(face) {
  const sheet = new PixelCanvas(MOUTH_SHAPES.length * TILE_W, TILE_H);
  for (let i = 0; i < MOUTH_SHAPES.length; i++) {
    const tile = new PixelCanvas(TILE_W, TILE_H);
    drawMouthOnTile(tile, face, MOUTH_SHAPES[i]);
    sheet.blit(tile, 0, 0, TILE_W, TILE_H, i * TILE_W, 0);
  }
  return sheet;
}

function buildEyesSheet(face) {
  const sheet = new PixelCanvas(EYE_STATES.length * TILE_W, TILE_H);
  for (let i = 0; i < EYE_STATES.length; i++) {
    const tile = new PixelCanvas(TILE_W, TILE_H);
    drawEyesOnTile(tile, face, EYE_STATES[i]);
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
const mouthSheet = buildMouthSheet(face);
fs.writeFileSync(path.join(OUT_DIR, 'mouth.png'), mouthSheet.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'mouth.json'), JSON.stringify(makeMouthJSON(), null, 2));

console.log('Building eyes sheet...');
const eyesSheet = buildEyesSheet(face);
fs.writeFileSync(path.join(OUT_DIR, 'eyes.png'), eyesSheet.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'eyes.json'), JSON.stringify(makeEyesJSON(), null, 2));

writeSpriteMeta(face, headShifts);

console.log('\n✓ Done! → ' + OUT_DIR);
console.log(`  Tile: ${TILE_W}×${TILE_H}px (display at 2×: ${TILE_W * 2}×${TILE_H * 2})`);
console.log(`  7 animations: idle, walk, wave, shrug, nod, shake-head, point`);
