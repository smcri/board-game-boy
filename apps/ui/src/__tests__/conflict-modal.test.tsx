import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Conflict } from '@bgb/shared';
import { ConflictModal } from '../components/ConflictModal';

describe('ConflictModal', () => {
  const sampleConflicts: Conflict[] = [
    {
      id: 'conflict-1',
      rule: 'Movement speed',
      description: 'Disagreement on how many squares per turn',
      sources: [
        { url: 'https://example.com', title: 'Official Rules', source_type: 'publisher' },
      ],
      severity: 'core_mechanic',
      confidence: 0.95,
      suggested_resolution: '3 squares per turn',
    },
    {
      id: 'conflict-2',
      rule: 'Win condition',
      description: 'First to reach the end vs highest score',
      sources: [{ url: 'https://example.com', source_type: 'bgg' }],
      severity: 'core_mechanic',
      confidence: 0.8,
    },
  ];

  it('should render modal when open', () => {
    render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={vi.fn()} />,
    );

    expect(screen.getByText('Resolve conflicts')).toBeInTheDocument();
  });

  it('should display all conflicts', () => {
    render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={vi.fn()} />,
    );

    expect(screen.getByText('Movement speed')).toBeInTheDocument();
    expect(screen.getByText('Win condition')).toBeInTheDocument();
  });

  it('should show suggested resolution when available', () => {
    render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={vi.fn()} />,
    );

    expect(screen.getByText('3 squares per turn')).toBeInTheDocument();
  });

  it('should show sources for each conflict', () => {
    render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={vi.fn()} />,
    );

    expect(screen.getByText('Official Rules')).toBeInTheDocument();
  });

  it('should call onResolve with correct decision map when submitted', () => {
    const mockOnResolve = vi.fn();
    const { container } = render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={mockOnResolve} />,
    );

    // Select "Accept" for first conflict.
    const acceptRadios = container.querySelectorAll('input[type="radio"][value="accept"]');
    fireEvent.click(acceptRadios[0]);

    // Select "Override" for second conflict.
    const overrideRadios = container.querySelectorAll('input[type="radio"][value="override"]');
    fireEvent.click(overrideRadios[1]);

    // Submit.
    const submitButton = screen.getByText('Submit decisions');
    fireEvent.click(submitButton);

    expect(mockOnResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        'conflict-1': { decision: 'accept' },
        'conflict-2': { decision: 'override' },
      }),
    );
  });

  it('should not enable submit until all conflicts are decided', () => {
    const mockOnResolve = vi.fn();
    render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={mockOnResolve} />,
    );

    const submitButton = screen.getByText('Submit decisions') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  it('should enable submit after all conflicts are decided', () => {
    const mockOnResolve = vi.fn();
    const { container } = render(
      <ConflictModal open={true} conflicts={sampleConflicts} onResolve={mockOnResolve} />,
    );

    const acceptRadios = container.querySelectorAll('input[type="radio"][value="accept"]');
    fireEvent.click(acceptRadios[0]);
    fireEvent.click(acceptRadios[1]);

    const submitButton = screen.getByText('Submit decisions') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
  });
});
