import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { eq } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	LINE_CLIENT_ID,
	LINE_CLIENT_SECRET
} from '$app/env/private';
import { db } from '#lib/server/db/index.js';
import { account, member, session, verification } from '#lib/server/db/schema.js';

export const PROVIDERS = ['google', 'line'] as const; // ADR 0005
export type Provider = (typeof PROVIDERS)[number];

const isSuspended = async (memberId: string) =>
	(await db.select({ at: member.suspendedAt }).from(member).where(eq(member.id, memberId)))[0]
		?.at != null;

const createAuth = () =>
	betterAuth({
		secret: BETTER_AUTH_SECRET,
		baseURL: BETTER_AUTH_URL,
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: { member, account, session, verification }
		}),
		advanced: { database: { generateId: 'uuid' } },
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
		account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
		socialProviders: {
			google: { clientId: GOOGLE_CLIENT_ID ?? '', clientSecret: GOOGLE_CLIENT_SECRET ?? '' },
			line: {
				clientId: LINE_CLIENT_ID ?? '',
				clientSecret: LINE_CLIENT_SECRET ?? '',
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
