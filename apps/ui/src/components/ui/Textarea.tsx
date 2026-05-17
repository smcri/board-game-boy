import React from 'react';
import clsx from 'clsx';

/**
 * Textarea component for multi-line text input.
 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={clsx(
      'px-3 py-2 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-none',
      className,
    )}
    {...props}
  />
));

Textarea.displayName = 'Textarea';
