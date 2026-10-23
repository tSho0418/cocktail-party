import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_IP_HEADER, LOGIN_RATE_LIMIT, pruneRateLimit } from '#lib/server/auth/index.js';
import { finishLogin, memberOfAccount, ORIGIN } from '#lib/server/auth/test/line-login.js';
import { inRequest } from '#lib/server/auth/test/via-handle.js';
import { db } from '#lib/server/db/index.js';
import { rateLimit, session, verification } from '#lib/server/db/schema.js';
import { actions } from './+page.server';
import type { RequestEvent } from './$types';

type Jar = { name: string; value: string; options: Record<string, unknown> }[];
type Outcome = { redirect: string; cookie: string; jar: Jar } | { failure: number };

// Runs a login action the way SvelteKit does. `cookie` is what the "browser" gets back, `jar` the
// cookies the action set with the attributes it set them with.
async function startLogin(
	provider: 'google' | 'line',
	headers: Record<string, string> = { [CLIENT_IP_HEADER]: '203.0.113.1' },
	module: { actions: typeof actions } = { actions },
	origin = ORIGIN
): Promise<Outcome> {
	const request = new Request(`${origin}/login?/${provider}`, {
		method: 'POST',
		headers: { origin, ...headers }
	});
	const jar: Jar = [];
	const cookies = {
		set: (name: string, value: string, options: Record<string, unknown>) =>
			jar.push({ name, value, options })
	};
	const event = {
		request,
		url: new URL(request.url),
		locals: {},
		cookies
	} as unknown as RequestEvent;
	const cookie = () => jar.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
	try {
		const result = await inRequest(event, () => module.actions[provider]!(event));
		if (isActionFailure(result)) return { failure: result.status };
	} catch (e) {
		if (isRedirect(e)) return { redirect: e.location, cookie: cookie(), jar };
		throw e;
	}
	throw new Error('the login action did not redirect');
}

const fromIp = (ip: string) => ({ [CLIENT_IP_HEADER]: ip });

const redirectOf = (o: Outcome) => {
	if (!('redirect' in o)) throw new Error(`login refused with ${o.failure}`);
	return o;
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.doUnmock('$app/env/private');
	vi.doUnmock('#lib/server/db/index.js');
	vi.resetModules();
});

