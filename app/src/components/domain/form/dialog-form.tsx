import type { ComponentType, ReactNode } from 'react';
import type { SlotNode } from '@/lib/utils';

/**
 * A `DialogLayout`'s `wrapperSlot` for a form: the header, the fields and the footer under one `<form>`, so Enter in a
 * field submits it and the footer's submit button is the form's own.
 *
 * @param AppForm - The form's `form.AppForm`, which gives the submit button its form.
 * @param submit - The form's `handleSubmit`.
 * @returns The wrapper.
 */
export function dialogForm(AppForm: ComponentType<{ children?: ReactNode }>, submit: () => unknown) {
  return (parts: SlotNode, { className }: { className: string }) => (
    <AppForm>
      <form
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {parts}
      </form>
    </AppForm>
  );
}
