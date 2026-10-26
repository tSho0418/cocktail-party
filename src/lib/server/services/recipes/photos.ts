import { asc, inArray, sql } from 'drizzle-orm';
import { member, photoUpload, recipe, recipePhoto } from '#lib/server/db/schema.js';
import type { OwnerKind } from '#lib/server/services/images/index.js';
import type { Db } from './recipes';

// Photo keys are `<kind>/<uuid>/{list,detail}.webp` (storePhoto); the uuid identifies an upload.
const PHOTO_KEY =
	/^(recipe|member)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(list|detail)\.webp$/;

/** The upload id of a `kind` photo key, or null when the key is not one storePhoto produces for it. */
export function photoId(key: string, kind: OwnerKind) {
	const m = PHOTO_KEY.exec(key);
	return m?.[1] === kind ? m[2] : null;
}

const filesOf = (kind: OwnerKind, id: string) => [
	`${kind}/${id}/list.webp`,
	`${kind}/${id}/detail.webp`
];

/**
 * Both files of the photo a stored key names (`list` and `detail` are written together), or the key
 * alone when it has no such shape. A key with no `photo_upload` row (older than ADR 0006) is the
 * only record of its pair.
 */
export function photoFiles(key: string) {
	const m = PHOTO_KEY.exec(key);
	return m ? filesOf(m[1] as OwnerKind, m[2]) : [key];
}

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
export async function lockPhotos(tx: Db, kind: OwnerKind, keys: string[]) {
	const ids = [...new Set(keys.flatMap((k) => photoId(k, kind) ?? []))];
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
		/** Every key is a `kind` photo `memberId` uploaded (and has not been released). */
		ownedBy: (memberId: string, keys: string[]) =>
			keys.every((k) => {
				const row = rows.find((r) => r.id === photoId(k, kind));
				return row?.memberId === memberId && row.kind === kind;
			})
	};
}

/**
 * Of the (locked) upload ids of `kind`, those nothing references any more (no Recipe photo, or
 * no Member icon): their upload rows are deleted, so the photo can never be attached again, and
 * their object keys returned for the caller to delete from storage after commit. Run it after
 * the write, in the same transaction.
 */
export async function releaseUnreferenced(tx: Db, kind: OwnerKind, ids: string[]) {
	if (ids.length === 0) return [];
	const files = ids.flatMap((id) => filesOf(kind, id));
	const used =
		kind === 'recipe'
			? await tx.execute<{ key: string }>(sql`
		select ${recipe.mainPhotoKey} as key from ${recipe} where ${inArray(recipe.mainPhotoKey, files)}
		union select ${recipePhoto.photoKey} from ${recipePhoto} where ${inArray(recipePhoto.photoKey, files)}`)
			: await tx.execute<{ key: string }>(
					sql`select ${member.iconKey} as key from ${member} where ${inArray(member.iconKey, files)}`
				);
	const usedIds = new Set(used.rows.map((r) => photoId(r.key, kind)));
	const free = ids.filter((id) => !usedIds.has(id));
	if (free.length > 0) await tx.delete(photoUpload).where(inArray(photoUpload.id, free));
	return free.flatMap((id) => filesOf(kind, id));
}
