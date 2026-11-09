import { useMutation } from "@apollo/client";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { graphql } from "@/__generated__/index.js";
import { InputField, useAppForm } from "@/components/app-form";
import { FormError } from "@/components/domain/form/form-error";
import { RangeField } from "@/components/domain/form/range-field";
import { PageLayout } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "@/components/ui/icons";

export const Route = createFileRoute("/groups/new")({
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
  const [createGroup, { error }] = useMutation(CREATE_GROUP);

  const form = useAppForm({
    defaultValues: { name: "", overlapThreshold: 50 },
    onSubmit: async ({ value }) => {
      const res = await createGroup({
        variables: { name: value.name.trim(), overlapThreshold: value.overlapThreshold },
      });
      const id = res.data?.createGroup.id;
      if (id) navigate({ to: "/groups/$groupId", params: { groupId: id } });
    },
  });

  return (
    <PageLayout
      title="Create a Group"
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
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <InputField
            form={form}
            name="name"
            label="Group name"
            placeholder="Weekend hiking crew"
            required
            validators={{
              onChange: ({ value }) => (value.trim() === "" ? "Give the group a name." : undefined),
            }}
          />
          <RangeField
            form={form}
            name="overlapThreshold"
            label="Overlap threshold"
            description="Minimum percentage of members who must share a free slot to start a normal vote."
            min={0}
            max={100}
            step={5}
            format={(value) => `${value}%`}
          />
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" linkSlot={<Link to="/groups" />} content="Cancel" />
            <form.AppForm>
              <form.SubmitButton createLabel="Create Group" loadingLabel="Creating…" />
            </form.AppForm>
          </div>
        </form>
      }
    />
  );
}
