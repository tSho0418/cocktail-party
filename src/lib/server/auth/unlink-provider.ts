import { revokeGoogleToken } from './google-revoke';
import { deauthorizeLine } from './line-deauthorize';
import { ProviderCallError } from './provider-call';
import type { ProviderToken } from './provider-access-token';

/** Only a ProviderCallError's message is fixed text; any other error is logged by name alone. */
const reasonOf = (e: unknown) =>
	e instanceof ProviderCallError ? e.message : e instanceof Error ? e.name : typeof e;

/**
 * After a withdrawal has committed: tells the Member's login provider that the app link is gone
 * (LINE: deauthorize, required by LINE's development guidelines; Google: revoke the access token,
 * which its best practices ask for). Best effort and never throws: the Member is already deleted.
 * Logs the status or the error's name, never a token.
 */
export async function unlinkProvider(token: ProviderToken | null): Promise<void> {
	if (!token) return;
	if (token.provider === 'line') {
		try {
			await deauthorizeLine(token.accessToken);
		} catch (e) {
			console.error('LINE deauthorization failed', reasonOf(e));
		}
		return;
	}
	// Google's access token lasts about an hour and no refresh token is stored, so an expired one is
	// already dead and revoking it would change nothing. Skip it.
	if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return;
	try {
		await revokeGoogleToken(token.accessToken);
	} catch (e) {
		console.error('Google token revocation failed', reasonOf(e));
	}
}
