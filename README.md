# cocktail-party

カクテルのレシピと写真を共有する日本語の Web SNS。用語は [CONTEXT.md](CONTEXT.md)、要件は [docs/requirements.md](docs/requirements.md)、設計判断は [docs/adr/](docs/adr/) を参照。

## Stack

SvelteKit (SSR, adapter-vercel) + Tailwind CSS, Hono API mounted at `/api/*` via `src/hooks.server.ts`, Drizzle ORM on Neon Postgres.

| Path                          | Role                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `src/lib/server/api/app.ts`   | Hono app (`/api/*`). Thin routes only.                     |
| `src/lib/api.ts`              | Typed Hono client (`createApiClient(fetch)`).              |
| `src/lib/server/services/`    | Business logic, shared by load functions and Hono routes.  |
| `src/lib/server/db/schema.ts` | Full data model. Migrations in `drizzle/`.                 |
| `src/lib/server/auth/`        | Better Auth (Google/LINE) and Hono guards. See Auth below. |

## Run

Requires Node 22, pnpm 9 (`corepack enable`) and Docker (for the local Postgres).

```sh
pnpm install
cp .env.example .env        # defaults point at the docker-compose Postgres
pnpm db:up                  # postgres:17 on 127.0.0.1:5432, or reuse one already running there
pnpm db:migrate             # apply drizzle/ (incl. pg_trgm)
pnpm db:seed:ingredients    # initial Ingredient master (DT-001), idempotent
pnpm dev                    # http://localhost:5173
```

