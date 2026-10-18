import { describe, expect, it } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { app } from './app';
import { denyAll, photosRoute } from './photos';
import { MAX_BYTES, memoryImageStore } from '#lib/server/services/images/index.js';
import { jpegWithGps } from '#lib/server/services/images/test-fixtures.js';

const allow: MiddlewareHandler = (_c, next) => next();

function setup(authorize: MiddlewareHandler = allow) {
	const store = memoryImageStore();
	const recorded: { memberId: string; kind: string; id: string }[] = [];
	let failRecord = false;
	const record = async (memberId: string, kind: string, id: string) => {
		if (failRecord) throw new Error('db down');
		recorded.push({ memberId, kind, id });
	};
	const api = new Hono().route('/photos', photosRoute({ authorize, store: () => store, record }));
	const member = { id: 'member-1', username: 'm', isAdministrator: false };
	const post = (body: BodyInit, headers: Record<string, string> = {}, query = '') =>
		api.request(
			`/photos${query}`,
			{
				method: 'POST',
				body,
				...({ duplex: 'half' } as RequestInit), // undici needs it for a stream body; not in the DOM type
				headers: { 'content-type': 'application/octet-stream', ...headers }
			},
			{ locals: { member } }
		);
	return {
		store,
		post,
		recorded,
		failRecording: () => {
			failRecord = true;
		}
	};
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
		const { store, post, recorded } = setup();
		const res = await post(new Uint8Array(await jpegWithGps()), {}, '?kind=member');
		expect(res.status).toBe(201);
		const { keys } = await res.json();
		expect(keys.list).toMatch(/^member\/.+\/list\.webp$/);
		expect([...store.objects.keys()].sort()).toEqual([keys.detail, keys.list]);
		// Recorded against the signed-in Member, so only they can attach it to a Recipe.
		expect(recorded).toEqual([
			{ memberId: 'member-1', kind: 'member', id: keys.list.split('/')[1] }
		]);
	});

	it('removes the objects again when the upload cannot be recorded', async () => {
		const { store, post, failRecording } = setup();
		failRecording();
		await expect(post(new Uint8Array(await jpegWithGps()))).resolves.toMatchObject({ status: 500 });
		expect(store.objects.size).toBe(0);
	});

	it('runs authorize before reading the body', async () => {
		const { store, post } = setup(async (c) => c.json({ error: 'nope' }, 403));
		expect((await post(new Uint8Array(await jpegWithGps()))).status).toBe(403);
		expect(store.objects.size).toBe(0);
	});

	it('denies a chunked body (no Content-Length) without reading a single chunk', async () => {
		// With a Content-Length bodyLimit never reads, so only a length-less stream shows the order.
		let pulls = 0;
		// highWaterMark 0: the stream itself never pulls ahead, so every pull is a read by the server.
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					if (++pulls > 3) controller.close();
					else controller.enqueue(new Uint8Array(1024));
				}
			},
			{ highWaterMark: 0 }
		);
		const { post } = setup(denyAll);
		const res = await post(body);
		expect(res.status).toBe(401);
		await new Promise((r) => setTimeout(r, 10)); // let any background reader run
		expect(pulls).toBe(0);
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
