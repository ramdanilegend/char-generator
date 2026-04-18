'use client';

/**
 * VideoRecorder
 *
 * Captures the PixiJS canvas + Web Audio output into a WebM video.
 *
 * Pipeline:
 *   canvas.captureStream(fps) ──────────────┐
 *                                           ├── MediaRecorder → WebM blob
 *   AudioContext → MediaStreamDest ─────────┘
 *
 * The AudioContext stream destination is provided by TimingController.
 */

const VIDEO_FPS = 30;
const VIDEO_BITRATE = 2_500_000;
const AUDIO_BITRATE = 128_000;

function getSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = getSupportedMimeType();

  /** true while recording is in progress */
  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /**
   * Start recording.
   * @param canvas — the PixiJS canvas element
   * @param audioStream — MediaStream from TimingController.recordingStream
   */
  start(canvas: HTMLCanvasElement, audioStream: MediaStream) {
    if (this.isRecording) return;
    this.chunks = [];

    const videoStream = canvas.captureStream(VIDEO_FPS);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    this.recorder = new MediaRecorder(combined, {
      mimeType: this.mimeType,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    });

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.start(100); // collect chunks every 100ms
  }

  /**
   * Stop recording and return the recorded Blob.
   * Waits up to 500ms after the audio ends to capture final frames.
   */
  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || !this.isRecording) {
        reject(new Error('Not recording'));
        return;
      }

      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        resolve(blob);
      };

      this.recorder.onerror = (e) => reject(e);

      // Small delay to capture final rendered frames
      setTimeout(() => this.recorder?.stop(), 500);
    });
  }

  /**
   * Download a blob as a file.
   */
  static download(blob: Blob, filename = 'character.webm') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
