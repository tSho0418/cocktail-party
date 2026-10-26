import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { holdingTransaction, waitForLockWaiters } from '#lib/server/db/test/concurrency.js';
import { db } from '#lib/server/db/index.js';
import { ingredient, member, photoUpload, recipe } from '#lib/server/db/schema.js';
import { createRecipe, updateRecipe } from '../recipes/recipes';
import { input, make, own, seedMember } from '../recipes/test-fixtures';
import { deleteIngredient, updateIngredientAbv } from '.';

// Real connections and committed rows, as in social/races.db.test.ts: the point is how a Recipe
// edit and an ABV edit (FR-015) interleave, which rolled-back `isolated` transactions cannot show.
// Postgres aborts one of two deadlocked transactions after a second (`deadlock detected`), so a
// deadlock shows up as a rejected promise rather than a hang.
const created = { members: [] as string[], ingredients: [] as string[] };

async function world() {
	const owner = await seedMember(db, `owner_${randomUUID().slice(0, 8)}`);
	const admin = await seedMember(db, `admin_${randomUUID().slice(0, 8)}`, {
		isAdministrator: true
	});
	created.members.push(owner.memberId, admin.memberId);
	const newIngredient = async (abvPercent: number) => {
		const [row] = await db
			.insert(ingredient)
			.values({ name: `競合${randomUUID()}`, abvPercent })
			.returning();
		created.ingredients.push(row.id);
		return row.id;
	};
	return { owner, admin, newIngredient };
}

const load = async (id: string) => (await db.select().from(recipe).where(eq(recipe.id, id)))[0];

/** 'finished', or why not; a deadlock victim reads `threw: deadlock detected`. */
const outcome = (p: Promise<{ ok: true } | { ok: false; error: string }>) =>
	p.then(
		(r) => (r.ok ? 'finished' : `failed: ${r.error}`),
		(e: Error & { cause?: Error }) => `threw: ${e.cause?.message ?? e.message}`
	);

afterEach(async () => {
	await db.delete(member).where(inArray(member.id, created.members.splice(0))); // cascades the rest
	await db.delete(ingredient).where(inArray(ingredient.id, created.ingredients.splice(0)));
});

describe('a Recipe edit racing an Ingredient ABV edit (#45)', () => {
	it('finishes both when the edit holds the Recipe and the ABV edit holds the Ingredient', async () => {
		const { owner, admin, newIngredient } = await world();
		const gin = await newIngredient(40);
		const mainPhotoKey = `recipe/${randomUUID()}/list.webp`;
		const id = await make(db, owner, input('競合', [[gin, 1]], { mainPhotoKey }));

		// The editor takes the Recipe row, then waits for the photo upload row parked here.
		const parked = holdingTransaction((tx) =>
			tx
				.select()
				.from(photoUpload)
				.where(eq(photoUpload.id, mainPhotoKey.split('/')[1]))
				.for('update')
		);
		try {
			await parked.result;
			const editing = updateRecipe(db, owner, id, input('競合・改', [[gin, 1]], { mainPhotoKey }));
			await waitForLockWaiters(1);
			// The ABV edit starts once the editor holds the Recipe, so it must wait for the Recipe
			// row without holding the Ingredient row the editor reads next.
			const changing = updateIngredientAbv(admin, gin, 20);
			await waitForLockWaiters(2);
			parked.commit();
			await parked.done;

			// Both must finish, whichever one goes first.
			expect(await Promise.all([outcome(editing), outcome(changing)])).toEqual([
				'finished',
				'finished'
			]);
			expect(await load(id)).toMatchObject({ title: '競合・改', autoAbv: 20 });
		} finally {
			parked.commit();
			await parked.done;
		}
	});

	// The ABV edit locks the Recipes using the Ingredient before the Ingredient itself, so it
	// cannot see a Recipe whose edit adds the Ingredient and commits in between. That Recipe's
	// auto_abv was derived from the old ABV and must not be left behind (FR-015).
	it('recomputes a Recipe that starts using the Ingredient while the ABV edit waits', async () => {
		const { owner, admin, newIngredient } = await world();
		const gin = await newIngredient(40);
		const soda = await newIngredient(0);
		const mainPhotoKey = `recipe/${randomUUID()}/list.webp`;
		const id = await make(db, owner, input('競合', [[soda, 1]], { mainPhotoKey }));

		// The edit adds gin and stays open: it holds the Recipe row and a share lock on gin.
		const adding = holdingTransaction((tx) =>
			updateRecipe(tx, owner, id, input('競合・改', [[gin, 1]], { mainPhotoKey }))
		);
		try {
			expect(await adding.result).toMatchObject({ ok: true });
			// No Recipe uses gin yet, so there is nothing to lock first; the Ingredient row waits.
			const changing = updateIngredientAbv(admin, gin, 20);
			await waitForLockWaiters(1);
			adding.commit();
			await adding.done;

			expect(await changing).toMatchObject({ ok: true, value: { recomputed: 1 } });
			expect(await load(id)).toMatchObject({ autoAbv: 20, hasAlcohol: true });
		} finally {
			adding.commit();
			await adding.done;
		}
	});
});

// A Recipe write share-locks the Ingredients it uses and the deletion locks the row FOR UPDATE
// before it looks for users, so whichever comes second waits for the first and sees its result:
// the foreign key (restrict) is only the last line of defence, never what the Administrator hits.
describe('an Ingredient deletion racing a Recipe write (#64)', () => {
	it('is refused as in_use when a Recipe that uses the Ingredient is being created', async () => {
		const { owner, admin, newIngredient } = await world();
		const syrup = await newIngredient(0);
		const creating = holdingTransaction((tx) => make(tx, owner, input('競合', [[syrup, 1]])));
		try {
			const id = await creating.result;
			const deleting = deleteIngredient(admin, syrup);
			await waitForLockWaiters(1);
			creating.commit();
			await creating.done;

			expect(await outcome(deleting)).toBe('failed: in_use');
			expect(await db.select().from(ingredient).where(eq(ingredient.id, syrup))).toHaveLength(1);
			expect(await load(id)).toMatchObject({ title: '競合' });
		} finally {
			creating.commit();
			await creating.done;
		}
	});

	it('makes the Recipe fail with unknown_ingredient when the deletion got there first', async () => {
		const { owner, admin, newIngredient } = await world();
		const syrup = await newIngredient(0);
		const recipeInput = await own(db, owner, input('競合', [[syrup, 1]]));
		const deleting = holdingTransaction((tx) => deleteIngredient(admin, syrup, tx));
		try {
			expect(await deleting.result).toMatchObject({ ok: true });
			const creating = createRecipe(db, owner, recipeInput);
			await waitForLockWaiters(1);
			deleting.commit();
			await deleting.done;

			expect(await outcome(creating)).toBe('failed: unknown_ingredient');
			expect(await db.select().from(ingredient).where(eq(ingredient.id, syrup))).toHaveLength(0);
			expect(
				await db.select().from(recipe).where(eq(recipe.memberId, owner.memberId))
			).toHaveLength(0);
		} finally {
			deleting.commit();
			await deleting.done;
		}
	});
});
