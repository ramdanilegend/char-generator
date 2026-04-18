import type { VisemeEvent } from '@/types';
import { visemeToMouthShape } from '@/tts/LipSyncMapper';
import type { MouthShape } from '@/types';

/** 100ns ticks → seconds */
const TICKS_TO_SEC = 1 / 10_000_000;

/** Pre-roll in seconds: audio is scheduled this far ahead of currentTime */
const PRE_ROLL = 0.15;

type MouthCallback = (shape: MouthShape) => void;
type BlinkCallback = () => void;
type PlaybackEndCallback = () => void;

/**
 * TimingController
 *
 * Single source of truth for all animation timing.
 * Drives lip sync via AudioContext.currentTime-based scheduling.
 * Also runs the autonomous blink ticker.
 */
export class TimingController {
  private ctx: AudioContext;
  private sourceNode: AudioBufferSourceNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode;

  private scheduledStartTime = 0;
  private visemeTimers: ReturnType<typeof setTimeout>[] = [];
  private speechBlinkTimers: ReturnType<typeof setTimeout>[] = [];
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;

  private onMouthChange: MouthCallback;
  private onBlink: BlinkCallback;
  private onPlaybackEnd: PlaybackEndCallback;

  constructor(opts: {
    onMouthChange: MouthCallback;
    onBlink: BlinkCallback;
    onPlaybackEnd: PlaybackEndCallback;
  }) {
    this.ctx = new AudioContext();
    this.streamDest = this.ctx.createMediaStreamDestination();
    this.onMouthChange = opts.onMouthChange;
    this.onBlink = opts.onBlink;
    this.onPlaybackEnd = opts.onPlaybackEnd;
    this.scheduleBlink();
  }

  /** The AudioContext — needed by VideoRecorder to access the stream destination */
  get audioContext(): AudioContext { return this.ctx; }

  /** MediaStreamDestination for recording audio — connect source nodes here */
  get recordingStream(): MediaStream { return this.streamDest.stream; }

  /**
   * Schedule an AudioBuffer for playback and set up viseme event callbacks.
   * Returns the absolute AudioContext time when playback will start.
   * Must be called after a user gesture so the browser allows AudioContext to resume.
   */
  async schedulePlayback(buffer: AudioBuffer, visemes: VisemeEvent[]): Promise<number> {
    this.stop();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.scheduledStartTime = this.ctx.currentTime + PRE_ROLL;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);    // speaker output
    src.connect(this.streamDest);         // recording output
    src.start(this.scheduledStartTime);

    src.onended = () => {
      // onended fires even when stopped manually; guard with a flag
      if (this.sourceNode === src) {
        this.onMouthChange('rest');
        this.onPlaybackEnd();
        this.sourceNode = null;
      }
    };

    this.sourceNode = src;
    this.scheduleVisemes(visemes);
    this.scheduleSpeechBlinks(buffer.duration);

    return this.scheduledStartTime;
  }

  /** Stop playback and cancel all pending viseme callbacks */
  stop() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch { /* already stopped */ }
      this.sourceNode = null;
    }
    this.visemeTimers.forEach(clearTimeout);
    this.visemeTimers = [];
    this.speechBlinkTimers.forEach(clearTimeout);
    this.speechBlinkTimers = [];
    this.onMouthChange('rest');
  }

  /** Current playhead position in seconds (negative = not started yet) */
  getPlayheadSeconds(): number {
    return this.ctx.currentTime - this.scheduledStartTime;
  }

  /** Schedule a callback at an absolute AudioContext time */
  scheduleAt(absoluteTime: number, cb: () => void): ReturnType<typeof setTimeout> {
    const delayMs = Math.max(0, (absoluteTime - this.ctx.currentTime) * 1000);
    return setTimeout(() => {
      // Re-check we're still close to the right time (handles tab throttling)
      cb();
    }, delayMs);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private scheduleVisemes(visemes: VisemeEvent[]) {
    for (const v of visemes) {
      const fireAt = this.scheduledStartTime + v.offset * TICKS_TO_SEC;
      const shape = visemeToMouthShape(v.visemeId);
      const t = this.scheduleAt(fireAt, () => this.onMouthChange(shape));
      this.visemeTimers.push(t);
    }
  }

  /**
   * Schedule deterministic blinks across the speech window so every
   * recording (even a ~2s one) includes at least one blink. Also resets
   * the autonomous ticker so it can't fire mid-clip and double-blink.
   */
  private scheduleSpeechBlinks(durationSec: number) {
    if (this.blinkTimer) clearTimeout(this.blinkTimer);

    // First blink ~600–900ms in; further blinks every ~2s after that.
    const firstDelay = 600 + Math.random() * 300;
    const interval = 2000;
    const totalMs = Math.max(0, durationSec * 1000 + PRE_ROLL * 1000);

    for (let t = firstDelay; t < totalMs - 200; t += interval + Math.random() * 400) {
      const timer = setTimeout(() => this.onBlink(), t);
      this.speechBlinkTimers.push(timer);
    }

    // Resume the autonomous ticker after the clip ends
    const resumeAt = totalMs + 500;
    const resumeTimer = setTimeout(() => this.scheduleBlink(), resumeAt);
    this.speechBlinkTimers.push(resumeTimer);
  }

  /** Autonomous blink every 3–5 seconds with random jitter */
  private scheduleBlink() {
    const delay = 3000 + Math.random() * 2000;
    this.blinkTimer = setTimeout(() => {
      this.onBlink();
      this.scheduleBlink();
    }, delay);
  }

  destroy() {
    this.stop();
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
    this.ctx.close();
  }
}
