import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

import { cx } from '../lib/cx.js';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * A modal dialog, built on the native `<dialog>` element so focus trapping, the
 * top layer and Escape handling come from the platform rather than from us.
 *
 * BANNED FROM THE WORKOUT FLOW (CLAUDE.md). A dialog that eats a set the user
 * already entered is the worst failure this product can produce. Use Sheet there.
 * This exists for settings, destructive confirmations and onboarding - places where
 * blocking the user is the point.
 */
export function Dialog({ open, onClose, title, children, actions, className }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('ff-dialog', className)}
      aria-labelledby={titleId}
      // Fires for Escape and for form method="dialog" alike, so the parent's
      // `open` state cannot drift out of sync with the element's.
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="ff-dialog__title" id={titleId}>
        {title}
      </h2>
      {children}
      {actions ? <div className="ff-dialog__actions">{actions}</div> : null}
    </dialog>
  );
}
