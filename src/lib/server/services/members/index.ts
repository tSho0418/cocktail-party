import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { member, recipe, recipePhoto, report } from '#lib/server/db/schema.js';

/** Same rule as the member_username_format CHECK (FR-053). */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

const UNIQUE_VIOLATION = '23505';

export type SetUsernameResult = { ok: true } | { ok: false; error: 'invalid' | 'taken' };

/** Sets or changes the Username (FR-052/053). Uniqueness ignores case, via the DB index. */
export async function setUsername(memberId: string, username: string): Promise<SetUsernameResult> {
	if (!USERNAME_PATTERN.test(username)) return { ok: false, error: 'invalid' };
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
 * account, Recipes, Photos, Likes, Saves and Follows; Reports it received or sent are kept with
 * the links nulled by their FKs. Returns the object-storage keys the caller must delete
 * afterwards (Main Photos, extra Photos, icon).
 */
export async function withdrawMember(actor: { id: string }): Promise<string[]> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ iconKey: member.iconKey })
			.from(member)
			.where(eq(member.id, actor.id))
			.for('update');
		if (!row) return [];

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

		// Reports already marked recipe_deleted keep that reason.
		await tx
			.update(report)
			.set({ targetState: 'member_withdrawn' })
			.where(and(eq(report.reportedMemberId, actor.id), eq(report.targetState, 'live')));
		await tx.delete(member).where(eq(member.id, actor.id));

		return [...recipes, ...extras].map((r) => r.key).concat(row.iconKey ?? []);
	});
}
