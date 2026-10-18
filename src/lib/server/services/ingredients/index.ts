// Ingredient master (FR-010–015). Every write takes the acting Member explicitly; callers
// (load functions, Hono routes) resolve it from the session.
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { ingredient, recipe, recipeIngredient } from '../../db/schema';
import { hasAtMostOneDecimal, recomputeDerived } from '#lib/domain/alcohol/index.js';
import {
	MAX_NAME_LENGTH,
	ingredientNameKey,
	ingredientNameKeySql,
	normalizeIngredientName
} from './name';

export { ingredientNameKey, normalizeIngredientName } from './name';

export type Actor = { memberId: string; isAdministrator: boolean; suspended?: boolean };
export type Ingredient = typeof ingredient.$inferSelect;
export type Suggestion = Pick<Ingredient, 'id' | 'name' | 'abvPercent' | 'isBaseSpirit'> & {
	score: number;
};
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type IngredientError =
	| 'suspended'
	| 'forbidden'
	| 'invalid_name'
	| 'invalid_abv'
	| 'abv_not_zero'
	| 'base_requires_alcohol'
	| 'duplicate'
	| 'not_found';
type Result<T> =
	{ ok: true; value: T } | { ok: false; error: IngredientError; similar?: Suggestion[] };

/** Below this pg_trgm similarity a name is not suggested (unless one name contains the other). */
const SIMILARITY_THRESHOLD = 0.2;
const nameKey = ingredientNameKeySql(ingredient.name);

/**
 * FR-014: existing Ingredients resembling `name`, best first: an exact (normalized) match, then
 * pg_trgm similarity. Containment also counts, since short Japanese names (ジン) share few trigrams.
 */
export async function suggestSimilar(name: string, limit = 5, tx: Tx | typeof db = db) {
	const q = ingredientNameKey(name);
	if (!q) return [];
	const score = sql<number>`similarity(${nameKey}, ${q})`;
	return tx
		.select({
			id: ingredient.id,
			name: ingredient.name,
			abvPercent: ingredient.abvPercent,
			isBaseSpirit: ingredient.isBaseSpirit,
			score
		})
		.from(ingredient)
		.where(
			sql`${score} > ${SIMILARITY_THRESHOLD} OR strpos(${nameKey}, ${q}) > 0 OR strpos(${q}, ${nameKey}) > 0`
		)
		.orderBy(desc(sql`${nameKey} = ${q}`), desc(score), asc(ingredient.name))
		.limit(limit);
}

const isValidAbv = (abv: number) =>
	Number.isFinite(abv) && abv >= 0 && abv <= 100 && hasAtMostOneDecimal(abv);

function checkActor(actor: Actor, adminOnly: boolean): IngredientError | null {
	if (actor.suspended) return 'suspended';
	if (adminOnly && !actor.isAdministrator) return 'forbidden';
	return null;
}

async function insertIngredient(
	actor: Actor,
	input: { name: string; abvPercent: number; isBaseSpirit: boolean }
): Promise<Result<Ingredient>> {
	const name = normalizeIngredientName(input.name);
	if (!name || [...name].length > MAX_NAME_LENGTH) return { ok: false, error: 'invalid_name' };
	const key = ingredientNameKey(name);

	return db.transaction(async (tx) => {
		// Serialise creates of the same key: the DB's unique(name) only catches byte-equal names.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
		const similar = await suggestSimilar(name, 5, tx);
		if (similar.some((s) => ingredientNameKey(s.name) === key)) {
			return { ok: false, error: 'duplicate', similar };
		}
		const [row] = await tx
			.insert(ingredient)
			.values({ ...input, name, createdBy: actor.memberId })
			.returning();
		return { ok: true, value: row };
	});
}

/** FR-012: any active Member may add a 0% Ingredient without approval. */
export async function createZeroAbvIngredient(
	actor: Actor,
	input: { name: string; abvPercent: number }
): Promise<Result<Ingredient>> {
	const denied = checkActor(actor, false);
	if (denied) return { ok: false, error: denied };
	if (input.abvPercent !== 0) return { ok: false, error: 'abv_not_zero' };
	return insertIngredient(actor, { name: input.name, abvPercent: 0, isBaseSpirit: false });
}

