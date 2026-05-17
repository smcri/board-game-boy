import React, { useState, useCallback } from 'react';
import type { SseEvent } from '@bgb/shared';
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
  const [streamEvents, setStreamEvents] = useState<SseEvent[]>([]);
  const [interruptEvent, setInterruptEvent] = useState<Extract<
    SseEvent,
    { type: 'interrupt' }
  > | null>(null);
  const [doneEvent, setDoneEvent] = useState<Extract<SseEvent, { type: 'done' }> | null>(null);
  const [closeStream, setCloseStream] = useState<(() => void) | null>(null);

  const handleBuildStart = useCallback((id: string) => {
    setBundleId(id);
    setStreamEvents([]);
    setDoneEvent(null);
  }, []);

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
      // Close stream on done.
      if (closeStream) {
        closeStream();
        setCloseStream(null);
      }
    }

    // Handle error.
    if (event.type === 'error') {
      console.error('Build error:', event.message);
    }
  }, [closeStream]);

  const handleResolveConflicts = useCallback(
    (decisions: Record<string, { decision: 'accept' | 'override'; value?: unknown; note?: string }>) => {
      if (!bundleId) return;

      api.resumeBuild(bundleId, decisions).catch((err) => {
        console.error('Resume error:', err);
        alert(`Resume failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      });

      setInterruptEvent(null);
    },
    [bundleId],
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

          {/* Right: Stream Panel */}
          <div className="lg:col-span-2">
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
