import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from './index';
import { ingredient, member, recipe, recipeIngredient, report } from './schema';

/** Postgres SQLSTATE of a failed query (drizzle wraps the pg error in `cause`). */
async function pgErrorCode(query: Promise<unknown>) {
	try {
		await query;
	} catch (e) {
		return ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
	}
	throw new Error('expected the query to fail');
}

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

let accounts = 0;
async function insertMember(username: string | null = null) {
	const [m] = await db
		.insert(member)
		.values({ provider: 'google', providerAccountId: `g-${++accounts}`, username })
		.returning();
	return m;
}

async function insertRecipe(memberId: string, searchText = '') {
	const [r] = await db
		.insert(recipe)
		.values({ memberId, title: 'テスト', mainPhotoKey: 'photos/test', searchText })
		.returning();
	return r;
}

describe('recipe and ingredient constraints', () => {
	let recipeId: string;
	let ginId: string;

	beforeAll(async () => {
		const m = await insertMember('tester');
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
		const [row] = await db.select().from(ingredient).where(eq(ingredient.id, ginId));
		expect(row.isAlcoholic).toBe(true);
	});

	it('accepts mix_ratio 0.1..99.9 with one decimal and rejects the rest (FR-005)', async () => {
		const [vermouth] = await db
			.insert(ingredient)
			.values({ name: 'ドライ・ベルモット', abvPercent: 18 })
			.returning();
		const where = eq(recipeIngredient.ingredientId, vermouth.id);
		const insert = (mixRatio: number) =>
			db
				.insert(recipeIngredient)
				.values({ recipeId, ingredientId: vermouth.id, mixRatio, position: 2 });

		for (const bad of [0, 100, 0.15, 0.05]) {
			expect(await pgErrorCode(insert(bad)), String(bad)).toBe(CHECK_VIOLATION);
		}
		for (const ok of [0.1, 99.9]) {
			await insert(ok);
			const [row] = await db.select().from(recipeIngredient).where(where);
			expect(row.mixRatio).toBe(ok);
			await db.delete(recipeIngredient).where(where);
		}
	});

	it('rejects ABV values with more than one decimal', async () => {
		const abv = db.insert(ingredient).values({ name: '謎の酒', abvPercent: 40.25 });
		expect(await pgErrorCode(abv)).toBe(CHECK_VIOLATION);
	});

	it('rejects an alcoholic Recipe with auto_abv 0', async () => {
		const [m] = await db.select().from(member).limit(1);
		const zero = db
			.insert(recipe)
			.values({ memberId: m.id, title: 'ゼロ', mainPhotoKey: 'p', autoAbv: 0, hasAlcohol: true });
		expect(await pgErrorCode(zero)).toBe(CHECK_VIOLATION);
	});

	it('rejects the same Ingredient twice in one Recipe', async () => {
		const duplicate = db
			.insert(recipeIngredient)
			.values({ recipeId, ingredientId: ginId, mixRatio: 1, position: 3 });
		expect(await pgErrorCode(duplicate)).toBe(UNIQUE_VIOLATION);
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

describe('member constraints', () => {
	it('treats Usernames case-insensitively (FR-053)', async () => {
		await insertMember('alice');
		expect(await pgErrorCode(insertMember('Alice'))).toBe(UNIQUE_VIOLATION);
	});

	it('only accepts known login providers (ADR 0005)', async () => {
		const apple = db.insert(member).values({ provider: 'apple', providerAccountId: 'a-1' });
		expect(await pgErrorCode(apple)).toBe(CHECK_VIOLATION);
	});
});

describe('report retention', () => {
	const findReport = async (id: string) =>
		(await db.select().from(report).where(eq(report.id, id)))[0];

	async function insertReport() {
		const author = await insertMember();
		const reporter = await insertMember();
		const r = await insertRecipe(author.id);
		const [rep] = await db
			.insert(report)
			.values({
				recipeId: r.id,
				reporterId: reporter.id,
				reportedMemberId: author.id,
				reason: 'spam'
			})
			.returning();
		return { author, reporter, recipe: r, report: rep };
	}

	it('keeps the Report when the Recipe is deleted (FR-008, FR-074)', async () => {
		const { author, recipe: r, report: rep } = await insertReport();
		await db.delete(recipe).where(eq(recipe.id, r.id));
		expect(await findReport(rep.id)).toMatchObject({
			recipeId: null,
			reportedMemberId: author.id,
			targetState: 'live'
		});
	});

	it('keeps Reports received and sent when a Member withdraws (FR-078)', async () => {
		const { author, reporter, report: rep } = await insertReport();

		await db.delete(member).where(eq(member.id, author.id));
		expect(await findReport(rep.id)).toMatchObject({ recipeId: null, reportedMemberId: null });

		await db.delete(member).where(eq(member.id, reporter.id));
		expect(await findReport(rep.id)).toMatchObject({ reporterId: null, reason: 'spam' });
	});
});
