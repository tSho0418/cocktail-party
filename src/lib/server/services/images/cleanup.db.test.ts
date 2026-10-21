import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { member } from '#lib/server/db/schema.js';
import { deleteUnreferencedPhotos } from './cleanup';
import { memoryImageStore } from './store';

const pair = (kind: string) => {
	const prefix = `${kind}/${randomUUID()}/`;
	return { prefix, list: `${prefix}list.webp`, detail: `${prefix}detail.webp` };
};
const seed = async (store: ReturnType<typeof memoryImageStore>, p: ReturnType<typeof pair>) => {
	await store.put(p.list, new Uint8Array([1]), 'image/webp');
	await store.put(p.detail, new Uint8Array([1]), 'image/webp');
};

describe('deleteUnreferencedPhotos', () => {
	it('deletes both files of an unreferenced icon or Recipe photo given either key', async () => {
		const store = memoryImageStore();
		const icon = pair('member');
		const photo = pair('recipe');
		await seed(store, icon);
		await seed(store, photo);
		await deleteUnreferencedPhotos(() => store, [icon.list, photo.detail]);
		expect(store.objects.size).toBe(0);
	});

	it('keeps a pair a Member icon still uses, and ignores keys that are not storePhoto output', async () => {
		const store = memoryImageStore();
		const used = pair('member');
		await seed(store, used);
		await store.put('static/logo.png', new Uint8Array([1]), 'image/png');
		await db
			.insert(member)
			.values({ username: `clean_${randomUUID().slice(0, 8)}`, iconKey: used.list });
		await deleteUnreferencedPhotos(() => store, [used.detail, 'static/logo.png', '../x']);
		expect([...store.objects.keys()].sort()).toEqual(
			[used.detail, used.list, 'static/logo.png'].sort()
		);
	});

	it('never throws when the store cannot be built', async () => {
		const gone = pair('member');
		await expect(
			deleteUnreferencedPhotos(() => {
				throw new Error('no R2 env');
			}, [gone.list])
		).resolves.toBeUndefined();
	});
});

describe('deleteUnreferencedPhotos failures', () => {
	it('logs each key it could not delete (the only trace of the leftover object) and deletes the rest', async () => {
		const store = memoryImageStore();
		const photo = pair('recipe');
		await seed(store, photo);
		const flaky = {
			...store,
			delete: async (key: string) => {
				if (key === photo.list) throw new Error('R2 unavailable');
				await store.delete(key);
			}
		};
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await deleteUnreferencedPhotos(() => flaky, [photo.list]);
			expect(log.mock.calls.flat().join(' ')).toContain(photo.list);
			expect([...store.objects.keys()]).toEqual([photo.list]);
		} finally {
			log.mockRestore();
		}
	});

	it('logs the photos it skipped when the store cannot be built (R2_* unset)', async () => {
		const photo = pair('member');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await deleteUnreferencedPhotos(() => {
				throw new Error('no R2 env');
			}, [photo.list]);
			expect(log.mock.calls.flat().join(' ')).toContain(photo.prefix);
		} finally {
			log.mockRestore();
		}
	});
});
