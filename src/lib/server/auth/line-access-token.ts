import { auth } from './index';

/** Reading the token may refresh it at LINE; withdrawing must not wait on LINE longer than this. */
const READ_TIMEOUT_MS = 10_000;

/**
 * The Member's LINE access token, or null when they signed in with Google or none can be read.
 * Call it before `withdrawMember`: the account row (and the token with it) goes with the Member.
 * Better Auth decrypts it (`encryptOAuthTokens`), and first refreshes it when it has expired and
 * LINE's refresh token (valid 90 days after the access token was issued) still works. Never
 * throws: a Member whose token is unavailable still withdraws, just without deauthorization.
 */
export async function lineAccessTokenOf(memberId: string): Promise<string | null> {
	try {
		const { internalAdapter } = await auth().$context;
		const line = (await internalAdapter.findAccounts(memberId)).find(
			(a) => a.providerId === 'line'
		);
		if (!line) return null;
		const read = auth().api.getAccessToken({ body: { accountId: line.id, userId: memberId } });
		read.catch(() => {}); // if the timeout wins, its late failure is not an unhandled rejection
		const timeout = new Promise<never>((_, reject) =>
			AbortSignal.timeout(READ_TIMEOUT_MS).addEventListener('abort', () =>
				reject(new Error('timed out'))
			)
		);
		return (await Promise.race([read, timeout])).accessToken || null;
	} catch (e) {
		// Name only: Better Auth's and the driver's messages can carry query text or parameters.
		console.error(
			'LINE access token unavailable for deauthorization',
			e instanceof Error ? e.name : typeof e
		);
		return null;
	}
}
