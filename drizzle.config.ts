import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	// Only `db:migrate` connects; the fallback is the docker-compose database. `db:generate` works offline.
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cocktail_party'
	},
	strict: true,
	verbose: true
});
