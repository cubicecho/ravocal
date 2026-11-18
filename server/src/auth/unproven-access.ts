import type { BetterAuthOptions } from 'better-auth';

// An account whose address nobody has proven (made by a Facebook sign-in, or by a Google one Google had not checked)
// may have been made by someone who does not own the address, to wait for its owner. So the first time the address is
// proven, by a magic link or a Google sign-in that Google checked, every way in the account had before stops working:
// its sessions, and every provider account but the one proving it. A provider connected after that, from Settings, was
// connected by a session that had proven the address, and is kept, because the address is never proven a second time.
// SECURE_LOCAL_NET proves nothing and never sets emailVerified.
//
// better-auth's magic link already does this itself (revokeUnprovenAccountAccess) before it confirms the address;
// a provider sign-in does not, so these hooks cover both, wherever better-auth confirms an address.

/** better-auth's request context, as its database hooks are handed it. */
type HookContext = object | null;

/** The provider accounts each request signed in with or linked, by its request context. */
const touched = new WeakMap<object, Set<string>>();
/** The requests that are confirming an address. */
const proving = new WeakSet<object>();

/**
 * Notes a provider account a request signed in with or linked, so proving the address in the same request keeps it.
 *
 * @param context - The request's context, or null outside one.
 * @param accountId - The account row's id.
 */
function remember(context: HookContext, accountId: string): void {
  if (context === null) {
    return;
  }
  const ids = touched.get(context) ?? new Set<string>();
  ids.add(accountId);
  touched.set(context, ids);
}

/** The database hooks that end an account's unproven ways in when its address is first proven. */
export const revokeUnprovenAccess: NonNullable<BetterAuthOptions['databaseHooks']> = {
  account: {
    create: {
      after: async (account, context) => {
        remember(context, account.id);
      },
    },
    update: {
      after: async (account, context) => {
        remember(context, account.id);
      },
    },
  },
  user: {
    update: {
      // better-auth writes `emailVerified: true` only when it proves an address that was not.
      before: async (user, context) => {
        if (user.emailVerified === true && context !== null) {
          proving.add(context);
        }
      },
      // Runs before the request opens its own session, so every session there is now predates the proof.
      after: async (user, context) => {
        if (context === null || proving.has(context) === false) {
          return;
        }
        proving.delete(context);
        const kept = touched.get(context) ?? new Set<string>();
        const { internalAdapter } = context.context;
        const unproven = (await internalAdapter.findAccounts(user.id)).filter(
          (account) => kept.has(account.id) === false,
        );
        await Promise.all(unproven.map((account) => internalAdapter.deleteAccount(account.id)));
        await internalAdapter.deleteUserSessions(user.id);
      },
    },
  },
};
