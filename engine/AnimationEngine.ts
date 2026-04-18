'use client';

import * as PIXI from 'pixi.js';
import type { StateMachine } from './StateMachine';
import type { GestureScheduler } from './GestureScheduler';
import type { MouthShape, EyeState, BodyAnimation } from '@/types';
import { MOUTH_SHAPES } from '@/tts/LipSyncMapper';

/** Display scale: sprite tiles rendered at 2× */
const DISPLAY_SCALE = 2;

/** Eye states in order matching eyes.png frame columns */
const EYE_STATES: EyeState[] = ['open', 'half', 'closed', 'happy', 'surprised'];

/** ms per idle frame */
const IDLE_FRAME_DURATION = 160;
const IDLE_FRAME_COUNT = 6;

/** Max delta-time to prevent large jumps on lag/tab switch */
const MAX_DELTA_MS = 50;

interface SpriteLayers {
  body:  PIXI.Sprite;
  eyes:  PIXI.Sprite;
  mouth: PIXI.Sprite;
}

interface HeadShift {
  x: number;
  y: number;
}

interface SpriteMeta {
  tileW: number;
  tileH: number;
  face?: {
    eyeY: number;
    eyeLX: number;
    eyeRX: number;
    eyeW: number;
    eyeH: number;
    mouthY: number;
    mouthX: number;
    mouthW: number;
    mouthH: number;
  };
  headShifts?: Record<string, HeadShift[]>;
}

/**
 * AnimationEngine
 *
 * Owns the PixiJS Application and the layered character sprite compositor.
 *
 * Scene graph:
 *   app.stage
 *   └── CharacterContainer (scaled DISPLAY_SCALE×)
 *       ├── body  (Sprite — texture swapped per frame)
 *       ├── eyes  (Sprite — texture swapped per state, positioned per head shift)
 *       └── mouth (Sprite — texture swapped per mouth shape, positioned per head shift)
 *
 * Eyes and mouth sprites are repositioned every frame according to the
 * per-frame head shift data from sprite-meta.json, so they stay glued
 * to the face even during head animations (nod, shake-head, etc.).
 */
export class AnimationEngine {
  private app!: PIXI.Application;
  private layers!: SpriteLayers;
  private container!: HTMLElement;

  private tileW = 56;
  private tileH = 80;

  private bodyTextures:  Record<string, PIXI.Texture> = {};
  private mouthTextures: Record<MouthShape, PIXI.Texture> = {} as Record<MouthShape, PIXI.Texture>;
  private eyeTextures:   Record<EyeState, PIXI.Texture> = {} as Record<EyeState, PIXI.Texture>;

  /** Per-frame head shift offsets — loaded from sprite-meta.json */
  private headShifts: Record<string, HeadShift[]> = {};

  private sm: StateMachine;
  private gs: GestureScheduler;

  private idleFrame = 0;
  private idleAcc = 0;

  /** Current interpolated overlay offsets for smooth transitions */
  private currentHeadDx = 0;
  private currentHeadDy = 0;

  private unsubscribe: (() => void) | null = null;
  initialized = false;

  constructor(sm: StateMachine, gs: GestureScheduler) {
    this.sm = sm;
    this.gs = gs;
  }

