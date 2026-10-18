import { randomUUID } from 'node:crypto';
import { count, eq, gt, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { ingredient, member, recipe, recipeIngredient } from '../../db/schema';
import { seedIngredients } from '../../db/seed/ingredients';
import {
	createAlcoholicIngredient,
	createZeroAbvIngredient,
	suggestSimilar,
	updateIngredientAbv,
	type Actor
} from '.';

let admin: Actor;
let memberActor: Actor;

beforeAll(async () => {
	const [a, m] = await db
		.insert(member)
		.values([
			{ provider: 'google', providerAccountId: `ing-admin-${randomUUID()}`, isAdministrator: true },
			{ provider: 'line', providerAccountId: `ing-member-${randomUUID()}` }
		])
		.returning();
	admin = { memberId: a.id, isAdministrator: true };
	memberActor = { memberId: m.id, isAdministrator: false };
});

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => {
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

describe('createZeroAbvIngredient', () => {
	it('lets a Member add a 0% Ingredient, stored normalized', async () => {
		const row = unwrap(
			await createZeroAbvIngredient(memberActor, { name: '  ﾃｽﾄﾄﾆｯｸ ', abvPercent: 0 })
		);
		expect(row).toMatchObject({ name: 'テストトニック', abvPercent: 0, isAlcoholic: false });
		expect(row.createdBy).toBe(memberActor.memberId);
	});

	it('detects duplicates across 全角/半角 and case, returning the candidates', async () => {
		unwrap(await createZeroAbvIngredient(memberActor, { name: 'Test Syrup', abvPercent: 0 }));
		for (const name of ['ｔｅｓｔ　ｓｙｒｕｐ', 'TEST SYRUP', 'テストトニック']) {
			const r = await createZeroAbvIngredient(memberActor, { name, abvPercent: 0 });
			expect(r, name).toMatchObject({ ok: false, error: 'duplicate' });
			expect(r.ok === false && r.similar?.[0].name).toBeTruthy();
		}
	});

	it('rejects a non-zero ABV and blank names', async () => {
		expect(await createZeroAbvIngredient(memberActor, { name: '謎の酒', abvPercent: 5 })).toEqual({
			ok: false,
			error: 'abv_not_zero'
		});
		expect(await createZeroAbvIngredient(memberActor, { name: '　', abvPercent: 0 })).toEqual({
			ok: false,
			error: 'invalid_name'
		});
	});

	it('rejects a suspended Member', async () => {
		const suspended = { ...memberActor, suspended: true };
		expect(await createZeroAbvIngredient(suspended, { name: '停止中', abvPercent: 0 })).toEqual({
			ok: false,
			error: 'suspended'
		});
	});
});

describe('createAlcoholicIngredient', () => {
	it('is Administrator-only', async () => {
		expect(
			await createAlcoholicIngredient(memberActor, { name: 'テスト酒', abvPercent: 40 })
		).toEqual({ ok: false, error: 'forbidden' });
	});

	it('requires 0 < ABV <= 100 with one decimal', async () => {
		for (const abvPercent of [0, 40.25, 100.1, NaN]) {
			expect(
				await createAlcoholicIngredient(admin, { name: 'テスト酒', abvPercent }),
				String(abvPercent)
			).toEqual({ ok: false, error: 'invalid_abv' });
		}
	});

	it('creates a Base spirit', async () => {
		const row = unwrap(
			await createAlcoholicIngredient(admin, {
				name: 'テストジン',
				abvPercent: 47.3,
				isBaseSpirit: true
			})
		);
		expect(row).toMatchObject({ abvPercent: 47.3, isBaseSpirit: true, isAlcoholic: true });
	});
});

describe('suggestSimilar', () => {
	it('ranks the normalized exact match first and finds containing names', async () => {
		unwrap(await createAlcoholicIngredient(admin, { name: 'サジェスト・ラム', abvPercent: 40 }));
		const exact = await suggestSimilar('ｻｼﾞｪｽﾄ・ﾗﾑ');
		expect(exact[0].name).toBe('サジェスト・ラム');
		const partial = await suggestSimilar('サジェスト');
		expect(partial.map((s) => s.name)).toContain('サジェスト・ラム');
		expect(await suggestSimilar('  ')).toEqual([]);
	});
});

describe('updateIngredientAbv', () => {
	async function insertRecipe(
		items: { id: string; mixRatio: number }[],
		autoAbv: number,
		abvOverride: number | null
	) {
		const [r] = await db
			.insert(recipe)
			.values({
				memberId: memberActor.memberId,
				title: 'ABV テスト',
				mainPhotoKey: 'p',
				autoAbv,
				hasAlcohol: true,
				abvOverride,
				updatedAt: new Date('2026-01-01T00:00:00Z')
			})
			.returning();
		await db.insert(recipeIngredient).values(
			items.map((i, n) => ({
				recipeId: r.id,
				ingredientId: i.id,
				mixRatio: i.mixRatio,
				position: n + 1
			}))
		);
		return r.id;
	}
	const load = async (id: string) => (await db.select().from(recipe).where(eq(recipe.id, id)))[0];

	it('recomputes every Recipe, keeping in-range overrides and discarding the rest', async () => {
		const spirit = unwrap(
			await createAlcoholicIngredient(admin, { name: '再計算リキュール', abvPercent: 40 })
		);
		const mixer = unwrap(
			await createZeroAbvIngredient(memberActor, { name: '再計算ソーダ', abvPercent: 0 })
		);
		const halfAndHalf = await insertRecipe(
			[
				{ id: spirit.id, mixRatio: 1 },
				{ id: mixer.id, mixRatio: 1 }
			],
			20,
			18
		);
		const neat = await insertRecipe([{ id: spirit.id, mixRatio: 1 }], 40, 35);

		const r = unwrap(await updateIngredientAbv(admin, spirit.id, 20));
		expect(r).toMatchObject({ recomputed: 2, discardedOverrides: [neat] });
		expect(r.ingredient.abvPercent).toBe(20);
		expect(await load(halfAndHalf)).toMatchObject({
			autoAbv: 10,
			hasAlcohol: true,
			abvOverride: 18
		});
		const neatRow = await load(neat);
		expect(neatRow).toMatchObject({ autoAbv: 20, hasAlcohol: true, abvOverride: null });
		expect(neatRow.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');

		// Crossing to 0% makes the Recipes Non-alcoholic and drops the remaining override.
		unwrap(await updateIngredientAbv(admin, spirit.id, 0));
		expect(await load(halfAndHalf)).toMatchObject({
			autoAbv: 0,
			hasAlcohol: false,
			abvOverride: null
		});
		const [row] = await db.select().from(ingredient).where(eq(ingredient.id, spirit.id));
		expect(row.isAlcoholic).toBe(false);
	});

	it('rejects non-admins, suspended admins, bad ABVs, unknown ids and a 0% Base', async () => {
		const gin = unwrap(
			await createAlcoholicIngredient(admin, {
				name: '更新ジン',
				abvPercent: 40,
				isBaseSpirit: true
			})
		);
		expect(await updateIngredientAbv(memberActor, gin.id, 30)).toEqual({
			ok: false,
			error: 'forbidden'
		});
		expect(await updateIngredientAbv({ ...admin, suspended: true }, gin.id, 30)).toEqual({
			ok: false,
			error: 'suspended'
		});
		expect(await updateIngredientAbv(admin, gin.id, 30.25)).toEqual({
			ok: false,
			error: 'invalid_abv'
		});
		expect(await updateIngredientAbv(admin, randomUUID(), 30)).toEqual({
			ok: false,
			error: 'not_found'
		});
		expect(await updateIngredientAbv(admin, gin.id, 0)).toEqual({
			ok: false,
			error: 'base_requires_alcohol'
		});
	});
});

describe('seedIngredients', () => {
	it('is idempotent and loads the DT-001 master', async () => {
		await seedIngredients(db);
		expect(await seedIngredients(db)).toBe(0);
		const countWhere = async (where: ReturnType<typeof sql>) =>
			(await db.select({ n: count() }).from(ingredient).where(where))[0].n;
		expect(await countWhere(sql`${gt(ingredient.abvPercent, 0)}`)).toBeGreaterThanOrEqual(50);
		expect(await countWhere(sql`${ingredient.abvPercent} = 0`)).toBeGreaterThanOrEqual(30);
		expect(await countWhere(sql`${ingredient.isBaseSpirit}`)).toBeGreaterThanOrEqual(6);
	});
});
