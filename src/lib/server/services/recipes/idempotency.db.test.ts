import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { holdingTransaction, waitForLockWaiters } from '#lib/server/db/test/concurrency.js';
import { ingredient, member, recipe } from '#lib/server/db/schema.js';
import { recordPhotoUpload } from './photos';
import { createRecipe, type Actor, type RecipeInput } from './recipes';

// Two real connections racing for one idempotency key (ADR 0007): the request that loses the
// INSERT waits for the winner's transaction, so the order below is forced, not hoped for.
let alice: Actor;
let ingredientId: string;

beforeAll(async () => {
	const [m] = await db
		.insert(member)
		.values({ username: `idem_${randomUUID().slice(0, 8)}` })
		.returning();
	alice = { memberId: m.id, isAdministrator: false };
	[{ id: ingredientId }] = await db
		.insert(ingredient)
		.values({ name: `冪等${randomUUID()}`, abvPercent: 0 })
		.returning();
});

afterAll(async () => {
	await db.delete(member).where(eq(member.id, alice.memberId)); // cascades Recipes and uploads
	await db.delete(ingredient).where(eq(ingredient.id, ingredientId));
});

const upload = async () => {
	const key = `recipe/${randomUUID()}/list.webp`;
	await recordPhotoUpload(db, alice.memberId, 'recipe', key.split('/')[1]);
	return key;
};

// Each request has its own photo, so the only thing they contend for is the key.
const body = async (): Promise<RecipeInput> => ({
	title: 'idem',
	mainPhotoKey: await upload(),
	ingredients: [{ ingredientId, mixRatio: 1 }],
	steps: ['混ぜる']
});

const withKey = (key: string) =>
	db.select({ id: recipe.id }).from(recipe).where(eq(recipe.idempotencyKey, key));

describe('createRecipe with the same idempotency key on two connections', () => {
	it('the one that loses the INSERT returns the winner’s Recipe once it commits', async () => {
		const key = randomUUID();
		const winner = holdingTransaction(async (tx) => createRecipe(tx, alice, await body(), key));
		try {
			const won = await winner.result;
			if (!won.ok) throw new Error(won.error);
			const losing = createRecipe(db, alice, await body(), key); // INSERT waits for the winner
			await waitForLockWaiters(1);
			winner.commit();
			await winner.done;

			expect(await losing).toEqual({ ok: true, value: { id: won.value.id } });
			expect(await withKey(key)).toEqual([{ id: won.value.id }]);
		} finally {
			winner.commit();
			await winner.done;
		}
	});

	it('the one that loses publishes its own Recipe when the winner rolls back', async () => {
		const key = randomUUID();
		const created = Promise.withResolvers<void>();
		const rollback = Promise.withResolvers<void>();
		const winner = holdingTransaction(async (tx) => {
			await createRecipe(tx, alice, await body(), key);
			created.resolve();
			await rollback.promise;
			throw new Error('rollback');
		});
		const winnerEnded = Promise.allSettled([winner.result, winner.done]);
		try {
			await created.promise;
			const losing = createRecipe(db, alice, await body(), key);
			await waitForLockWaiters(1);
			rollback.resolve();
			await winnerEnded;

			const result = await losing;
			if (!result.ok) throw new Error(result.error);
			expect(await withKey(key)).toEqual([{ id: result.value.id }]);
		} finally {
			rollback.resolve();
			await winnerEnded;
		}
	});
});
