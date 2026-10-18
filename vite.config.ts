import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';

// `pnpm test:db`: SvelteKit snapshots env when this config loads, so point the app's `db`
// (DATABASE_URL) at the test database here; the db project's global setup wipes and migrates it.
if (process.env.VITEST_DB) {
	process.env.DATABASE_URL_TEST ??=
		loadEnv('test', process.cwd(), '').DATABASE_URL_TEST ??
		'postgres://postgres:postgres@localhost:5432/cocktail_party_test';
	process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
	// Dummy OAuth apps: the auth db tests stub the provider's token endpoint.
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
