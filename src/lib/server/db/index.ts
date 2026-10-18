import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

// node-postgres works with both local Postgres and Neon's pooled TCP URL, and supports
// interactive transactions (ADR 0004). The pool connects lazily, so importing needs no database.
export const db = drizzle({ client: new pg.Pool({ connectionString: DATABASE_URL }), schema });
