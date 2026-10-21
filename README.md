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
| `pnpm db:seed:recipes`        | Add the DT-002 demo Recipes (about 20, 4 Non-alcoholic) to `DATABASE_URL`, see "Demo Recipes" below                                                                                                                                   |
| `pnpm photos:sweep`           | Delete uploads older than 24 hours that no Recipe or icon uses (needs `DATABASE_URL` and `R2_*`), see "Photo ownership" under API                                                                                                     |
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

| Route                                                      | Who           | Notes                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/recipes`                                         | anyone        | Search (FR-041..045), keyset: `ingredientIds`/`baseIds` (comma-separated), `onlyThese`, `keyword`, `abvMin`, `abvMax`, `nonAlcoholic` (`true`), `sort=new\|like`, `limit`, `cursor`                               |
| `GET /api/recipes/:id`                                     | anyone        | Detail (FR-046)                                                                                                                                                                                                   |
| `POST /api/recipes`                                        | Member        | Publish, 201 `{ id }` (FR-001..007)                                                                                                                                                                               |
| `PUT /api/recipes/:id`                                     | owner         | Replace the whole Recipe (FR-008); photos no longer referenced are deleted from storage                                                                                                                           |
| `DELETE /api/recipes/:id`                                  | owner, admin  | 204; unreferenced photos are deleted from storage                                                                                                                                                                 |
| `GET /api/ingredients/suggest`                             | anyone        | `?name=&limit=` similar existing Ingredients (FR-014)                                                                                                                                                             |
| `POST /api/ingredients`                                    | Member        | `{ name, abvPercent, isBaseSpirit? }`; 0% for a Member (FR-012), above 0% only for an Administrator (FR-013)                                                                                                      |
| `PATCH /api/ingredients/:id/abv`                           | Administrator | `{ abvPercent }`, recomputes the Recipes using it (FR-015)                                                                                                                                                        |
| `POST /api/recipes/:id/reports`                            | Member        | `{ reason, detail? }`; reason is inappropriate_photo, plagiarism, spam or other; detail up to 200 chars; once per Member and Recipe (409 `duplicate`) (FR-070/071)                                                |
| `GET /api/admin/reports`                                   | Administrator | `?status=open\|resolved\|dismissed&cursor=`; newest first, 50 per page, with sender and author; returns `{ items, nextCursor }` (`nextCursor` is null on the last page; a malformed `cursor` is 400) (FR-072/073) |
| `PATCH /api/admin/reports/:id`                             | Administrator | `{ status }` (FR-072)                                                                                                                                                                                             |
| `GET /api/admin/suspensions`                               | Administrator | Suspended Members                                                                                                                                                                                                 |
| `PUT/DELETE /api/admin/members/:username/suspension`       | Administrator | Suspend or lift (FR-075); an Administrator cannot suspend themself (422 `self`)                                                                                                                                   |
| `PUT/DELETE /api/recipes/:id/like`                         | Member        | Like / unlike (FR-055); 200 `{ liked, likeCount }`; 422 `own_recipe` on one's own Recipe; idempotent                                                                                                              |
| `PUT/DELETE /api/recipes/:id/save`                         | Member        | Save / unsave (FR-056); 200 `{ saved }`; idempotent                                                                                                                                                               |
| `GET /api/recipes/:id/reactions`                           | anyone        | `{ likeCount, liked, saved }`; `liked`/`saved` are the viewer's own (false when signed out)                                                                                                                       |
| `GET /api/me/saves`                                        | Member        | The Member's own Save list, `?cursor=`; there is no route to read anyone else's (FR-056)                                                                                                                          |
| `GET /api/members/:username`                               | anyone        | Profile: bio, icon key, recipe/follower/following counts, `isFollowing` (FR-054); no email                                                                                                                        |
| `GET /api/members/:username/{recipes,followers,following}` | anyone        | Public lists, newest first, `?cursor=`                                                                                                                                                                            |
| `PUT/DELETE /api/members/:username/follow`                 | Member        | Follow / unfollow (FR-057); 422 `self_follow`; idempotent                                                                                                                                                         |

Photo ownership (ADR 0006): `POST /api/photos` records the uploader in `photo_upload` (one row per upload, keyed by the `<uuid>` in the key). `POST`/`PUT /api/recipes` accept only `recipe/<uuid>/{list,detail}.webp` keys whose upload row belongs to the signed-in Member; another Member's upload, a Member icon, an unknown or malformed key is 422 `photo_key_invalid`. Only the uploader can reference an upload, so nothing else can still use a photo once its upload is released. When an edit or delete leaves an upload referenced by no Recipe, the same transaction deletes its `photo_upload` row (so it can never be attached again) and the caller (the Recipe routes, the `/admin` Recipe deletion, the sweep) then deletes both objects with `deleteObjects` (`services/images/delete-objects.ts`), best effort after commit: a storage failure, including missing `R2_*` variables, does not fail the request; each key it could not delete gets one `photo cleanup failed` log line. The write takes the locks listed under Lock order, so a concurrent Recipe write cannot reference a photo that is being deleted. Uploads that are never attached (abandoned form, replaced photo, failed publish) are removed by the sweep (`pnpm photos:sweep`, `sweepUnusedUploads` in `services/images/sweep.ts`): uploads older than 24 hours that no Recipe photo and no Member icon references have their row deleted (rows locked `FOR UPDATE SKIP LOCKED`, references re-checked), then both objects. It needs `DATABASE_URL` and the `R2_*` variables; `.github/workflows/sweep-photos.yml` runs it (manual only, and only from `main` so other branches never reach the `production` secrets, until those secrets exist; see Known limits). Recipes written before this change have no upload rows; they keep working, and an edit may resend the keys the Recipe already uses, as long as they have the shape `recipe/<uuid>/{list,detail}.webp` (an older key shape is rejected with `photo_key_invalid`).

Member icons follow the same rule: `updateProfile` accepts only a `member/<uuid>/list.webp` key whose `photo_upload` row (`kind = 'member'`) belongs to the Member (`icon_key_invalid` otherwise; the current icon is always accepted), and an icon that is replaced or removed has its row deleted in the same transaction and its objects deleted after commit.

**Lock order** (ADR 0006, #40, #45): a transaction that locks Recipes, photo uploads, Ingredients and a Member takes them in this one order, each kind in id order, skipping the kinds it does not need: **Recipe rows, then `photo_upload` rows, then `ingredient` rows, then the `member` row**. `updateRecipe` and `deleteRecipe` lock the Recipe (`lockRecipe`), then the uploads of its old and new photos (`lockPhotos`); `updateRecipe` then share-locks the Ingredients it uses (`loadIngredients`, `FOR SHARE`: an ABV edit waits for it, and shares do not wait for each other); `createRecipe` has no Recipe row yet, so it locks the uploads, then the Ingredients, and its INSERT then takes the Member's `FOR KEY SHARE`; `updateIngredientAbv` (FR-015) locks the Recipes that use the Ingredient, then the Ingredient row, and then reads those Recipes again: one that started using the Ingredient in between is not locked, and locking it now would be out of order, so the transaction ends without writing and a new one starts, once for each such edit that commits in that gap; `updateProfile` locks the icon uploads, then the Member row; `withdrawMember` locks all of the Member's Recipes, then all of their uploads, then the Member row, before the cascading DELETE; the sweep locks upload rows only, with `SKIP LOCKED`. Following the order is what lets a withdrawal and a Recipe write by the same Member, or a Recipe edit and an ABV edit, both finish instead of deadlocking. The one place that does not follow it exactly is the withdrawal's cascade, which sets `ingredient.created_by` to null last, after the `member` row is deleted (in effect Member, then Ingredient); no combination that deadlocks through it has been found.

Input bounds: `GET /api/recipes` takes at most 10 `keyword` terms and 20 `ingredientIds` / 20 `baseIds` (400 `invalid_query` beyond that); `GET /api/ingredients/suggest` takes a `name` of at most 100 characters (400); JSON bodies of `POST`/`PUT /api/recipes` and `POST /api/ingredients` (and the ABV `PATCH`) are limited to 64KB (413 `too_large`).

### Social UI

`/members/[username]` is the profile (tabs: Recipes, Following, Followers, and Saved for the owner only; others get 404). `/members/[username]/edit` changes Username, bio and icon; `/withdraw` is the withdrawal confirmation (no grace period, FR-058), which also deletes the stored photos. The Recipe detail page mounts `LikeButton` and `SaveButton` (`#lib/components`), with their initial state from `getReactions` in the page load (server-rendered, no flicker); Like shows a count only and is hidden on one's own Recipe, Save is for signed-in Members. The owner also gets an edit link and a confirmed delete (`?/delete`, which also removes the Likes, Saves and stored photos), and an Administrator gets the delete alone (no notice to the author, FR-074). The author's name on the detail page and the list cards links to `/members/[username]`.

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
- Withdrawal: `withdrawMember` in `#lib/server/services/members` deletes everything in one transaction and returns the storage keys to delete: Main and extra Photos, the icon, and both files of every `photo_upload` row of the Member, used or not (the rows go with the Member). It takes its locks in the Lock order described under Photo ownership (API section), so a withdrawal and a Recipe write by the same Member cannot deadlock. The `/withdraw` action runs it first; only once it has committed does it delete the objects with `deleteObjects` (best effort, each failed key logged) and sign out, so a failed withdrawal leaves the Member signed in to retry. Reachable without a Username, like `/welcome` and `/logout`.

