import { createRootRoute, Outlet, redirect } from '@tanstack/react-router';
import { useThemePreference } from '@/components/ui/theme-preference';
import { isSignedIn, rememberAfterSignIn } from '@/lib/auth';

/** The pages a signed-out reader may open: the sign-in form, and the magic link it sends. */
const PUBLIC_PATHS = new Set(['/login', '/login/verify']);

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
    throw redirect({ to: '/login' });
  },
  component: Root,
});

function Root() {
  // Follows the OS between light and dark, and applies a stored choice if one is ever made.
  useThemePreference();
  return <Outlet />;
}
