import type { TTSResponse } from '@/types';

/** Default Edge TTS voices shown in the studio voice picker */
export const DEFAULT_VOICES = [
  { label: 'Jenny (US)', value: 'en-US-JennyNeural' },
  { label: 'Guy (US)',   value: 'en-US-GuyNeural' },
  { label: 'Aria (US)',  value: 'en-US-AriaNeural' },
  { label: 'Sonia (UK)', value: 'en-GB-SoniaNeural' },
  { label: 'Ryan (UK)',  value: 'en-GB-RyanNeural' },
];

/**
 * Fetches synthesized audio + viseme data from the /api/tts route.
 * Returns a TTSResponse or throws on error.
 */
export async function synthesize(text: string, voice: string): Promise<TTSResponse> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`TTS error ${res.status}: ${(err as { error?: string }).error ?? 'unknown'}`);
  }

  return res.json() as Promise<TTSResponse>;
}

/**
 * Decode a base64 MP3 string into an AudioBuffer using the given AudioContext.
 */
export async function decodeAudio(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return ctx.decodeAudioData(bytes.buffer);
}
