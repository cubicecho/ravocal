import { useMutation } from "@apollo/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { graphql } from "@/__generated__/index.js";
import { PendingScreen } from "@/components/domain/pending-screen";

const searchSchema = z.object({ token: z.string() });

// A signed-out reader never gets here: the root route sends them to sign in and brings them back.
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
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [acceptInvite, { error }] = useMutation(ACCEPT_INVITE, {
    // The cached groups list lacks the group just joined, and its page is not mounted to be
    // refetched: drop it, so the page asks again when it opens.
    update: (cache) => {
      cache.evict({ fieldName: "myGroups" });
      cache.gc();
    },
    onCompleted: (data) => {
      void navigate({
        to: "/groups/$groupId",
        params: { groupId: data.acceptGroupInvite.groupId },
        replace: true,
      });
    },
    // The failure is drawn from `error`; handling it here keeps the promise from rejecting.
    onError: () => {},
  });

  // An invite is accepted once, and StrictMode runs an effect twice: the second run would fail
  // with "already accepted". The ref lives through StrictMode's remount, so it is sent once.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === token) return;
    sent.current = token;
    void acceptInvite({ variables: { token } });
  }, [token, acceptInvite]);

  return (
    <PendingScreen title="Accepting invite…" failedTitle="That invite didn't work" error={error} />
  );
}
