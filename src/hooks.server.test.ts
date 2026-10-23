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

describe('security headers (#66)', () => {
	const expectHeaders = (res: Response) => {
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('permissions-policy')).toContain('camera=()');
		expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
	};

	it.each([
		['a page', 'http://localhost/login'],
		['an API answer', 'http://localhost/api/health'],
		['an API error', 'http://localhost/api/me'],
		['an unknown API route', 'http://localhost/api/nothing-here'],
		['a Better Auth answer', 'http://localhost/api/auth/ok']
	])('are on %s', async (_, url) => {
		expectHeaders(await viaHandle(url));
	});
});
