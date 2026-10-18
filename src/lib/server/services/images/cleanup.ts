import { inArray, sql } from 'drizzle-orm';
import { db as appDb } from '#lib/server/db/index.js';
import { member, recipe, recipePhoto } from '#lib/server/db/schema.js';
import type { ImageStore } from './store';

const PHOTO_KEY =
	/^((?:recipe|member)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)(?:list|detail)\.webp$/;

/**
 * Deletes the photo pairs behind `keys` (Recipe photos or Member icons) that nothing references
 * any more; for after a committed withdrawal or icon change. A pair (`list.webp` + `detail.webp`)
 * goes only when neither file is still used. Best effort: never throws, because the data change
 * it follows is already committed. Keys that are not storePhoto's output are ignored.
 */
export async function deleteUnreferencedPhotos(
	store: () => ImageStore,
	keys: string[],
	db: Pick<typeof appDb, 'execute'> = appDb
) {
	const prefixes = [...new Set(keys.flatMap((k) => PHOTO_KEY.exec(k)?.[1] ?? []))];
	if (prefixes.length === 0) return;
	try {
		const files = prefixes.flatMap((p) => [`${p}list.webp`, `${p}detail.webp`]);
		const used = await db.execute<{ key: string }>(sql`
			select ${recipe.mainPhotoKey} as key from ${recipe} where ${inArray(recipe.mainPhotoKey, files)}
			union select ${recipePhoto.photoKey} from ${recipePhoto} where ${inArray(recipePhoto.photoKey, files)}
			union select ${member.iconKey} from ${member} where ${inArray(member.iconKey, files)}`);
		const usedPrefixes = new Set(used.rows.map((r) => PHOTO_KEY.exec(r.key)?.[1]));
		const s = store();
		await Promise.allSettled(
			prefixes
				.filter((p) => !usedPrefixes.has(p))
				.flatMap((p) => [`${p}list.webp`, `${p}detail.webp`])
				.map((k) => s.delete(k))
		);
	} catch (e) {
		console.error('photo cleanup failed', e);
	}
}
