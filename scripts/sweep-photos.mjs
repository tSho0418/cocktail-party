// `pnpm photos:sweep`: delete photo uploads (rows and R2 objects) that no Recipe or Member icon
// uses and that are older than 24 hours (see services/images/sweep.ts). Idempotent; safe to
// rerun or to run while the app is serving. Needs DATABASE_URL and the R2_* variables.
// runnerImport lets Node load the TypeScript modules without a separate TS runner.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { runnerImport } from 'vite';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const load = async (path) => (await runnerImport(path, { configFile: false })).module;
const { sweepUnusedUploads } = await load('./src/lib/server/services/images/sweep.ts');
const { r2ConfigFromEnv, r2ImageStore } = await load('./src/lib/server/services/images/r2.ts');

const store = r2ImageStore(r2ConfigFromEnv(process.env)); // throws naming missing R2_* variables
const pool = new pg.Pool({ connectionString: DATABASE_URL });
try {
	const swept = await sweepUnusedUploads(drizzle({ client: pool }), () => store);
	console.log(`Swept ${swept} unused photo uploads.`);
} finally {
	await pool.end();
}
