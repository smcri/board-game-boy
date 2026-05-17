import React from 'react';
import type { SseEvent } from '@bgb/shared';
import { Card, CardContent, CardHeader } from './ui/Card';

/**
 * Props for StreamPanel component.
 */
export interface StreamPanelProps {
  events: SseEvent[];
}

/**
 * Live build stream panel showing SSE events.
 * Displays update, search, fetch, cache_hit, and error events with appropriate icons.
 */
export function StreamPanel({ events }: StreamPanelProps) {
  const getEventIcon = (type: SseEvent['type']): string => {
    switch (type) {
      case 'update':
        return '📝';
      case 'search':
        return '🔍';
      case 'fetch':
        return '📥';
      case 'interrupt':
        return '⚠️';
      case 'done':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '•';
    }
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Build stream</h3>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-96 overflow-y-auto font-mono text-sm">
          {events.length === 0 ? (
            <p className="text-slate-400">Waiting for build events...</p>
          ) : (
            events.map((event, idx) => (
              <div key={idx} className="border-l-2 border-blue-300 pl-3 py-1">
                <div className="flex items-start gap-2">
                  <span className="text-lg">{getEventIcon(event.type)}</span>
                  <div className="flex-1 min-w-0">
                    {event.type === 'update' && (
                      <div>
                        <span className="font-bold text-slate-700">{event.node}</span>
                        {event.message && <span className="text-slate-600"> — {event.message}</span>}
                      </div>
                    )}
                    {event.type === 'search' && (
                      <div>
                        <span className="font-bold text-slate-700">Search ({event.provider})</span>
                        <span className="text-slate-600"> — {event.query}</span>
                        <span className="text-slate-500"> ({event.hits} hits)</span>
                      </div>
                    )}
                    {event.type === 'fetch' && (
                      <div>
                        <span className="font-bold text-slate-700">Fetch</span>
                        <span className="text-slate-600"> — {event.url}</span>
                        <span className="text-slate-500"> [{event.status}]</span>
                        {event.bytes && (
                          <span className="text-slate-500"> {event.bytes} bytes</span>
                        )}
                      </div>
                    )}
                    {event.type === 'interrupt' && (
                      <div>
                        <span className="font-bold text-slate-700">Interrupt</span>
                        <span className="text-slate-600"> — Waiting for conflict resolution</span>
                      </div>
                    )}
                    {event.type === 'done' && (
                      <div>
                        <span className="font-bold text-slate-700">Done</span>
                        <span className="text-slate-600"> — {event.bundle_id}</span>
                      </div>
                    )}
                    {event.type === 'error' && (
                      <div>
                        <span className="font-bold text-red-700">Error</span>
                        {event.node && <span className="text-slate-600"> [{event.node}]</span>}
                        <span className="text-red-600"> {event.message}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
