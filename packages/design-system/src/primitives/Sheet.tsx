import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

import { cx } from '../lib/cx.js';
import { CloseGlyph } from '../lib/glyphs.js';
import { IconButton } from './IconButton.js';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Actions pinned under the content. */
  actions?: ReactNode;
  /**
   * Block interaction with the page behind. Defaults to false, deliberately.
   *
   * CLAUDE.md: no modals during a workout - losing entered sets to a dismissed
   * dialog is the worst failure mode in this category. A Sheet is the container
   * you reach for mid-workout precisely because it does not trap the user.
   */
  modal?: boolean;
  closeLabel?: string;
  className?: string;
}

/** A bottom sheet: reachable with a thumb, dismissible, and non-blocking by default. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
  modal = false,
  closeLabel = 'Close',
  className,
}: SheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) sheetRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      {modal ? <div className="ff-scrim" onClick={onClose} data-ff-scrim="true" /> : null}
      <div
        ref={sheetRef}
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('ff-sheet', 'ff-focusable', className)}
        data-ff-modal={modal ? 'true' : 'false'}
      >
        <div className="ff-sheet__grabber" aria-hidden="true" />
        <div className="ff-sheet__header">
          <h2 className="ff-sheet__title" id={titleId}>
            {title}
          </h2>
          <IconButton icon={<CloseGlyph />} aria-label={closeLabel} onClick={onClose} size="lg" />
        </div>
        {children}
        {actions ? <div className="ff-sheet__actions">{actions}</div> : null}
      </div>
    </>
  );
}