| Script                        |                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | svelte-check / TypeScript                                                                                                                                                                                                             |
| `pnpm lint`                   | Prettier + ESLint (`pnpm format` to fix)                                                                                                                                                                                              |
| `pnpm test`                   | Vitest unit tests (`src/**/*.test.ts`, no DB)                                                                                                                                                                                         |
| `pnpm test:db`                | Integration tests (`src/**/*.db.test.ts`) in a throwaway database, see below                                                                                                                                                          |
| `pnpm test:e2e`               | Playwright smoke against `pnpm build && pnpm preview`. First run: `pnpm exec playwright install chromium`                                                                                                                             |
| `pnpm build` / `pnpm preview` | Production build / serve it on :4173                                                                                                                                                                                                  |
| `pnpm db:up`                  | Start the compose Postgres and wait until healthy. If a Postgres 17+ already answers on the `DATABASE_URL` host (e.g. another worktree's compose), reuse it instead of failing on the port clash. Creates the app database if missing |
| `pnpm db:down`                | Stop this checkout's compose Postgres (does nothing to one started elsewhere)                                                                                                                                                         |
| `pnpm db:reset`               | Drop and recreate the app database (`DATABASE_URL`), then migrate. Other databases on the server are untouched                                                                                                                        |
| `pnpm db:seed:ingredients`    | Insert the DT-001 Ingredients missing from `DATABASE_URL` (matched by normalized name; existing rows are not changed)                                                                                                                 |
| `pnpm db:generate`            | Generate a migration from the schema (no DB needed)                                                                                                                                                                                   |
| `pnpm db:migrate`             | Apply migrations to `$DATABASE_URL`                                                                                                                                                                                                   |

`db:*` scripts read `DATABASE_URL` from the shell, not `.env` (drizzle-kit does not load it), and default to `postgres://postgres:postgres@localhost:5432/cocktail_party`.

### DB tests and parallel worktrees

`DATABASE_URL_TEST` names only the server and credentials (default `postgres://postgres:postgres@localhost:5432/postgres`). Each `pnpm test:db` run creates its own database `cocktail_party_test_<random>`, applies `drizzle/`, runs the tests and drops it afterwards, also when tests fail. Several worktrees can therefore share one Postgres and run `pnpm test:db` at the same time. A run killed hard (e.g. `kill -9`) can leave a `cocktail_party_test_*` database behind; drop it by hand.

The app database is shared, though: worktrees using the same `DATABASE_URL` see each other's data, and `pnpm db:reset` resets it for all of them. Give a worktree its own `DATABASE_URL` database name if that matters.

### Notes

The first migration enables `pg_trgm` by a line added by hand to `drizzle/0000_init.sql`; drizzle-kit does not emit `CREATE EXTENSION`.

The DB client (`#lib/server/db`) uses node-postgres. Locally it talks to the compose Postgres; in production set `DATABASE_URL` to Neon's pooled connection string (`-pooler` host, `sslmode=require`).

## Auth

Better Auth runs inside the app (ADR 0005); its endpoints are under `/api/auth/*`. Google and LINE only, no email/password. Set the `BETTER_AUTH_*`, `GOOGLE_*` and `LINE_*` variables from `.env.example`.

**`member` is Better Auth's user table** (`user.modelName: 'member'`), so withdrawal and Suspension run in the app's own transactions. `account`, `session` and `verification` are Better Auth's tables in the same database; all ids are uuids.

| Better Auth user field           | `member` column                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `name`                           | `username`: stored as null at sign-up, set on `/welcome` (FR-052)               |
| `image`                          | `icon_key`: stored as null; the provider's photo URL is not kept                |
| `email`                          | `email`: always null (see below)                                                |
| `emailVerified`                  | `email_verified`: always false                                                  |
| `isAdministrator`, `suspendedAt` | `is_administrator`, `suspended_at` (additional fields, not writable by clients) |

- **No email is stored.** LINE may not return one (FR-050), and Better Auth matches a new login to an existing user by email, which would join a LINE login to a Google Member (FR-051). LINE logins without an email get a throwaway `<sub>@line.invalid` only to pass Better Auth's check; the create hook drops it.
- **One provider per Member** (FR-051) is enforced by `account`: unique `(provider_id, account_id)`, unique `user_id`, and `provider_id IN ('google', 'line')`. Account linking and `/link-social` are off; so are `/update-user`, `/update-session`, `/delete-user`, `/change-email` and `/unlink-account` (our services own those).
- **Suspension** (FR-075): a session is refused at creation if `suspended_at` is set, and every request re-reads the session from the database (no cookie cache); a suspended Member's sessions are deleted and `locals.member` is null.
- `src/hooks.server.ts` runs `authHandle` before `apiHandle`. `locals.member` (`{ id, username, isAdministrator }` or null) reaches Hono as `c.env.locals.member`. Guards: `requireMember`, `requireAdministrator` and `authorizePhotoUpload` in `#lib/server/auth/guards.js`. A Member without a Username is redirected to `/welcome` and gets 403 from guarded API routes.
- Withdrawal: `withdrawMember` in `#lib/server/services/members` deletes everything in one transaction and returns the storage keys to delete.

The db tests drive Better Auth's real sign-in and callback for LINE with the token endpoint stubbed. Real Google/LINE logins have not been tried.

## Photos (ADR 0003)

`PhotoPicker.svelte` shrinks a selected photo (JPEG/PNG/WebP, up to 10MB) below 4.5MB in the browser; `POST /api/photos?kind=recipe|member` takes the raw bytes as `application/octet-stream`, and `storePhoto` re-encodes them with `sharp` into two metadata-free WebP files (`<kind>/<id>/list.webp` 480px, `detail.webp` 1600px) in R2. The original is never stored. The route denies everything (401) until auth passes an `authorize` middleware to `photosRoute()` in `app.ts`. R2 is configured by the `R2_*` variables (declared in `src/env.ts`, examples in `.env.example`), read on the first upload. Derivatives are served with `Cache-Control: public, max-age=3600`, so a deleted Photo can still be fetched from an edge or browser cache for up to about an hour. `/dev/photo-picker` is the e2e harness page (uploads nothing); it returns 404 unless `E2E_HARNESS=1`, which only `playwright.config.ts` sets. Set `PW_REUSE_SERVER=1` to let `pnpm test:e2e` reuse an already running preview server on port 4173 (off by default, since another worktree may own that port).

### Known limits

- Browser downsizing is tested only on desktop Chromium (`e2e/photo.e2e.ts`). Untested: iOS Safari HEIC handling (expected to arrive as JPEG via `accept`, else rejected as an unsupported format), iOS canvas memory caps with 48MP/panorama photos, `imageOrientation: 'from-image'` on Safari ≤16.4 and old Android WebViews, Android Chrome's Google Photos picker (`file.type`, cloud-only photos), and downsizing speed on low-end phones.
- `sharp` loading in the Vercel function runtime is not verified. The local build bundles `@img/sharp-linux-x64`; deploy once to a Preview and hit `/api/photos` before relying on it.
- The R2 store is unit-tested for request construction only (no credentials in CI); it has not talked to a real bucket.
