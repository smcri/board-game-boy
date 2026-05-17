import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../components/ChatPanel';

describe('ChatPanel', () => {
  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      llm_key_openai: 'test-key-123',
    };
    global.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((key) => delete store[key]);
      },
      length: Object.keys(store).length,
      key: (index: number) => Object.keys(store)[index] || null,
    } as Storage;

    // Mock fetch for streaming
    global.fetch = vi.fn((input: string | URL | Request) => {
      let url = '';
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input instanceof Request) {
        url = input.url;
      }
      if (url.includes('/chat')) {
        // Simulate streamed response with Vercel AI SDK format
        const stream = new ReadableStream({
          start(controller) {
            // Send three tokens: "Hello", " ", "world"
            controller.enqueue(new TextEncoder().encode('0:"Hello"\n'));
            controller.enqueue(new TextEncoder().encode('0:" "\n'));
            controller.enqueue(new TextEncoder().encode('0:"world"\n'));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Vercel-AI-Data-Stream': 'v1',
            },
          }),
        );
      }
      return Promise.reject(new Error('Not mocked'));
    });
  });

  it('renders chat panel when open', () => {
    render(<ChatPanel open={true} onClose={vi.fn()} />);

    expect(screen.getByText('Rules Clarification')).toBeInTheDocument();
    // Placeholder may be disabled message or normal message depending on API key
    const input = screen.getByRole('textbox', { hidden: true });
    expect(input).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    const { container } = render(<ChatPanel open={false} onClose={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders input and button', () => {
    render(<ChatPanel open={true} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox', { hidden: true });
    const sendButton = screen.getByRole('button', { name: /Send/ });

    expect(input).toBeInTheDocument();
    expect(sendButton).toBeInTheDocument();
  });

  it('disables input when no LLM key is set', () => {
    // Clear the LLM key
    localStorage.clear();
    localStorage.setItem('llm_provider', 'openai');
    localStorage.setItem('llm_model', 'gpt-4o-mini');

    render(<ChatPanel open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText(/Disabled: set API key/);
    const sendButton = screen.getByRole('button', { name: /Send/ });

    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChatPanel open={true} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: /Close chat/ });
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('shows hint text about Ctrl+Enter', () => {
    render(<ChatPanel open={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Ctrl\/Cmd\+Enter to send/)).toBeInTheDocument();
  });
});
