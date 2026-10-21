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

/**
 * Resolves once a connection is waiting for a lock that the connection `holderPid` holds; waits
 * of unrelated connections do not count. Polls tightly, so it returns as soon as the wait exists.
 */
async function waitingFor(holderPid: number) {
	for (let i = 0; i < 300; i++) {
		const { rows } = await db.execute<{ n: number }>(
			sql`select count(*)::int as n from pg_stat_activity where ${holderPid} = any(pg_blocking_pids(pid))`
		);
		if (rows[0].n > 0) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`no transaction is waiting for a lock held by backend ${holderPid}`);
}

/**
 * Runs `hold` in a transaction that stays open until `commit()`. `result` resolves once `hold`
 * returned (rejects with its error if it threw) and `pid` is the backend holding its locks. The caller must `release()` in a
 * `finally`, so a failing assertion cannot leave the transaction (and its row locks) open.
 */
function holdingTransaction<T>(
	hold: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
) {
	let commit!: () => void;
	const gate = new Promise<void>((r) => (commit = r));
	let ready!: (v: { value: T; pid: number }) => void;
	let failed!: (e: unknown) => void;
	const held = new Promise<{ value: T; pid: number }>((res, rej) => {
		ready = res;
		failed = rej;
	});
	const done = db.transaction(async (tx) => {
		const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
		ready({ value: await hold(tx), pid: rows[0].pid });
		await gate;
	});
	// If `hold` throws, `held` rejects with its error instead of leaving the test waiting.
	done.catch(failed);
	return {
		held,
		done,
		commit,
		/** Commits (if not yet) and waits for the transaction to end. */
		release: async () => {
			commit();
			await done;
		}
	};
}

describe('photo release vs concurrent Recipe writes (#16)', () => {
	it('does not release a photo that a concurrent transaction attached before committing', async () => {
		const shared = await upload();
		const other = await upload();
		const a = await created(shared);

		// Another request is publishing a second Recipe with the same photo, not yet committed.
		const attaching = holdingTransaction((tx) => createRecipe(tx, alice, body(shared)));
		try {
			const { value, pid } = await attaching.held;
			expect(value.ok).toBe(true);

			const editing = updateRecipe(db, alice, a, body(other)); // drops `shared`; must wait
			await waitingFor(pid);
			await attaching.release();

			expect(await editing).toMatchObject({ ok: true, value: { removedPhotoKeys: [] } });
			expect(await db.select().from(recipe).where(eq(recipe.mainPhotoKey, shared))).toHaveLength(1);
			expect(
				await db
					.select()
					.from(photoUpload)
					.where(eq(photoUpload.id, shared.split('/')[1]))
			).toHaveLength(1);
		} finally {
			await attaching.release();
		}
	});

	it('rejects a Recipe that tries to attach a photo while its last user is being deleted', async () => {
		const shared = await upload();
		const a = await created(shared);

		const deleting = holdingTransaction((tx) => deleteRecipe(tx, alice, a)); // released, uncommitted
		try {
			const { value, pid } = await deleting.held;
			expect(value).toMatchObject({
				ok: true,
				value: { photoKeys: [expect.any(String), expect.any(String)] }
			});

			const attaching = createRecipe(db, alice, body(shared)); // must wait for the delete
			await waitingFor(pid);
			await deleting.release();

			expect(await attaching).toEqual({ ok: false, error: 'photo_key_invalid' });
			expect(await db.select().from(recipe).where(eq(recipe.mainPhotoKey, shared))).toEqual([]);
		} finally {
			await deleting.release();
		}
	});
});
