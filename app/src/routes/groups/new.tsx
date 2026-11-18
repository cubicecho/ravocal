import { useMutation } from '@apollo/client';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { graphql } from '@/__generated__/index.js';
import { InputField, useAppForm } from '@/components/app-form';
import { CardLayout } from '@/components/card-layout';
import { FormError } from '@/components/domain/form/form-error';
import { RangeField } from '@/components/domain/form/range-field';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';

export const Route = createFileRoute('/groups/new')({
  component: NewGroupPage,
});

const CREATE_GROUP = graphql(`
  mutation CreateGroup($name: String!, $overlapThreshold: Int) {
    createGroup(name: $name, overlapThreshold: $overlapThreshold) {
      id
      name
    }
  }
`);

function NewGroupPage() {
  const navigate = useNavigate();
  const [createGroup, { error }] = useMutation(CREATE_GROUP, {
    // The cached groups list lacks this one, and its page is not mounted to be refetched: drop it,
    // so the page asks again when it opens.
    update: (cache) => {
      cache.evict({ fieldName: 'myGroups' });
      cache.gc();
    },
    // The failure is drawn from `error` under the fields; handling it here keeps the submit's
    // promise from rejecting unhandled.
    onError: () => {},
  });

  const form = useAppForm({
    defaultValues: { name: '', overlapThreshold: 50 },
    onSubmit: async ({ value }) => {
      const res = await createGroup({
        variables: { name: value.name.trim(), overlapThreshold: value.overlapThreshold },
      });
      const id = res.data?.createGroup.id;
      if (id) await navigate({ to: '/groups/$groupId', params: { groupId: id } });
    },
  });

  return (
    <PageLayout
      title="New group"
      width="prose"
      backSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Back to your groups"
          iconSlot={<ArrowLeft />}
          linkSlot={<Link to="/groups" />}
        />
      }
      contentSlot={
        <CardLayout
          // The <form> wraps the footer too, so Create is the form's own submit button.
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
                label="Group name"
                placeholder="Weekend hiking crew"
                required
                validators={{
                  onChange: ({ value }) => {
                    const name = value.trim();
                    if (name === '') return 'Give the group a name.';
                    // The server's limit.
                    if (name.length > 100) return 'Keep the name to 100 characters or fewer.';
                    return undefined;
                  },
                }}
              />
              <RangeField
                form={form}
                name="overlapThreshold"
                label="Overlap threshold"
                description="How many of the group must be free at the same time before you can start a vote."
                min={0}
                max={100}
                step={5}
                format={(value) => `${value}%`}
              />
              <FormError error={error} />
            </div>
          }
          footerActionsSlot={
            <>
              <Button variant="outline" linkSlot={<Link to="/groups" />} content="Cancel" />
              <form.SubmitButton variant="info" createLabel="Create group" loadingLabel="Creating…" />
            </>
          }
        />
      }
    />
  );
}
