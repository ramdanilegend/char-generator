import type { MouthShape } from '@/types';

/**
 * Maps Microsoft Edge TTS viseme IDs (0–21) to mouth shape names.
 *
 * Microsoft's 22 visemes are mapped to 7 mouth shapes used in the sprite sheet.
 * Reference: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 */

/** The 7 mouth shapes available in the sprite sheet, ordered by frame index */
export const MOUTH_SHAPES: MouthShape[] = [
  'rest',           // 0 — silence / closed
  'open-a',         // 1 — wide open (AE, AX, AH, AA, AY, AW)
  'mid-e',          // 2 — mid-open smile (EY, EH, UH, ER, IY, IH)
  'rounded-o',      // 3 — rounded (AO, OW, OY, UW, W)
  'neutral-small',  // 4 — neutral open (HH, R, L, S, Z, SH, ZH, CH, JH, D, T, N, K, G, NG)
  'bilabial-m',     // 5 — lips pressed (P, B, M)
  'labiodental-f',  // 6 — teeth on lip (F, V)
];

/** visemeId → MouthShape */
const VISEME_MAP: Record<number, MouthShape> = {
  0:  'rest',          // silence
  1:  'open-a',        // AE, AX, AH
  2:  'open-a',        // AA
  3:  'rounded-o',     // AO
  4:  'mid-e',         // EY, EH, UH
  5:  'mid-e',         // ER
  6:  'mid-e',         // y, IY, IH
  7:  'rounded-o',     // w, UW
  8:  'rounded-o',     // OW
  9:  'open-a',        // AW
  10: 'rounded-o',     // OY
  11: 'open-a',        // AY
  12: 'neutral-small', // HH, HX, H
  13: 'neutral-small', // R
  14: 'neutral-small', // l, EL
  15: 'neutral-small', // s, z
  16: 'neutral-small', // SH, ZH, CH, JH
  17: 'neutral-small', // TH, DH
  18: 'labiodental-f', // F, V
  19: 'neutral-small', // D, T, N
  20: 'neutral-small', // K, G, NG
  21: 'bilabial-m',    // P, B, M
};

/** Convert a viseme ID to a mouth shape name */
export function visemeToMouthShape(visemeId: number): MouthShape {
  return VISEME_MAP[visemeId] ?? 'rest';
}

/** Convert a mouth shape name to its frame index in mouth.png */
export function mouthShapeToFrame(shape: MouthShape): number {
  return MOUTH_SHAPES.indexOf(shape);
}

/** Convenience: viseme ID → frame index */
export function visemeToFrame(visemeId: number): number {
  return mouthShapeToFrame(visemeToMouthShape(visemeId));
}
