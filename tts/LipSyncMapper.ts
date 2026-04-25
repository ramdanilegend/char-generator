import type { MouthShape } from '@/types';

/** The 6 mouth shapes available in the sprite sheet, representing gradient levels of openness */
export const MOUTH_SHAPES: MouthShape[] = [
  'rest',           // 0
  'talk-1',         // 1 - slightly parted
  'talk-2',         // 2 - small opening
  'talk-3',         // 3 - medium opening
  'talk-4',         // 4 - large opening (O shape)
  'talk-5',         // 5 - widest opening (A shape)
];

/** visemeId -> Target MouthShape level */
const VISEME_MAP: Record<number, MouthShape> = {
  0:  'rest',          // silence
  1:  'talk-5',        // AE, AX, AH
  2:  'talk-5',        // AA
  3:  'talk-4',        // AO (narrow O)
  4:  'talk-3',        // EY, EH, UH
  5:  'talk-3',        // ER
  6:  'talk-3',        // y, IY, IH
  7:  'talk-4',        // w, UW (narrow O)
  8:  'talk-4',        // OW
  9:  'talk-5',        // AW
  10: 'talk-4',        // OY
  11: 'talk-5',        // AY
  12: 'talk-2',        // HH, HX, H
  13: 'talk-2',        // R
  14: 'talk-2',        // l, EL
  15: 'talk-2',        // s, z
  16: 'talk-2',        // SH, ZH, CH, JH
  17: 'talk-2',        // TH, DH
  18: 'talk-1',        // F, V
  19: 'talk-2',        // D, T, N
  20: 'talk-2',        // K, G, NG
  21: 'rest',          // P, B, M (closed)
};

export function visemeToMouthShape(visemeId: number): MouthShape {
  return VISEME_MAP[visemeId] ?? 'rest';
}

export function mouthShapeToFrame(shape: MouthShape): number {
  return MOUTH_SHAPES.indexOf(shape);
}

export function visemeToFrame(visemeId: number): number {
  return mouthShapeToFrame(visemeToMouthShape(visemeId));
}
