// Shared by the *.db.test.ts files in this directory; never imported by app code.
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { ingredient, member } from '#lib/server/db/schema.js';
import { createRecipe, type Actor, type Db, type RecipeInput } from './recipes';

/**
 * Runs `fn` on an empty database inside a transaction that is always rolled back, so tests
 * neither see other files' rows nor leave their own (TRUNCATE is transactional in Postgres).
 */
export async function isolated(fn: (tx: Db) => Promise<void>) {
	try {
		await db.transaction(async (tx) => {
			await tx.execute(sql`truncate member, ingredient cascade`);
			await fn(tx);
			tx.rollback();
		});
	} catch (e) {
		if (!(e instanceof TransactionRollbackError)) throw e;
	}
}

let accounts = 0;
export async function seedMember(
	tx: Db,
	username: string,
	opts: { isAdministrator?: boolean; suspended?: boolean } = {}
): Promise<Actor> {
	const [m] = await tx
		.insert(member)
		.values({
			provider: 'google',
			providerAccountId: `recipes-${++accounts}`,
			username,
			isAdministrator: opts.isAdministrator ?? false,
			suspendedAt: opts.suspended ? new Date() : null
		})
		.returning();
	return { memberId: m.id, isAdministrator: m.isAdministrator, suspended: opts.suspended };
}

export async function seedIngredients(tx: Db) {
	const rows = await tx
		.insert(ingredient)
		.values([
			{ name: 'ジン', abvPercent: 40, isBaseSpirit: true },
			{ name: 'ウォッカ', abvPercent: 40, isBaseSpirit: true },
			{ name: 'ラム', abvPercent: 40, isBaseSpirit: true },
			{ name: 'ドライ・ベルモット', abvPercent: 18 },
			{ name: 'カンパリ', abvPercent: 25 },
			{ name: 'トニックウォーター', abvPercent: 0 },
			{ name: 'ライムジュース', abvPercent: 0 },
			{ name: 'ソーダ', abvPercent: 0 }
		])
		.returning();
	const by = (name: string) => rows.find((r) => r.name === name)!.id;
	return {
		gin: by('ジン'),
		vodka: by('ウォッカ'),
		rum: by('ラム'),
		vermouth: by('ドライ・ベルモット'),
		campari: by('カンパリ'),
		tonic: by('トニックウォーター'),
		lime: by('ライムジュース'),
		soda: by('ソーダ')
	};
}

export const input = (
	title: string,
	ingredients: [string, number][],
	extra: Partial<RecipeInput> = {}
): RecipeInput => ({
	title,
	description: '',
	mainPhotoKey: `photos/${title}/main`,
	ingredients: ingredients.map(([ingredientId, mixRatio]) => ({ ingredientId, mixRatio })),
	steps: ['氷を入れたグラスに注ぐ', '軽く混ぜる'],
	...extra
});

/** createRecipe that must succeed; returns the new id. */
export async function make(tx: Db, actor: Actor, recipeInput: RecipeInput) {
	const r = await createRecipe(tx, actor, recipeInput);
	if (!r.ok) throw new Error(`fixture createRecipe failed: ${r.error}`);
	return r.value.id;
}
