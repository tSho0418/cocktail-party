import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { DATABASE_URL } from '$app/env/private';
import * as schema from './schema';

// WebSocket Pool (not neon-http) because ADR 0004 recalculation needs interactive transactions.
// The pool connects lazily, so importing this module needs no running database.
export const db = drizzle({ client: new Pool({ connectionString: DATABASE_URL }), schema });
