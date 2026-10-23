import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

// Each Vercel function instance builds its own pool, so the connections to the database add up
// per instance. Against Neon Free's direct host (about 97 usable connections on the smallest
// compute) the default max of 10 would run out after a few instances, so keep the pool small:
//  - max 5: enough for a request that uses a transaction plus a second query, and for the 3-4
//    connections the db tests' lock-order races hold at once, with room for the test's own query.
//    Waiting past connectionTimeoutMillis fails instead of hanging.
//  - idleTimeoutMillis 5s: Vercel's guidance for pools on functions. Idle connections close
//    quickly, so a suspended instance holds few; the Neon compute may also stop after 5 min idle.
//  - connectionTimeoutMillis 10s: long enough for Neon's compute to wake up, short enough to
//    answer with an error before the function limit.
const POOL_OPTIONS = {
	max: 5,
	idleTimeoutMillis: 5_000,
	connectionTimeoutMillis: 10_000
} satisfies pg.PoolConfig;

// node-postgres works with both local Postgres and Neon's TCP URL, and supports interactive
// transactions (ADR 0004). The pool connects lazily, so importing needs no database.
const connect = (url: string) => {
	const pool = new pg.Pool({ connectionString: url, ...POOL_OPTIONS });
	// An idle connection can be cut by the server (Neon stopping or restarting the compute, a
	// network drop). Without a listener the 'error' event is thrown and kills the process. The pool
	// discards that connection and the next query opens a new one. Log the error only, never the URL.
	pool.on('error', (error: Error & { code?: string }) => {
		console.error(
			`postgres pool: idle connection lost (${error.code ?? 'no code'}): ${error.message}`
		);
	});
	return drizzle({ client: pool, schema });
};

// DATABASE_URL is optional at startup (build, unit tests), so fail clearly on first use instead.
export const db: ReturnType<typeof connect> = DATABASE_URL
	? connect(DATABASE_URL)
	: new Proxy({} as ReturnType<typeof connect>, {
			get() {
				throw new Error('DATABASE_URL is not set; copy .env.example to .env');
			}
		});
