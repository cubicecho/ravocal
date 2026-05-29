import { useMutation } from "@apollo/client";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { graphql } from "@/__generated__/index.js";

const searchSchema = z.object({ token: z.string() });

export const Route = createFileRoute("/invite")({
  validateSearch: searchSchema,
  component: InvitePage,
});

const ACCEPT_INVITE = graphql(`
  mutation AcceptGroupInvite($token: String!) {
    acceptGroupInvite(token: $token) {
      id
      groupId
    }
  }
`);

function InvitePage() {
  const { token } = useSearch({ from: "/invite" });
  const navigate = useNavigate();
  const jwtToken = localStorage.getItem("ravocal_token");
  const [acceptInvite, { error }] = useMutation(ACCEPT_INVITE);

  useEffect(() => {
    if (!jwtToken) {
      navigate({ to: "/login" });
      return;
    }
    acceptInvite({ variables: { token } }).then((res) => {
      const groupId = res.data?.acceptGroupInvite.groupId;
      if (groupId) navigate({ to: "/groups/$groupId", params: { groupId } });
    });
  }, [token, jwtToken, acceptInvite, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Accepting invite…</p>
    </div>
  );
}
