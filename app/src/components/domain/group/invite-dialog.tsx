import { useMutation } from '@apollo/client';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { dialogForm } from '@/components/domain/form/dialog-form';
import { FormError } from '@/components/domain/form/form-error';
import { Button } from '@/components/ui/button';

/** Longest address the server takes (`GROUP_DEFAULTS.maxInviteEmailLength`). */
const MAX_EMAIL_LENGTH = 254;
/** Enough of an address to send to; the server has the last word. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITE_TO_GROUP = graphql(`
  mutation InviteToGroup($groupId: UUID!, $email: String!) {
    inviteToGroup(groupId: $groupId, email: $email) {
      id
      email
      expiresAt
    }
  }
`);

interface InviteDialogProps {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Told the address once the invite is sent. */
  onInvited: (email: string) => void;
}

/**
 * The owner's invite: an address in, an emailed link out. The new invite shows in the group's Invited list.
 *
 * @param props - The group, and the dialog's open state.
 * @returns The dialog.
 */
export function InviteDialog({ groupId, open, onOpenChange, onInvited }: InviteDialogProps) {
  const [invite, { error }] = useMutation(INVITE_TO_GROUP, {
    refetchQueries: ['GroupDetail'],
    awaitRefetchQueries: true,
    // Drawn from `error` under the field; handling it here keeps the submit's promise from rejecting unhandled.
    onError: () => {},
  });
  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const res = await invite({ variables: { groupId, email: value.email.trim() } });
      const sent = res.data?.inviteToGroup;
      if (sent) {
        onInvited(sent.email);
        onOpenChange(false);
      }
    },
  });

  return (
    <DialogLayout
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Invite someone"
      description="We'll email them a link. Whoever opens it while signed in joins the group, once, within 7 days."
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      wrapperSlot={dialogForm(form.AppForm, form.handleSubmit)}
      contentSlot={
        <>
          <InputField
            form={form}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="friend@example.com"
            required
            validators={{
              onChange: ({ value }) => {
                const email = value.trim();
                if (email === '') {
                  return 'Enter the address to send the invite to.';
                }
                if (email.length > MAX_EMAIL_LENGTH) {
                  return `Keep the address to ${MAX_EMAIL_LENGTH} characters or fewer.`;
                }
                return EMAIL_SHAPE.test(email) ? undefined : 'Enter a valid email address.';
              },
            }}
          />
          <FormError error={error} />
        </>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <form.SubmitButton variant="info" createLabel="Send invite" loadingLabel="Sending…" />
        </>
      )}
    />
  );
}
