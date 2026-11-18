# Ravocal

Group scheduling with ranked-choice voting. Create a group and invite people by email. Each member marks the blocks
of time they are free. The owner then starts a vote over the slots enough of the group shares; members rank them, and
the winning slot shows in the app. When too few slots overlap, the owner can force a vote that puts their own free
time first.

It is one container, which serves the app and its GraphQL API from the same origin, plus Postgres.

## Quickstart

You need Docker with Compose. Nothing to clone and nothing to build:

```bash
mkdir ravocal && cd ravocal
curl -fsSLO https://raw.githubusercontent.com/cubicecho/ravocal/main/docker-compose.yml

# The secret better-auth signs sessions with, and sign-in by address alone (see below).
printf 'BETTER_AUTH_SECRET=%s\nSECURE_LOCAL_NET=true\n' "$(openssl rand -hex 32)" > .env

docker compose up -d
```

Ravocal is on <http://localhost:3001>. The server applies the database migrations at boot, so a fresh install has no
setup step. `docker compose up -d --wait` returns once `/healthz` answers.

`SECURE_LOCAL_NET=true` signs in whoever types an email address, which is right on your own machine and wrong
anywhere else. To email sign-in links instead, drop that line and set `SMTP_URL` (see [Sign-in methods](#sign-in-methods)).

- Keep `.env`. Changing `BETTER_AUTH_SECRET` signs everyone out.
- Your data is in the `ravocal_pgdata` volume, which survives `docker compose down` (but not `down -v`).
- Upgrade with `docker compose pull && docker compose up -d`. Migrations run on the next boot.
- The same image is on GitHub's registry as `ghcr.io/cubicecho/ravocal`, with the same tags. Change `image:` in
  `docker-compose.yml` to pull from there.

## Configuration

`docker-compose.yml` reads `.env` from its own directory and passes each variable to the container. Every variable,
its default and what it does is in [`.env.example`](.env.example). What an install usually sets:

| Variable | Default | |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | none | **Required.** `openssl rand -hex 32`. The server refuses a missing, placeholder or short one. |
| `APP_URL` | `http://localhost:3001` | The address people open. Links in emails and the providers' redirect URIs are built from it. |
| `SMTP_URL`, `SMTP_FROM` | unset | Outgoing mail, e.g. `smtps://user:pass@smtp.example.com:465`. |
| `SECURE_LOCAL_NET` | `false` | Sign in with an address alone. Private networks only. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Sign in with Google. Both or neither. |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | unset | Sign in with Facebook. Both or neither. |
| `SERVER_URL` | `APP_URL` | Where a browser reaches the server, if not at `APP_URL`. |
| `TRUST_PROXY` | `false` | `1` behind one reverse proxy, so sign-in is rate-limited per visitor, not per proxy. |
| `PORT` | `3001` | The host port the app is published on. |
| `POSTGRES_PASSWORD` | `ravocal` | The compose Postgres's password. Set it before the first `up`. Postgres isn't published outside the compose network. |

The server checks its configuration before it starts, and exits with a sentence saying what to fix.

### Behind a reverse proxy

Put TLS in front (Caddy, Traefik, nginx), set `APP_URL` to the public `https://` address, and set `TRUST_PROXY=1`.
Never set `SECURE_LOCAL_NET` on an instance the internet can reach. The server refuses it when `APP_URL` is a public
host.

## Sign-in methods

There are no passwords. Set at least one of these. With none, the server starts, warns in its log, and nobody can sign
in.

- **Email link.** Set `SMTP_URL` to a mail relay. Readers type their address and get a link that signs them in once.
  Invite and vote emails go out the same way. Without `SMTP_URL`, those emails are printed to the server's log.
- **`SECURE_LOCAL_NET=true`.** Typing an address signs straight in: the network is the credential. For a home network
  or a machine only you can reach. The server refuses it unless `APP_URL`'s host is private (localhost, a dotless
  name, `.lan`, `.local`, `.internal`, `.home.arpa`, or a private address).
- **Google and Facebook.** Create an OAuth client with each provider and set its pair. Register these redirect URIs,
  exactly (`SERVER_URL` is `APP_URL` unless you set it):

  ```
  <SERVER_URL>/api/auth/callback/google
  <SERVER_URL>/api/auth/callback/facebook
  ```

  The server prints each one at boot. [`.env.example`](.env.example) walks through both consoles step by step.
  A Google sign-in reaches the account that has its address only when Google says it checked the address. Facebook
  never says so, so a Facebook sign-in whose address already has an account is refused, and the reader signs in by
  email and connects Facebook in Settings.

## Development

Node 26 or later, and Docker for the database and mail.

```bash
git clone https://github.com/cubicecho/ravocal.git
cd ravocal
cp .env.example .env
npm ci
npm run db:up      # Postgres on 5436 and Mailpit (SMTP 1036, web UI 8036), from docker-compose.dev.yml
npm run dev        # The API on 3001 (migrates at boot) and the app on http://localhost:5173
```

Sign-in links and every other email land in Mailpit: open <http://localhost:8036>. Or set `SECURE_LOCAL_NET=true` in
`.env` to sign in without one. `npm run db:down` stops Postgres and Mailpit.

If the Docker daemon is another machine (`docker context ls`), set `DEV_BIND=0.0.0.0` and put that machine's host in
`DATABASE_URL` and `SMTP_URL`.

```bash
npm run check      # codegen, Biome and tsc across the three workspaces
npm test           # Vitest, on an in-memory Postgres (PGlite)
npm run build      # codegen and the app's Vite build
```

[AGENTS.md](AGENTS.md) describes how the pieces fit together, and [`docs/`](docs) goes into each.

### Running the image you built

`docker-compose.yml` pulls the published image. To run a build from your clone, tag it with the same name. Give it its
own env file, since your development `.env` points at the development database and Mailpit:

```bash
docker build -t vantreeseba/ravocal:latest .
printf 'BETTER_AUTH_SECRET=%s\nSECURE_LOCAL_NET=true\n' "$(openssl rand -hex 32)" > .env.compose
docker compose --env-file .env.compose up -d --wait
```

## CI

Every push to `main` and every pull request runs three jobs (`.github/workflows/ci.yml`):

- **check**: Biome, `tsc`, the tests and the build.
- **postgres**: applies every migration to an empty Postgres and checks that the models match them. It also applies
  the migrations around rows a data migration rewrites (`npm run check:data-migrations -w db`) and checks the result.
- **boot**: builds the image, starts `docker-compose.yml` on a fresh volume, and checks `/healthz`, an anonymous
  query, `authConfig` and the app page. Then it checks that `docker compose stop` exits cleanly.

## Releases

Releases are cut by [semantic-release](https://semantic-release.gitbook.io) from the conventional commit messages
on `main`. A `feat:` makes a minor version, a `fix:` or `perf:` a patch, and a `BREAKING CHANGE:` footer a major.
`chore:`, `docs:`, `ci:`, `build:`, `refactor:` and `test:` make none. The release workflow
(`.github/workflows/release.yml`):

1. Works out the next version, and stops when there isn't one.
2. Tags `vX.Y.Z`, writes the GitHub release and `CHANGELOG.md`, and commits the changelog and the version in
   `package.json` back to `main` (`chore(release): X.Y.Z [skip ci]`).
3. Builds the image and pushes it to Docker Hub (`vantreeseba/ravocal`) and GHCR (`ghcr.io/cubicecho/ravocal`),
   tagged `X.Y.Z` and `latest`.

For now it runs only by hand: **Actions > Release > Run workflow** on `main`. It needs the repository secrets
`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token). GHCR uses the workflow's own token. To
release on every push to `main`, change the workflow's trigger. The comment at the top of `release.yml` gives the
one line.
