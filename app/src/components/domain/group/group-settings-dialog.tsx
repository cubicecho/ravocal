import { useApolloClient, useMutation } from '@apollo/client';
import { useNavigate } from '@tanstack/react-router';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { ConfirmButton } from '@/components/confirm-button';
import { DialogLayout } from '@/components/dialog-layout';
import { dialogForm } from '@/components/domain/form/dialog-form';
import { FormError } from '@/components/domain/form/form-error';
import { RangeField } from '@/components/domain/form/range-field';
import { Button } from '@/components/ui/button';
import { Trash2 } from '@/components/ui/icons';

/** Longest group name the server accepts (its `GROUP_DEFAULTS.maxNameLength`). */
const MAX_NAME_LENGTH = 100;

const UPDATE_GROUP = graphql(`
  mutation UpdateGroup($id: UUID!, $name: String!, $overlapThreshold: Int!) {
    updateGroup(where: { id: { eq: $id } }, set: { name: $name, overlapThreshold: $overlapThreshold }) {
      id
      name
      overlapThreshold
    }
  }
`);

const DELETE_GROUP = graphql(`
  mutation DeleteGroup($id: UUID!) {
    deleteGroup(where: { id: { eq: $id } }) {
      id
    }
  }
`);

interface GroupSettingsDialogProps {
  group: { id: string; name: string; overlapThreshold: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The owner's group settings: its name and overlap threshold, and deleting it.
 *
 * @param props - The group, and the dialog's open state.
 * @returns The dialog.
 */
export function GroupSettingsDialog({ group, open, onOpenChange }: GroupSettingsDialogProps) {
  const navigate = useNavigate();
  // The group is the same normalized row the page reads, so the page shows the new name as soon as this answers.
  const [updateGroup, updating] = useMutation(UPDATE_GROUP, { onError: () => {} });
  const { cache } = useApolloClient();
  const [deleteGroup, deleting] = useMutation(DELETE_GROUP, {
    // Off the page first, so it isn't asked for again, then out of the cache with the list that held it, which is
    // asked for again when it opens.
    onCompleted: async () => {
      await navigate({ to: '/groups', replace: true });
      cache.evict({ id: cache.identify({ __typename: 'Group', id: group.id }) });
      cache.evict({ fieldName: 'groups' });
      cache.gc();
    },
    onError: () => {},
  });

  const form = useAppForm({
    defaultValues: { name: group.name, overlapThreshold: group.overlapThreshold },
    onSubmit: async ({ value }) => {
      const res = await updateGroup({
        variables: { id: group.id, name: value.name.trim(), overlapThreshold: value.overlapThreshold },
      });
      if (res.data?.updateGroup) {
        onOpenChange(false);
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Group settings"
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      wrapperSlot={dialogForm(form.AppForm, form.handleSubmit)}
      contentSlot={
        <>
          <InputField
            form={form}
            name="name"
            label="Group name"
            required
            validators={{
              onChange: ({ value }) => {
                const name = value.trim();
                if (name === '') {
                  return 'Give the group a name.';
                }
                if (name.length > MAX_NAME_LENGTH) {
                  return `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
                }
                return undefined;
              },
            }}
          />
          <RangeField
            form={form}
            name="overlapThreshold"
            label="Overlap threshold"
            description="How many of the group must be free at the same time before you can start a vote. A vote that is already open keeps its times."
            min={0}
            max={100}
            step={5}
            format={(value) => `${value}%`}
          />
          <FormError error={updating.error ?? deleting.error} />
        </>
      }
      footerSlot={
        <ConfirmButton
          iconSlot={<Trash2 />}
          loading={deleting.loading}
          loadingLabel="Deleting…"
          title={`Delete ${group.name}?`}
          description="Its members, invites, free time and votes are deleted with it, for everyone. This can't be undone."
          confirmLabel="Delete group"
          requireText={group.name}
          onConfirm={() => void deleteGroup({ variables: { id: group.id } })}
          content="Delete group"
        />
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.SubmitButton isEdit editLabel="Save changes" requireChanges />
        </>
      )}
    />
  );
}
