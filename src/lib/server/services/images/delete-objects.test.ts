import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { deleteObjects } from './delete-objects';
import { memoryImageStore, type ImageStore } from './store';

const pair = (kind: string) => {
	const prefix = `${kind}/${randomUUID()}/`;
	return { list: `${prefix}list.webp`, detail: `${prefix}detail.webp` };
};
const seed = async (store: ImageStore, p: { list: string; detail: string }) => {
	await store.put(p.list, new Uint8Array([1]), 'image/webp');
	await store.put(p.detail, new Uint8Array([1]), 'image/webp');
};
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('deleteObjects', () => {
	it('deletes every key it is given', async () => {
		const store = memoryImageStore();
		const icon = pair('member');
		const photo = pair('recipe');
		await seed(store, icon);
		await seed(store, photo);
		await deleteObjects(() => store, [icon.list, icon.detail, photo.list, photo.detail]);
		expect(store.objects.size).toBe(0);
	});

	it('does not even build the store when there is nothing to delete', async () => {
		const build = vi.fn(() => memoryImageStore());
		await deleteObjects(build, []);
		expect(build).not.toHaveBeenCalled();
	});

	it('logs each key it could not delete (the only trace of the leftover object) and deletes the rest', async () => {
		const store = memoryImageStore();
		const photo = pair('recipe');
		await seed(store, photo);
		const reason = new Error('R2 unavailable');
		const flaky = {
			...store,
			delete: async (key: string) => {
				if (key === photo.list) throw reason;
				await store.delete(key);
			}
		};
		const log = quiet();
		try {
			await deleteObjects(() => flaky, [photo.list, photo.detail]);
			expect(log.mock.calls).toEqual([['photo cleanup failed', photo.list, reason]]);
			expect([...store.objects.keys()]).toEqual([photo.list]);
		} finally {
			log.mockRestore();
		}
	});

	it('logs every key, once per failure, when all deletes fail', async () => {
		const photo = pair('recipe');
		const down = {
			...memoryImageStore(),
			delete: async () => {
				throw new Error('R2 unavailable');
			}
		};
		const log = quiet();
		try {
			await deleteObjects(() => down, [photo.list, photo.detail]);
			expect(log.mock.calls.map((c) => c[1])).toEqual([photo.list, photo.detail]);
		} finally {
			log.mockRestore();
		}
	});

	it('never throws, and logs the keys it skipped, when the store cannot be built (R2_* unset)', async () => {
		const photo = pair('member');
		const log = quiet();
		try {
			await expect(
				deleteObjects(() => {
					throw new Error('no R2 env');
				}, [photo.list, photo.detail])
			).resolves.toBeUndefined();
			expect(log).toHaveBeenCalledWith(
				'photo cleanup failed',
				[photo.list, photo.detail],
				expect.any(Error)
			);
		} finally {
			log.mockRestore();
		}
	});
});
