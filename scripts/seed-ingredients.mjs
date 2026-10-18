// `pnpm db:seed:ingredients`: load the DT-001 Ingredient master into DATABASE_URL (idempotent).
// runnerImport lets Node load the TypeScript seed module without a separate TS runner.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { runnerImport } from 'vite';

const { module } = await runnerImport('./src/lib/server/db/seed/ingredients.ts', {
	configFile: false
});
const pool = new pg.Pool({
	connectionString:
		process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cocktail_party'
});
try {
	const inserted = await module.seedIngredients(drizzle({ client: pool }));
	console.log(
		`Seeded ${inserted} new Ingredients (${module.seedIngredientList.length} in the list).`
	);
} finally {
	await pool.end();
}
