import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
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
