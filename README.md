# cocktail-party

カクテルのレシピと写真を共有する日本語の Web SNS。用語は [CONTEXT.md](CONTEXT.md)、要件は [docs/requirements.md](docs/requirements.md)、設計判断は [docs/adr/](docs/adr/) を参照。

## Stack

SvelteKit (SSR, adapter-vercel) + Tailwind CSS, Hono API mounted at `/api/*` via `src/hooks.server.ts`, Drizzle ORM on Neon Postgres.

| Path                          | Role                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `src/lib/server/api/app.ts`   | Hono app (`/api/*`). Thin routes only.                    |
| `src/lib/api.ts`              | Typed Hono client (`createApiClient(fetch)`).             |
| `src/lib/server/services/`    | Business logic, shared by load functions and Hono routes. |
| `src/lib/server/db/schema.ts` | Full data model. Migrations in `drizzle/`.                |
| `src/lib/server/auth/`        | Reserved for Better Auth (ADR 0005).                      |

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
