import { afterEach, describe, expect, it, vi } from 'vitest';
import { revokeGoogleToken } from './google-revoke';
import { deauthorizeLine } from './line-deauthorize';
import { ProviderCallError } from './provider-call';

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; headers: Headers; body: string };

/** Stands in for the providers' endpoints; `answer` picks the response for each request. */
function stubFetch(answer: (url: string) => Response) {
	const calls: Call[] = [];
	vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
		calls.push({ url, headers: new Headers(init.headers), body: String(init.body ?? '') });
		return answer(url);
	});
	return calls;
}

describe('deauthorizeLine (LINE development guidelines: deauthorize on unregistering)', () => {
	const credentials = { clientId: '1234567890', clientSecret: 'channel-secret' };
	const channelToken = 'channel-token';
	const lineAnswers = (deauthorize: Response, token?: Response) => (url: string) =>
		url.endsWith('/oauth2/v3/token')
			? (token ?? Response.json({ access_token: channelToken, expires_in: 900 }))
			: deauthorize;

	it('issues a stateless channel access token, then deauthorizes with the Member’s token', async () => {
		const calls = stubFetch(lineAnswers(new Response(null, { status: 204 })));

		await deauthorizeLine('member-access-token', credentials);

		expect(calls).toHaveLength(2);
		const [issue, deauthorize] = calls;
		expect(issue.url).toBe('https://api.line.me/oauth2/v3/token');
		expect(Object.fromEntries(new URLSearchParams(issue.body))).toEqual({
			grant_type: 'client_credentials',
			client_id: '1234567890',
			client_secret: 'channel-secret'
		});
		expect(deauthorize.url).toBe('https://api.line.me/user/v1/deauthorize');
		expect(deauthorize.headers.get('authorization')).toBe(`Bearer ${channelToken}`);
		expect(JSON.parse(deauthorize.body)).toEqual({ userAccessToken: 'member-access-token' });
	});

	it('fails with the status and LINE’s request id only when LINE refuses, so the logged error holds no token', async () => {
		stubFetch(
			lineAnswers(
				Response.json(
					{ message: 'invalid token' },
					{ status: 400, headers: { 'x-line-request-id': 'req-123' } }
				)
			)
		);

		const error = await deauthorizeLine('member-access-token', credentials).catch((e) => e);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('LINE deauthorize answered 400 (x-line-request-id req-123)');
	});

	it('treats any non-2xx answer as a failure, not only the documented 400', async () => {
		stubFetch(lineAnswers(new Response(null, { status: 500 })));

		await expect(deauthorizeLine('member-access-token', credentials)).rejects.toThrow(
			'LINE deauthorize answered 500 (x-line-request-id none)'
		);
	});

	it('does not try to deauthorize when the channel access token cannot be issued', async () => {
		const calls = stubFetch(
			lineAnswers(
				new Response(null, { status: 204 }),
				Response.json({ error: 'invalid_request' }, { status: 400 })
			)
		);

		await expect(deauthorizeLine('member-access-token', credentials)).rejects.toThrow(
			'LINE channel access token answered 400'
		);
		expect(calls).toHaveLength(1);
	});

	it('does not call LINE without the channel ID and secret', async () => {
		const calls = stubFetch(lineAnswers(new Response(null, { status: 204 })));

		await expect(
			deauthorizeLine('member-access-token', { clientId: '', clientSecret: '' })
		).rejects.toThrow('not set');
		expect(calls).toEqual([]);
	});
});

describe('revokeGoogleToken (Sign in with Google best practices: revoke on account deletion)', () => {
	it('posts the token to Google’s revoke endpoint as a form request', async () => {
		const calls = stubFetch(() => new Response(null, { status: 200 }));

		await revokeGoogleToken('member-access-token');

		expect(calls).toHaveLength(1);
		const url = new URL(calls[0].url);
		expect(url.origin + url.pathname).toBe('https://oauth2.googleapis.com/revoke');
		expect(url.searchParams.get('token')).toBe('member-access-token');
		expect(calls[0].headers.get('content-type')).toBe('application/x-www-form-urlencoded');
	});

	it('fails with the status only when Google refuses, so the logged error holds no token', async () => {
		stubFetch(() => Response.json({ error: 'invalid_token' }, { status: 400 }));

		const error = await revokeGoogleToken('member-access-token').catch((e) => e);

		expect(error).toBeInstanceOf(ProviderCallError);
		expect(error.message).toBe('Google revoke answered 400');
	});
});
