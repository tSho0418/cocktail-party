import { fail, redirect } from '@sveltejs/kit';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { BETTER_AUTH_URL } from '$app/env/private';
import { auth, CLIENT_IP_HEADER, pruneRateLimit, type Provider } from '#lib/server/auth/index.js';
import { PROVIDER_ORIGINS } from '#lib/server/auth/provider-origins.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.member) redirect(303, '/');
};

// The action goes through Better Auth's HTTP handler, not `api.signInSocial`: only the handler
// applies the sign-in rate limit (per client address, in the database). The request is built here
// with this app's own origin, so Better Auth's origin check passes by construction and is no
// protection; the rate limit is the only thing this buys.
const signIn =
	(provider: Provider): Actions[string] =>
	async ({ request, url, cookies }) => {
		const origin = new URL(BETTER_AUTH_URL ?? url.origin).origin;
		const headers = new Headers({ 'content-type': 'application/json', origin });
		// The address the rate limit is keyed by; Better Auth reads the same header.
		const clientIp = request.headers.get(CLIENT_IP_HEADER);
		if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp);
		const res = await auth().handler(
			new Request(`${origin}/api/auth/sign-in/social`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					provider,
					callbackURL: '/',
					newUserCallbackURL: '/welcome',
					errorCallbackURL: '/login'
				})
			})
		);
		if (res.status === 429) return fail(429, { error: 'rate_limited' as const });
		if (!res.ok) throw new Error(`sign-in for ${provider} failed with status ${res.status}`);
		const { url: authorizationUrl } = (await res.json()) as { url?: string };
		if (!authorizationUrl) throw new Error(`no authorization URL for ${provider}`);
		// The OAuth state cookie; the handler only puts it on the response, not on this request.
		const setCookie = res.headers.get('set-cookie');
		if (setCookie)
			for (const [name, attributes] of parseSetCookieHeader(setCookie))
				cookies.set(name, attributes.value, {
					...toCookieOptions(attributes),
					path: attributes.path || '/'
				});
		// Sweeping on every request would be a write each time; 1 in 20 keeps the table small.
		if (Math.random() < 0.05) await pruneRateLimit();
		// SvelteKit 3 refuses a redirect to another origin unless it is allowed: only the providers'
		// own authorization hosts (the URL comes from Better Auth, never from the request).
		redirect(303, authorizationUrl, { external: [...PROVIDER_ORIGINS] });
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
