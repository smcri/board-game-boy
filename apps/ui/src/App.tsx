import React, { useState, useCallback, useRef } from 'react';
import type { SseEvent, LlmProvider, SearchProvider } from '@bgb/shared';
import { SettingsPanel } from './components/SettingsPanel';
import { BuildForm } from './components/BuildForm';
import { StreamPanel } from './components/StreamPanel';
import { ConflictModal } from './components/ConflictModal';
import { BundleSummary } from './components/BundleSummary';
import { ChatToggle } from './components/ChatToggle';
import * as api from './lib/api';

/**
 * Explicit build phase state machine.
 *
 *   idle → building → (done | error | paused)
 *   paused → idle  (via Reset)
 *   done   → idle  (via Reset)
 *   error  → idle  (via Reset)
 */
type Phase = 'idle' | 'building' | 'paused' | 'done' | 'error';

export default function App() {
  // ─── Phase state machine ───────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('idle');

  // ─── Build context ─────────────────────────────────────────────────────────
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [buildCtx, setBuildCtx] = useState<{
    llm_provider: LlmProvider;
    search_provider?: SearchProvider;
  } | null>(null);

  // ─── Stream state ──────────────────────────────────────────────────────────
  const [streamEvents, setStreamEvents] = useState<SseEvent[]>([]);
  const [interruptEvent, setInterruptEvent] = useState<Extract<SseEvent, { type: 'interrupt' }> | null>(null);
  const [doneEvent, setDoneEvent] = useState<Extract<SseEvent, { type: 'done' }> | null>(null);

  /**
   * closeStreamRef holds the SSE close handle. We use a ref (not state) so
   * callbacks always see the current value without needing to be in their
   * dependency arrays.
   */
  const closeStreamRef = useRef<(() => void) | null>(null);

  /**
   * resetFormRef is called by App to tell BuildForm to reset its own loading
   * state. BuildForm sets this ref when it mounts.
   */
  const resetFormRef = useRef<(() => void) | null>(null);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const closeActiveStream = useCallback(() => {
    if (closeStreamRef.current) {
      closeStreamRef.current();
      closeStreamRef.current = null;
    }
  }, []);

  const resetFormLoading = useCallback(() => {
    if (resetFormRef.current) {
      resetFormRef.current();
    }
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  /** Called by BuildForm immediately after POST /builds succeeds. */
  const handleBuildStart = useCallback((
    id: string,
    ctx: { llm_provider: LlmProvider; search_provider?: SearchProvider },
  ) => {
    setBundleId(id);
    setBuildCtx(ctx);
    setStreamEvents([]);
    setDoneEvent(null);
    setInterruptEvent(null);
    setPhase('building');
  }, []);

  /** Called by BuildForm as soon as the SSE connection is opened. */
  const handleStreamOpen = useCallback((closeFn: () => void) => {
    closeStreamRef.current = closeFn;
  }, []);

  /** Called by BuildForm to register its own reset function. */
  const handleRegisterReset = useCallback((resetFn: () => void) => {
    resetFormRef.current = resetFn;
  }, []);

  const handlePause = useCallback(() => {
    closeActiveStream();
    setPhase('paused');
    setStreamEvents((prev) => [
      ...prev,
      { type: 'error', message: '⏸ Build paused by user.' } as SseEvent,
    ]);
    resetFormLoading();
  }, [closeActiveStream, resetFormLoading]);

  const handleReset = useCallback(() => {
    closeActiveStream();
    setBundleId(null);
    setBuildCtx(null);
    setStreamEvents([]);
    setDoneEvent(null);
    setInterruptEvent(null);
    setPhase('idle');
    resetFormLoading();
  }, [closeActiveStream, resetFormLoading]);

  const handleStreamEvent = useCallback((event: SseEvent) => {
    setStreamEvents((prev) => [...prev, event]);

    if (event.type === 'interrupt') {
      setInterruptEvent(event);
    }

    if (event.type === 'done') {
      setDoneEvent(event);
      setPhase('done');
      closeActiveStream();
      resetFormLoading();
    }

    if (event.type === 'error') {
      setPhase('error');
      resetFormLoading();
      console.error('Build error:', event.message);
    }
  }, [closeActiveStream, resetFormLoading]);

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

  // ─── Derived display flags ─────────────────────────────────────────────────
  const isBuilding = phase === 'building';
  const showControls = phase !== 'idle';

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
            <BuildForm
              onBuildStart={handleBuildStart}
              onStreamOpen={handleStreamOpen}
              onStreamEvent={handleStreamEvent}
              onRegisterReset={handleRegisterReset}
            />
          </div>

          {/* Right: Stream Panel + controls */}
          <div className="lg:col-span-2 space-y-3">
            {/* Pause / Reset controls */}
            {showControls && (
              <div className="flex gap-2 items-center">
                {isBuilding && (
                  <button
                    onClick={handlePause}
                    className="px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium transition-colors"
                  >
                    ⏸ Pause build
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium transition-colors"
                >
                  ✕ Reset
                </button>
                {phase === 'paused' && (
                  <span className="text-sm text-yellow-600 font-medium">Build paused</span>
                )}
                {phase === 'error' && (
                  <span className="text-sm text-red-600 font-medium">Build failed — reset to try again</span>
                )}
                {phase === 'done' && (
                  <span className="text-sm text-green-600 font-medium">✅ Build complete</span>
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
