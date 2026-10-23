import { defineConfig } from '@playwright/test';
import {
	AGE_GATE_COOKIE,
	AGE_GATE_COOKIE_VALUE,
	AGE_GATE_MAX_AGE_SECONDS
} from './src/lib/age-gate';
import { E2E_AUTH_SECRET } from './e2e/signed-in';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	use: {
		baseURL: 'http://localhost:4173',
		// Every spec starts past the Age Gate; e2e/age-gate.e2e.ts opts out to test the gate itself.
		storageState: {
			cookies: [
				{
					name: AGE_GATE_COOKIE,
					value: AGE_GATE_COOKIE_VALUE,
					domain: 'localhost',
					path: '/',
					expires: Math.floor(Date.now() / 1000) + AGE_GATE_MAX_AGE_SECONDS,
					httpOnly: true,
					secure: false,
					sameSite: 'Lax'
				}
			],
			origins: []
		}
	},
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		env: {
			// Lets e2e/signed-in.ts sign a session cookie the server accepts, without Google/LINE.
			BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
			BETTER_AUTH_URL: 'http://localhost:4173',
			// Dummy OAuth apps: sign-in builds the Google/LINE authorization URL locally and answers 303 to it
			// (e2e/security-headers.e2e.ts follows it with the provider's host stubbed out).
			GOOGLE_CLIENT_ID: 'e2e-google',
			GOOGLE_CLIENT_SECRET: 'e2e-google-secret',
			LINE_CLIENT_ID: 'e2e-line',
			LINE_CLIENT_SECRET: 'e2e-line-secret',
			E2E_HARNESS: '1', // serves /dev/* harness pages; production builds 404 them
			R2_PUBLIC_BASE_URL: 'https://img.example.invalid' // Photo URLs in rendered pages; never fetched by the specs
		},
		// Opt-in only: other worktrees on this machine may already be serving port 4173.
		reuseExistingServer: !!process.env.PW_REUSE_SERVER
	}
});
