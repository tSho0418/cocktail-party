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

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
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
