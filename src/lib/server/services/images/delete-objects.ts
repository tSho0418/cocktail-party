import type { ImageStore } from './store';

/**
 * Deletes the objects of photos that nothing can reference any more: their uploads were released
 * in a committed transaction (Recipe or icon writes, a deleted Recipe, the sweep) or went with a
 * withdrawn Member. Only the uploader can reference a photo, so no reference is checked here.
 * Best effort: the write is committed, so building the store (missing R2_* env) or any delete
 * failing is logged, never thrown. A leftover object has no row any more, so each failed key
 * is logged: that line is the only trace of it.
 */
export async function deleteObjects(store: () => ImageStore, keys: string[]) {
	if (keys.length === 0) return;
	try {
		const s = store();
		const results = await Promise.allSettled(keys.map((k) => s.delete(k)));
		results.forEach((r, i) => {
			if (r.status === 'rejected') console.error('photo cleanup failed', keys[i], r.reason);
		});
	} catch (e) {
		console.error('photo cleanup failed', keys, e);
	}
}
