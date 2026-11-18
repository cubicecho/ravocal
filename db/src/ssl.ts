/** The query parameter that states the TLS mode outright. When it is there, it is respected. */
const SSL_MODE_PARAM = 'sslmode';
/** Host name suffixes that only resolve on a private network. */
const PRIVATE_SUFFIXES = ['.lan', '.local', '.internal', '.home.arpa'];
/** IPv4 addresses that never leave a private network: loopback, RFC 1918 and link-local. */
const PRIVATE_IPV4 = [/^127\./, /^10\./, /^172\.(?:1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./];
/** IPv6 loopback, unique local (fc00::/7) and link-local (fe80::/10) addresses. */
const PRIVATE_IPV6 = [/^::1$/, /^f[cd][0-9a-f]{2}:/, /^fe[89ab][0-9a-f]:/];
/** The brackets a URL keeps around an IPv6 host. */
const IPV6_BRACKETS = /^\[|\]$/g;

/**
 * Reads the host out of a URL in the form `isPrivateHost` takes.
 *
 * @param url - Any URL.
 * @returns Its host, lower-cased, without IPv6 brackets.
 */
export function hostOf(url: string): string {
  return new URL(url).hostname.replace(IPV6_BRACKETS, '').toLowerCase();
}

/**
 * Whether a host can only be reached from a private network or this machine.
 *
 * @param host - Lower-case host name or address, without IPv6 brackets (`hostOf`).
 * @returns true for a dotless name (a compose service such as `postgres`), a private suffix or a private address.
 */
export function isPrivateHost(host: string): boolean {
  const isIpv6 = host.includes(':');
  if (isIpv6) {
    return PRIVATE_IPV6.some((range) => range.test(host));
  }
  const isDotless = host.includes('.') === false;
  const hasPrivateSuffix = PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
  const isPrivateIpv4 = PRIVATE_IPV4.some((range) => range.test(host));
  return isDotless || hasPrivateSuffix || isPrivateIpv4;
}

/**
 * Whether a Postgres URL needs TLS forced on.
 *
 * @param url - Connection URL.
 * @returns false for an explicit sslmode or a private or local host.
 *
 * @remarks
 * Self-hosters on a NAS or a home network must not need certificates, so only a host that may be on the
 * internet gets TLS forced on.
 */
export function requiresSsl(url: string): boolean {
  const hasSslMode = new URL(url).searchParams.has(SSL_MODE_PARAM);
  if (hasSslMode) {
    return false;
  }
  return isPrivateHost(hostOf(url)) === false;
}
