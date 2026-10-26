import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { member, photoUpload, recipe, recipePhoto, report } from '#lib/server/db/schema.js';
import { photoFiles } from '#lib/server/services/recipes/index.js';
import {
	deleteUnusedIngredients,
	lockIngredientQuota,
	lockRegisteredIngredients
} from '#lib/server/services/ingredients/index.js';

/** Same rule as the member_username_format CHECK (FR-053). */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Names that read as the operators or the service (impersonation of a public name, not a
 * privilege). Compared in lower case, like the case-insensitive uniqueness (FR-053). Members
 * who already hold one keep it; it only cannot be chosen again.
 */
const RESERVED_USERNAMES = new Set([
	'admin',
	'administrator',
	'support',
	'staff',
	'moderator',
	'mod',
	'official',
	'system',
	'root',
	'null',
	'undefined',
	'cocktail_party',
	'cocktailparty',
	'cocktail_party_official'
]);

export const isReservedUsername = (username: string) =>
	RESERVED_USERNAMES.has(username.toLowerCase());

const UNIQUE_VIOLATION = '23505';

export type SetUsernameResult =
	{ ok: true } | { ok: false; error: 'invalid' | 'reserved' | 'taken' };

/** Sets or changes the Username (FR-052/053). Uniqueness ignores case, via the DB index. */
export async function setUsername(memberId: string, username: string): Promise<SetUsernameResult> {
	if (!USERNAME_PATTERN.test(username)) return { ok: false, error: 'invalid' };
	if (isReservedUsername(username)) return { ok: false, error: 'reserved' };
	try {
		await db.update(member).set({ username }).where(eq(member.id, memberId));
		return { ok: true };
	} catch (e) {
		if ((e as { cause?: { code?: string } }).cause?.code === UNIQUE_VIOLATION)
			return { ok: false, error: 'taken' };
		throw e;
	}
}

/**
 * Withdrawal (FR-058, FR-078) in one transaction. Deleting the Member cascades to its sessions,
 * account, Recipes, Photos, uploads, Likes, Saves and Follows; Reports it received or sent are
 * kept with the links nulled by their FKs. Returns the object-storage keys the caller must
 * delete afterwards (Main Photos, extra Photos and icon, each as both of its files, and both files
 * of every upload, including ones no Recipe uses: their `photo_upload` rows go with the Member,
 * so this is the last time the keys are known).
 */
export async function withdrawMember(actor: { id: string }): Promise<string[]> {
	return db.transaction(async (tx) => {
		// Lock order: Recipes, then uploads (each by id), then the Member row (#40). Recipe writes
		// take the Recipe row before their upload rows (updateRecipe, deleteRecipe) and the upload
		// rows before the Member row's FOR KEY SHARE (createRecipe's INSERT); the cascade of the
		// DELETE below would otherwise take them in another order and could deadlock with those.
		// The Ingredient quota lock goes first (no Ingredient create is half-done), the 0% Ingredients
		// they registered are locked between the uploads and the Member row (#64).
		await lockIngredientQuota(tx, actor.id);
		await tx
			.select({ id: recipe.id })
			.from(recipe)
			.where(eq(recipe.memberId, actor.id))
			.orderBy(asc(recipe.id))
			.for('update');
		await tx
			.select({ id: photoUpload.id })
			.from(photoUpload)
			.where(eq(photoUpload.memberId, actor.id))
			.orderBy(asc(photoUpload.id))
			.for('update');
		const registered = await lockRegisteredIngredients(tx, actor.id);
		const [row] = await tx
			.select({ iconKey: member.iconKey })
			.from(member)
			.where(eq(member.id, actor.id))
			.for('update');
		if (!row) return [];

		// Read only now: with the Member row locked, nothing new can be added to their name.
		const recipes = await tx
			.select({ id: recipe.id, key: recipe.mainPhotoKey })
			.from(recipe)
			.where(eq(recipe.memberId, actor.id));
		const extras = recipes.length
			? await tx
					.select({ key: recipePhoto.photoKey })
					.from(recipePhoto)
					.where(
						inArray(
							recipePhoto.recipeId,
							recipes.map((r) => r.id)
						)
					)
			: [];
		const uploads = await tx
			.select({ id: photoUpload.id, kind: photoUpload.kind })
			.from(photoUpload)
			.where(eq(photoUpload.memberId, actor.id));

		// Reports already marked recipe_deleted keep that reason.
		await tx
			.update(report)
			.set({ targetState: 'member_withdrawn' })
			.where(and(eq(report.reportedMemberId, actor.id), eq(report.targetState, 'live')));
		await tx.delete(member).where(eq(member.id, actor.id));
		await deleteUnusedIngredients(tx, registered); // after the cascade took their Recipes

		return [
			...new Set([
				// A key with no upload row (older than ADR 0006) still leaves its other file behind (#48).
				...[...recipes, ...extras].flatMap((r) => photoFiles(r.key)),
				...(row.iconKey ? photoFiles(row.iconKey) : []),
				...uploads.flatMap((u) => [`${u.kind}/${u.id}/list.webp`, `${u.kind}/${u.id}/detail.webp`])
			])
		];
	});
}