  /** Mount PixiJS into the given container element */
  async init(container: HTMLElement) {
    this.container = container;

    // Read tile dimensions + head shifts from sprite-meta.json
    try {
      const res = await fetch('/sprites/sprite-meta.json');
      if (res.ok) {
        const meta: SpriteMeta = await res.json();
        this.tileW = meta.tileW;
        this.tileH = meta.tileH;
        if (meta.headShifts) {
          this.headShifts = meta.headShifts;
        }
      }
    } catch { /* use defaults */ }

    this.app = new PIXI.Application();
    await this.app.init({
      width:      this.tileW * DISPLAY_SCALE,
      height:     this.tileH * DISPLAY_SCALE,
      background: 0x1a1a2e,
      antialias:  false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Nearest-neighbor scaling for pixel-perfect rendering
    PIXI.TextureStyle.defaultOptions.scaleMode = 'nearest';

    container.appendChild(this.app.canvas as HTMLCanvasElement);

    await this.loadAssets();
    this.buildSceneGraph();
    this.attachStateMachineListener();

    this.app.ticker.add(this.onTick.bind(this));
    this.initialized = true;
  }

  /** The tile dimensions — used by CharacterCanvas to size the container div */
  get displayWidth()  { return this.tileW * DISPLAY_SCALE; }
  get displayHeight() { return this.tileH * DISPLAY_SCALE; }

  /** Expose the underlying canvas for captureStream() */
  get canvas(): HTMLCanvasElement | null {
    return this.initialized ? (this.app.canvas as HTMLCanvasElement) : null;
  }

  destroy() {
    this.unsubscribe?.();
    if (this.initialized) this.app.destroy(true);
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------------

  private async loadAssets() {
    // Body spritesheet
    const bodySheet = await PIXI.Assets.load<PIXI.Spritesheet>('/sprites/body.json');
    this.bodyTextures = bodySheet.textures as Record<string, PIXI.Texture>;

    // Mouth spritesheet
    const mouthSheet = await PIXI.Assets.load<PIXI.Spritesheet>('/sprites/mouth.json');
    for (const shape of MOUTH_SHAPES) {
      const key = `mouth-${shape} 0`;
      this.mouthTextures[shape] = (mouthSheet.textures as Record<string, PIXI.Texture>)[key];
    }

    // Eyes spritesheet
    const eyesSheet = await PIXI.Assets.load<PIXI.Spritesheet>('/sprites/eyes.json');
    for (const state of EYE_STATES) {
      const key = `eyes-${state} 0`;
      this.eyeTextures[state] = (eyesSheet.textures as Record<string, PIXI.Texture>)[key];
    }
  }

  // ---------------------------------------------------------------------------
  // Scene graph
  // ---------------------------------------------------------------------------

  private buildSceneGraph() {
    const character = new PIXI.Container();
    character.scale.set(DISPLAY_SCALE);

    const body  = new PIXI.Sprite(this.bodyTextures['idle 0']);
    const eyes  = new PIXI.Sprite(this.eyeTextures['open']);
    const mouth = new PIXI.Sprite(this.mouthTextures['rest']);

    character.addChild(body);
    character.addChild(eyes);
    character.addChild(mouth);

    this.layers = { body, eyes, mouth };
    this.app.stage.addChild(character);
  }

  // ---------------------------------------------------------------------------
  // State machine → visual sync
  // ---------------------------------------------------------------------------

  private attachStateMachineListener() {
    this.unsubscribe = this.sm.onChange((state) => {
      const mouthTex = this.mouthTextures[state.mouth];
      if (mouthTex) this.layers.mouth.texture = mouthTex;

      const eyeTex = this.eyeTextures[state.eyes];
      if (eyeTex) this.layers.eyes.texture = eyeTex;
    });
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  private onTick(ticker: PIXI.Ticker) {
    // Clamp deltaMs to prevent huge jumps from lag spikes or tab switches
    const deltaMs = Math.min(ticker.deltaMS, MAX_DELTA_MS);
    this.gs.tick(deltaMs);

    const anim = this.gs.currentAnimation;
    let frame: number;

    if (anim === 'idle') {
      this.idleAcc += deltaMs;
      if (this.idleAcc >= IDLE_FRAME_DURATION) {
        this.idleAcc -= IDLE_FRAME_DURATION;
        this.idleFrame = (this.idleFrame + 1) % IDLE_FRAME_COUNT;
      }
      frame = this.idleFrame;
      this.setBodyFrame('idle', frame);
    } else {
      frame = this.gs.currentFrame;
      this.setBodyFrame(anim, frame);
    }

    // Update eyes/mouth overlay positions based on head shift for current frame
    this.updateOverlayPositions(anim, frame);
  }

  private setBodyFrame(anim: BodyAnimation, frame: number) {
    const key = `${anim} ${frame}`;
    const tex = this.bodyTextures[key];
    if (tex && this.layers.body.texture !== tex) {
      this.layers.body.texture = tex;
    }
  }

  /**
   * Reposition eyes and mouth overlay sprites to follow the head.
   * Uses the per-frame head shift data from sprite-meta.json.
   * Smoothly interpolates between positions to prevent jitter.
   */
  private updateOverlayPositions(anim: BodyAnimation, frame: number) {
    const shifts = this.headShifts[anim];
    let targetDx = 0;
    let targetDy = 0;

    if (shifts && frame < shifts.length) {
      targetDx = shifts[frame].x;
      targetDy = shifts[frame].y;
    }

    // Smooth interpolation to prevent jerky overlay movement
    const lerpSpeed = 0.3;
    this.currentHeadDx += (targetDx - this.currentHeadDx) * lerpSpeed;
    this.currentHeadDy += (targetDy - this.currentHeadDy) * lerpSpeed;

    // Snap to integer pixels (for pixel-perfect rendering) when very close
    const dx = Math.abs(this.currentHeadDx - targetDx) < 0.1
      ? targetDx : Math.round(this.currentHeadDx);
    const dy = Math.abs(this.currentHeadDy - targetDy) < 0.1
      ? targetDy : Math.round(this.currentHeadDy);

    this.layers.eyes.x = dx;
    this.layers.eyes.y = dy;
    this.layers.mouth.x = dx;
    this.layers.mouth.y = dy;
  }
}
