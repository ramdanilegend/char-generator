import type { VisemeEvent, WordBoundary } from '@/types';

/**
 * Approximate Microsoft viseme IDs from word boundaries.
 *
 * Edge readaloud's WebSocket does not emit real viseme events, so we fake
 * them from each word's spelling. A word becomes a small sequence of mouth
 * shapes (timed within its duration) that the engine will play back like
 * actual visemes — which is enough to make the mouth look like it's
 * talking in step with the audio.
 *
 * Offsets are in 100-ns ticks (same scale as Edge boundary offsets) so the
 * client's existing scheduling code doesn't need to change.
 */

const TICKS_PER_MS = 10_000;

/** Letter → viseme ID (matches the IDs in tts/LipSyncMapper.ts) */
function letterViseme(ch: string): number | null {
  switch (ch) {
    case 'a':           return 1;   // open-a
    case 'e': case 'i': return 4;   // mid-e
    case 'o': case 'u': case 'w': return 7; // rounded-o
    case 'y':           return 6;   // mid-e (y like IY)
    case 'p': case 'b': case 'm': return 21; // bilabial-m
    case 'f': case 'v': return 18;  // labiodental-f
    // Common consonants — neutral small shape
    case 'l': case 'r': case 's': case 'z':
    case 't': case 'd': case 'n': case 'k': case 'g':
    case 'h': case 'j': case 'c': case 'x':
    case 'q':
      return 19;
    default:
      return null; // skip punctuation, spaces, etc.
  }
}

/** Extract a compact sequence of visemes from a word. */
function wordToVisemes(word: string): number[] {
  const out: number[] = [];
  const lowered = word.toLowerCase();
  let last = -1;
  for (const ch of lowered) {
    const v = letterViseme(ch);
    if (v === null) continue;
    // Collapse immediate repeats so we don't emit 30 identical shapes
    if (v !== last) {
      out.push(v);
      last = v;
    }
  }
  // Every word ends on a brief close so it looks articulated
  if (out.length > 0) out.push(0);
  return out;
}

export function approximateVisemes(words: WordBoundary[]): VisemeEvent[] {
  const events: VisemeEvent[] = [];
  for (const w of words) {
    const shapes = wordToVisemes(w.word);
    if (shapes.length === 0) continue;
    // Spread the viseme events evenly across the word's duration.
    // Cap per-shape time at 110ms — short, lively mouth movement.
    const perShape = Math.min(w.duration / shapes.length, 110 * TICKS_PER_MS);
    for (let i = 0; i < shapes.length; i++) {
      events.push({
        offset: Math.round(w.offset + i * perShape),
        visemeId: shapes[i],
      });
    }
  }
  return events;
}
