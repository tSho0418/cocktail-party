// Shared by db tests that need a real signed-in session; never imported by app code.
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { account, member } from '#lib/server/db/schema.js';
import { auth } from '../index';

export const ORIGIN = 'http://localhost:5173';

// Stands in for LINE's token endpoint; real Google/LINE OAuth needs credentials (see README).
// Callers must `vi.unstubAllGlobals()` afterwards.
const base64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function stubLineToken(claims: Record<string, unknown>) {
	const realFetch = globalThis.fetch;
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (!url.startsWith('https://api.line.me/oauth2/v2.1/token')) return realFetch(input, init);
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

/** Runs Better Auth's real sign-in → callback flow for LINE; returns the callback response. */
export async function lineLogin(claims: Record<string, unknown>) {
	stubLineToken(claims);
	const start = await auth().handler(
		new Request(`${ORIGIN}/api/auth/sign-in/social`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: ORIGIN },
			body: JSON.stringify({
				provider: 'line',
				callbackURL: '/',
				newUserCallbackURL: '/welcome',
				errorCallbackURL: '/login'
			})
		})
	);
	const { url } = await start.json();
	const state = new URL(url).searchParams.get('state');
	return auth().handler(
		new Request(`${ORIGIN}/api/auth/callback/line?code=c&state=${state}`, {
			headers: { cookie: cookiesOf(start) }
		})
	);
}

export const memberOfAccount = async (accountId: string) =>
	(
		await db
			.select({ member })
			.from(account)
			.innerJoin(member, eq(member.id, account.userId))
			.where(eq(account.accountId, accountId))
	)[0]?.member;
