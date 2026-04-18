#!/usr/bin/env node
/**
 * Generates placeholder Pokemon trainer sprite sheets (PNG + JSON).
 * Run: node scripts/generate-sprites.mjs
 *
 * Produces in src/assets/sprites/:
 *   body.png / body.json   — full trainer body (6 animations × up to 8 frames)
 *   mouth.png / mouth.json — 7 mouth shapes, single row, transparent bg
 *   eyes.png / eyes.json   — 5 eye states, single row, transparent bg
 */

import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../public/sprites');
const TILE_W = 56; // tile width — matches process-sprite.mjs output
const TILE_H = 80; // tile height
const TILE = TILE_W; // alias for square references in face overlays

// ---------------------------------------------------------------------------
// Minimal PNG (RGBA) writer using Node.js built-in zlib — no extra deps
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
function toPNG(w, h, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth=8, color type=RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter=None
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (1 + w * 4) + 1 + x * 4;
      raw.set(pixels.slice(src, src + 4), dst);
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// PixelCanvas — RGBA drawing surface
// ---------------------------------------------------------------------------
class PixelCanvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.pixels = new Uint8Array(w * h * 4); // all transparent
  }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.pixels[i] = r; this.pixels[i + 1] = g; this.pixels[i + 2] = b; this.pixels[i + 3] = a;
  }
  fillRect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color);
  }
  toPNG() { return toPNG(this.w, this.h, this.pixels); }
}

// ---------------------------------------------------------------------------
// Color palette — Gen 1/2 trainer inspired
// ---------------------------------------------------------------------------
const T     = [0, 0, 0, 0];
const BG    = [185, 210, 255, 255];   // light blue background
const OL    = [20, 20, 20, 255];      // near-black outline
const HAIR  = [35, 20, 10, 255];      // dark brown hair
const SKIN  = [255, 200, 150, 255];   // skin tone
const SKIN2 = [220, 165, 115, 255];   // skin shadow
const EYE_W = [245, 245, 245, 255];   // eye whites
const IRIS  = [50, 90, 200, 255];     // blue iris
const PUP   = [20, 20, 25, 255];      // pupil
const SHIRT = [210, 45, 45, 255];     // red shirt (trainer Red)
const SHIRT2= [165, 30, 30, 255];     // shirt shadow
const PANTS = [45, 50, 140, 255];     // blue pants
const PANTS2= [30, 35, 105, 255];     // pants shadow
const BELT  = [80, 55, 25, 255];      // belt
const SHOE  = [50, 40, 30, 255];      // shoes
const WHITE = [240, 240, 230, 255];   // teeth white
const MOUTH_IN = [150, 60, 60, 255];  // mouth interior

