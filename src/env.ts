import { defineEnvVars } from '@sveltejs/kit/env';

// R2_* are optional at startup for the same reason; the store is built and checked on first upload.
const r2 = (description: string) => ({ description, schema: (value: string | undefined) => value });

export const variables = defineEnvVars({
	DATABASE_URL: {
		description: 'Neon Postgres connection string (ADR 0001)',
		// Optional at startup so build, unit tests and the e2e smoke run without a database.
		schema: (value) => value
	},
	R2_ACCOUNT_ID: r2('Cloudflare account id owning the Photo bucket (ADR 0001, 0003)'),
	R2_ACCESS_KEY_ID: r2('R2 S3 API key id with Object Read & Write on the bucket'),
	R2_SECRET_ACCESS_KEY: r2('R2 S3 API secret'),
	R2_BUCKET: r2('R2 bucket holding Photo derivatives'),
	R2_PUBLIC_BASE_URL: r2('Public base URL serving the bucket, e.g. https://img.example.com'),
	E2E_HARNESS: {
		description: 'Set to 1 only by Playwright: serves the /dev/* test harness pages',
		schema: (value) => value
	}
});
