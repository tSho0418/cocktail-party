import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { account, member, session } from '#lib/server/db/schema.js';
import { auth, resolveMember } from './index';
import { viaHandle as viaHandleAt } from './test/via-handle';

const ORIGIN = 'http://localhost:5173';

// Stands in for LINE's token endpoint; real Google/LINE OAuth needs credentials (see README).
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
afterEach(() => vi.unstubAllGlobals());

const cookiesOf = (res: Response) =>
	res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');

/** Runs Better Auth's real sign-in → callback flow for LINE; returns the callback response. */
async function lineLogin(claims: Record<string, unknown>) {
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

const memberOfAccount = async (accountId: string) =>
	(
		await db
			.select({ member })
			.from(account)
			.innerJoin(member, eq(member.id, account.userId))
			.where(eq(account.accountId, accountId))
	)[0]?.member;

const viaHandle = (path: string, cookie?: string) => viaHandleAt(`${ORIGIN}${path}`, cookie);

describe('LINE login (stubbed provider)', () => {
	it('creates a Member without email or Username, then sends it to /welcome (FR-050, FR-052)', async () => {
		const res = await lineLogin({ sub: 'U-no-email', name: '山田' });
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('/welcome');

		const m = await memberOfAccount('U-no-email');
		expect(m).toMatchObject({ email: null, username: null, iconKey: null });

		const signedIn = await resolveMember(new Headers({ cookie: cookiesOf(res) }));
		expect(signedIn).toEqual({ id: m!.id, username: null, isAdministrator: false });
	});

	it('signs the same LINE account back into the same Member', async () => {
		await lineLogin({ sub: 'U-again' });
		const again = await lineLogin({ sub: 'U-again' });
		expect(again.headers.get('location')).toBe('/');
		expect(await db.select().from(account).where(eq(account.accountId, 'U-again'))).toHaveLength(1);
	});

	it('does not store the provider email nor match other Members by it (FR-051)', async () => {
		await lineLogin({ sub: 'U-mail-1', email: 'same@example.com' });
		const second = await lineLogin({ sub: 'U-mail-2', email: 'same@example.com' });
		expect(second.headers.get('location')).toBe('/welcome');
		const [a, b] = [await memberOfAccount('U-mail-1'), await memberOfAccount('U-mail-2')];
		expect(a!.id).not.toBe(b!.id);
		expect(a!.email).toBeNull();
	});
});

describe('Suspension (FR-075)', () => {
	it('rejects an existing session on the next request and revokes it', async () => {
		const res = await lineLogin({ sub: 'U-suspend' });
		const cookie = cookiesOf(res);
		const m = (await memberOfAccount('U-suspend'))!;
		await db.update(member).set({ username: 'suspendee' }).where(eq(member.id, m.id));
		expect((await viaHandle('/api/me', cookie)).status).toBe(200);

		await db.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, m.id));
		expect((await viaHandle('/api/me', cookie)).status).toBe(401);
		expect(await db.select().from(session).where(eq(session.userId, m.id))).toEqual([]);
		// Better Auth's own endpoint behind the same handle cannot hand the session back either.
		const got = await viaHandle('/api/auth/get-session', cookie);
		expect(await got.json()).toBeNull();
	});

	it('refuses sign-in while suspended', async () => {
		await lineLogin({ sub: 'U-banned' });
		const m = (await memberOfAccount('U-banned'))!;
		await db.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, m.id));
		await db.delete(session).where(eq(session.userId, m.id));

		const res = await lineLogin({ sub: 'U-banned' });
		expect(res.headers.get('location')).toMatch(/^\/login\?error=/);
		expect(await db.select().from(session).where(eq(session.userId, m.id))).toEqual([]);
	});
});

describe('Username gate', () => {
	it('redirects pages to /welcome and refuses the API until a Username is set (FR-052)', async () => {
		const cookie = cookiesOf(await lineLogin({ sub: 'U-gate' }));
		await expect(viaHandle('/', cookie)).rejects.toMatchObject({
			status: 303,
			location: '/welcome'
		});
		expect(await (await viaHandle('/welcome', cookie)).text()).toBe('page');
		expect((await viaHandle('/api/me', cookie)).status).toBe(403);
	});
});