// ---------------------------------------------------------------------------
// Character drawing — eye and mouth areas left BLANK (skin only)
// so overlay layers composite correctly.
//
// Face region in the 48×48 tile:
//   Eyes:  left  x=14–18, y=9–13   right  x=29–33, y=9–13
//   Mouth: x=18–29, y=15–19
// ---------------------------------------------------------------------------
function drawTrainer(c, ox, oy, opts = {}) {
  const { armRight = 'down', shoulderRaise = 0 } = opts;

  // Background
  c.fillRect(ox, oy, TILE_W, TILE_H, BG);

  // --- Hair (rows 0–7) ---
  c.fillRect(ox + 10, oy + 0, 28, 2, HAIR);
  c.fillRect(ox + 8,  oy + 2, 32, 5, HAIR);
  c.fillRect(ox + 8,  oy + 5, 5,  3, HAIR); // left sideburn
  c.fillRect(ox + 35, oy + 5, 5,  3, HAIR); // right sideburn
  // spikes
  c.fillRect(ox + 12, oy + 0, 3, 2, HAIR);
  c.fillRect(ox + 21, oy + 0, 6, 2, HAIR);
  c.fillRect(ox + 31, oy + 0, 3, 2, HAIR);

  // --- Face (rows 7–19) — leave eye/mouth areas as skin ---
  c.fillRect(ox + 10, oy + 7,  28, 13, SKIN);  // face block
  c.fillRect(ox + 8,  oy + 8,  2,  9,  SKIN);  // left cheek
  c.fillRect(ox + 38, oy + 8,  2,  9,  SKIN);  // right cheek
  // Ears
  c.fillRect(ox + 8,  oy + 10, 2, 4, SKIN2);
  c.fillRect(ox + 38, oy + 10, 2, 4, SKIN2);
  // Nose (subtle shadow)
  c.set(ox + 23, oy + 14, SKIN2);
  c.set(ox + 24, oy + 14, SKIN2);
  // Eye sockets (blank skin — eye layer draws on top)
  c.fillRect(ox + 14, oy + 9,  5, 5, SKIN);
  c.fillRect(ox + 29, oy + 9,  5, 5, SKIN);
  // Mouth area (blank skin — mouth layer draws on top)
  c.fillRect(ox + 18, oy + 15, 12, 5, SKIN);

  // --- Neck ---
  c.fillRect(ox + 20, oy + 20, 8, 3, SKIN);

  // --- Shirt / torso (y+22 to y+35) ---
  const sy = oy + 22 - shoulderRaise;
  c.fillRect(ox + 10, sy,      28, 14, SHIRT);
  c.fillRect(ox + 8,  sy + 1,  2,  12, SHIRT2); // left arm shadow
  c.fillRect(ox + 38, sy + 1,  2,  12, SHIRT2); // right arm shadow
  c.fillRect(ox + 20, sy,      8,  2,  SKIN);    // collar

  // --- Left arm (always down for MVP gestures) ---
  c.fillRect(ox + 4,  sy + 2,  6, 10, SHIRT);
  c.fillRect(ox + 4,  sy + 12, 6, 3,  SKIN);    // left hand

  // --- Right arm (varies) ---
  if (armRight === 'down') {
    c.fillRect(ox + 38, sy + 2,  6, 10, SHIRT);
    c.fillRect(ox + 38, sy + 12, 6, 3,  SKIN);
  } else if (armRight === 'mid') {
    c.fillRect(ox + 38, sy,      6, 8,  SHIRT);
    c.fillRect(ox + 38, sy + 8,  6, 3,  SKIN);
  } else if (armRight === 'up1') {
    c.fillRect(ox + 38, sy - 4,  6, 8,  SHIRT);
    c.fillRect(ox + 38, sy - 8,  6, 4,  SKIN);
  } else if (armRight === 'up2') {
    c.fillRect(ox + 40, sy - 7,  6, 8,  SHIRT);
    c.fillRect(ox + 40, sy - 11, 6, 4,  SKIN);
  } else if (armRight === 'forward') {
    c.fillRect(ox + 38, sy + 2,  12, 4, SHIRT);
    c.fillRect(ox + 48, sy + 2,  4,  4, SKIN);  // pointing hand (may clip but fine)
  }

  // --- Belt ---
  c.fillRect(ox + 10, oy + 36, 28, 3, BELT);

  // --- Pants ---
  c.fillRect(ox + 10, oy + 39, 28, 7, PANTS);
  c.fillRect(ox + 10, oy + 40, 13, 6, PANTS2); // left leg shadow

  // --- Shoes ---
  c.fillRect(ox + 9,  oy + 45, 14, 3, SHOE);
  c.fillRect(ox + 25, oy + 45, 13, 3, SHOE);
}

