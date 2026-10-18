import { defineConfig } from '@playwright/test';
import {
	AGE_GATE_COOKIE,
	AGE_GATE_COOKIE_VALUE,
	AGE_GATE_MAX_AGE_SECONDS
} from './src/lib/age-gate';

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
		env: { E2E_HARNESS: '1' }, // serves /dev/* harness pages; production builds 404 them
		// Opt-in only: other worktrees on this machine may already be serving port 4173.
		reuseExistingServer: !!process.env.PW_REUSE_SERVER
	}
});
