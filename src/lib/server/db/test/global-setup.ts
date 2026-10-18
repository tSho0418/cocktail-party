import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Fresh schema per run: drop everything (incl. pg_trgm and drizzle's journal), then apply drizzle/.
export async function setup() {
	// Set by vite.config.ts only under `pnpm test:db`, so this never wipes the dev database.
	const url = process.env.DATABASE_URL_TEST;
	if (!process.env.VITEST_DB || !url) throw new Error('Run DB tests with `pnpm test:db`');
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		await client.query(
			'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;'
		);
		await migrate(drizzle({ client }), { migrationsFolder: 'drizzle' });
	} finally {
		await client.end();
	}
}
