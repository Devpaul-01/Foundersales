import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type ButtonSize    = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:     'bg-brand text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary:   'bg-white text-text-primary border border-surface-border hover:bg-surface-hover active:bg-slate-100 shadow-sm',
  ghost:       'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
  destructive: 'bg-danger-light text-danger-dark border border-red-200 hover:bg-red-100 active:bg-red-200',
  outline:     'border border-brand text-brand hover:bg-brand-50 active:bg-brand-100',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'text-xs px-2.5 py-1 gap-1.5 rounded',
  sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-md',
  md: 'text-sm px-4 py-2 gap-2 rounded-md',
  lg: 'text-base px-5 py-2.5 gap-2 rounded-lg',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:    ButtonVariant;
  size?:       ButtonSize;
  isLoading?:  boolean;
  leftIcon?:   React.ReactNode;
  rightIcon?:  React.ReactNode;
  fullWidth?:  boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant    = 'primary',
      size       = 'md',
      isLoading  = false,
      leftIcon,
      rightIcon,
      fullWidth  = false,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          // Base
          'inline-flex items-center justify-center font-medium',
          'transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:pointer-events-none select-none',
          // Variant
          VARIANT_CLASSES[variant],
          // Size
          SIZE_CLASSES[size],
          // Full width
          fullWidth && 'w-full',
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="animate-spin shrink-0" size={size === 'lg' ? 18 : 16} />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';

/** Icon-only button */
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?:      'sm' | 'md' | 'lg';
  variant?:   ButtonVariant;
  label:      string;  // required for accessibility
  isLoading?: boolean;
}

const ICON_SIZE_CLASSES: Record<string, string> = {
  sm: 'w-7 h-7 rounded',
  md: 'w-8 h-8 rounded-md',
  lg: 'w-9 h-9 rounded-md',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', label, isLoading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex items-center justify-center shrink-0',
        'transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANT_CLASSES[variant],
        ICON_SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {isLoading ? <Loader2 className="animate-spin" size={15} /> : children}
    </button>
  ),
);

IconButton.displayName = 'IconButton';
