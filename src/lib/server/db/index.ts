import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

// node-postgres works with both local Postgres and Neon's pooled TCP URL, and supports
// interactive transactions (ADR 0004). The pool connects lazily, so importing needs no database.
const connect = (url: string) =>
	drizzle({ client: new pg.Pool({ connectionString: url }), schema });

// DATABASE_URL is optional at startup (build, unit tests), so fail clearly on first use instead.
export const db: ReturnType<typeof connect> = DATABASE_URL
	? connect(DATABASE_URL)
	: new Proxy({} as ReturnType<typeof connect>, {
			get() {
				throw new Error('DATABASE_URL is not set; copy .env.example to .env');
			}
		});
