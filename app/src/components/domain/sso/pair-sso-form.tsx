import { useMutation } from '@apollo/client';
import type { ReactNode } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { Alert } from '@/components/ui/alert';
import { describePairingError, PAIR_SSO, UNNAMED_PROVIDER } from '@/lib/sso';

/** What the form needs from the page it is on. */
interface PairSsoFormProps {
  /** The queries to ask again once a provider is paired, by name: whichever of them the page shows. */
  refetchQueries: readonly string[];
  /** Called with the provider's name once it is paired. */
  onPaired?: ((name: string) => void) | undefined;
  /** Beside the Connect button, before it: a way back. */
  secondaryActionSlot?: ReactNode | undefined;
}

/**
 * The paste-and-connect form: a setup URL in, a provider paired out. The server decides who may pair; this only asks,
 * and says why it was refused.
 *
 * @param props - What to ask again, and what to do once paired.
 * @returns The form.
 */
export function PairSsoForm({ refetchQueries, onPaired, secondaryActionSlot }: PairSsoFormProps) {
  const [pairSso, { error }] = useMutation(PAIR_SSO, {
    refetchQueries: [...refetchQueries],
    awaitRefetchQueries: true,
    // Drawn from `error` above the field; handling it here keeps the submit's promise from rejecting unhandled.
    onError: () => {},
  });

  const form = useAppForm({
    defaultValues: { setupUrl: '' },
    onSubmit: async ({ value, formApi }) => {
      const res = await pairSso({ variables: { setupUrl: value.setupUrl.trim() } });
      const paired = res.data?.pairSso;
      if (paired) {
        formApi.reset();
        onPaired?.(paired.name ?? UNNAMED_PROVIDER);
      }
    },
  });
  const problem = error ? describePairingError(error, "Couldn't connect the provider") : null;

  return (
    <form.AppForm>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {problem && <Alert variant="destructive" title={problem.title} description={problem.description} />}
        <InputField
          form={form}
          name="setupUrl"
          label="Setup URL"
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://id.example.com/oidc#setup=…"
          description="Your provider's admin makes this for Ravocal. It works once, and only for a short while."
          required
          validators={{
            onChange: ({ value }) => (value.trim() === '' ? 'Paste the setup URL your provider gave you.' : undefined),
          }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {secondaryActionSlot}
          <form.SubmitButton variant="info" createLabel="Connect" loadingLabel="Connecting…" />
        </div>
      </form>
    </form.AppForm>
  );
}
