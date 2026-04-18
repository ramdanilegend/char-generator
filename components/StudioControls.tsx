'use client';

import { useState } from 'react';
import type { CharacterCanvasHandle } from './CharacterCanvas';
import type { BodyAnimation } from '@/types';
import { DEFAULT_VOICES } from '@/tts/TTSClient';
import { VideoRecorder } from '@/recorder/VideoRecorder';

const GESTURE_OPTIONS: { label: string; value: BodyAnimation }[] = [
  { label: 'Walk',       value: 'walk' },
  { label: 'Wave',       value: 'wave' },
  { label: 'Shrug',      value: 'shrug' },
  { label: 'Nod',        value: 'nod' },
  { label: 'Shake head', value: 'shake-head' },
  { label: 'Point',      value: 'point' },
];

interface Props {
  handle: CharacterCanvasHandle | null;
}

type Phase = 'idle' | 'synthesizing' | 'playing' | 'recording';

export default function StudioControls({ handle }: Props) {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(DEFAULT_VOICES[0].value);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [recordBlob, setRecordBlob] = useState<Blob | null>(null);

  const canPlay   = !!handle?.isReady && text.trim().length > 0 && phase === 'idle';
  const canRecord = !!handle?.isReady && text.trim().length > 0 && phase === 'idle';
  const isLoading = phase === 'synthesizing';

  const handlePlay = async () => {
    if (!handle) return;
    setError('');
    setPhase('synthesizing');
    try {
      await handle.speak(text, voice); // resolves when playback ends
    } catch (e) {
      setError(String(e));
    } finally {
      setPhase('idle');
    }
  };

  const handleRecord = async () => {
    if (!handle) return;
    setError('');
    setRecordBlob(null);
    setPhase('synthesizing');
    try {
      handle.startRecording();
      setPhase('recording');
      await handle.speak(text, voice); // resolves when playback ends
      const blob = await handle.stopRecording();
      setRecordBlob(blob);
    } catch (e) {
      setError(String(e));
    } finally {
      setPhase('idle');
    }
  };

  const handleGesture = (gesture: BodyAnimation) => {
    handle?.queueGesture({ gesture, interrupt: false });
  };

  const handleDownload = () => {
    if (recordBlob) VideoRecorder.download(recordBlob);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg">
      {/* Script input */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 uppercase tracking-wider">Script</label>
        <textarea
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm resize-none
                     border border-gray-700 focus:border-indigo-500 focus:outline-none
                     placeholder:text-gray-600"
          rows={4}
          placeholder="Type what the character should say..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={phase !== 'idle'}
        />
      </div>

      {/* Voice picker */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 uppercase tracking-wider">Voice</label>
        <select
          className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm
                     border border-gray-700 focus:border-indigo-500 focus:outline-none"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          disabled={phase !== 'idle'}
        >
          {DEFAULT_VOICES.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handlePlay}
          disabled={!canPlay}
          className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700
                     disabled:text-gray-500 text-white text-sm font-medium py-2 px-4
                     transition-colors"
        >
          {isLoading ? 'Synthesizing…' : phase === 'playing' ? 'Playing…' : '▶ Play'}
        </button>

        <button
          onClick={handleRecord}
          disabled={!canRecord}
          className="flex-1 rounded-lg bg-red-700 hover:bg-red-600 disabled:bg-gray-700
                     disabled:text-gray-500 text-white text-sm font-medium py-2 px-4
                     transition-colors"
        >
          {phase === 'recording' ? '● Recording…' : '⏺ Record'}
        </button>
      </div>

      {/* Manual gesture buttons */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 uppercase tracking-wider">Manual gestures</label>
        <div className="flex flex-wrap gap-2">
          {GESTURE_OPTIONS.map((g) => (
            <button
              key={g.value}
              onClick={() => handleGesture(g.value)}
              disabled={!handle?.isReady}
              className="rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40
                         text-white text-xs py-1 px-3 transition-colors"
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Download */}
      {recordBlob && (
        <div className="flex items-center gap-3 bg-green-900/40 border border-green-700
                        rounded-lg px-4 py-3">
          <span className="text-green-400 text-sm flex-1">Recording ready!</span>
          <button
            onClick={handleDownload}
            className="text-sm bg-green-700 hover:bg-green-600 text-white rounded px-3 py-1 transition-colors"
          >
            Download WebM
          </button>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="rounded-lg bg-red-900/40 border border-red-700 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

    </div>
  );
}
