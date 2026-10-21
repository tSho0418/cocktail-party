import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { ingredient, member, photoUpload, recipe } from '#lib/server/db/schema.js';
import {
	input,
	isolated,
	make,
	seedIngredients,
	seedMember,
	upload,
	uploadIcon
} from '../recipes/test-fixtures';
import { createRecipe, type Actor, type Db } from '../recipes';
import { memoryImageStore } from './store';
import { sweepUnusedUploads, UPLOAD_GRACE_MS } from './sweep';

const DAY = UPLOAD_GRACE_MS;
const detail = (listKey: string) => listKey.replace('list.webp', 'detail.webp');

/** Puts both objects of an upload in `store` and returns the list key. */
async function stored(store: ReturnType<typeof memoryImageStore>, listKey: string) {
	for (const k of [listKey, detail(listKey)]) await store.put(k, new Uint8Array([1]), 'image/webp');
	return listKey;
}

/** Makes the upload of `key` look `ageMs` old. */
const age = (tx: Db, key: string, ageMs: number) =>
	tx
		.update(photoUpload)
		.set({ createdAt: new Date(Date.now() - ageMs) })
		.where(eq(photoUpload.id, key.split('/')[1]));

const rowCount = async (tx: Db, key: string) =>
	(
		await tx
			.select()
			.from(photoUpload)
			.where(eq(photoUpload.id, key.split('/')[1]))
	).length;

describe('sweepUnusedUploads (#17, #28)', () => {
	it('removes old unused uploads (row and both objects), of Recipe photos and Member icons', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const store = memoryImageStore();
			const photo = await stored(store, await upload(tx, alice));
			const icon = await stored(store, await uploadIcon(tx, alice));
			await age(tx, photo, 2 * DAY);
			await age(tx, icon, 2 * DAY);

			expect(await sweepUnusedUploads(tx, () => store)).toBe(2);
			expect(store.objects.size).toBe(0);
			expect(await rowCount(tx, photo)).toBe(0);
			expect(await rowCount(tx, icon)).toBe(0);
		}));

	it('keeps uploads inside the grace period, and the ones Recipes or icons use', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const { gin, tonic } = await seedIngredients(tx);
			const store = memoryImageStore();
			const fresh = await stored(store, await upload(tx, alice));
			const mainKey = await stored(store, await upload(tx, alice));
			const extraKey = await stored(store, await upload(tx, alice));
			const iconKey = await stored(store, await uploadIcon(tx, alice));
			await make(
				tx,
				alice,
				input(
					'ジントニック',
					[
						[gin, 3],
						[tonic, 5]
					],
					{ mainPhotoKey: mainKey, extraPhotoKeys: [extraKey] }
				)
			);
			await tx.update(member).set({ iconKey }).where(eq(member.id, alice.memberId));
			for (const k of [mainKey, extraKey, iconKey]) await age(tx, k, 30 * DAY);
			await age(tx, fresh, DAY / 2);

			expect(await sweepUnusedUploads(tx, () => store)).toBe(0);
			expect(store.objects.size).toBe(8);
			for (const k of [fresh, mainKey, extraKey, iconKey]) expect(await rowCount(tx, k)).toBe(1);
		}));

	it('sweeps in batches until nothing old and unused is left', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const store = memoryImageStore();
			for (let i = 0; i < 230; i++) {
				const key = await stored(store, await upload(tx, alice));
				await age(tx, key, 2 * DAY);
			}
			expect(await sweepUnusedUploads(tx, () => store)).toBe(230);
			expect(store.objects.size).toBe(0);
		}));

	it('still deletes the rows when the store fails, and never throws', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const key = await upload(tx, alice);
			await age(tx, key, 2 * DAY);
			const swept = await sweepUnusedUploads(tx, () => {
				throw new Error('no R2 env');
			});
			expect(swept).toBe(1);
			expect(await rowCount(tx, key)).toBe(0);
		}));
});

describe('sweepUnusedUploads vs a Recipe being published', () => {
	it('skips an upload that an uncommitted Recipe write has locked, so the Recipe keeps its photo', async () => {
		const [m] = await db
			.insert(member)
			.values({ username: `sweep_${randomUUID().slice(0, 8)}` })
			.returning();
		const alice: Actor = { memberId: m.id, isAdministrator: false };
		const [ing] = await db
			.insert(ingredient)
			.values({ name: `掃除${randomUUID()}`, abvPercent: 0 })
			.returning();
		try {
			const key = `recipe/${randomUUID()}/list.webp`;
			await db.insert(photoUpload).values({
				id: key.split('/')[1],
				memberId: alice.memberId,
				kind: 'recipe',
				createdAt: new Date(Date.now() - 2 * DAY)
			});
			const store = memoryImageStore();
			await stored(store, key);

			let attached!: () => void;
			const hasAttached = new Promise<void>((r) => (attached = r));
			let commit!: () => void;
			const gate = new Promise<void>((r) => (commit = r));
			const publishing = db.transaction(async (tx) => {
				const r = await createRecipe(tx, alice, {
					title: '公開中',
					mainPhotoKey: key,
					ingredients: [{ ingredientId: ing.id, mixRatio: 1 }],
					steps: ['混ぜる']
				});
				expect(r.ok).toBe(true);
				attached();
				await gate;
			});
			try {
				await hasAttached;
				// Must finish while the Recipe transaction is still open (it skips the locked row); a
				// sweep that waits for the lock instead is a failure, not a hang.
				const sweep = sweepUnusedUploads(db, () => store);
				const outcome = await Promise.race([
					sweep,
					new Promise<string>((r) => setTimeout(() => r('blocked on a row lock'), 2000))
				]);
				expect(outcome).toBe(0);
			} finally {
				commit();
				await publishing;
			}
			expect(await db.select().from(recipe).where(eq(recipe.mainPhotoKey, key))).toHaveLength(1);
			expect(
				await db
					.select()
					.from(photoUpload)
					.where(eq(photoUpload.id, key.split('/')[1]))
			).toHaveLength(1);
			expect(store.objects.size).toBe(2);
		} finally {
			await db.delete(member).where(eq(member.id, m.id)); // cascades Recipes and uploads
			await db.delete(ingredient).where(eq(ingredient.id, ing.id));
		}
	});
});
