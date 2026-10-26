import { afterEach, describe, expect, it, vi } from 'vitest';
import { deauthorizeLine, LineDeauthorizeError } from './line-deauthorize';

const credentials = { clientId: '1234567890', clientSecret: 'channel-secret' };
const channelToken = 'channel-token';

afterEach(() => vi.unstubAllGlobals());

/** Stands in for api.line.me; records each request as [url, headers, body]. */
function stubLine(answers: { token?: Response; deauthorize?: Response }) {
	const calls: [string, Headers, string][] = [];
	vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
		calls.push([url, new Headers(init.headers), String(init.body)]);
		return url.endsWith('/oauth2/v3/token')
			? (answers.token ?? Response.json({ access_token: channelToken, expires_in: 900 }))
			: (answers.deauthorize ?? new Response(null, { status: 204 }));
	});
	return calls;
}

describe('deauthorizeLine (LINE development guidelines: deauthorize on unregistering)', () => {
	it('issues a stateless channel access token, then deauthorizes with the Member’s token', async () => {
		const calls = stubLine({});

		await deauthorizeLine('member-access-token', credentials);

		expect(calls).toHaveLength(2);
		const [[tokenUrl, , tokenBody], [deauthUrl, deauthHeaders, deauthBody]] = calls;
		expect(tokenUrl).toBe('https://api.line.me/oauth2/v3/token');
		expect(Object.fromEntries(new URLSearchParams(tokenBody))).toEqual({
			grant_type: 'client_credentials',
			client_id: '1234567890',
			client_secret: 'channel-secret'
		});
		expect(deauthUrl).toBe('https://api.line.me/user/v1/deauthorize');
		expect(deauthHeaders.get('authorization')).toBe(`Bearer ${channelToken}`);
		expect(JSON.parse(deauthBody)).toEqual({ userAccessToken: 'member-access-token' });
	});

	it('fails with the status only when LINE refuses, so the logged error holds no token', async () => {
		stubLine({ deauthorize: Response.json({ message: 'invalid token' }, { status: 400 }) });

		const error = await deauthorizeLine('member-access-token', credentials).catch((e) => e);

		expect(error).toBeInstanceOf(LineDeauthorizeError);
		expect(error.message).toBe('LINE deauthorize answered 400');
	});

	it('does not try to deauthorize when the channel access token cannot be issued', async () => {
		const calls = stubLine({ token: Response.json({ error: 'invalid_request' }, { status: 400 }) });

		await expect(deauthorizeLine('member-access-token', credentials)).rejects.toThrow(
			'LINE channel access token answered 400'
		);
		expect(calls).toHaveLength(1);
	});

	it('does not call LINE without the channel ID and secret', async () => {
		const calls = stubLine({});

		await expect(
			deauthorizeLine('member-access-token', { clientId: '', clientSecret: '' })
		).rejects.toThrow('not set');
		expect(calls).toEqual([]);
	});
});
