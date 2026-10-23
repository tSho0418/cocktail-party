import { sql } from 'drizzle-orm';
import pg from 'pg';
import { expect, it } from 'vitest';
import { db } from './index';

/** What Neon does when the compute restarts: the server ends every client connection. */
async function terminateClientConnections() {
	const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await admin.connect();
	try {
		await admin.query(
			`select pg_terminate_backend(pid) from pg_stat_activity
			 where datname = current_database() and pid <> pg_backend_pid()
			   and backend_type = 'client backend'`
		);
	} finally {
		await admin.end();
	}
}

// Without the pool's error handling, the server's FATAL message is an unhandled 'error' event,
// which Vitest reports as an error and fails the run.

it('survives the server cutting idle connections, and the next query succeeds', async () => {
	await Promise.all([1, 2, 3].map(() => db.execute(sql`select pg_sleep(0.05)`)));
	expect(db.$client.idleCount).toBeGreaterThan(0);

	await terminateClientConnections();
	// The pool drops each dead connection when the server's close reaches it. The timeout is longer
	// than idleTimeoutMillis, so idle expiry alone would not hide a connection that stayed.
	await expect.poll(() => db.$client.idleCount, { timeout: 10_000 }).toBe(0);

	const { rows } = await db.execute<{ ok: number }>(sql`select 1 as ok`);
	expect(rows[0].ok).toBe(1);
});

it('survives the server cutting a connection held by an open transaction, which then fails', async () => {
	const attempt = db.transaction(async (tx) => {
		await tx.execute(sql`select 1`);
		await terminateClientConnections();
		// The connection is checked out and idle here; let its error event arrive.
		await new Promise((resolve) => setTimeout(resolve, 300));
		await tx.execute(sql`select 2`);
	});
	await expect(attempt).rejects.toThrow();

	const { rows } = await db.execute<{ ok: number }>(sql`select 1 as ok`);
	expect(rows[0].ok).toBe(1);
});