// ---------------------------------------------------------------------------
// Eyes overlay — draws ONLY eye pixels, transparent everywhere else.
// Position matches blank eye sockets in drawTrainer.
// ---------------------------------------------------------------------------
function drawEyes(c, ox, oy, state = 'open') {
  const lx = ox + 14, rx = ox + 29, ey = oy + 9;

  const drawEye = (x, y, s) => {
    if (s === 'open') {
      c.fillRect(x, y, 5, 5, EYE_W);
      c.fillRect(x + 1, y + 1, 3, 3, IRIS);
      c.set(x + 2, y + 2, PUP);
      // outline corners
      [0, 4].forEach(dx => [0, 4].forEach(dy => c.set(x + dx, y + dy, OL)));
    } else if (s === 'half') {
      c.fillRect(x, y, 5, 5, SKIN);
      c.fillRect(x, y + 2, 5, 3, EYE_W);
      c.fillRect(x + 1, y + 3, 3, 2, IRIS);
      c.fillRect(x, y + 2, 5, 1, OL); // upper lid
    } else if (s === 'closed') {
      c.fillRect(x, y, 5, 5, SKIN);
      c.fillRect(x + 1, y + 2, 3, 1, OL); // just a line
    } else if (s === 'happy') {
      c.fillRect(x, y, 5, 5, SKIN);
      // ^^ arc shape
      c.set(x + 0, y + 3, OL); c.set(x + 1, y + 2, OL); c.set(x + 2, y + 1, OL);
      c.set(x + 3, y + 2, OL); c.set(x + 4, y + 3, OL);
    } else if (s === 'surprised') {
      c.fillRect(x - 1, y - 1, 7, 7, EYE_W);
      c.fillRect(x, y, 5, 5, IRIS);
      c.set(x + 2, y + 2, PUP);
      [[-1,-1],[5,-1],[-1,5],[5,5]].forEach(([dx,dy]) => c.set(x+dx, y+dy, OL));
    }
  };

  drawEye(lx, ey, state);
  drawEye(rx, ey, state);
}

// ---------------------------------------------------------------------------
// Mouth overlay — draws ONLY mouth pixels, transparent everywhere else.
// Position matches blank mouth area in drawTrainer.
// ---------------------------------------------------------------------------
function drawMouth(c, ox, oy, shape = 'rest') {
  const mx = ox + 18, my = oy + 15, mw = 12;

  if (shape === 'rest') {
    c.fillRect(mx, my + 2, mw, 1, OL);
    c.fillRect(mx + 1, my + 2, mw - 2, 1, SKIN2);
  } else if (shape === 'open-a') {
    c.fillRect(mx + 1, my, mw - 2, 1, OL);
    c.fillRect(mx, my + 1, mw, 4, MOUTH_IN);
    c.fillRect(mx + 1, my + 1, mw - 2, 1, WHITE);  // top teeth
    c.fillRect(mx + 1, my + 4, mw - 2, 1, WHITE);  // bottom teeth
    c.fillRect(mx, my + 5, mw, 1, OL);
    c.set(mx, my + 1, OL); c.set(mx + mw - 1, my + 1, OL);
    c.set(mx, my + 4, OL); c.set(mx + mw - 1, my + 4, OL);
  } else if (shape === 'mid-e') {
    c.fillRect(mx, my + 1, mw, 3, OL);
    c.fillRect(mx + 1, my + 1, mw - 2, 3, MOUTH_IN);
    c.fillRect(mx + 1, my + 1, mw - 2, 1, WHITE);  // teeth strip
    c.set(mx, my + 2, SKIN);                        // smile corner gaps
    c.set(mx + mw - 1, my + 2, SKIN);
  } else if (shape === 'rounded-o') {
    c.fillRect(mx + 3, my, mw - 6, 1, OL);
    c.fillRect(mx + 2, my + 1, mw - 4, 4, MOUTH_IN);
    c.fillRect(mx + 3, my + 5, mw - 6, 1, OL);
    c.set(mx + 1, my + 1, OL); c.set(mx + mw - 2, my + 1, OL);
    c.set(mx + 1, my + 4, OL); c.set(mx + mw - 2, my + 4, OL);
  } else if (shape === 'neutral-small') {
    c.fillRect(mx + 2, my + 2, mw - 4, 1, OL);
    c.fillRect(mx + 2, my + 3, mw - 4, 1, MOUTH_IN);
    c.fillRect(mx + 2, my + 4, mw - 4, 1, OL);
  } else if (shape === 'bilabial-m') {
    c.fillRect(mx, my + 2, mw, 3, SKIN2);
    c.fillRect(mx + 1, my + 2, mw - 2, 1, OL); // pressed lip line
    c.fillRect(mx + 1, my + 4, mw - 2, 1, OL);
  } else if (shape === 'labiodental-f') {
    c.fillRect(mx + 2, my + 2, mw - 4, 1, WHITE);  // upper teeth
    c.fillRect(mx, my + 3, mw, 2, SKIN2);           // lower lip raised
    c.fillRect(mx + 1, my + 3, mw - 2, 1, OL);
  }
}

