// Ingredient master (FR-010–015). Every write takes the acting Member explicitly; callers
// (load functions, Hono routes) resolve it from the session.
import { and, asc, count, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { db } from '../../db';
import { ingredient, recipe, recipeIngredient } from '../../db/schema';
import { isUuid, type Db } from '../recipes/recipes';
import { hasAtMostOneDecimal, recomputeDerived } from '#lib/domain/alcohol/index.js';
import {
	MAX_ZERO_ABV_INGREDIENTS_PER_DAY,
	MAX_ZERO_ABV_INGREDIENTS_TOTAL
} from '#lib/domain/ingredient-limits.js';
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
	| 'ingredient_daily_limit'
	| 'ingredient_total_limit'
	| 'in_use'
	| 'not_deletable'
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

/** Serialises one Member's Ingredient creates (and their withdrawal); taken before any other lock. */
export const lockIngredientQuota = (tx: Tx, memberId: string) =>
	tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext('ingredient_quota'), hashtext(${memberId}))`
	);

/**
 * Withdrawal (#64): `ingredient.created_by` goes null with the Member, which would reset their
 * limit for the next account and leave unused rows for ever. The 0% Ingredients they registered
 * are therefore locked (after the uploads, before the `member` row: README, Lock order) ...
 */
export async function lockRegisteredIngredients(tx: Tx, memberId: string): Promise<string[]> {
	const rows = await tx
		.select({ id: ingredient.id })
		.from(ingredient)
		.where(and(eq(ingredient.createdBy, memberId), eq(ingredient.abvPercent, 0)))
		.orderBy(asc(ingredient.id))
		.for('update');
	return rows.map((r) => r.id);
}

/** ... and, once the Member's Recipes are gone, deleted unless a Recipe of someone else uses them. */
export async function deleteUnusedIngredients(tx: Tx, ids: string[]) {
	if (ids.length === 0) return;
	await tx.delete(ingredient).where(
		and(
			inArray(ingredient.id, ids),
			notExists(
				tx
					.select({ one: sql`1` })
					.from(recipeIngredient)
					.where(eq(recipeIngredient.ingredientId, ingredient.id))
			)
		)
	);
}

/**
 * FR-012 lets a Member add 0% Ingredients unreviewed, so each Member may register only so many
 * (`#lib/domain/ingredient-limits`): counted from `created_by`, over the last 24 hours and in
 * total. Rows an Administrator deletes stop counting. Call it holding the Member's quota lock.
 */
async function overLimit(tx: Tx, memberId: string): Promise<IngredientError | null> {
	const [n] = await tx
		.select({
			total: count(),
			daily:
				sql<number>`count(*) filter (where ${ingredient.createdAt} > now() - interval '24 hours')`.mapWith(
					Number
				)
		})
		.from(ingredient)
		.where(eq(ingredient.createdBy, memberId));
	if (n.total >= MAX_ZERO_ABV_INGREDIENTS_TOTAL) return 'ingredient_total_limit';
	if (n.daily >= MAX_ZERO_ABV_INGREDIENTS_PER_DAY) return 'ingredient_daily_limit';
	return null;
}

/**
 * `limited` applies the Member limit above. The Member's quota lock is taken before the name
 * lock, always in this order, so two creates cannot wait for each other's.
 */
async function insertIngredient(
	actor: Actor,
	input: { name: string; abvPercent: number; isBaseSpirit: boolean },
	limited = false
): Promise<Result<Ingredient>> {
	const name = normalizeIngredientName(input.name);
	if (!name || [...name].length > MAX_NAME_LENGTH) return { ok: false, error: 'invalid_name' };
	const key = ingredientNameKey(name);

	return db.transaction(async (tx) => {
		// Serialise one Member's creates, so the limit cannot be passed by simultaneous requests.
		// The two-int form is a different lock space from the one-bigint name lock below.
		if (limited) await lockIngredientQuota(tx, actor.memberId);
		// Serialise creates of the same key: the DB's unique(name) only catches byte-equal names.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
		const similar = await suggestSimilar(name, 5, tx);
		if (similar.some((s) => ingredientNameKey(s.name) === key)) {
			return { ok: false, error: 'duplicate', similar };
		}
		// After the duplicate check: a Member at the limit still learns which Ingredient to pick.
		const over = limited ? await overLimit(tx, actor.memberId) : null;
		if (over) return { ok: false, error: over };
		const [row] = await tx
			.insert(ingredient)
			.values({ ...input, name, createdBy: actor.memberId })
			.returning();
		return { ok: true, value: row };
	});
}

/**
 * FR-012: any active Member may add a 0% Ingredient without approval, up to the limits in
 * `ingredient-limits` (#64). An Administrator is not limited: they are trusted and keep the
 * master, so a limit there would only get in the way of seeding it (their alcoholic Ingredients
 * would not count either).
 */
