import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '#lib/server/auth/test/line-login.js';
import { inRequest } from '#lib/server/auth/test/via-handle.js';
import { actions } from './+page.server';
import type { RequestEvent } from './$types';

// Runs a login action the way SvelteKit does and returns the redirect it throws.
async function startLogin(provider: 'google' | 'line') {
	const request = new Request(`${ORIGIN}/login?/${provider}`, {
		method: 'POST',
		headers: { origin: ORIGIN }
	});
	const event = { request, url: new URL(request.url), locals: {} } as unknown as RequestEvent;
	try {
		await inRequest(event, () => actions[provider]!(event));
	} catch (e) {
		if (isRedirect(e)) return e;
		throw e;
	}
	throw new Error('the login action did not redirect');
}

describe('login actions', () => {
	// SvelteKit 3 refuses redirect() to another origin unless it is allowed explicitly; the
	// authorization page of each provider is another origin.
	it.each([
		['google', 'https://accounts.google.com/'],
		['line', 'https://access.line.me/']
	] as const)('sends the browser to the %s authorization page', async (provider, origin) => {
		const redirect = await startLogin(provider);
		expect(redirect.status).toBe(303);
		expect(redirect.location.startsWith(origin)).toBe(true);
	});
});
