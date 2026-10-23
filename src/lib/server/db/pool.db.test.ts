import { sql } from 'drizzle-orm';
import pg from 'pg';
import { expect, it } from 'vitest';
import { db } from './index';

it('survives the server cutting idle connections, and the next query succeeds', async () => {
	// Park a few idle connections in the pool.
	await Promise.all([1, 2, 3].map(() => db.execute(sql`select pg_sleep(0.05)`)));
	expect(db.$client.idleCount).toBeGreaterThan(0);

	// What Neon does when the compute restarts: terminate every other connection to this database.
	// Without the pool's 'error' listener, the resulting event is thrown and Vitest reports an
	// unhandled error.
	const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await admin.connect();
	try {
		await admin.query(
			`select pg_terminate_backend(pid) from pg_stat_activity
			 where datname = current_database() and pid <> pg_backend_pid()`
		);
	} finally {
		await admin.end();
	}
	// The pool drops each dead connection when the server's close reaches it.
	await expect.poll(() => db.$client.idleCount, { timeout: 5_000 }).toBe(0);

	const { rows } = await db.execute<{ ok: number }>(sql`select 1 as ok`);
	expect(rows[0].ok).toBe(1);
});
