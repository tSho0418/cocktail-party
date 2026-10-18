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
cp .env.example .env      # defaults point at the docker-compose Postgres
pnpm db:up                # postgres:17 on :5432 (databases cocktail_party and cocktail_party_test)
pnpm db:migrate           # apply drizzle/ (incl. pg_trgm)
pnpm dev                  # http://localhost:5173
```

| Script                        |                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | svelte-check / TypeScript                                                                                                              |
| `pnpm lint`                   | Prettier + ESLint (`pnpm format` to fix)                                                                                               |
| `pnpm test`                   | Vitest unit tests (`src/**/*.test.ts`, no DB)                                                                                          |
| `pnpm test:db`                | Integration tests (`src/**/*.db.test.ts`) against `DATABASE_URL_TEST`. Each run drops that database's schema and re-applies `drizzle/` |
| `pnpm test:e2e`               | Playwright smoke against `pnpm build && pnpm preview`. First run: `pnpm exec playwright install chromium`                              |
| `pnpm build` / `pnpm preview` | Production build / serve it on :4173                                                                                                   |
| `pnpm db:up` / `pnpm db:down` | Start (and wait for healthy) / stop the local Postgres                                                                                 |
| `pnpm db:reset`               | Delete the local volume, restart and migrate                                                                                           |
| `pnpm db:generate`            | Generate a migration from the schema (no DB needed)                                                                                    |
| `pnpm db:migrate`             | Apply migrations to `$DATABASE_URL` from the shell (drizzle-kit does not read `.env`), else the local compose DB                       |

The first migration enables `pg_trgm` by a line added by hand to `drizzle/0000_init.sql`; drizzle-kit does not emit `CREATE EXTENSION`.

The DB client (`#lib/server/db`) uses node-postgres. Locally it talks to the compose Postgres; in production set `DATABASE_URL` to Neon's pooled connection string (`-pooler` host, `sslmode=require`).

The test database is created by the compose init script only when the volume is first created; on an older volume run `pnpm db:reset`.

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
