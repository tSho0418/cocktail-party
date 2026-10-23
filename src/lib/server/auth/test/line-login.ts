// Shared by db tests that need a real signed-in session; never imported by app code.
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { account, member } from '#lib/server/db/schema.js';
import { auth } from '../index';

export const ORIGIN = 'http://localhost:5173';

// Stands in for the provider's token endpoint; real Google/LINE OAuth needs credentials (see
// README). Callers must `vi.unstubAllGlobals()` afterwards.
const TOKEN_ENDPOINTS = {
	line: 'https://api.line.me/oauth2/v2.1/token',
	google: 'https://oauth2.googleapis.com/token'
} as const;
type Provider = keyof typeof TOKEN_ENDPOINTS;
const base64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function stubToken(provider: Provider, claims: Record<string, unknown>) {
	const realFetch = globalThis.fetch;
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (!url.startsWith(TOKEN_ENDPOINTS[provider])) return realFetch(input, init);
		const idToken = `${base64url({ alg: 'none' })}.${base64url(claims)}.`;
		return Response.json({
			access_token: 'at',
			token_type: 'Bearer',
			expires_in: 3600,
			id_token: idToken
		});
	});
}

export const cookiesOf = (res: Response) =>
	res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');

// Each login comes from its own address so tests do not share the sign-in rate limit.
const randomIp = () =>
	Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 254)).join('.');

/** Better Auth's callback for `authorizationUrl`, with the browser's `cookie`; returns its response. */
export async function finishLogin(
	provider: Provider,
	authorizationUrl: string,
	cookie: string,
	claims: Record<string, unknown>
) {
	stubToken(provider, claims);
	const state = new URL(authorizationUrl).searchParams.get('state');
	return auth().handler(
		new Request(`${ORIGIN}/api/auth/callback/${provider}?code=c&state=${state}`, {
			headers: { cookie }
		})
	);
}

/** Runs Better Auth's real sign-in → callback flow; returns the callback response. */
export async function socialLogin(provider: Provider, claims: Record<string, unknown>) {
	const start = await auth().handler(
		new Request(`${ORIGIN}/api/auth/sign-in/social`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: ORIGIN,
				'x-forwarded-for': randomIp()
			},
			body: JSON.stringify({
				provider,
				callbackURL: '/',
				newUserCallbackURL: '/welcome',
				errorCallbackURL: '/login'
			})
		})
	);
	const { url } = await start.json();
	return finishLogin(provider, url, cookiesOf(start), claims);
}

export const lineLogin = (claims: Record<string, unknown>) => socialLogin('line', claims);

export const memberOfAccount = async (accountId: string) =>
	(
		await db
			.select({ member })
			.from(account)
			.innerJoin(member, eq(member.id, account.userId))
			.where(eq(account.accountId, accountId))
	)[0]?.member;
