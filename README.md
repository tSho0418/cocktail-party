# cocktail-party

カクテルのレシピと写真を共有する日本語の Web SNS。用語は [CONTEXT.md](CONTEXT.md)、要件は [docs/requirements.md](docs/requirements.md)、設計判断は [docs/adr/](docs/adr/) を参照。

## Stack

SvelteKit (SSR, adapter-vercel) + Tailwind CSS, Hono API mounted at `/api/*` via `src/hooks.server.ts`, Drizzle ORM on Neon Postgres.

| Path                          | Role                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `src/lib/server/api/app.ts`   | Hono app (`/api/*`). Thin routes only.                     |
| `src/lib/api.ts`              | Typed Hono client (`createApiClient(fetch)`).              |
| `src/lib/server/services/`    | Business logic, shared by load functions and Hono routes.  |
| `src/lib/domain/alcohol/`     | Alcohol Content rules (pure); also run in the browser.     |
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
| `pnpm test:e2e`               | Playwright against `pnpm build && pnpm preview` (needs the migrated app database). First run: `pnpm exec playwright install chromium`                                                                                                 |
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

## API

Routes live in `src/lib/server/api/` and only validate the request shape, call a service and map its result to a status; `AppType` (from `createApp()` in `app.ts`) types `createApiClient` in `src/lib/api.ts`. Errors are `{ "error": "<code>" }`: 400 malformed request, 401 signed out or Suspended, 403 no Username / not the owner / not an Administrator, 404, 413 body too large, 409 duplicate Ingredient (with `similar`), 422 a rule of the service rejected the input (the code is the service's, e.g. `main_photo_required`).

| Route                                                      | Who           | Notes                                                                                                                                                                               |
| ---------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/recipes`                                         | anyone        | Search (FR-041..045), keyset: `ingredientIds`/`baseIds` (comma-separated), `onlyThese`, `keyword`, `abvMin`, `abvMax`, `nonAlcoholic` (`true`), `sort=new\|like`, `limit`, `cursor` |
| `GET /api/recipes/:id`                                     | anyone        | Detail (FR-046)                                                                                                                                                                     |
| `POST /api/recipes`                                        | Member        | Publish, 201 `{ id }` (FR-001..007)                                                                                                                                                 |
| `PUT /api/recipes/:id`                                     | owner         | Replace the whole Recipe (FR-008); photos no longer referenced are deleted from storage                                                                                             |
| `DELETE /api/recipes/:id`                                  | owner, admin  | 204; unreferenced photos are deleted from storage                                                                                                                                   |
| `GET /api/ingredients/suggest`                             | anyone        | `?name=&limit=` similar existing Ingredients (FR-014)                                                                                                                               |
| `POST /api/ingredients`                                    | Member        | `{ name, abvPercent, isBaseSpirit? }`; 0% for a Member (FR-012), above 0% only for an Administrator (FR-013)                                                                        |
| `PATCH /api/ingredients/:id/abv`                           | Administrator | `{ abvPercent }`, recomputes the Recipes using it (FR-015)                                                                                                                          |
| `PUT/DELETE /api/recipes/:id/like`                         | Member        | Like / unlike (FR-055); 200 `{ liked, likeCount }`; 422 `own_recipe` on one's own Recipe; idempotent                                                                                |
| `PUT/DELETE /api/recipes/:id/save`                         | Member        | Save / unsave (FR-056); 200 `{ saved }`; idempotent                                                                                                                                 |
| `GET /api/recipes/:id/reactions`                           | anyone        | `{ likeCount, liked, saved }`; `liked`/`saved` are the viewer's own (false when signed out)                                                                                         |
| `GET /api/me/saves`                                        | Member        | The Member's own Save list, `?cursor=`; there is no route to read anyone else's (FR-056)                                                                                            |
| `GET /api/members/:username`                               | anyone        | Profile: bio, icon key, recipe/follower/following counts, `isFollowing` (FR-054); no email                                                                                          |
| `GET /api/members/:username/{recipes,followers,following}` | anyone        | Public lists, newest first, `?cursor=`                                                                                                                                              |
| `PUT/DELETE /api/members/:username/follow`                 | Member        | Follow / unfollow (FR-057); 422 `self_follow`; idempotent                                                                                                                           |

Photo ownership (ADR 0006): `POST /api/photos` records the uploader in `photo_upload` (one row per upload, keyed by the `<uuid>` in the key). `POST`/`PUT /api/recipes` accept only `recipe/<uuid>/{list,detail}.webp` keys whose upload row belongs to the signed-in Member; another Member's upload, a Member icon, an unknown or malformed key is 422 `photo_key_invalid`. When an edit or delete leaves an upload referenced by no Recipe, the same transaction deletes its `photo_upload` row (so it can never be attached again) and the route then deletes both objects from storage, best effort after commit: a storage failure, including missing `R2_*` variables, is logged and does not fail the request. The write locks the upload rows (`FOR UPDATE`, in id order) before attaching or releasing, so a concurrent Recipe write cannot reference a photo that is being deleted. Uploads that are never attached (abandoned form, replaced photo, failed publish) are removed by the sweep (`pnpm photos:sweep`, `sweepUnusedUploads` in `services/images/sweep.ts`): uploads older than 24 hours that no Recipe photo and no Member icon references have their row deleted (rows locked `FOR UPDATE SKIP LOCKED`, references re-checked), then both objects. It needs `DATABASE_URL` and the `R2_*` variables; `.github/workflows/sweep-photos.yml` runs it (manual only, and only from `main` so other branches never reach the `production` secrets, until those secrets exist; see Known limits). Recipes written before this change have no upload rows; they keep working, and an edit may resend the keys the Recipe already uses, as long as they have the shape `recipe/<uuid>/{list,detail}.webp` (an older key shape is rejected with `photo_key_invalid`).

Member icons follow the same rule: `updateProfile` accepts only a `member/<uuid>/list.webp` key whose `photo_upload` row (`kind = 'member'`) belongs to the Member (`icon_key_invalid` otherwise; the current icon is always accepted), and an icon that is replaced or removed has its row deleted in the same transaction and its objects deleted after commit.

Input bounds: `GET /api/recipes` takes at most 10 `keyword` terms and 20 `ingredientIds` / 20 `baseIds` (400 `invalid_query` beyond that); `GET /api/ingredients/suggest` takes a `name` of at most 100 characters (400); JSON bodies of `POST`/`PUT /api/recipes` and `POST /api/ingredients` (and the ABV `PATCH`) are limited to 64KB (413 `too_large`).

### Social UI

`/members/[username]` is the profile (tabs: Recipes, Following, Followers, and Saved for the owner only; others get 404). `/members/[username]/edit` changes Username, bio and icon; `/withdraw` is the withdrawal confirmation (no grace period, FR-058), which also deletes the stored photos. Reusable components for the Recipe detail page (not mounted there by this work): `LikeButton`, `SaveButton` in `#lib/components`, fed by `GET /api/recipes/:id/reactions` or `getReactions` from `#lib/server/services/social`.

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

## Age Gate (FR-060..062)

The root layout shows a modal asking the visitor to declare they are 20+ until the `age_gate_consent` cookie exists. `+layout.server.ts` reads the cookie; the "yes" button posts to `POST /age-gate` (`src/routes/age-gate/+server.ts`), which sets the cookie for 30 days (HttpOnly, SameSite=Lax) and redirects back to a same-origin path. "No" is a link to `?age-gate=declined`, which swaps the question for a "not available under 20" message; no cookie is set. Cookie name, lifetime and the helpers are in `src/lib/age-gate.ts`; the gate itself is `AgeGate.svelte`.

The page is always server-rendered (FR-062): while the gate is open its container is only `inert` (which also keeps keyboard focus inside the dialog) and covered by the overlay, and `<html>` stops scrolling. The gate works without JavaScript. Playwright runs every spec with the consent cookie set (`playwright.config.ts`); `e2e/age-gate.e2e.ts` clears it.

## Browsing: top page and Recipe detail (FR-040..046, FR-062, FR-080)

Both pages are public, server-rendered and read through the services directly (no HTTP hop to `/api`): the load functions call `searchRecipes` / `getRecipeDetail`, so the body is always in the HTML, behind the Age Gate too.

- **`/`** is a plain GET form, so every search is a shareable URL and works without JavaScript. Query: `q` keyword, `ing` (repeated; all must be in the Recipe), `only=1` (only these Ingredients; needs at least one `ing`), `base` (repeated; any), `abvMin`, `abvMax`, `na=1` (Non-alcoholic), `sort=new|like`, `cursor`. The "次のページ" link carries the keyset `cursor` of the same search; there is no previous-page link (use the browser's back or "最初のページへ"). A malformed query (bad cursor, id or number) answers 400. Pages with a search, a sort or a cursor carry `<meta name="robots" content="noindex">`; only the plain top page and Recipe detail are for search engines (NFR-007). A page costs three queries: the list, the Bases of the listed Recipes, and the Ingredient master for the form.
- **`/recipes/[id]`** shows the Recipe with its Ingredients (Mix Ratio as a bare number), steps, Alcohol Content ("目安"; an override is labelled "投稿者による修正値") and extra Photos. Unknown, malformed ids and Recipes of suspended Members are 404. OGP: `og:title`, `og:description`, `og:url`, and `og:image` = the Main Photo's `detail.webp` (`twitter:card` `summary_large_image`).
- Image `alt` is generated from the Recipe title (`<title>の写真`, NFR-005).
- Photo URLs come from `photoUrl(key, 'list'|'detail')` (`services/images/url.ts`): `R2_PUBLIC_BASE_URL` plus the stored key, with the stored `list.webp`/`detail.webp` key swapped for the wanted size. Without `R2_PUBLIC_BASE_URL` no image is rendered (a "写真なし" box on the list, no `og:image`).
- The e2e job needs the app database (`DATABASE_URL`, migrated): `e2e/browse.e2e.ts` inserts its own rows with SQL and removes them afterwards. CI starts a Postgres service for it.

## Branches, CI and deploy

Work on a branch off `develop` and open a PR into `develop`; link the issue with `Closes #N`. Merging needs the CI workflow green (`check`, `lint`, `test`, `build`, `test:db`).

`develop` is released by a PR into `main`. That PR also runs the Playwright e2e job. Deploy is postponed: `.github/workflows/deploy.yml` runs only by hand (`workflow_dispatch`); once enabled, a push to `main` runs it: the full CI including e2e, then `pnpm db:migrate` against Neon, then a Vercel production deploy. Migrations run before the new code is live, so keep them backward compatible with the running version.

The `production` GitHub environment needs the secrets `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. App runtime variables (`BETTER_AUTH_*`, `GOOGLE_*`, `LINE_*`, `R2_*`) are set in the Vercel project.

### 日本語で書くもの

Issue、PR、レビュー、コメント、コミットメッセージは日本語で書きます。コードの識別子、パス、`Closes #N`、FR-/NFR-/ADR の番号、用語集の語(Recipe、Member など)は英語のままにします。

- PR には対応する Issue を `Closes #N` で書きます。
- レビューは先頭行に `APPROVE` または `REQUEST CHANGES` を書き、続けて日本語で理由を書きます(例: `REQUEST CHANGES: 修正が必要です`)。

## Recipe form (FR-001..007, FR-020..023)

`/recipes/new` and `/recipes/<id>/edit` (`RecipeForm.svelte`) are for Members: signed out redirects to `/login`, and `/edit` answers 403 for someone else's Recipe and 404 for a missing one. The form posts through the typed client (`POST /api/recipes`, `PUT /api/recipes/:id`) and goes to `/recipes/<id>` afterwards.

- **Photos:** one required Main Photo and up to 3 more, each picked with `PhotoPicker` and uploaded at once to `POST /api/photos?kind=recipe`. The form keeps and sends the `.../list.webp` key of each stored pair (`mainPhotoKey`, `extraPhotoKeys`); the detail size is the same key with `detail.webp`. A photo that is replaced or removed before saving stays in storage unreferenced.
- **Ingredients:** `IngredientPicker.svelte` searches with `GET /api/ingredients/suggest` and shows similar names (FR-014). If no result matches the typed name exactly, "register as a 0% Ingredient" calls `POST /api/ingredients` with `abvPercent: 0` (FR-012). Alcoholic Ingredients can only come from an Administrator, so the form never offers to create one.
- **Alcohol Content:** the form computes the auto value live with the same rules as the server (`#lib/domain/alcohol`, via `src/lib/recipe-form.ts`). With alcohol, the Member may type an override in 0 < x ≤ the highest Ingredient ABV (shown as "投稿者による修正値", with the auto value beside it); editing Ingredients keeps it, "再計算する" clears it. An override that stops fitting after an Ingredient change blocks saving until it is fixed or cleared. Without alcohol the value is fixed at 0% and any typed override is dropped. Every save sends the override the form shows (`abvOverride` number or `null`), so the stored value always matches the screen.

## Photos (ADR 0003)

`PhotoPicker.svelte` shrinks a selected photo (JPEG/PNG/WebP, up to 10MB) below 4.5MB in the browser; `POST /api/photos?kind=recipe|member` takes the raw bytes as `application/octet-stream`, and `storePhoto` re-encodes them with `sharp` into two metadata-free WebP files (`<kind>/<id>/list.webp` 480px, `detail.webp` 1600px) in R2. The original is never stored. The route is behind `requireMember` (401 signed out, 403 without a Username) and records the upload against the Member (see API, "Photo ownership"). R2 is configured by the `R2_*` variables (declared in `src/env.ts`, examples in `.env.example`), read on the first upload. Derivatives are served with `Cache-Control: public, max-age=3600`, so a deleted Photo can still be fetched from an edge or browser cache for up to about an hour. `/dev/photo-picker` is the e2e harness page (uploads nothing); it returns 404 unless `E2E_HARNESS=1`, which only `playwright.config.ts` sets. Set `PW_REUSE_SERVER=1` to let `pnpm test:e2e` reuse an already running preview server on port 4173 (off by default, since another worktree may own that port).

### Known limits

- Browser downsizing is tested only on desktop Chromium (`e2e/photo.e2e.ts`). Untested: iOS Safari HEIC handling (expected to arrive as JPEG via `accept`, else rejected as an unsupported format), iOS canvas memory caps with 48MP/panorama photos, `imageOrientation: 'from-image'` on Safari ≤16.4 and old Android WebViews, Android Chrome's Google Photos picker (`file.type`, cloud-only photos), and downsizing speed on low-end phones.
- `sharp` loading in the Vercel function runtime is not verified. The local build bundles `@img/sharp-linux-x64`; deploy once to a Preview and hit `/api/photos` before relying on it.
- The R2 store is unit-tested for request construction only (no credentials in CI); it has not talked to a real bucket.
- The unused-upload sweep is not scheduled: `.github/workflows/sweep-photos.yml` is manual (`workflow_dispatch`, `main` only) until the `production` environment has `DATABASE_URL` and the `R2_*` secrets; then add the `schedule` it describes. The script has run only against a local database with dummy R2 credentials. If an R2 delete fails after the rows are gone, the object stays (logged, not retried).
