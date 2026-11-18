import { useMutation } from '@apollo/client';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { FormError } from '@/components/domain/form/form-error';

/** Longest name the server takes (`USER_DEFAULTS.maxNameLength`). */
const MAX_NAME_LENGTH = 100;

const UPDATE_USER = graphql(`
  mutation UpdateUser($id: UUID!, $name: String!) {
    updateUser(where: { id: { eq: $id } }, set: { name: $name }) {
      id
      name
    }
  }
`);

interface ProfileFormProps {
  userId: string;
  /** The saved name. Remount the form (`key`) when it changes, so the box starts from it. */
  name: string;
  /** Told once the new name is saved. */
  onSaved: () => void;
}

/**
 * The reader's display name: what the groups they're in call them.
 *
 * @param props - Who they are, their saved name, and what to do once it is saved.
 * @returns The card.
 */
export function ProfileForm({ userId, name, onSaved }: ProfileFormProps) {
  const [updateUser, { error }] = useMutation(UPDATE_USER, {
    // getSession is better-auth's read of the same row, so the page asks for it again.
    refetchQueries: ['Settings'],
    awaitRefetchQueries: true,
    onError: () => {},
  });
  const form = useAppForm({
    defaultValues: { name },
    onSubmit: async ({ value }) => {
      const res = await updateUser({ variables: { id: userId, name: value.name.trim() } });
      if (res.data?.updateUser) {
        onSaved();
      }
    },
  });

  return (
    <CardLayout
      title="Profile"
      level={2}
      description="How you appear to the people in your groups."
      wrapperSlot={(parts, { className }) => (
        <form.AppForm>
          <form
            className={className}
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            {parts}
          </form>
        </form.AppForm>
      )}
      contentSlot={
        <div className="grid gap-4">
          <InputField
            form={form}
            name="name"
            label="Display name"
            autoComplete="name"
            required
            validators={{
              onChange: ({ value }) => {
                const trimmed = value.trim();
                if (trimmed === '') {
                  return 'Your name cannot be empty.';
                }
                if (trimmed.length > MAX_NAME_LENGTH) {
                  return `Keep your name to ${MAX_NAME_LENGTH} characters or fewer.`;
                }
                return undefined;
              },
            }}
          />
          <FormError error={error} />
        </div>
      }
      footerActionsSlot={<form.SubmitButton isEdit editLabel="Save name" requireChanges />}
    />
  );
}
