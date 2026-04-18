// ---------------------------------------------------------------------------
// Shared types for the character animation system
// ---------------------------------------------------------------------------

/** Raw viseme event from Edge TTS (offset in 100ns ticks) */
export interface VisemeEvent {
  offset: number;   // 100-nanosecond units
  visemeId: number; // 0–21 Microsoft viseme set
}

/** Word boundary event from Edge TTS */
export interface WordBoundary {
  offset: number;   // 100-nanosecond units
  word: string;
  duration: number; // 100-nanosecond units
}

/** Response from /api/tts */
export interface TTSResponse {
  audioBase64: string;
  visemes: VisemeEvent[];
  wordBoundaries: WordBoundary[];
  durationMs: number;
}

/** Mouth shape names matching spritesheet animation keys */
export type MouthShape =
  | 'rest'
  | 'open-a'
  | 'mid-e'
  | 'rounded-o'
  | 'neutral-small'
  | 'bilabial-m'
  | 'labiodental-f';

/** Eye state names matching spritesheet animation keys */
export type EyeState = 'open' | 'close-1' | 'close-2' | 'close-3' | 'closed' | 'happy' | 'surprised';

/** Body animation names matching spritesheet animation keys */
export type BodyAnimation = 'idle' | 'walk' | 'wave' | 'shrug' | 'nod' | 'shake-head' | 'point';

/** Base states for the character FSM */
export type BaseState = 'idle' | 'gesture' | 'listening';

/** A gesture request pushed to GestureScheduler */
export interface GestureRequest {
  gesture: BodyAnimation;
  delayMs?: number;       // delay from now before starting (ms)
  interrupt?: boolean;    // if true, fast-forward current gesture and start this one
}

/** Active gesture being played */
export interface ActiveGesture {
  name: BodyAnimation;
  frameCount: number;
  currentFrame: number;
  frameDurationMs: number;
  accMs: number;
}

/** Script submission payload for the studio */
export interface ScriptPayload {
  text: string;
  voice: string;
  gestures?: Array<{ timeMs: number; gesture: BodyAnimation }>;
}
