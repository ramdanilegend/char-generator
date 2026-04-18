'use client';

import { useEffect, useRef } from 'react';
import { AnimationEngine } from '@/engine/AnimationEngine';
import { StateMachine } from '@/engine/StateMachine';
import { GestureScheduler } from '@/engine/GestureScheduler';
import { TimingController } from '@/engine/TimingController';
import { VideoRecorder } from '@/recorder/VideoRecorder';
import { synthesize, decodeAudio } from '@/tts/TTSClient';
import type { BodyAnimation, GestureRequest } from '@/types';

export interface CharacterCanvasHandle {
  speak: (text: string, voice: string, gestures?: Array<{ timeMs: number; gesture: BodyAnimation }>) => Promise<void>;
  startRecording: () => void;
  stopRecording: () => Promise<Blob>;
  queueGesture: (req: GestureRequest) => void;
  isReady: boolean;
}

interface Props {
  onReady?: (handle: CharacterCanvasHandle) => void;
  onStateChange?: (state: string) => void;
  onPlaybackEnd?: () => void;
}

/**
 * CharacterCanvas
 *
 * Mounts the PixiJS canvas, initialises all engine subsystems, and exposes
 * an imperative handle via the onReady callback.
 */
export default function CharacterCanvas({ onReady, onStateChange, onPlaybackEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Engine refs — stable across renders
  const engineRef    = useRef<AnimationEngine | null>(null);
  const smRef        = useRef<StateMachine | null>(null);
  const gsRef        = useRef<GestureScheduler | null>(null);
  const tcRef        = useRef<TimingController | null>(null);
  const recorderRef  = useRef<VideoRecorder | null>(null);
  const readyRef     = useRef(false);
  const sizeRef      = useRef({ w: 168, h: 240 }); // default 56×80 @ 3×
  // Set to true when the caller wants the next speak() call to be recorded.
  // The actual recorder.start() happens just before audio playback begins,
  // after synthesis completes, so no leading silence is captured.
  const pendingRecordRef = useRef(false);

  const handleRef = useRef<CharacterCanvasHandle>({
    isReady: false,
    speak: async () => {},
    startRecording: () => {},
    stopRecording: async () => new Blob(),
    queueGesture: () => {},
  });

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    (async () => {
      // 1. Build subsystems
      const sm = new StateMachine();
      const gs = new GestureScheduler(sm);
      let playbackResolve: (() => void) | null = null;

      const tc = new TimingController({
        onMouthChange: (shape) => sm.setMouth(shape),
        onBlink: () => sm.triggerBlink(),
        onPlaybackEnd: () => {
          sm.setIdle();
          gs.clearAll();
          onPlaybackEnd?.();
          playbackResolve?.();
          playbackResolve = null;
        },
      });
      const engine = new AnimationEngine(sm, gs);
      const recorder = new VideoRecorder();

      smRef.current    = sm;
      gsRef.current    = gs;
      tcRef.current    = tc;
      engineRef.current = engine;
      recorderRef.current = recorder;

      // 2. Mount PixiJS
      await engine.init(containerRef.current!);
      if (destroyed) { engine.destroy(); return; }

      // Resize the wrapper to match the canvas (tile size may vary per sprite)
      sizeRef.current = { w: engine.displayWidth, h: engine.displayHeight };
      if (containerRef.current) {
        containerRef.current.style.width  = `${engine.displayWidth}px`;
        containerRef.current.style.height = `${engine.displayHeight}px`;
      }

      // 3. Subscribe to state for debug label
      sm.onChange((s) => onStateChange?.(`${s.base} / ${s.currentAnimation} / mouth:${s.mouth}`));

      // 4. Build handle
      const handle: CharacterCanvasHandle = {
        isReady: true,
        speak: (text, voice, gestures = []) => {
          sm.setListening();

          // Resume AudioContext immediately while still in the user-gesture
          // call stack. If we wait until after the async synthesize() network
          // call the browser may have revoked the activation token, causing
          // ctx.resume() to silently fail and scheduling to use stale time.
          void tc.audioContext.resume();

          return new Promise<void>(async (resolve, reject) => {
            playbackResolve = resolve;
            try {
              const tts = await synthesize(text, voice);
              const buffer = await decodeAudio(tts.audioBase64, tc.audioContext);

              // Start recording NOW — just before audio plays — so the recorded
              // clip matches the TTS duration with no leading synthesis silence.
              if (pendingRecordRef.current) {
                const canvas = engine.canvas;
                if (!canvas) throw new Error('Canvas not ready');
                recorder.start(canvas, tc.recordingStream);
                pendingRecordRef.current = false;
              }

              // schedulePlayback is now async: it awaits ctx.resume() internally
              // to guarantee the AudioContext is running before deriving startTime.
              const startTime = await tc.schedulePlayback(buffer, tts.visemes);
              const nowMs = tc.audioContext.currentTime * 1000;
              for (const g of gestures) {
                const delayMs = Math.max(0, (startTime * 1000 + g.timeMs) - nowMs);
                gs.enqueue({ gesture: g.gesture, delayMs });
              }
            } catch (err) {
              pendingRecordRef.current = false;
              playbackResolve = null;
              sm.setIdle();
              reject(err);
            }
          });
        },
        // Mark that the next speak() should capture a recording.
        // The recorder actually starts after synthesis so no silence is prepended.
        startRecording: () => {
          pendingRecordRef.current = true;
        },
        stopRecording: () => recorder.stop(),
        queueGesture: (req) => gs.enqueue(req),
      };

      handleRef.current = handle;
      readyRef.current = true;
      onReady?.(handle);
    })();

    return () => {
      destroyed = true;
      engineRef.current?.destroy();
      tcRef.current?.destroy();
      engineRef.current = null;
      smRef.current = null;
      gsRef.current = null;
      tcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width:           sizeRef.current.w,
        height:          sizeRef.current.h,
        imageRendering:  'pixelated',
        minWidth:        sizeRef.current.w,
      }}
      className="rounded-lg overflow-hidden shadow-lg shadow-indigo-500/30"
    />
  );
}
