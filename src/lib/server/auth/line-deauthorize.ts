import { LINE_CLIENT_ID, LINE_CLIENT_SECRET } from '$app/env/private';
import { PROVIDER_CALL_TIMEOUT_MS, ProviderCallError } from './provider-call';

// LINE Login development guidelines, "Deauthorize your app when a user unregisters from your app":
// https://developers.line.biz/en/docs/line-login/development-guidelines/#deauthorize
// The call needs a channel access token (stateless: issued from the channel ID and secret, valid
// 15 minutes) and the user's own access token:
// https://developers.line.biz/en/reference/messaging-api/#issue-stateless-channel-access-token
// https://developers.line.biz/en/reference/line-login/#deauthorize
const CHANNEL_TOKEN_URL = 'https://api.line.me/oauth2/v3/token';
const DEAUTHORIZE_URL = 'https://api.line.me/user/v1/deauthorize';

export type LineCredentials = { clientId: string; clientSecret: string };

const ENV_CREDENTIALS: LineCredentials = {
	clientId: LINE_CLIENT_ID ?? '',
	clientSecret: LINE_CLIENT_SECRET ?? ''
};

/** `x-line-request-id` is not a secret and is what LINE asks for when investigating a request. */
const failure = (step: string, res: Response) =>
	new ProviderCallError(
		`LINE ${step} answered ${res.status} (x-line-request-id ${res.headers.get('x-line-request-id') ?? 'none'})`
	);

/**
 * Removes this app from the Member's "Authorized apps" on the LINE side, given the Member's LINE
 * access token. Throws on any failure; the caller decides what that means. LINE documents 400 for
 * a token that is invalid, for example because the app was already deauthorized; what it answers
 * for an expired token is not confirmed.
 */
export async function deauthorizeLine(
	userAccessToken: string,
	{ clientId, clientSecret }: LineCredentials = ENV_CREDENTIALS
): Promise<void> {
	if (!clientId || !clientSecret)
		throw new ProviderCallError('LINE_CLIENT_ID / LINE_CLIENT_SECRET are not set');
	const signal = AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS); // both requests share it
	const issued = await fetch(CHANNEL_TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: clientId,
			client_secret: clientSecret
		}),
		signal
	});
	if (!issued.ok) throw failure('channel access token', issued);
	const { access_token: channelToken } = (await issued.json()) as { access_token?: string };
	if (!channelToken) throw new ProviderCallError('LINE returned no channel access token');

	const res = await fetch(DEAUTHORIZE_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${channelToken}`, 'content-type': 'application/json' },
		body: JSON.stringify({ userAccessToken }),
		signal
	});
	if (!res.ok) throw failure('deauthorize', res); // success is 204
}
