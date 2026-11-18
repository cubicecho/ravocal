# Frontend — Ravocal

React 19 + Vite + TanStack Router (file-based) + Apollo Client. Plain web app — no React Native, no Expo.

## Dev Server

```bash
npm run dev:app    # Vite on localhost:5173
npm run dev        # server + app concurrently
```

Vite proxies `/graphql`, `/sso/` and `/api/auth/` to `http://localhost:3001`, so the app and the server are one origin in development as in production: no CORS, and a provider's state cookie comes back to the origin that set it. Set `APP_URL=http://localhost:5173` (`.env.example` does).

## Auth

The session is better-auth's bearer token, kept in `localStorage.ravocal_token` and read and written
only through `app/src/lib/auth.ts` (`getToken`, `isSignedIn`, `storeToken`, `clearToken`). Apollo
Client's `authLink` sends it as `Authorization: Bearer <token>` on every request.

Sign-in: `/login` reads `authConfig` and calls `signInMagicLink(email)`. The link in the email
opens `/auth/verify?token=…`, which calls `magicLinkVerify` once and stores the token it answers
with. Under `SECURE_LOCAL_NET` `signInMagicLink` answers with the token itself, and the login page
signs straight in. With neither SMTP nor `SECURE_LOCAL_NET` the page says sign-in is not set up
instead of offering a form. A `TOO_MANY_REQUESTS` refusal is shown as its own callout.

Google and Facebook: `/login` shows a "Continue with <name>" `Button` per entry in
`authConfig.providers`, its `linkSlot` a plain `<a href={signInUrl}>`: a full page load out to the
provider, not a fetch. The server's callback lands on `/auth/sso?token=…`, which calls
`verifyOneTimeToken` once (the same ref guard), stores the token and goes on with
`takeAfterSignIn`; a failure says a sign-in has to be finished within a few minutes and only once.
A refusal comes back as `/login?error=<code>&provider=<id>`, and `lib/provider-errors.ts`
(`describeProviderError`) says what each code means, naming the provider. "Sign-in is not set up"
shows only with no links, no `SECURE_LOCAL_NET` and no provider.

Setting sign-in up: `/login` also reads `ssoSetup`. On an instance with no accounts and nothing paired
(`canPair`, source `NONE`) it offers "Set up sign-in", which swaps the card for
`components/domain/sso/pair-sso-form.tsx`: paste the setup URL, `pairSso`, and back on the sign-in card the
"Continue with <name>" button is there (`AuthConfig` and `SsoSetup` are refetched by name), with a note that the
first account becomes the admin. `lib/sso.ts` holds the documents and `describePairingError`, which heads each
`extensions.reason` (`BAD_URL`, `EXPIRED`, …) with its own title over the server's sentence.

Settings (`/settings`, the Settings button on `/groups`): "Profile" (`components/domain/profile-form.tsx`) edits the
reader's display name with `updateUser`, and re-reads `getSession`. "Connected accounts" lists the email link
and each provider with `SettingRow`s. Connect calls `linkSocialAccount(provider)` and follows the
URL it answers with; the provider sends the reader back to `/settings?connected=<id>` or
`?error=<code>&provider=<id>`. Disconnect is a `ConfirmButton` calling `unlinkAccount`, held back
(with the reason as its hint) when it is the last way to sign in: no other provider connected and
no confirmed address for a link. The server enforces the same rule.

"Single sign-on" (`components/domain/sso/sso-settings.tsx`) shows only to the admin: the Settings query
reads `users(where: { isAdmin: { eq: true } })` and looks for the reader's own id. It shows the paired
provider and its issuer with a Disconnect `ConfirmButton` (`unpairSso`), or the setup URL form, or, when
`OIDC_ISSUER` sets it, that the server's environment does, with the redirect URI to register.

Auth guard: the root route's `beforeLoad` (`app/src/routes/__root.tsx`) redirects a signed-out
reader to `/login`, except on `PUBLIC_PATHS` (`/login`, `/auth/verify` and `/auth/sso`). It first remembers where
they were going (`rememberAfterSignIn`), so an invite link or a group link opened while signed out
finishes there once the magic link is followed; `/auth/verify` and `/auth/sso` send them on with `takeAfterSignIn`.
`/login` redirects a signed-in reader to `/groups` in its own `beforeLoad`.

