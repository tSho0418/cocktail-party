import type { ImageStore } from './store';

/**
 * Deletes the objects of photos whose uploads were released in a committed transaction (nothing
 * can reference them any more). Best effort: the write is committed, so building the store
 * (missing R2_* env) or any delete failing is logged, never thrown.
 */
export async function deleteObjects(store: () => ImageStore, keys: string[]) {
	if (keys.length === 0) return;
	try {
		const s = store();
		const results = await Promise.allSettled(keys.map((k) => s.delete(k)));
		for (const r of results)
			if (r.status === 'rejected') console.error('photo cleanup failed', r.reason);
	} catch (e) {
		console.error('photo cleanup failed', e);
	}
}
