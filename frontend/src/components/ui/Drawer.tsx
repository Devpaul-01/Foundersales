import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DRAWER_RIGHT, DRAWER_BOTTOM, MODAL_BACKDROP } from '@/lib/animations';
import { IconButton } from './Button';

interface DrawerProps {
  isOpen:      boolean;
  onClose:     () => void;
  title?:      string;
  subtitle?:   string;
  children:    React.ReactNode;
  footer?:     React.ReactNode;
  width?:      string;
  side?:       'right' | 'left';
  className?:  string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width    = 'w-full max-w-md',
  side     = 'right',
  className,
}: DrawerProps) {
  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) { document.body.style.overflow = 'hidden'; }
    else        { document.body.style.overflow = ''; }
    return ()   => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const variants = side === 'right' ? DRAWER_RIGHT : DRAWER_BOTTOM;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            variants={MODAL_BACKDROP}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="drawer-panel"
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'fixed z-50 bg-white shadow-elevated',
              'border-l border-surface-border',
              'flex flex-col',
              side === 'right' && `right-0 top-0 bottom-0 ${width}`,
              side === 'left'  && `left-0 top-0 bottom-0 ${width}`,
              className,
            )}
          >
            {/* Header */}
            {(title || subtitle) && (
              <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-surface-border shrink-0">
                <div>
                  {title && (
                    <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
                  )}
                  {subtitle && (
                    <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
                  )}
                </div>
                <IconButton label="Close" size="sm" onClick={onClose} className="text-text-muted shrink-0">
                  <X size={16} />
                </IconButton>
              </div>
            )}

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="shrink-0 px-5 py-4 border-t border-surface-border bg-surface-base/50 flex items-center justify-end gap-2">
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
