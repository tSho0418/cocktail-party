import { and, asc, gt, lt } from 'drizzle-orm';
import { photoUpload } from '#lib/server/db/schema.js';
import { releaseUnreferenced } from '#lib/server/services/recipes/photos.js';
import type { Db } from '#lib/server/services/recipes/recipes.js';
import { deleteObjects } from './delete-objects';
import type { ImageStore } from './store';

/** How long an upload may sit unused: long enough for a Member to finish filling in a form. */
export const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

const BATCH = 100;

/**
 * Sweeps uploads older than `graceMs` that nothing references (no Recipe photo, no Member icon):
 * deletes their `photo_upload` rows, then both objects of each. Removes what the write paths of
 * ADR 0006 never see: photos uploaded and then abandoned, replaced in the form, or whose
 * publication failed (#17, #28).
 *
 * Each batch locks its upload rows (FOR UPDATE SKIP LOCKED, in id order, like `lockPhotos`) and
 * checks references again in the same transaction, so a Recipe or icon write that is attaching
 * a photo right now either holds the row (the sweep skips it until the next run) or finds it
 * gone and is rejected. Objects are deleted after commit, best effort (see `deleteObjects`).
 * Returns how many uploads were swept.
 */
export async function sweepUnusedUploads(
	db: Db,
	store: () => ImageStore,
	{ graceMs = UPLOAD_GRACE_MS, now = new Date() }: { graceMs?: number; now?: Date } = {}
) {
	const cutoff = new Date(now.getTime() - graceMs);
	let swept = 0;
	let after: string | null = null;
	for (;;) {
		const batch: { keys: string[]; last: string | null } = await db.transaction(async (tx) => {
			const rows = await tx
				.select({ id: photoUpload.id, kind: photoUpload.kind })
				.from(photoUpload)
				.where(
					and(lt(photoUpload.createdAt, cutoff), after ? gt(photoUpload.id, after) : undefined)
				)
				.orderBy(asc(photoUpload.id))
				.limit(BATCH)
				.for('update', { skipLocked: true });
			const idsOf = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.id);
			const keys = [
				...(await releaseUnreferenced(tx, 'recipe', idsOf('recipe'))),
				...(await releaseUnreferenced(tx, 'member', idsOf('member')))
			];
			return { keys, last: rows.length === BATCH ? rows[rows.length - 1].id : null };
		});
		await deleteObjects(store, batch.keys);
		swept += batch.keys.length / 2;
		if (!batch.last) return swept;
		after = batch.last;
	}
}
