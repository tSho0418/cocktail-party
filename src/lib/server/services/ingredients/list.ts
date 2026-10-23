import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../recipes/recipes';
import { ingredient, recipeIngredient } from '../../db/schema';
import { ingredientNameKey, ingredientNameKeySql } from './name';

export type IngredientOption = { id: string; name: string; isBaseSpirit: boolean };

/**
 * The whole Ingredient master, for the search form's pickers. It is finite because a Member may
 * register only so many 0% Ingredients (`ingredient-limits`): at most about 80 seeded plus
 * Members × that total.
 */
export const listIngredientOptions = (db: Db): Promise<IngredientOption[]> =>
	db
		.select({ id: ingredient.id, name: ingredient.name, isBaseSpirit: ingredient.isBaseSpirit })
		.from(ingredient)
		.orderBy(asc(ingredient.name));

export type IngredientRow = IngredientOption & { abvPercent: number; inUse: boolean };

/** How many 0% Ingredients `/admin` shows at once; the search (`?q=`) narrows the rest. */
export const ADMIN_ZERO_ABV_LIMIT = 50;

const rowColumns = {
	id: ingredient.id,
	name: ingredient.name,
	isBaseSpirit: ingredient.isBaseSpirit,
	abvPercent: ingredient.abvPercent,
	inUse: sql<boolean>`exists (select 1 from ${recipeIngredient} where ${recipeIngredient.ingredientId} = ${ingredient.id})`
};

/**
 * The master for the administrator's screen (FR-076, #64), with whether a Recipe uses each:
 * every alcoholic Ingredient (the Administrator's own, a bounded set), and the 0% ones, which
 * Members add, matching `q` (normalized like duplicate detection; blank = all) and cut to
 * `ADMIN_ZERO_ABV_LIMIT`; `zeroTotal` is how many match before the cut.
 */
export async function listIngredientsWithAbv(db: Db, q = '') {
	const key = ingredientNameKey(q);
	const zeroWhere = and(
		eq(ingredient.abvPercent, 0),
		key ? sql`strpos(${ingredientNameKeySql(ingredient.name)}, ${key}) > 0` : undefined
	);
	const [alcoholic, zero, [total]] = await Promise.all([
		db
			.select(rowColumns)
			.from(ingredient)
			.where(gt(ingredient.abvPercent, 0))
			.orderBy(asc(ingredient.name)),
		db
			.select(rowColumns)
			.from(ingredient)
			.where(zeroWhere)
			.orderBy(asc(ingredient.name))
			.limit(ADMIN_ZERO_ABV_LIMIT),
		db.select({ n: count() }).from(ingredient).where(zeroWhere)
	]);
	return { alcoholic, zero, zeroTotal: total.n };
}
