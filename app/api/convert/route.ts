export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * POST /api/convert
 * Body: multipart/form-data with field "file" (WebM)
 * Returns: MP4 file stream
 */
export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 100 MB)' }, { status: 413 });
  }

  let inputPath = '';
  let outputPath = '';

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
    }

    const id = randomUUID();
    inputPath  = path.join(os.tmpdir(), `${id}.webm`);
    outputPath = path.join(os.tmpdir(), `${id}.mp4`);

    // Write uploaded WebM to disk
    const bytes = await file.arrayBuffer();
    await fs.writeFile(inputPath, Buffer.from(bytes));

    // Convert WebM → MP4 using ffmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags faststart', '-pix_fmt yuv420p'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });

    // Stream MP4 back to client
    const mp4 = await fs.readFile(outputPath);
    return new NextResponse(mp4, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="character.mp4"',
        'Content-Length': String(mp4.byteLength),
      },
    });
  } catch (err) {
    console.error('[/api/convert]', err);
    return NextResponse.json({ error: 'Conversion failed', detail: String(err) }, { status: 500 });
  } finally {
    // Clean up temp files
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
