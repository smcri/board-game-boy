import React from 'react';
import clsx from 'clsx';

/**
 * Card component for grouping content.
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={clsx('bg-white rounded-lg border border-slate-200 shadow-sm', className)}
    {...props}
  />
));

Card.displayName = 'Card';

/**
 * Card header component.
 */
export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx('px-6 py-4 border-b border-slate-200', className)} {...props} />
));

CardHeader.displayName = 'CardHeader';

/**
 * Card content component.
 */
export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx('px-6 py-4', className)} {...props} />
));

CardContent.displayName = 'CardContent';

/**
 * Card footer component.
 */
export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={clsx('px-6 py-4 border-t border-slate-200', className)} {...props} />
));

CardFooter.displayName = 'CardFooter';
