import React, { useState } from 'react';
import { ChatPanel } from './ChatPanel';

/**
 * ChatToggle — a floating button (bottom-right) that opens/closes the ChatPanel.
 */
export function ChatToggle() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating chat button */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 w-12 h-12 rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-all z-30 flex items-center justify-center text-lg font-semibold ${
          open ? 'scale-0 pointer-events-none' : 'scale-100'
        }`}
        aria-label="Open chat"
      >
        💬
      </button>

      {/* Chat panel */}
      <ChatPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
