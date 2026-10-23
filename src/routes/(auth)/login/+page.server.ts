import { fail, redirect } from '@sveltejs/kit';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { BETTER_AUTH_URL } from '$app/env/private';
import { auth, type Provider } from '#lib/server/auth/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.member) redirect(303, '/');
};

// SvelteKit 3 refuses a redirect to another origin unless it is allowed; only the providers'
// own authorization hosts are (the URL comes from Better Auth, never from the request).
const PROVIDER_ORIGINS = ['https://accounts.google.com', 'https://access.line.me'];

// The action goes through Better Auth's HTTP handler, not `api.signInSocial`: only the handler
// applies the sign-in rate limit (per client address, in the database) and the origin check.
const signIn =
	(provider: Provider): Actions[string] =>
	async ({ request, url, cookies }) => {
		const origin = new URL(BETTER_AUTH_URL ?? url.origin).origin;
		const headers = new Headers({ 'content-type': 'application/json', origin });
		// Vercel sets x-forwarded-for itself; Better Auth only trusts it when it is one address.
		const forwarded = request.headers.get('x-forwarded-for');
		if (forwarded) headers.set('x-forwarded-for', forwarded);
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
		const { url: authorizationUrl } = (await res.json()) as { url?: string };
		if (!res.ok || !authorizationUrl) throw new Error(`no authorization URL for ${provider}`);
		// The OAuth state cookie; the handler only puts it on the response, not on this request.
		const setCookie = res.headers.get('set-cookie');
		if (setCookie)
			for (const [name, attributes] of parseSetCookieHeader(setCookie))
				cookies.set(name, attributes.value, {
					...toCookieOptions(attributes),
					path: attributes.path || '/'
				});
		redirect(303, authorizationUrl, { external: PROVIDER_ORIGINS });
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