// ---------------------------------------------------------------------------
// Body spritesheet
// Row layout:
//   0: idle (4 frames)        — subtle arm variation
//   1: wave (8 frames)        — right arm up/down
//   2: shrug (6 frames)       — shoulders raised
//   3: nod (4 frames)         — same pose (head movement done via CSS/overlay in code)
//   4: shake-head (6 frames)  — same pose (head movement done via CSS/overlay)
//   5: point (3 frames)       — right arm extends
// ---------------------------------------------------------------------------
function generateBody() {
  const c = new PixelCanvas(8 * TILE_W, 6 * TILE_H);

  // Row 0: IDLE (4 frames, minor arm variation only)
  for (let i = 0; i < 4; i++) {
    drawTrainer(c, i * TILE_W, 0 * TILE_H, { armRight: 'down' });
    drawEyes(c, i * TILE_W, 0 * TILE_H, 'open');
    drawMouth(c, i * TILE_W, 0 * TILE_H, 'rest');
  }

  // Row 1: WAVE (8 frames)
  const waveArms   = ['down', 'mid', 'up1', 'up2', 'up2', 'up1', 'mid', 'down'];
  const waveEyes   = ['open','happy','happy','happy','happy','happy','happy','open'];
  const waveMouths = ['rest','mid-e','mid-e','mid-e','mid-e','mid-e','mid-e','rest'];
  for (let i = 0; i < 8; i++) {
    drawTrainer(c, i * TILE_W, 1 * TILE_H, { armRight: waveArms[i] });
    drawEyes(c, i * TILE_W, 1 * TILE_H, waveEyes[i]);
    drawMouth(c, i * TILE_W, 1 * TILE_H, waveMouths[i]);
  }

  // Row 2: SHRUG (6 frames)
  const shrugRaise = [0, 1, 2, 3, 2, 0];
  const shrugEyes  = ['open','open','happy','happy','happy','open'];
  for (let i = 0; i < 6; i++) {
    drawTrainer(c, i * TILE_W, 2 * TILE_H, { armRight: 'down', shoulderRaise: shrugRaise[i] });
    drawEyes(c, i * TILE_W, 2 * TILE_H, shrugEyes[i]);
    drawMouth(c, i * TILE_W, 2 * TILE_H, i >= 2 ? 'mid-e' : 'rest');
  }

  // Row 3: NOD (4 frames, stationary)
  for (let i = 0; i < 4; i++) {
    drawTrainer(c, i * TILE_W, 3 * TILE_H, { armRight: 'down' });
    drawEyes(c, i * TILE_W, 3 * TILE_H, 'open');
    drawMouth(c, i * TILE_W, 3 * TILE_H, 'rest');
  }

  // Row 4: SHAKE-HEAD (6 frames, stationary)
  for (let i = 0; i < 6; i++) {
    drawTrainer(c, i * TILE_W, 4 * TILE_H, { armRight: 'down' });
    drawEyes(c, i * TILE_W, 4 * TILE_H, 'open');
    drawMouth(c, i * TILE_W, 4 * TILE_H, 'rest');
  }

  // Row 5: POINT (3 frames)
  const pointArms = ['down', 'mid', 'forward'];
  for (let i = 0; i < 3; i++) {
    drawTrainer(c, i * TILE_W, 5 * TILE_H, { armRight: pointArms[i] });
    drawEyes(c, i * TILE_W, 5 * TILE_H, 'open');
    drawMouth(c, i * TILE_W, 5 * TILE_H, 'rest');
  }

  return c;
}

function generateMouth() {
  const shapes = ['rest', 'open-a', 'mid-e', 'rounded-o', 'neutral-small', 'bilabial-m', 'labiodental-f'];
  const c = new PixelCanvas(shapes.length * TILE_W, TILE_H);
  shapes.forEach((shape, i) => drawMouth(c, i * TILE_W, 0, shape));
  return { canvas: c, shapes };
}

