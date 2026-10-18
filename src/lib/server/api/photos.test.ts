import { describe, expect, it } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { app } from './app';
import { photosRoute } from './photos';
import { MAX_BYTES, memoryImageStore } from '#lib/server/services/images/index.js';
import { jpegWithGps } from '#lib/server/services/images/test-fixtures.js';

const allow: MiddlewareHandler = (_c, next) => next();

function setup(authorize: MiddlewareHandler = allow) {
	const store = memoryImageStore();
	const api = new Hono().route('/photos', photosRoute({ authorize, store: () => store }));
	const post = (body: BodyInit, headers: Record<string, string> = {}, query = '') =>
		api.request(`/photos${query}`, {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/octet-stream', ...headers }
		});
	return { store, post };
}

describe('POST /api/photos', () => {
	it('is mounted and denies by default (no auth wired yet)', async () => {
		const res = await app.request('/api/photos', {
			method: 'POST',
			body: new Uint8Array(await jpegWithGps()),
			headers: { 'content-type': 'application/octet-stream' }
		});
		expect(res.status).toBe(401);
	});

	it('stores the two derivatives and returns their keys', async () => {
		const { store, post } = setup();
		const res = await post(new Uint8Array(await jpegWithGps()), {}, '?kind=member');
		expect(res.status).toBe(201);
		const { keys } = await res.json();
		expect(keys.list).toMatch(/^member\/.+\/list\.webp$/);
		expect([...store.objects.keys()].sort()).toEqual([keys.detail, keys.list]);
	});

	it('runs authorize before reading the body', async () => {
		const { store, post } = setup(async (c) => c.json({ error: 'nope' }, 403));
		expect((await post(new Uint8Array(await jpegWithGps()))).status).toBe(403);
		expect(store.objects.size).toBe(0);
	});

	it('rejects an oversized Content-Length with 413', async () => {
		const { post } = setup();
		const res = await post(new Uint8Array(MAX_BYTES + 1), {
			'content-length': String(MAX_BYTES + 1)
		});
		expect(res.status).toBe(413);
	});

	it('rejects non-octet-stream, unknown kind and non-images', async () => {
		const { post, store } = setup();
		const jpeg = new Uint8Array(await jpegWithGps());
		expect((await post(jpeg, { 'content-type': 'multipart/form-data; boundary=x' })).status).toBe(
			415
		);
		expect((await post(jpeg, {}, '?kind=admin')).status).toBe(400);
		const res = await post(new TextEncoder().encode('<?php echo 1; ?>'));
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({ error: 'unsupported_format' });
		expect(store.objects.size).toBe(0);
	});
});