An expired or ended session: Apollo's `errorLink` (`app/src/apollo-client.ts`) watches for the
`UNAUTHENTICATED` code, drops the token, remembers the page and reloads on `/login`. A bad sign-in
link is `BAD_USER_INPUT`, so it never signs anyone out. Errors are matched by code
(`lib/error-codes.ts`), never by message.

A link from an email (`/auth/verify`, `/invite`) spends a single-use token, so its page sends the
mutation once (a ref guard, because StrictMode runs effects twice) and reports a failure through
the mutation's `error`, with `onError` set so the promise never rejects unhandled.

Sign-out (the Sign out button on `/groups`): the `signOut` mutation ends the session on the server,
then `clearToken()`, clear Apollo's store, and navigate to `/login`.

## Routing

TanStack Router with file-based routes. The Vite plugin regenerates `app/src/routeTree.gen.ts` in dev, and `npm run codegen` generates it for typechecks and builds. It is gitignored; do not edit it manually.

| Route              | File                         | Purpose                                                                                             |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `/`                | `routes/index.tsx`           | Redirect → `/groups` or `/login`                                                                    |
| `/login`           | `routes/login.tsx`           | Magic link request form, provider buttons, `?error=` messages, setting sign-in up on a new instance |
| `/auth/verify`     | `routes/auth/verify.tsx`     | Spend a magic link's token for a session                                                            |
| `/auth/sso`        | `routes/auth/sso.tsx`        | Spend a provider sign-in's one-time token for a session                                             |
| `/settings`        | `routes/settings.tsx`        | Connected accounts: connect and disconnect providers; Single sign-on for the admin                  |
| `/invite`          | `routes/invite.tsx`          | Accept group invite via token                                                                       |
| `/groups`          | `routes/groups/index.tsx`    | List user's groups                                                                                  |
| `/groups/new`      | `routes/groups/new.tsx`      | Create group form                                                                                   |
| `/groups/$groupId` | `routes/groups/$groupId.tsx` | Group detail: vote, free time, members and invites ("The group page")                               |

Add new routes by creating files in `app/src/routes/`. Run the dev server once to let the plugin generate the updated route tree.

## GraphQL Operations

Use the typed `graphql()` helper — never raw `gql`:

```typescript
import { graphql } from '@/__generated__/index.js';

const MY_QUERY = graphql(`
  query MyGroups {
    groups { id name }
  }
`);
```

Colocate operations with the component that uses them. After adding/changing operations, run `npm run codegen:app`.

The API is mostly generated (`docs/graphql.md`): `groups` is already only the reader's own, `group(where: { id: { eq: $id } })` is `null` for a group they aren't in (the page shows "Group not found"), and the reader's own user comes from `getSession { user { id name email } }`. Owner-only actions are drawn only when `getSession.user.id` is the group's `ownerId`; the server refuses them anyway.

## Path Alias

`@/` maps to `app/src/`. Use it for all imports within the app:

```typescript
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
```

## cubeui

