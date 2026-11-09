import { useMutation } from "@apollo/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { graphql } from "@/__generated__/index.js";
import { InputField, useAppForm } from "@/components/app-form";
import { CenteredCardLayout } from "@/components/centered-card-layout";
import { FormError } from "@/components/domain/form/form-error";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const REQUEST_MAGIC_LINK = graphql(`
  mutation RequestMagicLink($email: String!) {
    requestMagicLink(email: $email)
  }
`);

function LoginPage() {
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [requestMagicLink, { error }] = useMutation(REQUEST_MAGIC_LINK);

  const form = useAppForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      await requestMagicLink({ variables: { email: value.email } });
      setSent(true);
    },
  });

  const token = localStorage.getItem("ravocal_token");
  if (token) {
    navigate({ to: "/groups" });
    return null;
  }

  if (sent) {
    return (
      <CenteredCardLayout
        title="Check your email"
        description="We sent you a sign-in link. Open it on this device to finish signing in."
      />
    );
  }

  return (
    <CenteredCardLayout
      title="Ravocal"
      description="Group scheduling, made easy."
      wrapperSlot={(parts, { className }) => (
        <form
          className={className}
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {parts}
        </form>
      )}
      contentSlot={
        <>
          <InputField
            form={form}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            validators={{
              onChange: ({ value }) => (value.trim() === "" ? "Enter your email." : undefined),
            }}
          />
          <FormError error={error} />
        </>
      }
      footerActionsSlot={
        <form.AppForm>
          <form.SubmitButton
            createLabel="Send sign-in link"
            loadingLabel="Sending…"
            className="w-full"
          />
        </form.AppForm>
      }
    />
  );
}
