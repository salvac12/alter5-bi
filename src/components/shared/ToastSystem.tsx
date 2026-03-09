/* ═══════════════════════════════════════════════════════════════
   ToastSystem — Toast notification system with context + hook
   ═══════════════════════════════════════════════════════════════ */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { colors, font, layout, spacing, shadows, transitions, darkPanel } from '../../theme/tokens';
import type { Toast, ToastVariant } from '../../types';

// ── Variant config ──────────────────────────────────────────────

const VARIANT_CONFIG: Record<ToastVariant, { color: string; Icon: typeof CheckCircle2 }> = {
  success: { color: colors.accent.green, Icon: CheckCircle2 },
  error:   { color: colors.accent.red,   Icon: XCircle },
  info:    { color: colors.accent.blue,   Icon: Info },
  warning: { color: colors.accent.yellow, Icon: AlertTriangle },
};

const DEFAULT_DURATION = 5000;

// ── Context ─────────────────────────────────────────────────────

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ── Single toast ────────────────────────────────────────────────

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const { color, Icon } = VARIANT_CONFIG[toast.variant];
  const duration = toast.duration || DEFAULT_DURATION;
  const [progress, setProgress] = useState(100);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onRemove(toast.id);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [toast.id, duration, onRemove]);

  const containerStyle: React.CSSProperties = {
    background: colors.dark.bg,
    borderRadius: layout.borderRadius.md,
    borderLeft: `3px solid ${color}`,
    padding: `${spacing.md} ${spacing.lg}`,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 320,
    maxWidth: 420,
    boxShadow: shadows.lg,
    position: 'relative',
    overflow: 'hidden',
  };

  const messageStyle: React.CSSProperties = {
    flex: 1,
    color: colors.text.onDark,
    fontSize: font.size.md,
    fontFamily: font.family,
    fontWeight: font.weight.medium,
    lineHeight: font.lineHeight.normal,
  };

  const closeStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: spacing.xs,
    borderRadius: layout.borderRadius.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.text.onDarkSecondary,
    transition: transitions.fast,
    flexShrink: 0,
  };

  const progressBarStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    width: `${progress}%`,
    background: color,
    transition: 'width 30ms linear',
    borderRadius: '0 0 0 2px',
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95 }}
      transition={{ ...transitions.spring }}
      style={containerStyle}
    >
      <Icon size={18} color={color} style={{ flexShrink: 0 }} />
      <span style={messageStyle}>{toast.message}</span>
      <button
        style={closeStyle}
        onClick={() => onRemove(toast.id)}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = colors.text.onDark; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = colors.text.onDarkSecondary; }}
        aria-label="Cerrar"
      >
        <X size={14} />
      </button>
      <div style={progressBarStyle} />
    </motion.div>
  );
}

// ── Provider ────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info', duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast: Toast = { id, message, variant, duration: duration || DEFAULT_DURATION };
    setToasts(prev => [...prev, toast]);
  }, []);

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 24,
    right: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
    zIndex: 9999,
    pointerEvents: 'none',
  };

  const innerStyle: React.CSSProperties = {
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div style={containerStyle}>
        <div style={innerStyle}>
          <AnimatePresence mode="popLayout">
            {toasts.map(toast => (
              <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </ToastContext.Provider>
  );
}
