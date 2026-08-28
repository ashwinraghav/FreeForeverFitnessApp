import { Button, Toast, ToastRegion } from '@freeforever/design-system';

/**
 * Confirmation with an undo.
 *
 * One-tap logging is only safe because this exists. The write happens
 * immediately — no confirmation step, because a confirmation step is the tap
 * this whole feature is trying not to spend — and the undo is what makes a
 * mis-tap cost nothing. Take the undo away and the one-tap path becomes a trap.
 */
export interface UndoableAction {
  id: string;
  message: string;
  undo: () => void;
}

export function UndoToast({
  action,
  onDismiss,
}: {
  action: UndoableAction | null;
  onDismiss: () => void;
}) {
  if (action === null) return null;
  return (
    <div className="ffn-toasts">
      <ToastRegion label="Logging">
        <Toast
          key={action.id}
          tone="success"
          onDismiss={onDismiss}
          action={
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                action.undo();
                onDismiss();
              }}
            >
              Undo
            </Button>
          }
        >
          {action.message}
        </Toast>
      </ToastRegion>
    </div>
  );
}
