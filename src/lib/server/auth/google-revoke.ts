import { PROVIDER_CALL_TIMEOUT_MS, ProviderCallError } from './provider-call';

// Sign in with Google best practices, "Revoke tokens on account deletion": when a user deletes their
// account the app must revoke the access and refresh tokens it obtained.
// https://developers.google.com/identity/siwg/best-practices
// Server-side revocation, as Google's guide shows it: POST https://oauth2.googleapis.com/revoke with
// the token as the `token` parameter (an access token or a refresh token; revoking an access token
// also revokes its refresh token) and `Content-Type: application/x-www-form-urlencoded`. 200 is
// success; 400 plus an error code is every failure, and nothing is said about an expired token.
// https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
// The guide puts `token` in the query string, so it goes there. Errors thrown from here never
// carry the URL.
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** Revokes the Member's Google access token. Throws on any failure; the caller decides what that means. */
export async function revokeGoogleToken(accessToken: string): Promise<void> {
	const res = await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: accessToken })}`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		signal: AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)
	});
	if (!res.ok) throw new ProviderCallError(`Google revoke answered ${res.status}`);
}
