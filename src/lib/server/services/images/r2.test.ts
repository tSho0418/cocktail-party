// No R2 credentials in CI: these check request construction only, stopping before the network.
import { describe, expect, it } from 'vitest';
import { r2Client, r2ConfigFromEnv, r2ImageStore, type R2Config } from './r2';

type SentRequest = {
	method: string;
	hostname: string;
	path: string;
	headers: Record<string, string>;
};

const config: R2Config = {
	accountId: 'acct123',
	accessKeyId: 'AKID',
	secretAccessKey: 'SECRET',
	bucket: 'photos',
	publicBaseUrl: 'https://img.example.com/'
};

function capturingStore() {
	const requests: SentRequest[] = [];
	const client = r2Client(config);
	// Runs after signing and replaces the HTTP send.
	client.middlewareStack.add(
		() => async (args) => {
			requests.push(args.request as SentRequest);
			return { output: { $metadata: {} }, response: {} };
		},
		{ step: 'finalizeRequest', priority: 'low' }
	);
	return { store: r2ImageStore(config, client), requests };
}

describe('r2ImageStore', () => {
	it('PUTs the object to the account endpoint with type and cache headers, signed', async () => {
		const { store, requests } = capturingStore();
		await store.put('recipe/abc/list.webp', new Uint8Array([1, 2, 3]), 'image/webp');

		const [req] = requests;
		expect(req.method).toBe('PUT');
		expect(req.hostname).toBe('photos.acct123.r2.cloudflarestorage.com');
		expect(req.path).toBe('/recipe/abc/list.webp');
		expect(req.headers['content-type']).toBe('image/webp');
		expect(req.headers['cache-control']).toBe('public, max-age=3600');
		expect(req.headers['authorization']).toMatch(
			/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\//
		);
	});

	it('DELETEs by key', async () => {
		const { store, requests } = capturingStore();
		await store.delete('recipe/abc/detail.webp');
		expect(requests[0].method).toBe('DELETE');
		expect(requests[0].path).toBe('/recipe/abc/detail.webp');
	});

	it('builds public URLs without a double slash', () => {
		expect(r2ImageStore(config).publicUrl('member/x/list.webp')).toBe(
			'https://img.example.com/member/x/list.webp'
		);
	});
});

describe('r2ConfigFromEnv', () => {
	it('names every missing variable', () => {
		expect(() => r2ConfigFromEnv({ R2_BUCKET: 'b' })).toThrow(
			'Missing env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL'
		);
	});

	it('maps env to config', () => {
		expect(
			r2ConfigFromEnv({
				R2_ACCOUNT_ID: 'a',
				R2_ACCESS_KEY_ID: 'k',
				R2_SECRET_ACCESS_KEY: 's',
				R2_BUCKET: 'b',
				R2_PUBLIC_BASE_URL: 'u'
			})
		).toEqual({
			accountId: 'a',
			accessKeyId: 'k',
			secretAccessKey: 's',
			bucket: 'b',
			publicBaseUrl: 'u'
		});
	});
});
