import { useMutation } from "@apollo/client";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { graphql } from "@/__generated__/index.js";
import { PendingScreen } from "@/components/domain/pending-screen";

const searchSchema = z.object({ token: z.string() });

export const Route = createFileRoute("/login/verify")({
  validateSearch: searchSchema,
  component: VerifyPage,
});

const VERIFY_MAGIC_LINK = graphql(`
  mutation VerifyMagicLink($token: String!) {
    verifyMagicLink(token: $token) {
      token
      user {
        id
        email
        name
      }
    }
  }
`);

function VerifyPage() {
  const { token } = useSearch({ from: "/login/verify" });
  const navigate = useNavigate();
  const [verifyMagicLink, { error }] = useMutation(VERIFY_MAGIC_LINK);

  useEffect(() => {
    verifyMagicLink({ variables: { token } }).then((res) => {
      const jwt = res.data?.verifyMagicLink.token;
      if (jwt) {
        localStorage.setItem("ravocal_token", jwt);
        navigate({ to: "/groups" });
      }
    });
  }, [token, verifyMagicLink, navigate]);

  return (
    <PendingScreen
      title="Signing you in…"
      failedTitle="That sign-in link didn't work"
      error={error}
    />
  );
}
