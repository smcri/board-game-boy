import React, { useRef, useEffect } from 'react';
import { useChat } from 'ai/react';
import { getLlmKey } from '../lib/storage';
import { getBackendUrl } from '../lib/api';
import clsx from 'clsx';

export interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ChatPanel — a chat surface for rules clarification using @ai-sdk/react useChat.
 * Streams responses from POST /chat endpoint.
 * Displays disabled state when no LLM API key is configured.
 */
export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get current provider and model from settings (assume stored in localStorage)
  const provider = (localStorage.getItem('llm_provider') || 'openai') as
    | 'openai'
    | 'anthropic'
    | 'ollama'
    | 'groq';
  const model = localStorage.getItem('llm_model') || 'gpt-4o-mini';
  const llmKey = getLlmKey(provider);

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: `${getBackendUrl()}/chat`,
    headers: llmKey
      ? {
          'X-LLM-API-Key': llmKey,
        }
      : {},
    body: {
      llm_provider: provider,
      llm_model: model,
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Handle Ctrl/Cmd+Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const isDisabled = !llmKey;
  const disabledTooltip = isDisabled ? 'LLM API key not configured. Set it in Settings.' : '';

  if (!open) {
    return null;
  }

  return (
    <div className="fixed bottom-16 right-6 w-96 h-96 bg-white rounded-lg shadow-lg border border-slate-200 flex flex-col z-40">
      {/* Header */}
      <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Rules Clarification</h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          aria-label="Close chat panel"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50"
      >
        {messages.length === 0 && (
          <div className="text-sm text-slate-500 italic">
            Ask me about the game rules! E.g., "What should castling do in chess?"
          </div>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={clsx(
                'max-w-xs px-3 py-2 rounded-md text-sm',
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-slate-200 text-slate-900 rounded-bl-none',
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-200 text-slate-900 px-3 py-2 rounded-md text-sm rounded-bl-none">
              <span className="inline-block animate-pulse">…</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white">
        {isDisabled && (
          <div className="text-xs text-red-600 mb-2 px-2">{disabledTooltip}</div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder={isDisabled ? 'Disabled: set API key' : 'Ask a question...'}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={isDisabled || isLoading}
            className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm disabled:bg-slate-100 disabled:text-slate-400"
          />
          <button
            type="submit"
            disabled={isDisabled || isLoading || !input.trim()}
            className="px-3 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
        <div className="text-xs text-slate-500 mt-2 px-2">Ctrl/Cmd+Enter to send</div>
      </div>
    </div>
  );
}
