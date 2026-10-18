import { describe, expect, it } from 'vitest';
import { viaHandle } from '#lib/server/auth/test/via-handle.js';

describe('handle order', () => {
	it('runs auth before the API: a protected route is 401 without a session', async () => {
		expect((await viaHandle('http://localhost/api/me')).status).toBe(401);
	});

	it('leaves public routes open', async () => {
		expect((await viaHandle('http://localhost/api/health')).status).toBe(200);
		expect(await (await viaHandle('http://localhost/login')).text()).toBe('page');
	});
});
