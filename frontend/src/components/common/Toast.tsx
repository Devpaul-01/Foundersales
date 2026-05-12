import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOAST_VARIANTS } from '@/lib/animations';

// ── Types ─────────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id:       string;
  message:  string;
  type:     ToastType;
  duration: number;
}

interface ToastContextValue {
  showToast:   (message: string, type?: ToastType, duration?: number) => void;
  dismissToast:(id: string) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  showToast:    () => {},
  dismissToast: () => {},
});

// ── Global imperative API ─────────────────────────────────────
let _showToast: ToastContextValue['showToast'] = () => {};

/** Call outside React components */
export function showToast(
  message:  string,
  type:     ToastType = 'info',
  duration: number    = 4000,
) {
  _showToast(message, type, duration);
}

// ── Icons & styles ────────────────────────────────────────────
const TOAST_CONFIG: Record<ToastType, {
  icon:        React.ReactNode;
  border:      string;
  progressBg:  string;
  iconColor:   string;
}> = {
  success: {
    icon:       <CheckCircle2 size={15} />,
    border:     'border-emerald-200',
    progressBg: 'bg-success',
    iconColor:  'text-success',
  },
  error: {
    icon:       <XCircle size={15} />,
    border:     'border-red-200',
    progressBg: 'bg-danger',
    iconColor:  'text-danger',
  },
  warning: {
    icon:       <AlertTriangle size={15} />,
    border:     'border-amber-200',
    progressBg: 'bg-warning',
    iconColor:  'text-warning',
  },
  info: {
    icon:       <Info size={15} />,
    border:     'border-brand-200',
    progressBg: 'bg-brand',
    iconColor:  'text-brand',
  },
};

// ── Single Toast item ─────────────────────────────────────────
function ToastItemComponent({
  toast,
  onDismiss,
}: {
  toast:     ToastItem;
  onDismiss: () => void;
}) {
  const progressRef = useRef<HTMLDivElement>(null);
  const config      = TOAST_CONFIG[toast.type];

  useEffect(() => {
    const start    = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct     = Math.min((elapsed / toast.duration) * 100, 100);
      if (progressRef.current) {
        progressRef.current.style.width = `${100 - pct}%`;
      }
      if (elapsed >= toast.duration) {
        clearInterval(interval);
        onDismiss();
      }
    }, 16);
    return () => clearInterval(interval);
  }, [toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      variants={TOAST_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn(
        'relative flex items-start gap-2.5 bg-white rounded-lg shadow-elevated',
        'border px-4 py-3 min-w-[280px] max-w-[380px] overflow-hidden',
        config.border,
      )}
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      {/* Icon */}
      <span className={cn('mt-0.5 shrink-0', config.iconColor)}>
        {config.icon}
      </span>

      {/* Message */}
      <p className="flex-1 text-sm text-text-primary leading-relaxed">
        {toast.message}
      </p>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-text-muted hover:text-text-primary transition-colors shrink-0 mt-0.5"
      >
        <X size={13} />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-100">
        <div
          ref={progressRef}
          className={cn('h-full transition-none', config.progressBg, 'opacity-60')}
          style={{ width: '100%' }}
        />
      </div>
    </motion.div>
  );
}

// ── Provider ──────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToastFn = useCallback(
    (message: string, type: ToastType = 'info', duration = 4000) => {
      const id = crypto.randomUUID ? crypto.randomUUID() : `toast-${Date.now()}`;
      // Cap at 5 toasts — slice oldest
      setToasts((prev) => [...prev.slice(-4), { id, message, type, duration }]);
    },
    [],
  );

  // Expose globally
  useEffect(() => {
    _showToast = showToastFn;
  }, [showToastFn]);

  return (
    <ToastContext.Provider value={{ showToast: showToastFn, dismissToast }}>
      {children}
      {createPortal(
        <div
          aria-label="Notifications"
          className="fixed top-4 right-4 z-[9000] flex flex-col gap-2 pointer-events-none"
        >
          <AnimatePresence mode="popLayout">
            {toasts.map((toast) => (
              <div key={toast.id} className="pointer-events-auto">
                <ToastItemComponent
                  toast={toast}
                  onDismiss={() => dismissToast(toast.id)}
                />
              </div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
