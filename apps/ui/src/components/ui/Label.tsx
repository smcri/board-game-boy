import React from 'react';
import clsx from 'clsx';

/**
 * Label component for form fields.
 */
export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={clsx('block text-sm font-medium text-slate-700 mb-1', className)}
    {...props}
  />
));

Label.displayName = 'Label';
