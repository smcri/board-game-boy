import React from 'react';
import clsx from 'clsx';

/**
 * Input component for text/password fields.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={clsx(
      'px-3 py-2 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500',
      className,
    )}
    {...props}
  />
));

Input.displayName = 'Input';