The UI comes from the [cubeui](https://github.com/cubicecho/cubeui) registry, installed with the
shadcn CLI from `app/` (`components.json` registers `@cubeui`):

```bash
npx shadcn@latest add @cubeui/page-layout
npx shadcn@latest add @cubeui/button --overwrite   # update an installed item
```

Primitives land in `app/src/components/ui/`, the layout shells and `app-form` in
`app/src/components/`, and helpers such as `utils.ts` in `app/src/lib/`. They are installed, not
edited: change them upstream and reinstall. `biome.json` turns linting and formatting off for them,
so a new item's files join that override. App-specific components go in
`app/src/components/domain/`.

- An edit is an explicit form, never inline: a `DialogLayout` holding a `useAppForm` form, its `wrapperSlot` from
  `dialogForm` (`components/domain/form/dialog-form.tsx`), Cancel taken from `footerActionsSlot`'s `close`, and
  `hasUnsavedChanges` read off `form.state.isDefaultValue`. The page holds it with `useDialog` (`lib/use-dialog.ts`) and
  keys the dialog on its `key`, so a reopened form starts from what is saved. A destructive action is a
  `ConfirmButton`.
- A page is `PageLayout` (a detail page passes `loading` and puts `LoadState` with `record` in its
  body); a list page puts `LoadState` with `count` and an `EmptyState` over a `List` of `ListItem`s.
  Pass `asQuery(result)` from `@/lib/as-query` as an Apollo query's `query`.
- Forms are `useAppForm` with the bound fields (`InputField`, …) and `form.SubmitButton`. A
  mutation's failure goes under the fields with `FormError`. `RangeField`
  (`components/domain/form/range-field.tsx`) is the slider the registry does not ship.
- The palette is cubeui's (`app/cubeui-tokens.css`), light and dark following the system.

## The group page

`/groups/$groupId` reads everything in one query, `GroupDetail`, and every change on the page refetches it by name
(`refetchQueries: ['GroupDetail']`), except a rename, which Apollo's normalized cache shows at once. Each list in the
query is priced by its page size (`OPERATION_LIMIT_DEFAULTS.maxCost`), which is why a block's owner is looked up in
`members` rather than read per block. Owner-only controls (Settings, Invite, Start vote, Close vote, Remove, Cancel
invite) are drawn only for the owner; the server refuses them anyway. The sections, in `components/domain/group/`:

- **Vote** (`vote-section.tsx`). The owner starts a vote (`startVote`). A `BAD_USER_INPUT` refusal with no vote open is
  the threshold's: the page shows the server's sentence and offers `forceStartVote`. While a vote is open, every member
  ranks it in `ranking-dialog.tsx`: an ordered list with move up, move down and take-off buttons (focus follows the
  time that moved, and a live region says where it went), and the times left out with Add. Saving sends the whole
  ballot to `submitRankings`, top choice rank 1; a member may leave times out, and an empty ballot withdraws a saved
  one. Before a first save the ballot starts as every candidate in ballot order. Above the reader's ballot, a line and
  a `Progress` bar say how many of the members have ranked (`Vote.rankedCount`) and whether the reader is one of them;
  a save refetches `GroupDetail`, so it moves at once. The owner closes it (`closeVote`, a `ConfirmButton`), and a
  closed vote shows its winner on a card of its own, with how many ballots chose it, over every candidate.
- **Free time** (`free-time-section.tsx`, `time-block-dialog.tsx`). Blocks grouped by member, the reader's first, with
  Edit and Delete on the reader's own. The dialog takes a date and a start and an end from selects built by
  `lib/time-grid.ts`: the starts are every **UTC** half hour inside the chosen local day, labelled in local time, so
  every choice is one the server's grid accepts. Where the offset is not a whole number of half hours (Nepal, +05:45)
  the choices read :15 and :45, and the dialog says so. The ends follow the chosen start, from half an hour after it
  to a day after it (`LONGEST_BLOCK_MINUTES`), so a block can run past midnight: an end on the next day is labelled
  "(next day)". A choice is minutes since the local midnight (past 1440 for the next day), so changing the date keeps
  the times; a 23- or 25-hour day has fewer or more starts, the ends count hours that pass rather than hours on the
  clock, and a repeated hour is labelled with its offset. An edited block longer than a day keeps its end as an extra
  choice, labelled with its date. The list shows a block across midnight with both dates.
- **Members** and **Invited**, with the owner's Invite dialog (`invite-dialog.tsx`, `inviteToGroup`) and Group
  settings (`group-settings-dialog.tsx`: `updateGroup` for the name and threshold, and `deleteGroup` behind a
  `ConfirmButton` that asks for the group's name).

## Apollo Client

Configured in `app/src/apollo-client.ts`. Cache is `InMemoryCache` with default settings.

After mutations that modify lists, pass `refetchQueries`:

```typescript
useMutation(CREATE_GROUP, {
  refetchQueries: [{ query: MY_GROUPS }],
});
```
