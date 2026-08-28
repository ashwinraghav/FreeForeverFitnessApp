import type { ReactNode } from 'react';
import { useId, useRef } from 'react';

import { cx } from '../lib/cx.js';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** The selected tab id. Controlled - the caller owns which tab is open. */
  value: string;
  onValueChange: (id: string) => void;
  /** Required: a tablist with no name is an unlabelled group of buttons. */
  label: string;
  className?: string;
}

/**
 * Tabs with a roving tabindex: one tab stop for the whole list, arrows move between
 * tabs, Home/End jump to the ends. Activation follows focus, which is correct here
 * because panels are already rendered and switching costs nothing.
 */
export function Tabs({ items, value, onValueChange, label, className }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const enabled = items.filter((item) => !item.disabled);

  const move = (delta: number) => {
    const currentIndex = enabled.findIndex((item) => item.id === value);
    if (currentIndex === -1 || enabled.length === 0) return;
    const nextIndex = (currentIndex + delta + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (!next) return;
    onValueChange(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-tab-${next.id}`)}`)?.focus();
  };

  const jump = (edge: 'first' | 'last') => {
    const target = edge === 'first' ? enabled[0] : enabled[enabled.length - 1];
    if (!target) return;
    onValueChange(target.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-tab-${target.id}`)}`)?.focus();
  };

  return (
    <div className={className}>
      <div className="ff-tabs__list" role="tablist" aria-label={label} ref={listRef}>
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              // Roving tabindex: only the selected tab is in the tab order.
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled ?? false}
              className={cx('ff-control', 'ff-focusable', 'ff-tab')}
              onClick={() => onValueChange(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  jump('first');
                } else if (event.key === 'End') {
                  event.preventDefault();
                  jump('last');
                }
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== value}
          tabIndex={0}
          className="ff-tabs__panel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
