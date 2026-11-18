/**
 * The signed-in session, as the browser keeps it: the bearer token a sign-in link was spent for, and the page a
 * signed-out reader was on their way to when they were sent to sign in. The session itself lives on the server,
 * which ends it on `signOut`.
 */

const TOKEN_KEY = 'ravocal_token';
const AFTER_SIGN_IN_KEY = 'ravocal_after_sign_in';

/** Where a reader lands after signing in when they were not on their way anywhere. */
export const HOME_PATH = '/groups' as const;
/** Where a reader signs in. */
export const LOGIN_PATH = '/login' as const;
/** Where a sign-in link from an email lands. The server builds the link with this path. */
export const VERIFY_PATH = '/auth/verify' as const;
/** Where a sign-in with Google, Facebook or the OIDC provider lands, with a one-time token. The server redirects here. */
export const SSO_PATH = '/auth/sso' as const;

/** The pages a signed-out reader may open: the sign-in form, and the pages a sign-in lands on. */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, VERIFY_PATH, SSO_PATH]);

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function isSignedIn(): boolean {
  return getToken() !== null;
}

/** Keeps the session token `magicLinkVerify` or `verifyOneTimeToken` answered with. */
export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Forgets the session token. The server's session is ended by the `signOut` mutation. */
export function clearToken(): void {
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
  const isSitePath = href?.startsWith('/') === true && href.startsWith('//') === false;
  return isSitePath ? href : HOME_PATH;
}
