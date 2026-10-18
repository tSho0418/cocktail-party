import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { storePhoto } from './store-photo';
import { memoryImageStore, type ImageStore } from './store';
import { jpegWithGps } from './test-fixtures';

function spyStore() {
	const inner = memoryImageStore();
	const puts: { key: string; data: Uint8Array; contentType: string }[] = [];
	const store: ImageStore = {
		...inner,
		async put(key, data, contentType) {
			puts.push({ key, data, contentType });
			await inner.put(key, data, contentType);
		}
	};
	return { store, puts, objects: inner.objects };
}

describe('storePhoto', () => {
	it('puts only the two WebP derivatives, never the original bytes (ADR 0003)', async () => {
		const original = await jpegWithGps({ orientation: 6 });
		const { store, puts } = spyStore();

		const result = await storePhoto(store, original, 'recipe');

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.keys.list).toMatch(/^recipe\/[0-9a-f-]{36}\/list\.webp$/);
		expect(result.keys.detail).toBe(result.keys.list.replace('list.webp', 'detail.webp'));
		expect(puts.map((p) => p.key).sort()).toEqual([result.keys.detail, result.keys.list]);
		for (const p of puts) {
			expect(p.contentType).toBe('image/webp');
			expect(Buffer.compare(Buffer.from(p.data), original)).not.toBe(0);
			expect((await sharp(p.data).metadata()).format).toBe('webp');
		}
	});

	it('stores nothing for rejected input', async () => {
		const { store, puts } = spyStore();
		expect(await storePhoto(store, Buffer.from('hello'), 'member')).toEqual({
			ok: false,
			error: 'unsupported_format'
		});
		expect(puts).toEqual([]);
	});

	it('removes the stored half when a put fails', async () => {
		const { store, objects } = spyStore();
		const failing: ImageStore = {
			...store,
			put: (key, data, type) =>
				key.endsWith('detail.webp')
					? Promise.reject(new Error('R2 down'))
					: store.put(key, data, type)
		};
		await expect(storePhoto(failing, await jpegWithGps(), 'recipe')).rejects.toThrow('R2 down');
		expect(objects.size).toBe(0);
	});
});
