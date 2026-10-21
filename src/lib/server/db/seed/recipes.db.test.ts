import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryImageStore } from '../../services/images/store';
import { db } from '../index';
import { ingredient, recipe, recipeIngredient } from '../schema';
import { seedIngredients } from './ingredients';
import { seedRecipeList, seedRecipes } from './recipes';

describe('demo Recipe seed (DT-002)', () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	const store = memoryImageStore();

	beforeAll(async () => {
		await db.execute(sql`truncate member, ingredient cascade`);
		await seedIngredients(drizzle({ client: pool }));
	});
	afterAll(async () => {
		await db.execute(sql`truncate member, ingredient cascade`);
		await pool.end();
	});

	it('adds about 20 Recipes with a spread of Bases and ABV, at least 3 Non-alcoholic, once', async () => {
		expect(await seedRecipes(pool, store)).toBe(seedRecipeList.length);
		expect(await seedRecipes(pool, store)).toBe(0);

		const rows = await db.select().from(recipe);
		expect(rows.length).toBeGreaterThanOrEqual(18);
		expect(rows.length).toBeLessThanOrEqual(22);
		expect(rows.filter((r) => !r.hasAlcohol).length).toBeGreaterThanOrEqual(3);
		const abvs = rows.filter((r) => r.hasAlcohol).map((r) => r.autoAbv);
		expect(Math.max(...abvs) - Math.min(...abvs)).toBeGreaterThan(20);
		const bases = await db
			.selectDistinct({ id: ingredient.id })
			.from(recipeIngredient)
			.innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
			.where(eq(ingredient.isBaseSpirit, true));
		expect(bases.length).toBeGreaterThanOrEqual(6);
		// Each Recipe has its Main Photo stored (two derivatives per Recipe).
		expect(store.objects.size).toBe(rows.length * 2);
	});
});
