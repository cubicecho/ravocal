import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const token = localStorage.getItem("ravocal_token");
    if (!token) throw redirect({ to: "/login" });
    throw redirect({ to: "/groups" });
  },
  component: () => null,
});
