import { defineEnvVars } from '@sveltejs/kit/env';

// Optional at startup so build, unit tests and the e2e smoke run without a database, OAuth apps or R2.
// R2_* are checked on first upload.
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
	LINE_CLIENT_SECRET: { description: 'LINE Login channel secret', schema: optional },
	R2_ACCOUNT_ID: {
		description: 'Cloudflare account id owning the Photo bucket (ADR 0001, 0003)',
		schema: optional
	},
	R2_ACCESS_KEY_ID: {
		description: 'R2 S3 API key id with Object Read & Write on the bucket',
		schema: optional
	},
	R2_SECRET_ACCESS_KEY: { description: 'R2 S3 API secret', schema: optional },
	R2_BUCKET: { description: 'R2 bucket holding Photo derivatives', schema: optional },
	R2_PUBLIC_BASE_URL: {
		description: 'Public base URL serving the bucket, e.g. https://img.example.com',
		schema: optional
	},
	E2E_HARNESS: {
		description: 'Set to 1 only by Playwright: serves the /dev/* test harness pages',
		schema: optional
	}
});
