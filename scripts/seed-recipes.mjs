// `pnpm db:seed:recipes`: DT-002 demo Recipes into DATABASE_URL (idempotent).
// Photos go to R2 (R2_* variables, as the app reads them). `--no-store` keeps the images in memory
// instead: the Recipes then point at keys that exist nowhere, which is only for a local database.
// Run `pnpm db:seed:ingredients` first.
import pg from 'pg';
import { runnerImport } from 'vite';

// r2.ts reads SvelteKit's $app/env/private only as the default of r2ConfigFromEnv; this script passes
// process.env itself, so an empty stand-in is enough outside SvelteKit.
const opts = {
	configFile: false,
	plugins: [
		{
			name: 'empty-app-env',
			resolveId: (id) => (id === '$app/env/private' ? '\0app-env-private' : null),
			load: (id) => (id === '\0app-env-private' ? 'export {}' : null)
		}
	]
};
const { module } = await runnerImport('./src/lib/server/db/seed/recipes.ts', opts);
const { module: images } = await runnerImport('./src/lib/server/services/images/store.ts', opts);
const { module: r2 } = await runnerImport('./src/lib/server/services/images/r2.ts', opts);

const noStore = process.argv.includes('--no-store');
let store;
if (noStore) {
	console.warn('--no-store: images are not saved anywhere; the Recipes will show no photo.');
	store = images.memoryImageStore();
} else {
	store = r2.r2ImageStore(r2.r2ConfigFromEnv(process.env));
}

const pool = new pg.Pool({
	connectionString:
		process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cocktail_party'
});
try {
	const added = await module.seedRecipes(pool, store);
	console.log(`Seeded ${added} new Recipes (${module.seedRecipeList.length} in the list).`);
} finally {
	await pool.end();
}
