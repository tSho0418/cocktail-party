import { processUpload, type ProcessError } from './process';
import type { ImageStore } from './store';

/** Recipe photos and Member icons (FR-032) share the same path. */
export type OwnerKind = 'recipe' | 'member';

export type PhotoKeys = { list: string; detail: string };

export type StorePhotoResult =
	{ ok: true; id: string; keys: PhotoKeys } | { ok: false; error: ProcessError };

/** Re-encodes and stores only the two derivatives; the original bytes are never written (ADR 0003). */
export async function storePhoto(
	store: ImageStore,
	bytes: Uint8Array,
	ownerKind: OwnerKind
): Promise<StorePhotoResult> {
	const processed = await processUpload(bytes);
	if (!processed.ok) return processed;

	const id = crypto.randomUUID();
	const keys = { list: `${ownerKind}/${id}/list.webp`, detail: `${ownerKind}/${id}/detail.webp` };
	try {
		await Promise.all([
			store.put(keys.list, processed.list.data, 'image/webp'),
			store.put(keys.detail, processed.detail.data, 'image/webp')
		]);
	} catch (e) {
		// Don't leave half a photo behind.
		await Promise.allSettled([store.delete(keys.list), store.delete(keys.detail)]);
		throw e;
	}
	return { ok: true, id, keys };
}
