import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { randomBytes } from 'node:crypto';

// `pnpm test:db`: every run gets its own database on the DATABASE_URL_TEST server, so concurrent
// runs (other worktrees) never collide; the db project's global setup creates, migrates and drops it.
// SvelteKit snapshots env when this config loads, so the app's `db` (DATABASE_URL) is pointed here.
// `??=` keeps one name when the config is evaluated again (projects `extends` it).
if (process.env.VITEST_DB) {
	process.env.DATABASE_URL_TEST ??=
		loadEnv('test', process.cwd(), '').DATABASE_URL_TEST ??
		'postgres://postgres:postgres@localhost:5432/postgres';
	process.env.TEST_DATABASE_NAME ??= `cocktail_party_test_${randomBytes(4).toString('hex')}`;
	const url = new URL(process.env.DATABASE_URL_TEST);
	url.pathname = `/${process.env.TEST_DATABASE_NAME}`;
	process.env.DATABASE_URL = url.href;
	// Dummy OAuth apps: the auth db tests stub the provider's token endpoint, and Better Auth
	// registers a provider only when it has both an id and a secret (CI has no .env).
	process.env.GOOGLE_CLIENT_ID = 'test-google';
	process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
	process.env.LINE_CLIENT_ID = 'test-line';
	process.env.LINE_CLIENT_SECRET = 'test-line-secret';
}

// Tests must not depend on a developer's .env (CI has none): blank every R2_* and OAuth variable the
// tests read through `$app/env/private`. SvelteKit snapshots env when this config loads and process.env
// wins over .env, so this has to happen here. R2_* are blanked for both projects; OAuth only without
// VITEST_DB (the db block above has already set dummies, which must stay). `VITEST` is set by vitest
// before it loads the config.
if (process.env.VITEST) {
	for (const name of [
		'R2_ACCOUNT_ID',
		'R2_ACCESS_KEY_ID',
		'R2_SECRET_ACCESS_KEY',
		'R2_BUCKET',
		'R2_PUBLIC_BASE_URL'
	])
		process.env[name] = '';
	if (!process.env.VITEST_DB)
		for (const name of [
			'GOOGLE_CLIENT_ID',
			'GOOGLE_CLIENT_SECRET',
			'LINE_CLIENT_ID',
			'LINE_CLIENT_SECRET'
		])
			process.env[name] = '';
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Run next to the Neon database (Singapore); without it functions start in iad1 (US East).
			adapter: adapter({ regions: ['sin1'] })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.db.test.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'db',
					environment: 'node',
					include: ['src/**/*.db.test.ts'],
					globalSetup: ['src/lib/server/db/test/global-setup.ts'],
					// Files share one database.
					fileParallelism: false
				}
			}
		]
	}
});
