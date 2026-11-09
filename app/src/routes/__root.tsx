import { createRootRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useThemePreference } from "@/components/ui/theme-preference";

export const Route = createRootRoute({
  component: Root,
});

function Root() {
  // Follows the OS between light and dark, and applies a stored choice if one is ever made.
  useThemePreference();
  const navigate = useNavigate();
  const token = localStorage.getItem("ravocal_token");

  useEffect(() => {
    if (!token) {
      navigate({ to: "/login" });
    }
  }, [token, navigate]);

  return <Outlet />;
}
