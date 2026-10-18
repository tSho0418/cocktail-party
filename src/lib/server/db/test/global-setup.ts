import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

async function exec(connectionString: string, query: string) {
	const client = new pg.Client({ connectionString });
	await client.connect();
	try {
		await client.query(query);
	} finally {
		await client.end();
	}
}

// Creates this run's own database (named in vite.config.ts), applies drizzle/, and returns the
// teardown that drops it; Vitest runs the teardown whether the tests pass or fail.
export async function setup() {
	const {
		VITEST_DB,
		DATABASE_URL_TEST: server,
		TEST_DATABASE_NAME: name,
		DATABASE_URL: url
	} = process.env;
	if (!VITEST_DB || !server || !name || !url) throw new Error('Run DB tests with `pnpm test:db`');
	if (!/^cocktail_party_test_[0-9a-f]+$/.test(name)) throw new Error(`Unexpected test DB ${name}`);

	await exec(server, `CREATE DATABASE "${name}"`);
	const drop = () => exec(server, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	try {
		const client = new pg.Client({ connectionString: url });
		await client.connect();
		try {
			await migrate(drizzle({ client }), { migrationsFolder: 'drizzle' });
		} finally {
			await client.end();
		}
	} catch (e) {
		await drop();
		throw e;
	}
	return drop;
}
