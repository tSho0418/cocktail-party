// Shared by the *.db.test.ts files in this directory; never imported by app code.
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { randomUUID } from 'node:crypto';
import { ingredient, member, photoUpload } from '#lib/server/db/schema.js';
import { recordPhotoUpload } from './photos';
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

export async function seedMember(
	tx: Db,
	username: string,
	opts: { isAdministrator?: boolean; suspended?: boolean } = {}
): Promise<Actor> {
	const [m] = await tx
		.insert(member)
		.values({
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

/** A well-formed Recipe photo key (storePhoto's shape) with a fresh upload id. */
export const photoKey = (file: 'list' | 'detail' = 'list') => `recipe/${randomUUID()}/${file}.webp`;

/** Records an upload by `actor` and returns its list key (add `.replace('list', 'detail')` for the other file). */
export async function upload(tx: Db, actor: Actor) {
	const key = photoKey();
	await recordPhotoUpload(tx, actor.memberId, 'recipe', key.split('/')[1]);
	return key;
}

export const input = (
	title: string,
	ingredients: [string, number][],
	extra: Partial<RecipeInput> = {}
): RecipeInput => ({
	title,
	description: '',
	mainPhotoKey: photoKey(),
	ingredients: ingredients.map(([ingredientId, mixRatio]) => ({ ingredientId, mixRatio })),
	steps: ['氷を入れたグラスに注ぐ', '軽く混ぜる'],
	...extra
});

/** `recipeInput` after recording its photos as uploads of `actor`, as POST /api/photos would have. */
export async function own<T extends RecipeInput>(tx: Db, actor: Actor, recipeInput: T) {
	for (const key of [recipeInput.mainPhotoKey, ...(recipeInput.extraPhotoKeys ?? [])])
		await tx
			.insert(photoUpload)
			.values({ id: key.split('/')[1], memberId: actor.memberId, kind: 'recipe' })
			.onConflictDoNothing();
	return recipeInput;
}

/** createRecipe that must succeed; returns the new id. */
export async function make(tx: Db, actor: Actor, recipeInput: RecipeInput) {
	const r = await createRecipe(tx, actor, await own(tx, actor, recipeInput));
	if (!r.ok) throw new Error(`fixture createRecipe failed: ${r.error}`);
	return r.value.id;
}