The db tests drive Better Auth's real sign-in and callback for LINE with the token endpoint stubbed. Real Google/LINE logins have not been tried.

## Age Gate (FR-060..062)

The root layout also renders the site header (sign-in-dependent links: own profile, saved Recipes, new Recipe, `/admin` for Administrators) and footer (`/terms`, `/privacy`); `/withdraw` is linked from the own profile page. It shows a modal asking the visitor to declare they are 20+ until the `age_gate_consent` cookie exists. `+layout.server.ts` reads the cookie; the "yes" button posts to `POST /age-gate` (`src/routes/age-gate/+server.ts`), which sets the cookie for 30 days (HttpOnly, SameSite=Lax) and redirects back to a same-origin path. "No" is a link to `?age-gate=declined`, which swaps the question for a "not available under 20" message and adds `<meta name="robots" content="noindex">` (the page behind it is a duplicate); no cookie is set. Cookie name, lifetime and the helpers are in `src/lib/age-gate.ts`; the gate itself is `AgeGate.svelte`.

`/terms` and `/privacy` are exempt from the gate (`isAgeGateExempt`).

The page is always server-rendered (FR-062): while the gate is open its container is only `inert` (which also keeps keyboard focus inside the dialog) and covered by the overlay, and `<html>` stops scrolling. The gate works without JavaScript. Playwright runs every spec with the consent cookie set (`playwright.config.ts`); `e2e/age-gate.e2e.ts` clears it.

