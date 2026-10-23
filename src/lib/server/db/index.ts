import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions/db-connections';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

// Each Vercel function instance builds its own pool, so the connections to the database add up
// per instance. Against Neon's direct host the budget is max_connections minus 7 reserved (`SHOW
// max_connections`; 97 on a 0.25 CU compute, which is the smallest, so more on a larger one), so
// keep the pool small:
//  - max 5: the widest work in the app is 3 parallel queries (/admin; the top page uses 2), no
//    request holds a transaction while using the pool for another query, and the db tests' lock
//    order races hold 3-4 connections at once. Waiting past connectionTimeoutMillis fails instead
//    of hanging.
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
	// The server can cut a connection at any time (Neon stopping or restarting the compute, a
	// network drop). An 'error' event with no listener is thrown and kills the process. pg-pool
	// listens only while a client is idle, and the pool re-emits that as its own 'error'; a client
	// checked out (a transaction between two queries) has no listener, so give every client one for
	// its whole life. The pool discards the connection and the next query opens a new one.
	// Log the code and message only: never console.error the error, the client or the pool, they
	// carry options.connectionString with the password.
	pool.on('connect', (client) => {
		client.on('error', (error: Error & { code?: string }) => {
			console.error(`postgres connection lost (${error.code ?? 'no code'}): ${error.message}`);
		});
	});
	// Required: the pool re-emits an idle client's error here, and with no listener it is thrown.
	// The client listener above has already logged it.
	pool.on('error', () => {});
	// Closes idle connections before a suspended Fluid compute instance can leak them; it does
	// nothing outside a Vercel function (no VERCEL_URL / VERCEL_REGION).
	attachDatabasePool(pool);
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
