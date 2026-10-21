import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { holdingTransaction, waitForLockWaiters } from '#lib/server/db/test/concurrency.js';
import { db } from '#lib/server/db/index.js';
import { follow, ingredient, like, member, recipe, save } from '#lib/server/db/schema.js';
import { input, make, seedMember } from '../recipes/test-fixtures';
import { followMember, likeRecipe, saveRecipe } from './index';

// Real connections and committed rows: the point is how requests interleave with a deletion
// (#31), which the rolled-back `isolated` transactions of social.db.test.ts cannot show.
const created = { members: [] as string[], ingredients: [] as string[] };

async function world() {
	const alice = await seedMember(db, `alice_${randomUUID().slice(0, 8)}`);
	const bob = await seedMember(db, `bob_${randomUUID().slice(0, 8)}`);
	created.members.push(alice.memberId, bob.memberId);
	const [ing] = await db
		.insert(ingredient)
		.values({ name: `競合${randomUUID()}`, abvPercent: 0 })
		.returning();
	created.ingredients.push(ing.id);
	const r = await make(db, alice, input('競合', [[ing.id, 1]]));
	const [{ username: aliceName }] = await db
		.select({ username: member.username })
		.from(member)
		.where(eq(member.id, alice.memberId));
	return { alice, bob, r, aliceName: aliceName! };
}

afterEach(async () => {
	await db.delete(member).where(inArray(member.id, created.members.splice(0))); // cascades the rest
	await db.delete(ingredient).where(inArray(ingredient.id, created.ingredients.splice(0)));
});

describe('Like, Save and Follow racing the deletion of their target (#31)', () => {
	// Another request deletes the target and has not committed yet: our existence check still
	// sees it, and the INSERT then waits for the deletion and hits the foreign key.
	it.each([
		['like a Recipe', 'recipe'],
		['save a Recipe', 'recipe'],
		['follow a Member', 'member']
	] as const)(
		'answers not_found when the target is deleted before the insert: %s',
		async (what, target) => {
			const { alice, bob, r, aliceName } = await world();
			const deleting = holdingTransaction((tx) =>
				target === 'recipe'
					? tx.delete(recipe).where(eq(recipe.id, r))
					: tx.delete(member).where(eq(member.id, alice.memberId))
			);
			try {
				await deleting.result;
				const request =
					what === 'like a Recipe'
						? likeRecipe(db, bob, r)
						: what === 'save a Recipe'
							? saveRecipe(db, bob, r)
							: followMember(db, bob, aliceName);
				await waitForLockWaiters(1);
				deleting.commit();
				await deleting.done;
				expect(await request).toEqual({ ok: false, error: 'not_found' });
			} finally {
				deleting.commit();
				await deleting.done;
			}
		}
	);

	it('keeps one row however many identical requests arrive together', async () => {
		const { alice, bob, r, aliceName } = await world();
		const times = <T>(n: number, f: () => Promise<T>) => Array.from({ length: n }, f);
		const results = await Promise.all([
			...times(6, () => likeRecipe(db, bob, r)),
			...times(6, () => saveRecipe(db, bob, r)),
			...times(6, () => followMember(db, bob, aliceName))
		]);
		expect(results.every((x) => x.ok)).toBe(true);
		expect(await db.select().from(like).where(eq(like.recipeId, r))).toHaveLength(1);
		expect(await db.select().from(save).where(eq(save.recipeId, r))).toHaveLength(1);
		expect(
			await db.select().from(follow).where(eq(follow.followeeId, alice.memberId))
		).toHaveLength(1);
	});
});
