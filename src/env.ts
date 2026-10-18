import { defineEnvVars } from '@sveltejs/kit/env';

// Optional at startup so build, unit tests and the e2e smoke run without a database or OAuth apps.
const optional = (value: string | undefined) => value;

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'Neon Postgres connection string (ADR 0001)', schema: optional },
	BETTER_AUTH_SECRET: {
		description: 'Better Auth signing/encryption secret (openssl rand -base64 32)',
		schema: optional
	},
	BETTER_AUTH_URL: { description: 'Public origin, e.g. https://example.com', schema: optional },
	GOOGLE_CLIENT_ID: { description: 'Google OAuth client id (ADR 0005)', schema: optional },
	GOOGLE_CLIENT_SECRET: { description: 'Google OAuth client secret', schema: optional },
	LINE_CLIENT_ID: { description: 'LINE Login channel id (ADR 0005)', schema: optional },
	LINE_CLIENT_SECRET: { description: 'LINE Login channel secret', schema: optional }
});
