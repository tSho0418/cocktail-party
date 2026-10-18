import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	// Only `db:migrate` needs a real URL; `db:generate` works offline.
	dbCredentials: { url: process.env.DATABASE_URL ?? '' },
	strict: true,
	verbose: true
});