## Browsing: top page and Recipe detail (FR-040..046, FR-062, FR-080)

Both pages are public, server-rendered and read through the services directly (no HTTP hop to `/api`): the load functions call `searchRecipes` / `getRecipeDetail`, so the body is always in the HTML, behind the Age Gate too.

- **`/`** is a plain GET form, so every search is a shareable URL and works without JavaScript. Query: `q` keyword, `ing` (repeated; all must be in the Recipe), `only=1` (only these Ingredients; needs at least one `ing`), `base` (repeated; any), `abvMin`, `abvMax`, `na=1` (Non-alcoholic), `sort=new|like`, `cursor`. The "次のページ" link carries the keyset `cursor` of the same search; there is no previous-page link (use the browser's back or "最初のページへ"). A malformed query (bad cursor, id or number) answers 400. Any page with a query string (a search, a sort, a cursor, or an untouched form's `?q=&sort=new`) carries `<meta name="robots" content="noindex">`; only the plain top page and Recipe detail are for search engines (NFR-007). A page costs three queries: the list, the Bases of the listed Recipes, and the Ingredient master for the form.
- **`/recipes/[id]`** shows the Recipe with its Ingredients (Mix Ratio as a bare number), steps, Alcohol Content ("目安"; an override is labelled "投稿者による修正値") and extra Photos. Unknown, malformed ids and Recipes of suspended Members are 404. OGP: `og:title`, `og:description`, `og:url`, and `og:image` = the Main Photo's `detail.webp` (`twitter:card` `summary_large_image`).
- **Report and `/admin`** (FR-070–076): a signed-in Member sees "このレシピを通報する" on the Recipe page (form action `?/report`). `/admin` (Administrator only: 401→login, 403 otherwise; `noindex`) lists Reports (`?status=open\|resolved\|dismissed\|all`, default `open`; 50 per page, newest first, with a plain "次へ" link carrying `?cursor=`; a malformed cursor shows the first page) and changes their status, deletes the reported Recipe, suspends/unsuspends Members, and registers alcoholic Ingredients / edits their ABV. Reports keep `target_state` (`recipe_deleted`, `member_withdrawn`) and no Recipe content once the Recipe is gone (FR-074/078); a deleted Recipe is not notified to its author. The first Administrator is made by hand: after they have logged in once, run `update member set is_administrator = true where username = '<username>';`. The page calls the services directly; the Hono routes above expose the same services.
- Image `alt` is generated from the Recipe title (`<title>の写真`, NFR-005).
- Photo URLs come from `photoUrl(key, 'list'|'detail')` (`services/images/url.ts`): `R2_PUBLIC_BASE_URL` plus the stored key, with the stored `list.webp`/`detail.webp` key swapped for the wanted size. Without `R2_PUBLIC_BASE_URL` no image is rendered (a "写真なし" box on the list, no `og:image`).
- The e2e job needs the app database (`DATABASE_URL`, migrated): `e2e/browse.e2e.ts` inserts its own rows with SQL and removes them afterwards. `e2e/recipe-form-signed-in.e2e.ts`, `e2e/report.e2e.ts` and `e2e/admin.e2e.ts` sign a Member in by inserting a session row and signing the cookie with a fixed test secret (`e2e/signed-in.ts`, handed to the server by `playwright.config.ts`); photo uploads are answered by the spec, since R2 is not reachable. The Report and administrator specs publish their Recipes through `POST /api/recipes` with a seeded photo upload, and remove their Members, Reports, Recipes and Ingredients (own `e2e_rpt_` / `e2e_adm_` / `E2E通報` / `E2E管理` prefixes) afterwards. CI starts a Postgres service for it.

