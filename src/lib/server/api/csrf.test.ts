import { describe, expect, it, vi } from 'vitest';
import { app } from './app';

// POST /api/photos takes a daily upload (services/quota) before it looks at the Content-Type; this
// unit test has no database, so the reservation is stubbed to succeed.
vi.mock('#lib/server/services/quota/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/services/quota/index.js')>()),
	reserveQuota: async () => 'use',
	pruneQuotaUse: async () => {}
}));

// What the browser can send without a CORS preflight: form encodings, text/plain, or no Content-Type.
// A Member is signed in, so a 403 can only come from the Origin check (#66).
const member = { id: 'm1', username: 'alice', isAdministrator: false };
const post = (
	headers: Record<string, string>,
	body: BodyInit | null = '{}',
	path = '/api/recipes'
) => app.request(path, { method: 'POST', headers, body }, { locals: { member } });

describe('CSRF on /api/*', () => {
	it.each([
		['text/plain', '{}'],
		['application/x-www-form-urlencoded', 'a=b'],
		['multipart/form-data; boundary=x', '--x--']
	])('rejects a cross-origin %s POST', async (type, body) => {
		const res = await post({ 'content-type': type, origin: 'https://evil.example' }, body);
		expect(res.status).toBe(403);
	});

	it('rejects a POST with no Content-Type and no Origin, and a cross-origin one', async () => {
		expect((await post({}, null)).status).toBe(403);
		expect((await post({ origin: 'https://evil.example' }, null)).status).toBe(403);
	});

	it('guards PUT and DELETE the same way', async () => {
		for (const method of ['PUT', 'DELETE'])
			expect(
				(
					await app.request(
						'/api/recipes/x/like',
						{ method, headers: { origin: 'https://evil.example' } },
						{ locals: { member } }
					)
				).status
			).toBe(403);
	});

	it('lets a same-origin request reach the route', async () => {
		// The route's own validation answers (400), not the CSRF check.
		const json = await post({ 'content-type': 'application/json', origin: 'http://localhost' });
		expect(json.status).toBe(400);
		const noBody = await app.request(
			'/api/recipes/x/like',
			{ method: 'PUT', headers: { origin: 'http://localhost' } },
			{ locals: { member } }
		);
		expect(noBody.status).not.toBe(403);
	});

	it('lets a browser fetch through on Sec-Fetch-Site alone', async () => {
		const res = await post({ 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' });
		expect(res.status).not.toBe(403);
	});

	it('still refuses a body that is not JSON, so a form-type request is never read as JSON', async () => {
		// Same origin passes the CSRF check; the JSON route then refuses the content type.
		const cases: Record<string, string>[] = [
			{ 'content-type': 'text/plain', origin: 'http://localhost' },
			{ origin: 'http://localhost' }
		];
		for (const headers of cases) expect((await post(headers, '{"title":"x"}')).status).toBe(400);
	});

	it('refuses a photo that is not exactly application/octet-stream', async () => {
		const sameOrigin = { origin: 'http://localhost' };
		expect(
			(await post({ ...sameOrigin, 'content-type': 'text/plain' }, 'x', '/api/photos')).status
		).toBe(415);
		expect(
			(
				await post(
					{ ...sameOrigin, 'content-type': 'application/octet-stream; charset=x' },
					'x',
					'/api/photos'
				)
			).status
		).toBe(415);
	});
});
