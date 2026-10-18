import { describe, expect, it } from 'vitest';
import { jpegWithGps } from '#lib/server/services/images/test-fixtures.js';
import { createApp } from './app';
import { memoryImageStore } from '#lib/server/services/images/index.js';
import { seedMember } from './test-helpers';

describe('POST /api/photos behind the real guard', () => {
	const post = async (member: App.Locals['member']) => {
		const store = memoryImageStore();
		const res = await createApp({ store: () => store }).request(
			'/api/photos',
			{
				method: 'POST',
				body: new Uint8Array(await jpegWithGps()),
				headers: { 'content-type': 'application/octet-stream' }
			},
			{ locals: { member } }
		);
		return { res, store };
	};

	it('401 signed out, 403 without a Username', async () => {
		expect((await post(null)).res.status).toBe(401);
		expect((await post(await seedMember(null))).res.status).toBe(403);
	});

	it('201 and stores the derivatives for a Member', async () => {
		const { res, store } = await post(await seedMember('uploader'));
		expect(res.status).toBe(201);
		expect(store.objects.size).toBe(2);
	});
});
