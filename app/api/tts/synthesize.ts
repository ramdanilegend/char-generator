/**
 * Custom Edge TTS synthesizer with word boundary events.
 *
 * The `edge-tts` npm package disables word/viseme metadata. This module
 * uses the same WebSocket protocol but enables wordBoundaryEnabled so we
 * can approximate lip sync timing.
 *
 * Protocol reference: https://github.com/rany2/edge-tts (Python impl)
 */

import { createHash } from 'crypto';
import { WebSocket } from 'ws';
import type { WordBoundary, VisemeEvent } from '@/types';

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.3650.75';

const WS_BASE =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  `?TrustedClientToken=${TRUSTED_TOKEN}`;

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

// Microsoft requires a proof token derived from the current 5-minute time window.
// Algorithm: SHA256(string(roundedWindowsTicks) + TRUSTED_TOKEN), result uppercased.
// Token and version go in the query string (not headers).
function getSecMsGec(): string {
  const WIN_EPOCH_OFFSET = 11_644_473_600; // seconds from 1601-01-01 to 1970-01-01
  const nowSec = Math.floor(Date.now() / 1000);
  const ts = nowSec + WIN_EPOCH_OFFSET;
  const rounded = ts - (ts % 300); // round down to 5-min boundary
  const ticks = rounded * 10_000_000; // convert to 100ns intervals
  return createHash('sha256').update(`${ticks}${TRUSTED_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}

function randomMuid(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  wordBoundaries: WordBoundary[];
  visemes: VisemeEvent[];
}

export async function synthesizeWithMeta(
  text: string,
  voice = 'en-US-JennyNeural'
): Promise<SynthesisResult> {
  const requestId = uuid().replace(/-/g, '');

  return new Promise((resolve, reject) => {
    const gec = getSecMsGec();
    const url =
      WS_BASE +
      `&ConnectionId=${requestId}` +
      `&Sec-MS-GEC=${gec}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const ws = new WebSocket(url, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'User-Agent': EDGE_UA,
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `muid=${randomMuid()};`,
      },
    });

    const audioChunks: Buffer[] = [];
    const wordBoundaries: WordBoundary[] = [];
    const visemes: VisemeEvent[] = [];

    ws.on('open', () => {
      // Message 1: speech config (enable word boundaries)
      const speechConfig = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: false,
                wordBoundaryEnabled: true,
              },
              outputFormat: OUTPUT_FORMAT,
            },
          },
        },
      });
      ws.send(
        `X-Timestamp:${new Date().toISOString()}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          speechConfig
      );

      // Message 2: SSML synthesis request
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${escapeXml(voice)}'>` +
        escapeXml(text) +
        `</voice></speak>`;

      ws.send(
        `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${new Date().toISOString()}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml
      );
    });

    ws.on('message', (rawData: Buffer | string, isBinary: boolean) => {
      if (!isBinary) {
        const text = rawData.toString('utf8');

        // Parse word boundaries from audio.metadata messages
        if (text.includes('Path:audio.metadata')) {
          const jsonStart = text.indexOf('\r\n\r\n');
          if (jsonStart !== -1) {
            try {
              const json = JSON.parse(text.slice(jsonStart + 4)) as {
                Metadata?: Array<{
                  Type: string;
                  Data: {
                    Offset: number;
                    Duration?: number;
                    text?: { Text: string };
                    VisemeId?: number;
                  };
                }>;
              };
              for (const item of json.Metadata ?? []) {
                if (item.Type === 'WordBoundary' && item.Data.text) {
                  wordBoundaries.push({
                    offset: item.Data.Offset,
                    word: item.Data.text.Text,
                    duration: item.Data.Duration ?? 0,
                  });
                } else if (item.Type === 'Viseme' && item.Data.VisemeId !== undefined) {
                  visemes.push({ offset: item.Data.Offset, visemeId: item.Data.VisemeId });
                }
              }
            } catch { /* malformed JSON, skip */ }
          }
        }

        if (text.includes('Path:turn.end')) {
          ws.close();
          resolve({
            audioBuffer: Buffer.concat(audioChunks),
            wordBoundaries,
            visemes,
          });
        }
        return;
      }

      // Binary message: extract MP3 audio after the header separator
      const data = rawData as Buffer;
      const separator = Buffer.from('Path:audio\r\n');
      const sepIdx = data.indexOf(separator);
      if (sepIdx !== -1) {
        audioChunks.push(data.slice(sepIdx + separator.length));
      }
    });

    ws.on('error', reject);

    ws.on('close', (code: number) => {
      if (code !== 1000 && audioChunks.length === 0) {
        reject(new Error(`WebSocket closed unexpectedly: code ${code}`));
      }
    });
  });
}