export async function createZeroAbvIngredient(
	actor: Actor,
	input: { name: string; abvPercent: number }
): Promise<Result<Ingredient>> {
	const denied = checkActor(actor, false);
	if (denied) return { ok: false, error: denied };
	if (input.abvPercent !== 0) return { ok: false, error: 'abv_not_zero' };
	return insertIngredient(
		actor,
		{ name: input.name, abvPercent: 0, isBaseSpirit: false },
		!actor.isAdministrator
	);
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
 * #64: an Administrator removes a 0% Ingredient that no Recipe uses (OOS-007 excludes merging, so
 * this is the only way to clean up junk). Alcoholic Ingredients are the Administrator's own
 * curated list and cannot be deleted here, which also leaves OOS-007 (editing beyond ABV) alone.
 *
 * Lock order (README): only an `ingredient` row, taken FOR UPDATE. `createRecipe`/`updateRecipe`
 * hold it FOR SHARE until they commit, so a Recipe being written that uses this Ingredient
 * makes us wait and then find it in use; one that starts after us waits for our DELETE and fails
 * with `unknown_ingredient`. The restrict foreign key is therefore never what stops us.
 * `conn` is the transaction to join (tests only); by default a new one.
 */
export async function deleteIngredient(
	actor: Actor,
	ingredientId: string,
	conn: Db = db
): Promise<Result<{ id: string }>> {
	const denied = checkActor(actor, true);
	if (denied) return { ok: false, error: denied };
	if (!isUuid(ingredientId)) return { ok: false, error: 'not_found' };

	return conn.transaction(async (tx): Promise<Result<{ id: string }>> => {
		const [row] = await tx
			.select({ abvPercent: ingredient.abvPercent })
			.from(ingredient)
			.where(eq(ingredient.id, ingredientId))
			.for('update');
		if (!row) return { ok: false, error: 'not_found' };
		if (row.abvPercent !== 0) return { ok: false, error: 'not_deletable' };
		const [used] = await tx
			.select({ recipeId: recipeIngredient.recipeId })
			.from(recipeIngredient)
			.where(eq(recipeIngredient.ingredientId, ingredientId))
			.limit(1);
		if (used) return { ok: false, error: 'in_use' };
		await tx.delete(ingredient).where(eq(ingredient.id, ingredientId));
		return { ok: true, value: { id: ingredientId } };
	});
}

type AbvChange = { ingredient: Ingredient; recomputed: number; discardedOverrides: string[] };

/**
 * FR-015, ADR 0004: change an Ingredient's ABV and, in the same transaction, recompute
 * auto_abv / has_alcohol / abv_override of every Recipe using it (an override outside the new
 * range is discarded). Nothing else on the Recipe changes, updated_at included.
 * Crossing 0% either way is allowed: is_alcoholic is generated and the recompute re-derives
 * has_alcohol. A Base Ingredient cannot go to 0% (Base implies alcoholic, FR-010) and its Base
 * flag is not editable (OOS-007).
 *
 * Lock order (README, #45): the Recipe rows, then the Ingredient row, as `updateRecipe` does
 * (it holds its Recipe while it share-locks the Ingredient). Once the Ingredient row is ours no
 * Recipe can start using it, so the Recipes read then are the ones to recompute. A Recipe whose
 * edit added the Ingredient and committed after the first lock is not among the rows held, and
 * locking it now would be out of order: `changeAbv` ends its transaction without writing, and
 * the next transaction holds that Recipe from the start. It repeats once for every such edit
 * that commits in that gap, so how often depends on the concurrent writers, not on a limit here.
 */
export async function updateIngredientAbv(
	actor: Actor,
	ingredientId: string,
	abvPercent: number
): Promise<Result<AbvChange>> {
	const denied = checkActor(actor, true);
	if (denied) return { ok: false, error: denied };
	if (!isValidAbv(abvPercent)) return { ok: false, error: 'invalid_abv' };
	if (!isUuid(ingredientId)) return { ok: false, error: 'not_found' };

	for (;;) {
		const result = await db.transaction((tx) => changeAbv(tx, ingredientId, abvPercent));
		if (result) return result;
	}
}

/** One transaction of `updateIngredientAbv`; null (nothing written) means start a new one. */
async function changeAbv(
	tx: Tx,
	ingredientId: string,
	abvPercent: number
): Promise<Result<AbvChange> | null> {
	// Lock affected Recipes in id order so concurrent ABV edits cannot deadlock.
	const recipesUsing = () =>
		tx
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
			.orderBy(asc(recipe.id));
	const held = new Set((await recipesUsing().for('update')).map((r) => r.id));

	const [current] = await tx
		.select()
		.from(ingredient)
		.where(eq(ingredient.id, ingredientId))
		.for('update');
	if (!current) return { ok: false, error: 'not_found' };
	if (current.isBaseSpirit && abvPercent === 0) {
		return { ok: false, error: 'base_requires_alcohol' };
	}

	const recipes = await recipesUsing();
	if (recipes.some((r) => !held.has(r.id))) return null;

	const [updated] = await tx
		.update(ingredient)
		.set({ abvPercent })
		.where(eq(ingredient.id, ingredientId))
		.returning();
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
}