function generateEyes() {
  const states = ['open', 'half', 'closed', 'happy', 'surprised'];
  const c = new PixelCanvas(states.length * TILE_W, TILE_H);
  states.forEach((state, i) => drawEyes(c, i * TILE_W, 0, state));
  return { canvas: c, states };
}

// ---------------------------------------------------------------------------
// JSON metadata (Aseprite-compatible spritesheet format for PixiJS)
// ---------------------------------------------------------------------------
function makeBodyJSON() {
  const anims = [
    { name: 'idle',        frames: 4, row: 0, duration: 180 },
    { name: 'wave',        frames: 8, row: 1, duration: 100 },
    { name: 'shrug',       frames: 6, row: 2, duration: 130 },
    { name: 'nod',         frames: 4, row: 3, duration: 120 },
    { name: 'shake-head',  frames: 6, row: 4, duration: 100 },
    { name: 'point',       frames: 3, row: 5, duration: 180 },
  ];
  const frames = {}, animations = {};
  for (const anim of anims) {
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
  return { frames, meta: { image: 'body.png', size: { w: 8 * TILE_W, h: 6 * TILE_H }, scale: '1' }, animations };
}

function makeMouthJSON() {
  const shapes = ['rest', 'open-a', 'mid-e', 'rounded-o', 'neutral-small', 'bilabial-m', 'labiodental-f'];
  const frames = {}, animations = {};
  shapes.forEach((shape, i) => {
    const key = `mouth-${shape} 0`;
    frames[key] = { frame: { x: i * TILE_W, y: 0, w: TILE_W, h: TILE_H }, spriteSourceSize: { x:0,y:0,w:TILE_W,h:TILE_H }, sourceSize: { w:TILE_W,h:TILE_H }, duration: 100 };
    animations[`mouth-${shape}`] = [key];
  });
  return { frames, meta: { image: 'mouth.png', size: { w: shapes.length * TILE_W, h: TILE_H }, scale: '1' }, animations };
}

function makeEyesJSON() {
  const states = ['open', 'half', 'closed', 'happy', 'surprised'];
  const frames = {}, animations = {};
  states.forEach((state, i) => {
    const key = `eyes-${state} 0`;
    frames[key] = { frame: { x: i * TILE_W, y: 0, w: TILE_W, h: TILE_H }, spriteSourceSize: { x:0,y:0,w:TILE_W,h:TILE_H }, sourceSize: { w:TILE_W,h:TILE_H }, duration: 100 };
    animations[`eyes-${state}`] = [key];
  });
  return { frames, meta: { image: 'eyes.png', size: { w: states.length * TILE_W, h: TILE_H }, scale: '1' }, animations };
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

const body = generateBody();
fs.writeFileSync(path.join(OUT_DIR, 'body.png'), body.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'body.json'), JSON.stringify(makeBodyJSON(), null, 2));

const { canvas: mouthCanvas } = generateMouth();
fs.writeFileSync(path.join(OUT_DIR, 'mouth.png'), mouthCanvas.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'mouth.json'), JSON.stringify(makeMouthJSON(), null, 2));

const { canvas: eyesCanvas } = generateEyes();
fs.writeFileSync(path.join(OUT_DIR, 'eyes.png'), eyesCanvas.toPNG());
fs.writeFileSync(path.join(OUT_DIR, 'eyes.json'), JSON.stringify(makeEyesJSON(), null, 2));

// sprite-meta.json — read by AnimationEngine at runtime
fs.writeFileSync(path.join(OUT_DIR, 'sprite-meta.json'), JSON.stringify({ tileW: TILE_W, tileH: TILE_H }, null, 2));

console.log('Sprites generated →', OUT_DIR);
console.log(`  body.png   (${8*TILE_W}×${6*TILE_H}) — 6 animations`);
console.log(`  mouth.png  (${7*TILE_W}×${TILE_H})  — 7 mouth shapes`);
console.log(`  eyes.png   (${5*TILE_W}×${TILE_H})  — 5 eye states`);
console.log(`  sprite-meta.json — tileW:${TILE_W} tileH:${TILE_H}`);
