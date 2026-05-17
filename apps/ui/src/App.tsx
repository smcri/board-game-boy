import React, { useState, useCallback } from 'react';
import type { SseEvent, LlmProvider, SearchProvider } from '@bgb/shared';
import { SettingsPanel } from './components/SettingsPanel';
import { BuildForm } from './components/BuildForm';
import { StreamPanel } from './components/StreamPanel';
import { ConflictModal } from './components/ConflictModal';
import { BundleSummary } from './components/BundleSummary';
import { ChatToggle } from './components/ChatToggle';
import * as api from './lib/api';

/**
 * Main App component — orchestrates the Builder UI layout.
 * Layout:
 *  - Top: Settings panel
 *  - Left/Center: Build form
 *  - Right: Live build stream
 *  - Overlay: Conflict modal (when needed)
 *  - Bottom (after done): Bundle summary
 */
export default function App() {
  const [bundleId, setBundleId] = useState<string | null>(null);
  /**
   * The provider tuple that started the *current* build. We remember it so the
   * resume path can attach the matching localStorage keys without guessing.
   */
  const [buildCtx, setBuildCtx] = useState<{
    llm_provider: LlmProvider;
    search_provider?: SearchProvider;
  } | null>(null);
  const [streamEvents, setStreamEvents] = useState<SseEvent[]>([]);
  const [interruptEvent, setInterruptEvent] = useState<Extract<
    SseEvent,
    { type: 'interrupt' }
  > | null>(null);
  const [doneEvent, setDoneEvent] = useState<Extract<SseEvent, { type: 'done' }> | null>(null);
  const [closeStream, setCloseStream] = useState<(() => void) | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const handleBuildStart = useCallback((id: string, ctx: { llm_provider: LlmProvider; search_provider?: SearchProvider }) => {
    setBundleId(id);
    setBuildCtx(ctx);
    setStreamEvents([]);
    setDoneEvent(null);
    setInterruptEvent(null);
    setIsBuilding(true);
  }, []);

  const handlePause = useCallback(() => {
    if (closeStream) {
      closeStream();
      setCloseStream(null);
    }
    setIsBuilding(false);
    setStreamEvents((prev) => [
      ...prev,
      { type: 'error', message: 'Build paused by user.' } as SseEvent,
    ]);
  }, [closeStream]);

  const handleReset = useCallback(() => {
    if (closeStream) {
      closeStream();
      setCloseStream(null);
    }
    setBundleId(null);
    setBuildCtx(null);
    setStreamEvents([]);
    setDoneEvent(null);
    setInterruptEvent(null);
    setIsBuilding(false);
  }, [closeStream]);

  const handleStreamEvent = useCallback((event: SseEvent) => {
    // Add to stream history.
    setStreamEvents((prev) => [...prev, event]);

    // Handle interrupt.
    if (event.type === 'interrupt') {
      setInterruptEvent(event);
    }

    // Handle done.
    if (event.type === 'done') {
      setDoneEvent(event);
      setIsBuilding(false);
      // Close stream on done.
      if (closeStream) {
        closeStream();
        setCloseStream(null);
      }
    }

    // Handle error — build ended.
    if (event.type === 'error') {
      setIsBuilding(false);
    }

    // Handle error.
    if (event.type === 'error') {
      console.error('Build error:', event.message);
    }
  }, [closeStream]);

  const handleResolveConflicts = useCallback(
    (decisions: Record<string, { decision: 'accept' | 'override'; value?: unknown; note?: string }>) => {
      if (!bundleId || !buildCtx) return;

      api.resumeBuild(bundleId, decisions, buildCtx).catch((err) => {
        console.error('Resume error:', err);
        alert(`Resume failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });

      setInterruptEvent(null);
    },
    [bundleId, buildCtx],
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900">Board Game Builder</h1>
          <p className="text-slate-600 mt-2">
            Design playable games using AI. No coding required.
          </p>
        </div>

        {/* Settings Panel (always visible) */}
        <SettingsPanel />

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Build Form */}
          <div className="lg:col-span-1">
            <BuildForm onBuildStart={handleBuildStart} onStreamEvent={handleStreamEvent} />
          </div>

          {/* Right: Stream Panel + controls */}
          <div className="lg:col-span-2 space-y-3">
            {/* Pause / Reset buttons */}
            {(isBuilding || streamEvents.length > 0) && (
              <div className="flex gap-2">
                {isBuilding && (
                  <button
                    onClick={handlePause}
                    className="px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium transition-colors"
                  >
                    ⏸ Pause build
                  </button>
                )}
                {streamEvents.length > 0 && (
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium transition-colors"
                  >
                    ✕ Reset
                  </button>
                )}
              </div>
            )}
            <StreamPanel events={streamEvents} />
          </div>
        </div>

        {/* Bundle Summary (shown after done) */}
        {doneEvent && (
          <div className="mt-6">
            <BundleSummary doneEvent={doneEvent} />
          </div>
        )}
      </div>

      {/* Conflict Modal (overlay) */}
      <ConflictModal
        open={!!interruptEvent}
        conflicts={interruptEvent?.conflicts ?? []}
        onResolve={handleResolveConflicts}
      />

      {/* Chat Toggle (floating button + panel) */}
      <ChatToggle />
    </div>
  );
}
