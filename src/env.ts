import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Neon Postgres connection string (ADR 0001)',
		// Optional at startup so build, unit tests and the e2e smoke run without a database.
		schema: (value) => value
	}
});
