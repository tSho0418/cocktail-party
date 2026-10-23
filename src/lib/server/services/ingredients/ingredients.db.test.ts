import { randomUUID } from 'node:crypto';
import { count, eq, gt, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { ingredient, member, recipe, recipeIngredient } from '../../db/schema';
import { seedIngredients } from '../../db/seed/ingredients';
import {
	MAX_ZERO_ABV_INGREDIENTS_PER_DAY,
	MAX_ZERO_ABV_INGREDIENTS_TOTAL
} from '#lib/domain/ingredient-limits.js';
import {
	createAlcoholicIngredient,
	createZeroAbvIngredient,
	deleteIngredient,
	suggestSimilar,
	updateIngredientAbv,
	type Actor
} from '.';

let admin: Actor;
let memberActor: Actor;

beforeAll(async () => {
	const [a, m] = await db
		.insert(member)
		.values([{ isAdministrator: true }, {}])
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

// FR-012 lets any Member add a 0% Ingredient without approval, so the master's size is only as
// bounded as these limits (#64).
describe('the limit on 0% Ingredients per Member', () => {
	const created: string[] = [];
	const newMember = async () => {
		const [m] = await db.insert(member).values({}).returning();
		created.push(m.id);
		return { memberId: m.id, isAdministrator: false } satisfies Actor;
	};
	const add = (actor: Actor, name: string) =>
		createZeroAbvIngredient(actor, { name: `${name}${randomUUID()}`, abvPercent: 0 });
	const addMany = async (actor: Actor, n: number) => {
		for (let i = 0; i < n; i++) unwrap(await add(actor, '上限'));
	};
	/** Rows that were created `ageHours` ago, as if registered by `actor` back then. */
	const addAged = async (actor: Actor, n: number, ageHours: number) => {
		await db.insert(ingredient).values(
			Array.from({ length: n }, () => ({
				name: `過去${randomUUID()}`,
				abvPercent: 0,
				createdBy: actor.memberId,
				createdAt: new Date(Date.now() - ageHours * 3_600_000)
			}))
		);
	};
	const owned = async (actor: Actor) =>
		(
			await db
				.select({ n: count() })
				.from(ingredient)
				.where(eq(ingredient.createdBy, actor.memberId))
		)[0].n;
	afterAll(async () => {
		await db.delete(ingredient).where(inArray(ingredient.createdBy, created));
		await db.delete(member).where(inArray(member.id, created));
	});

	it('allows exactly the daily limit, then answers ingredient_daily_limit and stores nothing', async () => {
		const alice = await newMember();
		await addMany(alice, MAX_ZERO_ABV_INGREDIENTS_PER_DAY);
		expect(await add(alice, '超過')).toEqual({ ok: false, error: 'ingredient_daily_limit' });
		expect(await owned(alice)).toBe(MAX_ZERO_ABV_INGREDIENTS_PER_DAY);
	});

	it('counts each Member on their own', async () => {
		const [alice, bob] = [await newMember(), await newMember()];
		await addMany(alice, MAX_ZERO_ABV_INGREDIENTS_PER_DAY);
		expect(await add(alice, '超過')).toMatchObject({ ok: false });
		expect(await add(bob, '独立')).toMatchObject({ ok: true });
	});

	it('counts only the last 24 hours towards the daily limit', async () => {
		const alice = await newMember();
		await addAged(alice, MAX_ZERO_ABV_INGREDIENTS_PER_DAY, 25);
		await addMany(alice, MAX_ZERO_ABV_INGREDIENTS_PER_DAY);
		expect(await add(alice, '超過')).toEqual({ ok: false, error: 'ingredient_daily_limit' });
		const bob = await newMember();
		await addAged(bob, MAX_ZERO_ABV_INGREDIENTS_PER_DAY, 23);
		expect(await add(bob, '超過')).toEqual({ ok: false, error: 'ingredient_daily_limit' });
	});

	it('allows exactly the total limit however long ago, then answers ingredient_total_limit', async () => {
		const alice = await newMember();
		await addAged(alice, MAX_ZERO_ABV_INGREDIENTS_TOTAL - 1, 24 * 30);
		expect(await add(alice, '最後の1件')).toMatchObject({ ok: true });
		expect(await add(alice, '超過')).toEqual({ ok: false, error: 'ingredient_total_limit' });
		expect(await owned(alice)).toBe(MAX_ZERO_ABV_INGREDIENTS_TOTAL);
	});

	it('does not stop an Administrator, whose registrations are the maintenance of the master', async () => {
		const root = await newMember();
		await db.update(member).set({ isAdministrator: true }).where(eq(member.id, root.memberId));
		const actor = { ...root, isAdministrator: true };
		await addAged(actor, MAX_ZERO_ABV_INGREDIENTS_TOTAL, 1);
		await addMany(actor, MAX_ZERO_ABV_INGREDIENTS_PER_DAY + 1);
		expect(await owned(actor)).toBe(
			MAX_ZERO_ABV_INGREDIENTS_TOTAL + MAX_ZERO_ABV_INGREDIENTS_PER_DAY + 1
		);
	});

	it('still reports a duplicate (with the existing one to pick) rather than the limit', async () => {
		const alice = await newMember();
		const first = unwrap(
			await createZeroAbvIngredient(alice, { name: `重複上限${randomUUID()}`, abvPercent: 0 })
		);
		await addMany(alice, MAX_ZERO_ABV_INGREDIENTS_PER_DAY - 1);
		const again = await createZeroAbvIngredient(alice, { name: first.name, abvPercent: 0 });
		expect(again).toMatchObject({ ok: false, error: 'duplicate' });
		expect(again.ok === false && again.similar?.[0].id).toBe(first.id);
	});

	it('cannot be exceeded by simultaneous requests of one Member', async () => {
		const alice = await newMember();
		const results = await Promise.all(
			Array.from({ length: MAX_ZERO_ABV_INGREDIENTS_PER_DAY + 4 }, () => add(alice, '同時'))
		);
		expect(results.filter((r) => r.ok)).toHaveLength(MAX_ZERO_ABV_INGREDIENTS_PER_DAY);
		expect(await owned(alice)).toBe(MAX_ZERO_ABV_INGREDIENTS_PER_DAY);
	});
});

describe('deleteIngredient (#64)', () => {
	const zero = async (name: string) =>
		unwrap(await createZeroAbvIngredient(admin, { name: `${name}${randomUUID()}`, abvPercent: 0 }));
	const exists = async (id: string) =>
		(await db.select().from(ingredient).where(eq(ingredient.id, id))).length === 1;

	it('deletes an unused 0% Ingredient, and only for an Administrator', async () => {
		const row = await zero('削除');
		expect(await deleteIngredient(memberActor, row.id)).toEqual({ ok: false, error: 'forbidden' });
		expect(await deleteIngredient({ ...admin, suspended: true }, row.id)).toEqual({
			ok: false,
			error: 'suspended'
		});
		expect(await exists(row.id)).toBe(true);

		expect(await deleteIngredient(admin, row.id)).toEqual({ ok: true, value: { id: row.id } });
		expect(await exists(row.id)).toBe(false);
		expect(await deleteIngredient(admin, row.id)).toEqual({ ok: false, error: 'not_found' });
		expect(await deleteIngredient(admin, 'not-a-uuid')).toEqual({ ok: false, error: 'not_found' });
	});

	it('frees the name for registering again', async () => {
		const row = await zero('再登録');
		unwrap(await deleteIngredient(admin, row.id));
		expect(
			await createZeroAbvIngredient(memberActor, { name: row.name, abvPercent: 0 })
		).toMatchObject({
			ok: true
		});
	});

	it('refuses an Ingredient that a Recipe uses, and keeps it', async () => {
		const row = await zero('使用中');
		const [r] = await db
			.insert(recipe)
			.values({ memberId: memberActor.memberId, title: '使用中', mainPhotoKey: 'p' })
			.returning();
		await db
			.insert(recipeIngredient)
			.values({ recipeId: r.id, ingredientId: row.id, mixRatio: 1, position: 1 });
		expect(await deleteIngredient(admin, row.id)).toEqual({ ok: false, error: 'in_use' });
		expect(await exists(row.id)).toBe(true);
		// Once the last Recipe using it is gone it can be deleted.
		await db.delete(recipe).where(eq(recipe.id, r.id));
		expect(await deleteIngredient(admin, row.id)).toMatchObject({ ok: true });
	});

	it("refuses an alcoholic Ingredient: the master of spirits is the Administrator's curated list", async () => {
		const gin = unwrap(
			await createAlcoholicIngredient(admin, {
				name: `削除不可ジン${randomUUID()}`,
				abvPercent: 40
			})
		);
		expect(await deleteIngredient(admin, gin.id)).toEqual({ ok: false, error: 'not_deletable' });
		expect(await exists(gin.id)).toBe(true);
	});
});
