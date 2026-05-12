import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODAL_BACKDROP, MODAL_PANEL } from '@/lib/animations';
import { IconButton } from './Button';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm:   'max-w-sm',
  md:   'max-w-lg',
  lg:   'max-w-2xl',
  xl:   'max-w-4xl',
  full: 'max-w-[95vw]',
};

interface ModalProps {
  isOpen:      boolean;
  onClose:     () => void;
  title?:      string;
  description?: string;
  size?:       ModalSize;
  children:    React.ReactNode;
  footer?:     React.ReactNode;
  /** Prevent closing on backdrop click */
  persistent?: boolean;
  className?:  string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size        = 'md',
  children,
  footer,
  persistent  = false,
  className,
}: ModalProps) {
  const modalRef    = useRef<HTMLDivElement>(null);
  const previousRef = useRef<Element | null>(null);

  // Save and restore focus
  useEffect(() => {
    if (isOpen) {
      previousRef.current = document.activeElement;
      // Focus first focusable element
      setTimeout(() => {
        const focusable = modalRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      }, 50);
    } else {
      (previousRef.current as HTMLElement | null)?.focus();
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen || persistent) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, persistent]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="modal-backdrop"
            variants={MODAL_BACKDROP}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            onClick={persistent ? undefined : onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="modal-panel"
              ref={modalRef}
              variants={MODAL_PANEL}
              initial="initial"
              animate="animate"
              exit="exit"
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? 'modal-title' : undefined}
              aria-describedby={description ? 'modal-desc' : undefined}
              className={cn(
                'pointer-events-auto w-full bg-white rounded-xl shadow-elevated',
                'border border-surface-border overflow-hidden',
                SIZE_CLASSES[size],
                className,
              )}
            >
              {/* Header */}
              {(title || description) && (
                <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-surface-border">
                  <div>
                    {title && (
                      <h2 id="modal-title" className="text-base font-semibold text-text-primary">
                        {title}
                      </h2>
                    )}
                    {description && (
                      <p id="modal-desc" className="text-sm text-text-muted mt-0.5">
                        {description}
                      </p>
                    )}
                  </div>
                  <IconButton
                    label="Close modal"
                    size="sm"
                    onClick={onClose}
                    className="text-text-muted hover:text-text-primary mt-0.5"
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              )}

              {/* Body */}
              <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">
                {children}
              </div>

              {/* Footer */}
              {footer && (
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-surface-border bg-surface-base/50">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
