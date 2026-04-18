// Must use Node.js runtime — WebSocket + ws require Node.js environment
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { synthesizeWithMeta } from './synthesize';
import type { TTSResponse } from '@/types';

const VOICE_LIST_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list' +
  '?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

interface EdgeVoice {
  FriendlyName: string;
  ShortName: string;
  Locale: string;
}

/** GET /api/tts — return English voices for the picker */
export async function GET() {
  try {
    const res = await fetch(VOICE_LIST_URL);
    const voices = (await res.json()) as EdgeVoice[];
    const english = voices
      .filter((v) => v.Locale?.startsWith('en'))
      .map((v) => ({ name: v.FriendlyName, shortName: v.ShortName, locale: v.Locale }))
      .slice(0, 20);
    return NextResponse.json({ voices: english });
  } catch {
    return NextResponse.json({ voices: [] });
  }
}

/** POST /api/tts — synthesize text, return audio + word boundary timing */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { text?: string; voice?: string };
  const { text, voice } = body;

  if (!text || !voice) {
    return NextResponse.json({ error: 'text and voice are required' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: 'text too long (max 2000 chars)' }, { status: 400 });
  }

  try {
    const { audioBuffer, wordBoundaries, visemes } = await synthesizeWithMeta(text, voice);

    const audioBase64 = audioBuffer.toString('base64');

    // Estimate total duration from last word boundary
    const last = wordBoundaries.at(-1);
    const durationMs = last
      ? Math.ceil((last.offset + last.duration) / 10_000) + 300
      : 0;

    const response: TTSResponse = { audioBase64, visemes, wordBoundaries, durationMs };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[/api/tts]', err);
    return NextResponse.json(
      { error: 'TTS synthesis failed', detail: String(err) },
      { status: 500 }
    );
  }
}
