import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { ingredient, member, photoUpload, recipe } from '#lib/server/db/schema.js';
import { recordPhotoUpload } from './photos';
import { createRecipe, deleteRecipe, updateRecipe, type Actor, type RecipeInput } from './recipes';

// Real connections, committed data: the point is how two transactions interleave (#16), which
// the rolled-back `isolated` transactions of the other service tests cannot show.
let alice: Actor;
let ingredientId: string;

beforeAll(async () => {
	const [m] = await db
		.insert(member)
		.values({ username: `race_${randomUUID().slice(0, 8)}` })
		.returning();
	alice = { memberId: m.id, isAdministrator: false };
	[{ id: ingredientId }] = await db
		.insert(ingredient)
		.values({ name: `競合${randomUUID()}`, abvPercent: 0 })
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

const body = (mainPhotoKey: string): RecipeInput => ({
	title: 'race',
	mainPhotoKey,
	ingredients: [{ ingredientId, mixRatio: 1 }],
	steps: ['混ぜる']
});

const created = async (mainPhotoKey: string) => {
	const r = await createRecipe(db, alice, body(mainPhotoKey));
	if (!r.ok) throw new Error(r.error);
	return r.value.id;
};

/** Resolves once some other connection is waiting for a row lock. */
async function lockWaiter() {
	for (let i = 0; i < 100; i++) {
		const { rows } = await db.execute<{ n: number }>(
			sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
		);
		if (rows[0].n > 0) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error('no transaction is waiting for a lock');
}

/** Runs `hold` in a transaction that stays open until `commit()`; resolves `ready` once `hold` returned. */
function holdingTransaction<T>(
	hold: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
) {
	let commit!: () => void;
	const gate = new Promise<void>((r) => (commit = r));
	let ready!: (v: T) => void;
	const result = new Promise<T>((r) => (ready = r));
	const done = db.transaction(async (tx) => {
		ready(await hold(tx));
		await gate;
	});
	return { result, commit, done };
}

describe('photo release vs concurrent Recipe writes (#16)', () => {
	it('does not release a photo that a concurrent transaction attached before committing', async () => {
		const shared = await upload();
		const other = await upload();
		const a = await created(shared);

		// Another request is publishing a second Recipe with the same photo, not yet committed.
		const attaching = holdingTransaction((tx) => createRecipe(tx, alice, body(shared)));
		expect((await attaching.result).ok).toBe(true);

		const editing = updateRecipe(db, alice, a, body(other)); // drops `shared`; must wait
		await lockWaiter();
		attaching.commit();
		await attaching.done;

		const edited = await editing;
		expect(edited).toMatchObject({ ok: true, value: { removedPhotoKeys: [] } });
		expect(await db.select().from(recipe).where(eq(recipe.mainPhotoKey, shared))).toHaveLength(1);
		expect(
			await db
				.select()
				.from(photoUpload)
				.where(eq(photoUpload.id, shared.split('/')[1]))
		).toHaveLength(1);
	});

	it('rejects a Recipe that tries to attach a photo while its last user is being deleted', async () => {
		const shared = await upload();
		const a = await created(shared);

		const deleting = holdingTransaction((tx) => deleteRecipe(tx, alice, a)); // released, uncommitted
		expect(await deleting.result).toMatchObject({
			ok: true,
			value: { photoKeys: [expect.any(String), expect.any(String)] }
		});

		const attaching = createRecipe(db, alice, body(shared)); // must wait for the delete
		await lockWaiter();
		deleting.commit();
		await deleting.done;

		expect(await attaching).toEqual({ ok: false, error: 'photo_key_invalid' });
		expect(await db.select().from(recipe).where(eq(recipe.mainPhotoKey, shared))).toEqual([]);
	});
});