describe('login actions', () => {
	// SvelteKit 3 refuses redirect() to another origin unless it is allowed explicitly; the
	// authorization page of each provider is another origin.
	it.each([
		['google', 'https://accounts.google.com/'],
		['line', 'https://access.line.me/']
	] as const)('sends the browser to the %s authorization page', async (provider, origin) => {
		const { redirect } = redirectOf(await startLogin(provider, fromIp('203.0.113.10')));
		expect(redirect.startsWith(origin)).toBe(true);
	});

	it('does not write to the verification table to start a login', async () => {
		await startLogin('line', fromIp('203.0.113.11'));
		expect(await db.select().from(verification)).toHaveLength(0);
	});

	// The state now travels in a cookie, so the round trip must still work for each provider.
	it.each([
		['google', { sub: 'g-roundtrip', email: 'g@example.com', email_verified: true }],
		['line', { sub: 'U-roundtrip' }]
	] as const)(
		'signs a new Member in through %s after the provider sends them back',
		async (provider, claims) => {
			const { redirect, cookie } = redirectOf(await startLogin(provider, fromIp('203.0.113.12')));
			const res = await finishLogin(provider, redirect, cookie, claims);
			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toContain('/welcome');
			expect(res.headers.getSetCookie().join()).toContain('session_token');
			expect((await memberOfAccount(claims.sub))?.id).toBeTruthy();
		}
	);

	it('refuses a return that did not start in this browser', async () => {
		const { redirect } = redirectOf(await startLogin('line', fromIp('203.0.113.13')));
		const res = await finishLogin('line', redirect, '', { sub: 'U-no-cookie' });
		expect(res.headers.get('location')).toContain('error=state_mismatch');
		expect(res.headers.getSetCookie().join()).not.toContain('session_token');
		expect(await memberOfAccount('U-no-cookie')).toBeUndefined();
	});

	// Login CSRF: an attacker starts a login, and gets the victim to finish it with the
	// attacker's authorization code. The victim's browser holds its own state cookie.
	it('refuses a return whose state belongs to another login', async () => {
		const attacker = redirectOf(await startLogin('line', fromIp('203.0.113.14')));
		const victim = redirectOf(await startLogin('line', fromIp('203.0.113.15')));
		const before = (await db.select().from(session)).length;
		const res = await finishLogin('line', attacker.redirect, victim.cookie, { sub: 'U-csrf' });
		expect(res.headers.get('location')).toContain('error=state_mismatch');
		expect(res.headers.getSetCookie().join()).not.toContain('session_token');
		expect(await memberOfAccount('U-csrf')).toBeUndefined();
		expect(await db.select().from(session)).toHaveLength(before);
	});

	// Dropping an attribute while copying Better Auth's cookie to the response would not fail any
	// flow above, but would weaken the state cookie.
	it('sets the state cookie as HttpOnly, SameSite=Lax, 10 minutes, for the whole site', async () => {
		const { jar } = redirectOf(await startLogin('line', fromIp('203.0.113.16')));
		expect(jar).toHaveLength(1);
		expect(jar[0].name).toBe('better-auth.oauth_state');
		expect(jar[0].options).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600,
			path: '/'
		});
		expect(jar[0].options.secure).toBeFalsy();
	});

	it('also marks it Secure, with the __Secure- prefix, on an https site', async () => {
		const https = 'https://cocktail.example';
		vi.resetModules();
		vi.doMock('$app/env/private', async (original) => ({
			...(await original<object>()),
			BETTER_AUTH_URL: https
		}));
		// Keep the one database pool of this run.
		vi.doMock('#lib/server/db/index.js', () => ({ db }));
		const module = await import('./+page.server');
		const { jar } = redirectOf(await startLogin('line', fromIp('203.0.113.17'), module, https));
		expect(jar).toHaveLength(1);
		expect(jar[0].name).toBe('__Secure-better-auth.oauth_state');
		expect(jar[0].options).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600,
			path: '/',
			secure: true
		});
	});
});

describe('login rate limit', () => {
	it('lets a person retry up to the limit, then refuses until the window passes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const ip = '198.51.100.7';
		for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
			expect(await startLogin(i % 2 ? 'google' : 'line', fromIp(ip))).toHaveProperty('redirect');
		}
		expect(await startLogin('line', fromIp(ip))).toEqual({ failure: 429 });
		expect(await startLogin('google', fromIp(ip))).toEqual({ failure: 429 });

		// Another address (another NAT, another device) is not affected.
		expect(await startLogin('line', fromIp('198.51.100.8'))).toHaveProperty('redirect');

		vi.setSystemTime(Date.now() + (LOGIN_RATE_LIMIT.window + 1) * 1000);
		expect(await startLogin('line', fromIp(ip))).toHaveProperty('redirect');
	});

	it('does not let a forged address chain pick the bucket', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		// More than one hop is not trusted: it lands in one shared bucket instead of a fresh one.
		for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
			await startLogin('line', fromIp(`203.0.113.${100 + i}, 10.0.0.1`));
		}
		expect(await startLogin('line', fromIp('203.0.113.250, 10.0.0.1'))).toEqual({ failure: 429 });
	});

	it('ignores x-forwarded-for, which a client sets freely, when Vercel gives no address', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 2 * 3600 * 1000); // clear the shared bucket of the tests above
		for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++)
			await startLogin('line', { 'x-forwarded-for': `192.0.2.${i + 1}` });
		expect(await startLogin('line', { 'x-forwarded-for': '192.0.2.200' })).toEqual({
			failure: 429
		});
	});

	it('deletes the rows of addresses that stopped coming after an hour', async () => {
		const now = Date.now();
		await db.insert(rateLimit).values([
			{ key: 'old|/x', count: 1, lastRequest: now - 61 * 60 * 1000 },
			{ key: 'recent|/x', count: 1, lastRequest: now - 59 * 60 * 1000 }
		]);
		await pruneRateLimit(now);
		const keys = (await db.select().from(rateLimit)).map((r) => r.key);
		expect(keys).not.toContain('old|/x');
		expect(keys).toContain('recent|/x');
	});
});
