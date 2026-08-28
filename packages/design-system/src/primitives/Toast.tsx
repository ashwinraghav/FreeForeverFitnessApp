import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { cx } from '../lib/cx.js';
import { CheckGlyph, DangerGlyph, InfoGlyph } from '../lib/glyphs.js';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastProps {
  tone?: ToastTone;
  children: ReactNode;
  /** Auto-dismiss after this many ms. Omit to leave it until dismissed. */
  durationMs?: number;
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
}

const GLYPHS = {
  info: InfoGlyph,
  success: CheckGlyph,
  danger: DangerGlyph,
};

/**
 * A non-blocking confirmation. Never a modal, never a place to put something the
 * user must act on - it can be missed, and mid-set it will be.
 *
 * `role="status"` (polite) for info and success; `role="alert"` (assertive) for
 * danger, which is the only tone worth interrupting a screen reader for.
 */
export function Toast({
  tone = 'info',
  children,
  durationMs,
  onDismiss,
  action,
  className,
}: ToastProps) {
  useEffect(() => {
    if (durationMs === undefined || !onDismiss) return undefined;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  const Glyph = GLYPHS[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={cx('ff-toast', `ff-toast--${tone}`, className)}
      data-ff-tone={tone}
    >
      {/* Tone is never colour alone. */}
      <span className="ff-toast__glyph">
        <Glyph />
      </span>
      <span className="ff-toast__body">{children}</span>
      {action}
    </div>
  );
}

export interface ToastRegionProps {
  children: ReactNode;
  label?: string;
  className?: string;
}

/** The fixed, bottom-anchored container toasts stack into. Mount once, near the root. */
export function ToastRegion({ children, label = 'Notifications', className }: ToastRegionProps) {
  return (
    <div className={cx('ff-toast-region', className)} role="region" aria-label={label}>
      {children}
    </div>
  );
}
