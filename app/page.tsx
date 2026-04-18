'use client';

import { useState, useCallback } from 'react';
import CharacterCanvas from '@/components/CharacterCanvas';
import StudioControls from '@/components/StudioControls';
import type { CharacterCanvasHandle } from '@/components/CharacterCanvas';

export default function StudioPage() {
  const [handle, setHandle] = useState<CharacterCanvasHandle | null>(null);
  const [debugState, setDebugState] = useState('initializing…');

  const handleReady = useCallback((h: CharacterCanvasHandle) => {
    setHandle(h);
    setDebugState('idle / idle / mouth:rest');
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-8 gap-10">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-indigo-300">
          Pixel Trainer Studio
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Pokemon trainer · Edge TTS · Lip sync · Video export
        </p>
      </div>

      {/* Canvas + controls layout */}
      <div className="flex flex-col md:flex-row gap-10 items-start justify-center w-full max-w-2xl">
        {/* Character canvas */}
        <div className="flex flex-col items-center gap-3">
          <div className="bg-gray-900 rounded-xl p-4 flex items-center justify-center
                          border border-gray-800 shadow-xl">
            <CharacterCanvas
              onReady={handleReady}
              onStateChange={setDebugState}
            />
          </div>
          {/* Debug state pill */}
          <span className="text-xs font-mono text-gray-600 bg-gray-900 px-3 py-1 rounded-full border border-gray-800">
            {debugState}
          </span>
        </div>

        {/* Studio controls */}
        <StudioControls handle={handle} />
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-700">
        Replace placeholder sprites with your own art in{' '}
        <code className="text-gray-600">public/sprites/</code> — see{' '}
        <code className="text-gray-600">scripts/generate-sprites.mjs</code>
      </p>
    </main>
  );
}
