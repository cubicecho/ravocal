# Frontend — Ravocal

React 19 + Vite + TanStack Router (file-based) + Apollo Client. Plain web app — no React Native, no Expo.

## Dev Server

```bash
npm run dev:app    # Vite on localhost:3000
npm run dev        # server + app concurrently
```

Vite proxies `/graphql` to `http://localhost:3001` so no CORS issues in development.

## Auth

JWT stored in `localStorage.ravocal_token`. Apollo Client's `authLink` reads it and injects `Authorization: Bearer <token>` on every request.

Auth guard in `app/src/routes/__root.tsx`: if no token, redirect to `/login`. The `/login` route skips the guard.

Sign-out: delete `localStorage.ravocal_token` and navigate to `/login`.

## Routing

TanStack Router with file-based routes. The Vite plugin generates `app/src/routeTree.gen.ts` automatically — do not edit it manually.

| Route | File | Purpose |
|-------|------|---------|
| `/` | `routes/index.tsx` | Redirect → `/groups` or `/login` |
| `/login` | `routes/login.tsx` | Magic link request form |
| `/login/verify` | `routes/login.verify.tsx` | Consume magic link token |
| `/invite` | `routes/invite.tsx` | Accept group invite via token |
| `/groups` | `routes/groups/index.tsx` | List user's groups |
| `/groups/new` | `routes/groups/new.tsx` | Create group form |
| `/groups/$groupId` | `routes/groups/$groupId.tsx` | Group detail + calendar + vote |

Add new routes by creating files in `app/src/routes/`. Run the dev server once to let the plugin generate the updated route tree.

## GraphQL Operations

Use the typed `graphql()` helper — never raw `gql`:

```typescript
import { graphql } from "@/__generated__/index.js";

const MY_QUERY = graphql(`
  query MyGroups {
    myGroups { id name }
  }
`);
```

Colocate operations with the component that uses them. After adding/changing operations, run `npm run codegen:app`.

## Path Alias

`@/` maps to `app/src/`. Use it for all imports within the app:

```typescript
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
```

## shadcn/ui

Install components via the CLI:

```bash
npx shadcn@latest add button
npx shadcn@latest add input card dialog
```

Components land in `app/src/components/ui/`. Never add app logic there — it's primitives only. App-specific components go in `app/src/components/domain/`.

## Apollo Client

Configured in `app/src/apollo-client.ts`. Cache is `InMemoryCache` with default settings.

After mutations that modify lists, pass `refetchQueries`:

```typescript
useMutation(CREATE_GROUP, {
  refetchQueries: [{ query: MY_GROUPS }],
})
```