## Public launch (Issue #7)

### Terms and Privacy Policy (NFR-009)

`/terms` and `/privacy` are static server-rendered pages (`src/routes/terms`, `src/routes/privacy`). They are exempt from the Age Gate (`isAgeGateExempt` in `src/lib/age-gate.ts`, used by `+layout.server.ts`), so a visitor can read them before declaring they are 20+. The operator name, the contact and the effective date shown on both pages are the three constants in `src/lib/legal.ts`; they are decisions for a person, to be set before launch. The texts are drafts, not legal advice: have them reviewed before going public. Both pages are linked from the footer in `+layout.svelte`.

### Backup (NFR-003)

`.github/workflows/backup.yml` runs `pg_dump` (custom format) against Neon, checks it with `pg_restore --list`, uploads `cocktail-party-<UTC timestamp>.dump` to a dedicated private R2 bucket and then deletes dumps older than 14 days (by the timestamp in the key). Like `deploy.yml`, it is manual-only (`workflow_dispatch`) while CD is postponed; the file's header comment shows the `schedule` block to add for the daily run (enabling it is on the pre-launch checklist below). The rows of `session` and `verification` (IP addresses, User-Agents, OAuth state) are left out of the dump. Secrets in the `production` environment:

- `DATABASE_URL`: Neon's direct (non-pooled) connection string
- `BACKUP_R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `BACKUP_R2_BUCKET`: an R2 API token limited to Object Read & Write on the backup bucket, which must not be the Photo bucket. `BACKUP_R2_BUCKET` is a private bucket: no public access and no custom domain, since the dumps hold every Member's data.
- Restrict the `production` environment's Deployment branches to `main`, so no other branch can read these secrets.

Restore with `pg_restore --no-owner --dbname "$DATABASE_URL" <file>` into an empty database. Restores are not rehearsed (NFR-003).

### Demo Recipes (DT-002)

`pnpm db:seed:recipes` (after `pnpm db:migrate` and `pnpm db:seed:ingredients`) adds 20 well-known cocktails (16 alcoholic across 6+ Bases and 6-37% ABV, 4 Non-alcoholic) through `createRecipe`, so all of FR-004..007 apply. It is idempotent: a Recipe is skipped when the demo Member already has one with that title. The author is the Member `demo_bartender`, inserted directly without an `account` row (nobody can sign in as it). If `demo_bartender` already exists with an `account` row (a real Member), the script stops instead of posting as them. Mix Ratios are bare parts, scaled down where a part would exceed 99.9.

Each Recipe's Main Photo is a generated gradient card, not a photo of the drink; replace them with real photos if the demo is meant to look real. Photos are stored in R2 with the `R2_*` variables set (the same bucket the app serves). `pnpm db:seed:recipes --no-store` keeps the images in memory instead; it refuses to run unless `DATABASE_URL` is unset or points at localhost, 127.0.0.1 or [::1]: the Recipes then show "写真なし".

### What is still unchecked: do this on a Preview

None of these can be exercised without real credentials. Deploy a Preview with the production-like variables, then:

1. **R2 and `sharp` on Vercel** (also the Known limits above): sign in, create a Recipe with a JPEG that has GPS EXIF (any phone photo), and confirm `POST /api/photos` returns 201, the image shows on the Recipe page, and the stored `*.webp` has no EXIF (`exiftool` on the downloaded file). Then delete the Recipe and check both objects are gone from the bucket.
2. **Google and LINE login**: sign in with each on the Preview URL (the callback URLs must be registered, see `.env.example`), set a Username, sign out and in again, and confirm one provider cannot reach the other's Member. For LINE, try an account that returns no email.
3. **Suspension and withdrawal with real sessions**: withdraw a test Member and confirm its photos disappear from R2.
4. **Demo Recipes**: run `pnpm db:seed:recipes` against the Preview/production database with `R2_*` set and open the top page.
5. **Backup**: run the Backup workflow by hand, check the object in the backup bucket, and run `pg_restore --list` on a downloaded copy. Then enable the schedule in `backup.yml` before launch, and check that the bucket has no public access or custom domain and that the `production` environment is limited to `main`.
6. **Terms and Privacy**: fill in `src/lib/legal.ts` (operator name, contact and date are still provisional) and have both pages reviewed. The footer already links to them.

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
- The unused-upload sweep is not scheduled: `.github/workflows/sweep-photos.yml` is manual (`workflow_dispatch`, `main` only) until the `production` environment has `DATABASE_URL` and the `R2_*` secrets; then add the `schedule` it describes. The script has run only against a local database with dummy R2 credentials.
- A storage deletion that fails after its commit is only logged: `deleteObjects` writes one `photo cleanup failed` line per failed key (one line listing every key when the store cannot be built), on every path (Recipe edit and delete, the `/admin` Recipe deletion, icon change, withdrawal, the sweep). The `photo_upload` row is already gone, so nothing retries it, and Vercel keeps runtime logs only briefly. Leftover objects can be found by listing R2 against the database; the sweep works from `photo_upload` rows, so it does not find them.
