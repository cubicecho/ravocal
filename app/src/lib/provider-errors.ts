/**
 * What the reader is told when a sign-in with a provider, or connecting one in Settings, comes back with `?error=`.
 * The codes are better-auth's (its callback's) and the server's own (server/src/http/sso.ts).
 */

/** The `?error=` codes a reader can be sent back with, by name. */
export const ProviderError = {
  /** A Facebook sign-in whose address an account already has: Facebook's word on an address is not taken. */
  AccountNotLinked: 'account_not_linked',
  /** The provider shared no email address. */
  EmailNotFound: 'email_not_found',
  /** The reader said no at the provider. */
  AccessDenied: 'access_denied',
  /** The sign-in took too long, was finished twice, or in another browser than it started in. */
  StateMismatch: 'state_mismatch',
  /** The same, caught before better-auth could find the sign-in at all. */
  StateNotFound: 'state_not_found',
  /** The provider is not set up on this instance. */
  Off: 'sso_off',
  /** Connecting a provider account that another Ravocal account already has. */
  AlreadyLinked: 'account_already_linked_to_different_user',
  /** better-auth could not link the account, or the session that asked for it had ended. */
  UnableToLink: 'unable_to_link_account',
} as const;
export type ProviderError = (typeof ProviderError)[keyof typeof ProviderError];

/** Said when the sign-in took too long or crossed browsers, under either code. */
const START_AGAIN = 'That sign-in took too long, or was finished in another browser. Start again from this page.';

/** What each code says, given what the provider is called. */
const MESSAGES: ReadonlyMap<string, (provider: string) => string> = new Map<
  ProviderError,
  (provider: string) => string
>([
  [
    ProviderError.AccountNotLinked,
    (provider) =>
      `An account with that email address already exists. Sign in with your email, then connect ${provider} in Settings.`,
  ],
  [
    ProviderError.EmailNotFound,
    (provider) =>
      `Ravocal needs an email address to sign you in, and ${provider} didn't share one. Let it share your address, or sign in with your email.`,
  ],
  [ProviderError.AccessDenied, (provider) => `You said no at ${provider}, so it didn't sign you in.`],
  [ProviderError.StateMismatch, () => START_AGAIN],
  [ProviderError.StateNotFound, () => START_AGAIN],
  [ProviderError.Off, () => "That way of signing in isn't set up here. Use one this page offers."],
  [
    ProviderError.AlreadyLinked,
    (provider) => `That account at ${provider} is connected to another Ravocal account. Disconnect it there first.`,
  ],
  [ProviderError.UnableToLink, (provider) => `Couldn't connect ${provider}. Sign in again, then try once more.`],
]);

/**
 * Says why a provider's sign-in or connection failed.
 *
 * @param code - The `?error=` code.
 * @param [provider] - What the provider is called, when the page knows.
 * @returns A sentence to show the reader.
 */
export function describeProviderError(code: string, provider = 'the provider'): string {
  const message = MESSAGES.get(code);
  return message === undefined ? `Signing in with ${provider} didn't work. Try again.` : message(provider);
}
