import { createFileRoute, redirect } from "@tanstack/react-router";
import { HOME_PATH } from "@/lib/auth";

export const Route = createFileRoute("/")({
  // The root route has already sent a signed-out reader to sign in.
  beforeLoad: () => {
    throw redirect({ to: HOME_PATH });
  },
  component: () => null,
});
