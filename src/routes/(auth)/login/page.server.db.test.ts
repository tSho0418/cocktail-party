import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_RATE_LIMIT } from '#lib/server/auth/index.js';
import { finishLogin, memberOfAccount, ORIGIN } from '#lib/server/auth/test/line-login.js';
import { inRequest } from '#lib/server/auth/test/via-handle.js';
import { db } from '#lib/server/db/index.js';
import { verification } from '#lib/server/db/schema.js';
import { actions } from './+page.server';
import type { RequestEvent } from './$types';

type Outcome = { redirect: string; cookie: string } | { failure: number };

// Runs a login action the way SvelteKit does. `cookie` is what the "browser" gets back.
async function startLogin(provider: 'google' | 'line', ip = '203.0.113.1'): Promise<Outcome> {
	const request = new Request(`${ORIGIN}/login?/${provider}`, {
		method: 'POST',
		headers: { origin: ORIGIN, 'x-forwarded-for': ip }
	});
	const jar = new Map<string, string>();
	const cookies = { set: (name: string, value: string) => jar.set(name, value) };
	const event = {
		request,
		url: new URL(request.url),
		locals: {},
		cookies
	} as unknown as RequestEvent;
	const cookie = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
	try {
		const result = await inRequest(event, () => actions[provider]!(event));
		if (isActionFailure(result)) return { failure: result.status };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location, cookie: cookie() };
		throw e;
	}
	throw new Error('the login action did not redirect');
}

const redirectOf = (o: Outcome) => {
	if (!('redirect' in o)) throw new Error(`login refused with ${o.failure}`);
	return o;
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('login actions', () => {
	// SvelteKit 3 refuses redirect() to another origin unless it is allowed explicitly; the
	// authorization page of each provider is another origin.
	it.each([
		['google', 'https://accounts.google.com/'],
		['line', 'https://access.line.me/']
	] as const)('sends the browser to the %s authorization page', async (provider, origin) => {
		const { redirect } = redirectOf(await startLogin(provider, '203.0.113.10'));
		expect(redirect.startsWith(origin)).toBe(true);
	});

	it('does not write to the database to start a login', async () => {
		await startLogin('line', '203.0.113.11');
		expect(await db.select().from(verification)).toHaveLength(0);
	});

	// The state now travels in a cookie, so the round trip must still work for each provider.
	it.each([
		['google', { sub: 'g-roundtrip', email: 'g@example.com', email_verified: true }],
		['line', { sub: 'U-roundtrip' }]
	] as const)(
		'signs a new Member in through %s after the provider sends them back',
		async (provider, claims) => {
			const { redirect, cookie } = redirectOf(await startLogin(provider, '203.0.113.12'));
			const res = await finishLogin(provider, redirect, cookie, claims);
			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toContain('/welcome');
			expect(res.headers.getSetCookie().join()).toContain('session_token');
			expect((await memberOfAccount(claims.sub))?.id).toBeTruthy();
		}
	);

	it('refuses a return that did not start in this browser', async () => {
		const { redirect } = redirectOf(await startLogin('line', '203.0.113.13'));
		const res = await finishLogin('line', redirect, '', { sub: 'U-no-cookie' });
		expect(res.headers.get('location')).toContain('error=state_mismatch');
		expect(res.headers.getSetCookie().join()).not.toContain('session_token');
		expect(await memberOfAccount('U-no-cookie')).toBeUndefined();
	});
});

describe('login rate limit', () => {
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
	});

	it('lets a person retry up to the limit, then refuses until the window passes', async () => {
		const ip = '198.51.100.7';
		for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
			expect(await startLogin(i % 2 ? 'google' : 'line', ip)).toHaveProperty('redirect');
		}
		expect(await startLogin('line', ip)).toEqual({ failure: 429 });
		expect(await startLogin('google', ip)).toEqual({ failure: 429 });

		// Another address (another NAT, another device) is not affected.
		expect(await startLogin('line', '198.51.100.8')).toHaveProperty('redirect');

		vi.setSystemTime(Date.now() + (LOGIN_RATE_LIMIT.window + 1) * 1000);
		expect(await startLogin('line', ip)).toHaveProperty('redirect');
	});

	it('does not let a forged x-forwarded-for chain pick the bucket', async () => {
		// More than one hop is not trusted: it lands in one shared bucket instead of a fresh one.
		for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
			await startLogin('line', `203.0.113.${100 + i}, 10.0.0.1`);
		}
		expect(await startLogin('line', '203.0.113.250, 10.0.0.1')).toEqual({ failure: 429 });
	});
});