/** FR-013, FR-076: only an Administrator adds alcoholic Ingredients. */
export async function createAlcoholicIngredient(
	actor: Actor,
	input: { name: string; abvPercent: number; isBaseSpirit?: boolean }
): Promise<Result<Ingredient>> {
	const denied = checkActor(actor, true);
	if (denied) return { ok: false, error: denied };
	if (!isValidAbv(input.abvPercent) || input.abvPercent === 0) {
		return { ok: false, error: 'invalid_abv' };
	}
	return insertIngredient(actor, {
		name: input.name,
		abvPercent: input.abvPercent,
		isBaseSpirit: input.isBaseSpirit ?? false
	});
}

/**
 * FR-015, ADR 0004: change an Ingredient's ABV and, in the same transaction, recompute
 * auto_abv / has_alcohol / abv_override of every Recipe using it (an override outside the new
 * range is discarded). Nothing else on the Recipe changes, updated_at included.
 * Crossing 0% either way is allowed: is_alcoholic is generated and the recompute re-derives
 * has_alcohol. A Base Ingredient cannot go to 0% (Base implies alcoholic, FR-010) and its Base
 * flag is not editable (OOS-007).
 */
export async function updateIngredientAbv(
	actor: Actor,
	ingredientId: string,
	abvPercent: number
): Promise<Result<{ ingredient: Ingredient; recomputed: number; discardedOverrides: string[] }>> {
	const denied = checkActor(actor, true);
	if (denied) return { ok: false, error: denied };
	if (!isValidAbv(abvPercent)) return { ok: false, error: 'invalid_abv' };

	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(ingredient)
			.where(eq(ingredient.id, ingredientId))
			.for('update');
		if (!current) return { ok: false, error: 'not_found' };
		if (current.isBaseSpirit && abvPercent === 0) {
			return { ok: false, error: 'base_requires_alcohol' };
		}

		const [updated] = await tx
			.update(ingredient)
			.set({ abvPercent })
			.where(eq(ingredient.id, ingredientId))
			.returning();

		// Lock affected Recipes in id order so concurrent ABV edits cannot deadlock.
		const recipes = await tx
			.select({ id: recipe.id, abvOverride: recipe.abvOverride })
			.from(recipe)
			.where(
				inArray(
					recipe.id,
					tx
						.select({ id: recipeIngredient.recipeId })
						.from(recipeIngredient)
						.where(eq(recipeIngredient.ingredientId, ingredientId))
				)
			)
			.orderBy(asc(recipe.id))
			.for('update');
		if (recipes.length === 0) {
			return { ok: true, value: { ingredient: updated, recomputed: 0, discardedOverrides: [] } };
		}

		const items = await tx
			.select({
				recipeId: recipeIngredient.recipeId,
				id: recipeIngredient.ingredientId,
				mixRatio: recipeIngredient.mixRatio,
				abvPercent: ingredient.abvPercent,
				isBaseSpirit: ingredient.isBaseSpirit
			})
			.from(recipeIngredient)
			.innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
			.where(
				inArray(
					recipeIngredient.recipeId,
					recipes.map((r) => r.id)
				)
			);

		const discardedOverrides: string[] = [];
		for (const r of recipes) {
			const derived = recomputeDerived(
				items.filter((i) => i.recipeId === r.id),
				r.abvOverride
			);
			if (derived.overrideDiscarded) discardedOverrides.push(r.id);
			await tx
				.update(recipe)
				.set({
					autoAbv: derived.autoAbv,
					hasAlcohol: derived.hasAlcohol,
					abvOverride: derived.abvOverride,
					updatedAt: sql`${recipe.updatedAt}` // not an author edit; keep it (and skip $onUpdate)
				})
				.where(eq(recipe.id, r.id));
		}
		return {
			ok: true,
			value: { ingredient: updated, recomputed: recipes.length, discardedOverrides }
		};
	});
}
