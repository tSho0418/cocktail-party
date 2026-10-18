import { asc, inArray, sql } from 'drizzle-orm';
import { photoUpload, recipe, recipePhoto } from '#lib/server/db/schema.js';
import type { OwnerKind } from '#lib/server/services/images/index.js';
import type { Db } from './recipes';

// Photo keys are `<kind>/<uuid>/{list,detail}.webp` (storePhoto); the uuid identifies an upload.
const RECIPE_PHOTO_KEY =
	/^recipe\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(list|detail)\.webp$/;

/** The upload id of a Recipe photo key, or null when the key is not one storePhoto produces. */
export const recipePhotoId = (key: string) => RECIPE_PHOTO_KEY.exec(key)?.[1] ?? null;

const filesOf = (id: string) => [`recipe/${id}/list.webp`, `recipe/${id}/detail.webp`];

/** Records who uploaded a photo; POST /api/photos calls it once the derivatives are stored. */
export async function recordPhotoUpload(db: Db, memberId: string, kind: OwnerKind, id: string) {
	await db.insert(photoUpload).values({ id, memberId, kind });
}

/**
 * Locks the upload rows of `keys` (FOR UPDATE, in id order so two writers cannot deadlock) and
 * returns the distinct upload ids. Held until the transaction ends: a concurrent write that
 * attaches or releases the same photo waits here, so the reference check in
 * `releaseUnreferenced` and the removal of the upload row cannot interleave with it.
 */
export async function lockPhotos(tx: Db, keys: string[]) {
	const ids = [...new Set(keys.flatMap((k) => recipePhotoId(k) ?? []))];
	const rows =
		ids.length === 0
			? []
			: await tx
					.select({ id: photoUpload.id, memberId: photoUpload.memberId, kind: photoUpload.kind })
					.from(photoUpload)
					.where(inArray(photoUpload.id, ids))
					.orderBy(asc(photoUpload.id))
					.for('update');
	return {
		ids,
		/** Every key is a Recipe photo `memberId` uploaded (and has not been released). */
		ownedBy: (memberId: string, keys: string[]) =>
			keys.every((k) => {
				const row = rows.find((r) => r.id === recipePhotoId(k));
				return row?.memberId === memberId && row.kind === 'recipe';
			})
	};
}

/**
 * Of the (locked) upload ids, those no Recipe references any more: their upload rows are
 * deleted, so the photo can never be attached again, and their object keys returned for the
 * caller to delete from storage after commit. Run it after the Recipe write, in the same
 * transaction.
 */
export async function releaseUnreferenced(tx: Db, ids: string[]) {
	if (ids.length === 0) return [];
	const files = ids.flatMap(filesOf);
	const used = await tx.execute<{ key: string }>(sql`
		select ${recipe.mainPhotoKey} as key from ${recipe} where ${inArray(recipe.mainPhotoKey, files)}
		union select ${recipePhoto.photoKey} from ${recipePhoto} where ${inArray(recipePhoto.photoKey, files)}`);
	const usedIds = new Set(used.rows.map((r) => recipePhotoId(r.key)));
	const free = ids.filter((id) => !usedIds.has(id));
	if (free.length > 0) await tx.delete(photoUpload).where(inArray(photoUpload.id, free));
	return free.flatMap(filesOf);
}
