import React from 'react';
import type { SseEvent } from '@bgb/shared';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';

/**
 * Props for BundleSummary component.
 */
export interface BundleSummaryProps {
  doneEvent: Extract<SseEvent, { type: 'done' }> | null;
}

/**
 * Bundle summary panel shown after a successful build.
 * Displays bundle ID, links to play and download, and conflict summary.
 */
export function BundleSummary({ doneEvent }: BundleSummaryProps) {
  if (!doneEvent) return null;

  const backendUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
  const playUrl = `${backendUrl}/bundles/${doneEvent.bundle_id}/play`;
  const bundleJsonUrl = `${backendUrl}/bundles/${doneEvent.bundle_id}/bundle.json`;
  const downloadUrl = `${backendUrl}/bundles/${doneEvent.bundle_id}/download`;

  return (
    <Card className="border-green-200 bg-green-50">
      <CardHeader>
        <h3 className="text-lg font-semibold text-green-900">Game created!</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm text-slate-600">Bundle ID:</p>
          <p className="font-mono text-sm font-semibold text-slate-900 break-all">
            {doneEvent.bundle_id}
          </p>
        </div>

        <div className="space-y-2">
          <Button
            onClick={() => window.open(playUrl, '_blank')}
            className="w-full"
            variant="primary"
          >
            Open game
          </Button>
          <Button
            onClick={() => window.open(bundleJsonUrl, '_blank')}
            className="w-full"
            variant="secondary"
          >
            View bundle.json
          </Button>
          <Button
            onClick={() => {
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.download = `${doneEvent.bundle_id}.bundle.json`;
              link.click();
            }}
            className="w-full"
            variant="secondary"
          >
            Download bundle
          </Button>
        </div>

        {/* Conflict Summary */}
        <div className="border-t border-green-200 pt-4">
          <p className="text-sm font-semibold text-slate-700 mb-2">Conflict Summary</p>
          <div className="space-y-1 text-sm">
            {doneEvent.conflicts_summary.blocking > 0 && (
              <div className="text-red-700">
                🔴 {doneEvent.conflicts_summary.blocking} blocking conflict
                {doneEvent.conflicts_summary.blocking !== 1 ? 's' : ''}
              </div>
            )}
            {doneEvent.conflicts_summary.non_blocking > 0 && (
              <div className="text-yellow-700">
                🟡 {doneEvent.conflicts_summary.non_blocking} non-blocking conflict
                {doneEvent.conflicts_summary.non_blocking !== 1 ? 's' : ''}
              </div>
            )}
            {doneEvent.conflicts_summary.unsupported > 0 && (
              <div className="text-blue-700">
                🔵 {doneEvent.conflicts_summary.unsupported} unsupported effect
                {doneEvent.conflicts_summary.unsupported !== 1 ? 's' : ''}
              </div>
            )}
            {doneEvent.conflicts_summary.blocking === 0 &&
              doneEvent.conflicts_summary.non_blocking === 0 &&
              doneEvent.conflicts_summary.unsupported === 0 && (
                <div className="text-green-700">✅ No conflicts</div>
              )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
