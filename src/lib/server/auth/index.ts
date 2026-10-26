import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { eq, lt } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	LINE_CLIENT_ID,
	LINE_CLIENT_SECRET
} from '$app/env/private';
import { requireBaseUrlOnVercel } from './config';
import { db } from '#lib/server/db/index.js';
import { account, member, rateLimit, session, verification } from '#lib/server/db/schema.js';

export const PROVIDERS = ['google', 'line'] as const; // ADR 0005
export type Provider = (typeof PROVIDERS)[number];

/**
 * Starting a login, per client address. Better Auth's own default for /sign-in is 3 per 10 s,
 * which a household behind one NAT retrying after a failed consent screen could hit; this is
 * loose for people and still bounds one address's writes. Rows live in `rate_limit`.
 */
export const LOGIN_RATE_LIMIT = { window: 60, max: 10 };

/**
 * Vercel sets this header itself to the client's address, even when a proxy sits in front of
 * the project (x-forwarded-for can then carry what the client sent). Without it (local, tests)
 * Better Auth falls back to one shared bucket, never to a header the client can choose.
 */
export const CLIENT_IP_HEADER = 'x-vercel-forwarded-for';

/** `rate_limit` rows hold client addresses; older than this they are deleted (privacy page). */
const RATE_LIMIT_KEEP_MS = 60 * 60 * 1000;

/**
 * Deletes `rate_limit` rows nobody has touched for an hour. Better Auth only prunes rows when
 * some address's window rolls over, so the rows of addresses that never return would stay.
 * Called from the login action on a fraction of the requests: no cron, no extra cost.
 */
export const pruneRateLimit = async (now = Date.now()) =>
	void (await db.delete(rateLimit).where(lt(rateLimit.lastRequest, now - RATE_LIMIT_KEEP_MS)));

const isSuspended = async (memberId: string) =>
	(await db.select({ at: member.suspendedAt }).from(member).where(eq(member.id, memberId)))[0]
		?.at != null;

const createAuth = () =>
	betterAuth({
		secret: BETTER_AUTH_SECRET,
		baseURL: requireBaseUrlOnVercel(BETTER_AUTH_URL),
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: { member, account, session, verification, rateLimit }
		}),
		advanced: {
			database: { generateId: 'uuid' },
			ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] }
		},
		// `member` is Better Auth's user table; README.md "Auth" has the mapping.
		user: {
			modelName: 'member',
			fields: { name: 'username', image: 'iconKey' },
			additionalFields: {
				isAdministrator: { type: 'boolean', required: false, input: false },
				suspendedAt: { type: 'date', required: false, input: false }
			}
		},
		// Switching provider makes a new Member; never link by email (FR-051).
		account: {
			accountLinking: { enabled: false },
			encryptOAuthTokens: true,
			// The OAuth state (with the PKCE verifier) rides in an encrypted, HttpOnly, SameSite=Lax
			// cookie, so starting a login writes nothing to the database. Lax still sends it on the
			// provider's top-level GET redirect back to /api/auth/callback/*.
			storeStateStrategy: 'cookie'
		},
		// In-memory counters are per serverless instance and so do not limit anything; the database
		// is shared. Off by default outside production; on everywhere so the db tests exercise it.
		// Keyed by CLIENT_IP_HEADER; a value of several addresses is not trusted and falls into
		// the shared bucket.
		rateLimit: {
			enabled: true,
			storage: 'database',
			customRules: { '/sign-in/social': LOGIN_RATE_LIMIT }
		},
		socialProviders: {
			google: { clientId: GOOGLE_CLIENT_ID ?? '', clientSecret: GOOGLE_CLIENT_SECRET ?? '' },
			line: {
				clientId: LINE_CLIENT_ID ?? '',
				clientSecret: LINE_CLIENT_SECRET ?? '',
				// openid + profile only: no email scope, which a channel needs LINE's approval for.
				disableDefaultScope: true,
				scope: ['openid', 'profile'],
				// Better Auth refuses a login without an email; LINE may not send one (FR-050). The
				// placeholder only satisfies that check: the user.create hook below stores no email.
				mapProfileToUser: (profile) => ({ email: profile.email ?? `${profile.sub}@line.invalid` })
			}
		},
		// Profile and account changes go through our services (Username, withdrawal), not these.
		disabledPaths: [
			'/update-user',
			'/delete-user',
			'/delete-user/callback',
			'/change-email',
			'/link-social',
			'/unlink-account',
			'/update-session'
		],
		databaseHooks: {
			user: {
				create: {
					// Username is chosen on /welcome (FR-052); the provider's name, photo URL and email
					// are not kept (email: see member.email in schema.ts).
					before: async (user) => ({
						// Better Auth types these as strings; the member columns are nullable.
						data: {
							...user,
							...({ name: null, image: null, email: null } as unknown as typeof user),
							emailVerified: false
						}
					})
				}
			},
			account: {
				// The provider's ID token is a JWT that can carry email, name and picture claims, which
				// are not kept either.
				create: { before: async (a) => ({ data: { ...a, idToken: null } }) }
			},
			session: {
				// Sign-in refused while suspended (FR-075); existing sessions: see resolveMember.
				create: { before: async (s) => ((await isSuspended(s.userId)) ? false : undefined) }
			}
		},
		plugins: [sveltekitCookies(getRequestEvent)]
	});

let instance: ReturnType<typeof createAuth> | undefined;
// Lazy so build and pages without a session cookie never touch the database.
export const auth = () => (instance ??= createAuth());

export type Member = { id: string; username: string | null; isAdministrator: boolean };

/**
 * The signed-in Member for these request headers, or null. Runs on every request (no cookie
 * cache), so a Suspension takes effect at once and the Member's sessions are revoked (FR-075).
 */
export async function resolveMember(headers: Headers): Promise<Member | null> {
	const result = await auth().api.getSession({ headers });
	if (!result) return null;
	const { user } = result;
	if (user.suspendedAt) {
		await db.delete(session).where(eq(session.userId, user.id));
		return null;
	}
	return { id: user.id, username: user.name, isAdministrator: user.isAdministrator === true };
}
