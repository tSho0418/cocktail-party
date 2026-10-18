import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from './index';
import { ingredient, member, recipe, recipeIngredient } from './schema';

/** Postgres SQLSTATE of a failed query (drizzle wraps the pg error in `cause`). */
async function pgErrorCode(query: Promise<unknown>) {
	try {
		await query;
	} catch (e) {
		return ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
	}
	throw new Error('expected the query to fail');
}

describe('schema constraints', () => {
	let recipeId: string;
	let ginId: string;

	beforeAll(async () => {
		const [m] = await db
			.insert(member)
			.values({ provider: 'google', providerAccountId: 'g-1', username: 'tester' })
			.returning();
		const [gin] = await db
			.insert(ingredient)
			.values({ name: 'ジン', abvPercent: 40, isBaseSpirit: true })
			.returning();
		const [r] = await db
			.insert(recipe)
			.values({
				memberId: m.id,
				title: 'マティーニ',
				mainPhotoKey: 'photos/test',
				autoAbv: 40,
				hasAlcohol: true,
				searchText: 'マティーニ ジン ドライ・ベルモット'
			})
			.returning();
		ginId = gin.id;
		recipeId = r.id;
		await db
			.insert(recipeIngredient)
			.values({ recipeId, ingredientId: ginId, mixRatio: 4.5, position: 1 });
	});

	it('derives ingredient.is_alcoholic from abv_percent', async () => {
		const [row] = await db.select().from(ingredient);
		expect(row.isAlcoholic).toBe(true);
	});

	it('rejects mix_ratio outside 0.1..99.9', async () => {
		const [vermouth] = await db
			.insert(ingredient)
			.values({ name: 'ドライ・ベルモット', abvPercent: 18 })
			.returning();
		const insert = (mixRatio: number) =>
			db
				.insert(recipeIngredient)
				.values({ recipeId, ingredientId: vermouth.id, mixRatio, position: 2 });
		expect(await pgErrorCode(insert(0))).toBe('23514'); // check_violation
		// 100 overflows numeric(3,1) before the CHECK runs.
		expect(await pgErrorCode(insert(100))).toBe('22003'); // numeric_value_out_of_range
	});

	it('rejects the same Ingredient twice in one Recipe', async () => {
		const duplicate = db
			.insert(recipeIngredient)
			.values({ recipeId, ingredientId: ginId, mixRatio: 1, position: 3 });
		expect(await pgErrorCode(duplicate)).toBe('23505'); // unique_violation
	});

	it('finds search_text via the pg_trgm GIN index', async () => {
		await db.transaction(async (tx) => {
			await tx.execute(sql`SET LOCAL enable_seqscan = off`);
			const plan = await tx.execute(
				sql`EXPLAIN SELECT id FROM recipe WHERE search_text ILIKE '%マティーニ%'`
			);
			expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
				'recipe_search_text_trgm_idx'
			);
			const found = await tx.execute(
				sql`SELECT id FROM recipe WHERE search_text ILIKE '%マティーニ%'`
			);
			expect(found.rows).toEqual([{ id: recipeId }]);
		});
	});
});
