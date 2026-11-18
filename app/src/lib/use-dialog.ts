import { useState } from 'react';

/** A dialog's open state, and the key that gives its form fresh values each time it opens. */
export interface DialogState {
  open: boolean;
  /** Changes on every `show`: put it on the dialog's form component, so a reopened form starts from what is saved. */
  key: number;
  show: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Holds a dialog that is opened from a button somewhere else on the page.
 *
 * @returns Whether it is open, its form's key, and the two ways to change it.
 */
export function useDialog(): DialogState {
  const [state, setState] = useState({ open: false, key: 0 });
  return {
    open: state.open,
    key: state.key,
    show: () => setState((prev) => ({ open: true, key: prev.key + 1 })),
    onOpenChange: (open) => setState((prev) => ({ ...prev, open })),
  };
}
