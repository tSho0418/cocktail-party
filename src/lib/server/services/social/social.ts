import { and, eq, isNull, sql } from 'drizzle-orm';
import { follow, like, member, recipe, save } from '#lib/server/db/schema.js';
import { isUuid, likeCountOf, type Actor, type Db } from '#lib/server/services/recipes/index.js';

type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = <E extends string>(error: E) => ({ ok: false as const, error });

/** The Recipe, unless it is missing or its Member is suspended (FR-075). */
async function visibleRecipe(db: Db, recipeId: string) {
	if (!isUuid(recipeId)) return null;
	const [row] = await db
		.select({ id: recipe.id, memberId: recipe.memberId })
		.from(recipe)
		.innerJoin(member, eq(member.id, recipe.memberId))
		.where(and(eq(recipe.id, recipeId), isNull(member.suspendedAt)));
	return row ?? null;
}

async function recipeExists(db: Db, recipeId: string) {
	if (!isUuid(recipeId)) return false;
	const [row] = await db.select({ id: recipe.id }).from(recipe).where(eq(recipe.id, recipeId));
	return !!row;
}

const likeCount = async (db: Db, recipeId: string) =>
	(
		await db
			.select({ n: likeCountOf(recipe.id) })
			.from(recipe)
			.where(eq(recipe.id, recipeId))
	)[0]?.n ?? 0;

export type LikeError = 'suspended' | 'not_found' | 'own_recipe';

/** FR-055. Idempotent: liking twice leaves one Like. Not allowed on one's own Recipe. */
export async function likeRecipe(
	db: Db,
	actor: Actor,
	recipeId: string
): Promise<Result<{ liked: true; likeCount: number }, LikeError>> {
	if (actor.suspended) return fail('suspended');
	const target = await visibleRecipe(db, recipeId);
	if (!target) return fail('not_found');
	if (target.memberId === actor.memberId) return fail('own_recipe');
	await db.insert(like).values({ memberId: actor.memberId, recipeId }).onConflictDoNothing();
	return ok({ liked: true as const, likeCount: await likeCount(db, recipeId) });
}

/** Idempotent. A Like survives its Recipe's author being suspended, so unliking stays possible. */
export async function unlikeRecipe(
	db: Db,
	actor: Actor,
	recipeId: string
): Promise<Result<{ liked: false; likeCount: number }, 'suspended' | 'not_found'>> {
	if (actor.suspended) return fail('suspended');
	if (!(await recipeExists(db, recipeId))) return fail('not_found');
	await db.delete(like).where(and(eq(like.memberId, actor.memberId), eq(like.recipeId, recipeId)));
	return ok({ liked: false as const, likeCount: await likeCount(db, recipeId) });
}

/** FR-056. Idempotent. */
export async function saveRecipe(
	db: Db,
	actor: Actor,
	recipeId: string
): Promise<Result<{ saved: true }, 'suspended' | 'not_found'>> {
	if (actor.suspended) return fail('suspended');
	if (!(await visibleRecipe(db, recipeId))) return fail('not_found');
	await db.insert(save).values({ memberId: actor.memberId, recipeId }).onConflictDoNothing();
	return ok({ saved: true as const });
}

export async function unsaveRecipe(
	db: Db,
	actor: Actor,
	recipeId: string
): Promise<Result<{ saved: false }, 'suspended' | 'not_found'>> {
	if (actor.suspended) return fail('suspended');
	if (!(await recipeExists(db, recipeId))) return fail('not_found');
	await db.delete(save).where(and(eq(save.memberId, actor.memberId), eq(save.recipeId, recipeId)));
	return ok({ saved: false as const });
}

/**
 * Like count (public) and the viewer's own Like/Save state. Saves are private (FR-056), so
 * `saved` is only ever about the viewer. Null when the Recipe is missing or hidden.
 */
export async function getReactions(db: Db, recipeId: string, viewerId: string | null) {
	if (!(await visibleRecipe(db, recipeId))) return null;
	const [row] = await db
		.select({
			likeCount: likeCountOf(recipe.id),
			liked: viewerId
				? sql<boolean>`exists (select 1 from "like" l where l.recipe_id = recipe.id and l.member_id = ${viewerId})`
				: sql<boolean>`false`,
			saved: viewerId
				? sql<boolean>`exists (select 1 from save s where s.recipe_id = recipe.id and s.member_id = ${viewerId})`
				: sql<boolean>`false`
		})
		.from(recipe)
		.where(eq(recipe.id, recipeId));
	return row;
}

export type FollowError = 'suspended' | 'not_found' | 'self_follow';

async function followee(db: Db, username: string) {
	const [row] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(sql`lower(${member.username}) = lower(${username})`, isNull(member.suspendedAt)));
	return row ?? null;
}

/** FR-057. Idempotent; never oneself. `username` is matched case-insensitively (FR-053). */
export async function followMember(
	db: Db,
	actor: Actor,
	username: string
): Promise<Result<{ following: true }, FollowError>> {
	if (actor.suspended) return fail('suspended');
	const target = await followee(db, username);
	if (!target) return fail('not_found');
	if (target.id === actor.memberId) return fail('self_follow');
	await db
		.insert(follow)
		.values({ followerId: actor.memberId, followeeId: target.id })
		.onConflictDoNothing();
	return ok({ following: true as const });
}

export async function unfollowMember(
	db: Db,
	actor: Actor,
	username: string
): Promise<Result<{ following: false }, 'suspended' | 'not_found'>> {
	if (actor.suspended) return fail('suspended');
	const [target] = await db
		.select({ id: member.id })
		.from(member)
		.where(sql`lower(${member.username}) = lower(${username})`);
	if (!target) return fail('not_found');
	await db
		.delete(follow)
		.where(and(eq(follow.followerId, actor.memberId), eq(follow.followeeId, target.id)));
	return ok({ following: false as const });
}
