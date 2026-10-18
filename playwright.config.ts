import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	use: { baseURL: 'http://localhost:4173' },
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		env: { E2E_HARNESS: '1' }, // serves /dev/* harness pages; production builds 404 them
		// Opt-in only: other worktrees on this machine may already be serving port 4173.
		reuseExistingServer: !!process.env.PW_REUSE_SERVER
	}
});
