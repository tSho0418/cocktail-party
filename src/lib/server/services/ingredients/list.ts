import { asc, sql } from 'drizzle-orm';
import type { Db } from '../recipes/recipes';
import { ingredient, recipeIngredient } from '../../db/schema';

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

/** The master with ABV and whether a Recipe uses it, for the administrator's screen (FR-076, #64). */
export const listIngredientsWithAbv = (db: Db): Promise<IngredientRow[]> =>
	db
		.select({
			id: ingredient.id,
			name: ingredient.name,
			isBaseSpirit: ingredient.isBaseSpirit,
			abvPercent: ingredient.abvPercent,
			inUse: sql<boolean>`exists (select 1 from ${recipeIngredient} where ${recipeIngredient.ingredientId} = ${ingredient.id})`
		})
		.from(ingredient)
		.orderBy(asc(ingredient.name));
