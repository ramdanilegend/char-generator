import type { BodyAnimation, GestureRequest } from '@/types';
import type { StateMachine } from './StateMachine';

/** Frame counts per animation (must match body.json) */
const ANIM_FRAME_COUNTS: Record<BodyAnimation, number> = {
  idle:          6,
  walk:          8,
  wave:         10,
  shrug:         8,
  nod:           6,
  'shake-head':  8,
  point:         6,
};

/** Default frame duration in ms per animation */
const ANIM_FRAME_DURATION: Record<BodyAnimation, number> = {
  idle:          160,
  walk:          100,
  wave:           80,
  shrug:         100,
  nod:           100,
  'shake-head':   80,
  point:         120,
};

/** Maximum delta-time per tick to prevent jumping frames on lag */
const MAX_DELTA_MS = 50;

interface ActiveGesture {
  name: BodyAnimation;
  frame: number;
  frameCount: number;
  frameDurationMs: number;
  accMs: number;
  onComplete: () => void;
}

/**
 * GestureScheduler
 *
 * Manages the gesture queue and drives body animation frame advancement.
 * Call tick(deltaMs) from the render loop.
 * New gestures queue behind the active one unless interrupt=true.
 */
export class GestureScheduler {
  private sm: StateMachine;
  private pending: GestureRequest[] = [];
  private active: ActiveGesture | null = null;
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];

  /** Expose current body animation frame for AnimationEngine to read */
  currentFrame = 0;
  currentAnimation: BodyAnimation = 'idle';

  constructor(sm: StateMachine) {
    this.sm = sm;
  }

  /**
   * Queue a gesture request.
   * @param req.delayMs — ms from now before the gesture starts
   * @param req.interrupt — if true, abort current gesture immediately
   */
  enqueue(req: GestureRequest) {
    const delay = req.delayMs ?? 0;

    if (delay > 0) {
      const t = setTimeout(() => this.enqueue({ ...req, delayMs: 0 }), delay);
      this.pendingTimers.push(t);
      return;
    }

    if (req.interrupt && this.active) {
      // Skip to last frame of current gesture then start this one
      this.active.frame = this.active.frameCount - 1;
      this.active.accMs = this.active.frameDurationMs; // force completion next tick
    }

    this.pending.push(req);
  }

  /**
   * Drive animation frame advancement. Call every render tick.
   * Delta is clamped to prevent multi-frame jumps from lag spikes.
   * @param deltaMs — ms since last tick (already clamped by AnimationEngine)
   */
  tick(deltaMs: number) {
    // Clamp delta to prevent skipping frames on lag/tab switch
    const dt = Math.min(deltaMs, MAX_DELTA_MS);

    // Try to start next gesture from queue if idle
    if (!this.active && this.pending.length > 0) {
      const next = this.pending.shift()!;
      this.startGesture(next.gesture);
    }

    if (this.active) {
      this.active.accMs += dt;
      // Advance by exactly one frame at a time (no multi-frame skipping)
      if (this.active.accMs >= this.active.frameDurationMs) {
        this.active.accMs -= this.active.frameDurationMs;
        this.active.frame++;
        if (this.active.frame >= this.active.frameCount) {
          // Gesture complete
          const { onComplete } = this.active;
          this.active = null;
          this.currentAnimation = 'idle';
          this.currentFrame = 0;
          this.sm.gestureComplete();
          onComplete();
          return;
        }
      }
      this.currentFrame = this.active.frame;
    } else {
      // Idle loop
      this.currentAnimation = 'idle';
      // Idle frame advancement is handled by AnimationEngine directly
    }
  }

  clearAll() {
    this.pendingTimers.forEach(clearTimeout);
    this.pendingTimers = [];
    this.pending = [];
    this.active = null;
    this.currentAnimation = 'idle';
    this.currentFrame = 0;
    this.sm.gestureComplete();
  }

  private startGesture(name: BodyAnimation) {
    if (name === 'idle') return;
    this.active = {
      name,
      frame: 0,
      frameCount: ANIM_FRAME_COUNTS[name],
      frameDurationMs: ANIM_FRAME_DURATION[name],
      accMs: 0,
      onComplete: () => {},
    };
    this.currentAnimation = name;
    this.currentFrame = 0;
    this.sm.startGesture(name);
  }
}
