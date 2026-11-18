import { createRootRoute, Outlet, redirect } from '@tanstack/react-router';
import { useThemePreference } from '@/components/ui/theme-preference';
import { isSignedIn, LOGIN_PATH, PUBLIC_PATHS, rememberAfterSignIn } from '@/lib/auth';

export const Route = createRootRoute({
  // Before any page loads, so a signed-out reader never sees one flash before the redirect, and
  // the magic link's own page is left to finish signing them in.
  beforeLoad: ({ location }) => {
    if (isSignedIn() || PUBLIC_PATHS.has(location.pathname)) {
      return;
    }
    if (location.pathname !== '/') {
      rememberAfterSignIn(location.href);
    }
    throw redirect({ to: LOGIN_PATH });
  },
  component: Root,
});

function Root() {
  // Follows the OS between light and dark, and applies a stored choice if one is ever made.
  useThemePreference();
  return <Outlet />;
}
