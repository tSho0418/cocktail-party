import { LINE_CLIENT_ID, LINE_CLIENT_SECRET } from '$app/env/private';

// LINE Login development guidelines, "Deauthorize your app when a user unregisters from your app":
// https://developers.line.biz/en/docs/line-login/development-guidelines/#deauthorize
// The call needs a channel access token (stateless: issued from the channel ID and secret, valid
// 15 minutes) and the user's own access token:
// https://developers.line.biz/en/reference/messaging-api/#issue-stateless-channel-access-token
// https://developers.line.biz/en/reference/line-login/#deauthorize
const CHANNEL_TOKEN_URL = 'https://api.line.me/oauth2/v3/token';
const DEAUTHORIZE_URL = 'https://api.line.me/user/v1/deauthorize';

/** Each external call may take this long; withdrawing must not hang on LINE. */
const TIMEOUT_MS = 5000;

/** Carries the HTTP status only: never the request, which holds the Member's token and our secret. */
export class LineDeauthorizeError extends Error {
	constructor(step: string, status: number) {
		super(`LINE ${step} answered ${status}`);
		this.name = 'LineDeauthorizeError';
	}
}

export type LineCredentials = { clientId: string; clientSecret: string };

const ENV_CREDENTIALS: LineCredentials = {
	clientId: LINE_CLIENT_ID ?? '',
	clientSecret: LINE_CLIENT_SECRET ?? ''
};

/**
 * Removes this app from the Member's "Authorized apps" on the LINE side, given the Member's LINE
 * access token. Throws on any failure (LINE answers 400 for a token that is expired or already
 * deauthorized); the caller decides what that means.
 */
export async function deauthorizeLine(
	userAccessToken: string,
	{ clientId, clientSecret }: LineCredentials = ENV_CREDENTIALS
): Promise<void> {
	if (!clientId || !clientSecret)
		throw new Error('LINE_CLIENT_ID / LINE_CLIENT_SECRET are not set');
	const issued = await fetch(CHANNEL_TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: clientId,
			client_secret: clientSecret
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!issued.ok) throw new LineDeauthorizeError('channel access token', issued.status);
	const { access_token: channelToken } = (await issued.json()) as { access_token?: string };
	if (!channelToken) throw new Error('LINE returned no channel access token');

	const res = await fetch(DEAUTHORIZE_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${channelToken}`, 'content-type': 'application/json' },
		body: JSON.stringify({ userAccessToken }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (res.status !== 204) throw new LineDeauthorizeError('deauthorize', res.status);
}
