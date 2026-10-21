import { asc } from 'drizzle-orm';
import type { Db } from '../recipes/recipes';
import { ingredient } from '../../db/schema';

export type IngredientOption = { id: string; name: string; isBaseSpirit: boolean };

/** The whole Ingredient master (a few hundred rows at most), for the search form's pickers. */
export const listIngredientOptions = (db: Db): Promise<IngredientOption[]> =>
	db
		.select({ id: ingredient.id, name: ingredient.name, isBaseSpirit: ingredient.isBaseSpirit })
		.from(ingredient)
		.orderBy(asc(ingredient.name));

export type IngredientRow = IngredientOption & { abvPercent: number };

/** The master with ABV, for the administrator's edit screen (FR-076). */
export const listIngredientsWithAbv = (db: Db): Promise<IngredientRow[]> =>
	db
		.select({
			id: ingredient.id,
			name: ingredient.name,
			isBaseSpirit: ingredient.isBaseSpirit,
			abvPercent: ingredient.abvPercent
		})
		.from(ingredient)
		.orderBy(asc(ingredient.name));
