// Shared by db tests that need two real connections to interleave in a chosen order; never
// imported by app code.
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';

/** Resolves once at least `n` other connections are waiting for a lock; throws after ~5s. */
export async function waitForLockWaiters(n: number) {
	for (let i = 0; i < 250; i++) {
		const { rows } = await db.execute<{ n: number }>(sql`
			select count(*)::int as n from pg_stat_activity
			where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`);
		if (rows[0].n >= n) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error(`fewer than ${n} transactions are waiting for a lock`);
}

/**
 * Runs `hold` in a transaction that stays open until `commit()`; `result` resolves with what
 * `hold` returned. Callers MUST reach `commit()` (try/finally), or the locks outlive the test.
 */
export function holdingTransaction<T>(
	hold: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
) {
	const gate = Promise.withResolvers<void>();
	const held = Promise.withResolvers<T>();
	const done = db.transaction(async (tx) => {
		try {
			held.resolve(await hold(tx));
		} catch (e) {
			held.reject(e);
			throw e;
		}
		await gate.promise;
	});
	return { result: held.promise, commit: gate.resolve, done };
}
