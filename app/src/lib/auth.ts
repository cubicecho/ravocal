/**
 * The signed-in session, as the browser keeps it: the JWT from a magic link, and the page a
 * signed-out reader was on their way to when they were sent to sign in.
 */

const TOKEN_KEY = "ravocal_token";
const AFTER_SIGN_IN_KEY = "ravocal_after_sign_in";

/** Where a reader lands after signing in when they were not on their way anywhere. */
export const HOME_PATH = "/groups" as const;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function isSignedIn(): boolean {
  return getToken() !== null;
}

export function signIn(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Keeps the page a signed-out reader asked for — an invite link, a group — so signing in can
 * finish there. It is in `localStorage` rather than the URL because the magic link that signs
 * them in arrives by email and is often opened in another tab.
 */
export function rememberAfterSignIn(href: string): void {
  localStorage.setItem(AFTER_SIGN_IN_KEY, href);
}

/** The page kept by `rememberAfterSignIn`, once, or `HOME_PATH` when there is none. */
export function takeAfterSignIn(): string {
  const href = localStorage.getItem(AFTER_SIGN_IN_KEY);
  localStorage.removeItem(AFTER_SIGN_IN_KEY);
  // Only a path on this site: never `//elsewhere.example` or a full URL.
  return href?.startsWith("/") && !href.startsWith("//") ? href : HOME_PATH;
}
