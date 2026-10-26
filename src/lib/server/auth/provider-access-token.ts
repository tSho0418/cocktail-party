import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { account } from '#lib/server/db/schema.js';
import { auth, type Provider } from './index';
import { PROVIDER_CALL_TIMEOUT_MS } from './provider-call';

export type ProviderToken = { provider: Provider; accessToken: string; expiresAt: Date | null };

/** Why no token could be read; logged as is (fixed strings, so no token or cause can leak). */
type Unavailable =
	'no-account' | 'no-token' | 'lookup-failed' | 'timeout' | 'decrypt-or-refresh-failed';

class TokenUnavailable extends Error {
	constructor(readonly reason: Unavailable) {
		super(reason);
	}
}

const timeoutAfter = (ms: number) =>
	new Promise<never>((_, reject) =>
		AbortSignal.timeout(ms).addEventListener('abort', () => reject(new TokenUnavailable('timeout')))
	);

/**
 * The Member's login provider and its access token, or null when none can be read (logged with a
 * fixed reason). Call it before `withdrawMember`: the account row (and the token with it) goes with
 * the Member. Better Auth decrypts the token (`encryptOAuthTokens`) through its public
 * `getAccessToken`, which first refreshes it when it has expired and a refresh token exists (LINE:
 * valid 90 days from the last OAuth login; Google: none is stored, see `accessType` in
 * auth/index.ts). Without a refresh token an expired token comes back as it is, with its expiry.
 * Never throws: a Member whose token is unavailable still withdraws, just without deauthorization.
 */
export async function providerTokenOf(memberId: string): Promise<ProviderToken | null> {
	try {
		const [row] = await db
			.select({ id: account.id, provider: account.providerId })
			.from(account)
			.where(eq(account.userId, memberId))
			.catch(() => {
				throw new TokenUnavailable('lookup-failed');
			});
		if (!row) throw new TokenUnavailable('no-account');
		const read = auth()
			.api.getAccessToken({ body: { accountId: row.id, userId: memberId } })
			.catch(() => {
				throw new TokenUnavailable('decrypt-or-refresh-failed');
			});
		read.catch(() => {}); // if the timeout wins, the late failure is not an unhandled rejection
		const { accessToken, accessTokenExpiresAt } = await Promise.race([
			read,
			timeoutAfter(PROVIDER_CALL_TIMEOUT_MS)
		]);
		if (!accessToken) throw new TokenUnavailable('no-token');
		return {
			provider: row.provider as Provider,
			accessToken,
			expiresAt: accessTokenExpiresAt ? new Date(accessTokenExpiresAt) : null
		};
	} catch (e) {
		console.error(
			'provider access token unavailable for deauthorization',
			e instanceof TokenUnavailable ? e.reason : 'unexpected'
		);
		return null;
	}
}
