import React from 'react';
import clsx from 'clsx';

/**
 * Select component for dropdown selections.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={clsx(
      'px-3 py-2 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white',
      className,
    )}
    {...props}
  />
));

Select.displayName = 'Select';
