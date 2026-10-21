import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { holdingTransaction, waitForLockWaiters } from '#lib/server/db/test/concurrency.js';
import { db } from '#lib/server/db/index.js';
import {
	account,
	follow,
	ingredient,
	like,
	member,
	photoUpload,
	recipe,
	recipePhoto,
	report,
	save,
	session
} from '#lib/server/db/schema.js';
import { deleteUnreferencedPhotos } from '#lib/server/services/images/cleanup.js';
import { memoryImageStore } from '#lib/server/services/images/store.js';
import {
	createRecipe,
	recordPhotoUpload,
	updateRecipe,
	type RecipeInput
} from '#lib/server/services/recipes/index.js';
import { setUsername, withdrawMember } from './index';

let n = 0;
async function newMember(fields: Partial<typeof member.$inferInsert> = {}) {
	const [m] = await db
		.insert(member)
		.values({ username: `m${++n}_w`, ...fields })
		.returning();
	await db
		.insert(account)
		.values({ id: crypto.randomUUID(), providerId: 'line', accountId: `w-${n}`, userId: m.id });
	return m;
}
const newRecipe = async (memberId: string, mainPhotoKey: string) =>
	(await db.insert(recipe).values({ memberId, title: 't', mainPhotoKey }).returning())[0];

describe('setUsername (FR-052/053)', () => {
	it('sets a valid Username and rejects bad formats', async () => {
		const m = await newMember({ username: null });
		expect(await setUsername(m.id, 'ab')).toEqual({ ok: false, error: 'invalid' });
		expect(await setUsername(m.id, 'bad-name')).toEqual({ ok: false, error: 'invalid' });
		expect(await setUsername(m.id, 'Bob_42')).toEqual({ ok: true });
	});

	it('treats Usernames that differ only by case as taken', async () => {
		const a = await newMember({ username: null });
		const b = await newMember({ username: null });
		expect(await setUsername(a.id, 'Carol')).toEqual({ ok: true });
		expect(await setUsername(b.id, 'cAROL')).toEqual({ ok: false, error: 'taken' });
	});
});

describe('withdrawMember (FR-058, FR-078)', () => {
	it('deletes the Member and its data in one go, keeps Reports, returns the storage keys', async () => {
		const leaver = await newMember({ iconKey: 'icons/leaver' });
		const other = await newMember();
		const own = await newRecipe(leaver.id, 'photos/main-1');
		await newRecipe(leaver.id, 'photos/main-2');
		const theirs = await newRecipe(other.id, 'photos/other');
		await db
			.insert(recipePhoto)
			.values({ recipeId: own.id, photoKey: 'photos/extra-1', position: 1 });
		await db.insert(like).values({ memberId: leaver.id, recipeId: theirs.id });
		await db.insert(save).values({ memberId: leaver.id, recipeId: theirs.id });
		await db.insert(follow).values({ followerId: leaver.id, followeeId: other.id });
		await db.insert(follow).values({ followerId: other.id, followeeId: leaver.id });
		await db.insert(session).values({
			id: crypto.randomUUID(),
			token: `t-${leaver.id}`,
			userId: leaver.id,
			expiresAt: new Date(Date.now() + 60_000)
		});
		const [ing] = await db
			.insert(ingredient)
			.values({ name: '退会テスト水', abvPercent: 0, createdBy: leaver.id })
			.returning();
		const [received] = await db
			.insert(report)
			.values({
				recipeId: own.id,
				reporterId: other.id,
				reportedMemberId: leaver.id,
				reason: 'spam'
			})
			.returning();
		const [sent] = await db
			.insert(report)
			.values({
				recipeId: theirs.id,
				reporterId: leaver.id,
				reportedMemberId: other.id,
				reason: 'other'
			})
			.returning();

		const keys = await withdrawMember({ id: leaver.id });

		expect(keys.sort()).toEqual(
			['icons/leaver', 'photos/extra-1', 'photos/main-1', 'photos/main-2'].sort()
		);
		expect(await db.select().from(member).where(eq(member.id, leaver.id))).toEqual([]);
		expect(await db.select().from(session).where(eq(session.userId, leaver.id))).toEqual([]);
		expect(await db.select().from(account).where(eq(account.userId, leaver.id))).toEqual([]);
		expect(await db.select().from(recipe).where(eq(recipe.memberId, leaver.id))).toEqual([]);
		expect(await db.select().from(like).where(eq(like.memberId, leaver.id))).toEqual([]);
		expect(await db.select().from(save).where(eq(save.memberId, leaver.id))).toEqual([]);
		expect(
			await db
				.select()
				.from(follow)
				.where(inArray(follow.followerId, [leaver.id, other.id]))
		).toEqual([]);
		expect(
			(await db.select().from(ingredient).where(eq(ingredient.id, ing.id)))[0].createdBy
		).toBeNull();

		const [r, s] = await Promise.all(
			[received.id, sent.id].map(
				async (id) => (await db.select().from(report).where(eq(report.id, id)))[0]
			)
		);
		expect(r).toMatchObject({
			targetState: 'member_withdrawn',
			reportedMemberId: null,
			recipeId: null,
			reporterId: other.id
		});
		expect(s).toMatchObject({
			targetState: 'live',
			reporterId: null,
			recipeId: theirs.id,
			reportedMemberId: other.id
		});
	});

	it('returns no keys for a Member already gone', async () => {
		expect(await withdrawMember({ id: crypto.randomUUID() })).toEqual([]);
	});
});

describe('withdrawMember and stored photos (FR-058)', () => {
	it('also returns uploads no Recipe uses, so their objects are deleted with the rest (#38)', async () => {
		const leaver = await newMember();
		const other = await newMember();
		const store = memoryImageStore();
		const objectsOf = async (memberId: string, kind: 'recipe' | 'member') => {
			const id = randomUUID();
			await recordPhotoUpload(db, memberId, kind, id);
			for (const file of ['list', 'detail'])
				await store.put(`${kind}/${id}/${file}.webp`, new Uint8Array([1]), 'image/webp');
			return `${kind}/${id}/list.webp`;
		};
		const used = await objectsOf(leaver.id, 'recipe');
		await objectsOf(leaver.id, 'recipe'); // uploaded, never attached to a Recipe
		await objectsOf(leaver.id, 'member'); // an icon that was replaced
		const icon = await objectsOf(leaver.id, 'member');
		await db.update(member).set({ iconKey: icon }).where(eq(member.id, leaver.id));
		await newRecipe(leaver.id, used);
		const kept = await objectsOf(other.id, 'recipe');

		await deleteUnreferencedPhotos(() => store, await withdrawMember({ id: leaver.id }));

		expect([...store.objects.keys()].sort()).toEqual([kept, kept.replace('list', 'detail')].sort());
	});
});

describe('withdrawMember racing the same Member’s Recipe writes (#40)', () => {
	// Each test parks one writer on an Ingredient row lock after it took its photo locks, starts
	// the withdrawal behind it, then lets the writer go. Postgres would abort one of two
	// deadlocked transactions after a second; both must finish.
	const body = (ingredientId: string, mainPhotoKey: string): RecipeInput => ({
		title: 'race',
		mainPhotoKey,
		ingredients: [{ ingredientId, mixRatio: 1 }],
		steps: ['混ぜる']
	});
	const setup = async () => {
		const m = await newMember();
		const [ing] = await db
			.insert(ingredient)
			.values({ name: `退会競合${randomUUID()}`, abvPercent: 0 })
			.returning();
		const upload = async () => {
			const id = randomUUID();
			await recordPhotoUpload(db, m.id, 'recipe', id);
			return `recipe/${id}/list.webp`;
		};
		return { actor: { memberId: m.id, isAdministrator: false }, ing, upload };
	};
	const parkOnIngredient = (ingredientId: string) =>
		holdingTransaction((tx) =>
			tx.select().from(ingredient).where(eq(ingredient.id, ingredientId)).for('update')
		);

	it('finishes both while a Recipe is being published', async () => {
		const { actor, ing, upload } = await setup();
		const key = await upload();
		const parked = parkOnIngredient(ing.id);
		try {
			await parked.result;
			const publishing = createRecipe(db, actor, body(ing.id, key)); // holds the upload, waits
			await waitForLockWaiters(1);
			const withdrawing = withdrawMember({ id: actor.memberId });
			await waitForLockWaiters(2);
			parked.commit();
			const [p, w] = await Promise.allSettled([publishing, withdrawing]);
			expect(p).toMatchObject({ status: 'fulfilled', value: { ok: true } });
			expect(w).toMatchObject({ status: 'fulfilled' });
			// The Recipe published a moment before the withdrawal went with it, photos included.
			expect((w as PromiseFulfilledResult<string[]>).value).toContain(key);
			expect(await db.select().from(member).where(eq(member.id, actor.memberId))).toEqual([]);
			expect(await db.select().from(recipe).where(eq(recipe.mainPhotoKey, key))).toEqual([]);
		} finally {
			parked.commit();
			await parked.done;
		}
	});

	it('finishes both while one of their Recipes is being edited', async () => {
		const { actor, ing, upload } = await setup();
		const key = await upload();
		const created = await createRecipe(db, actor, body(ing.id, key));
		if (!created.ok) throw new Error(created.error);
		const parked = holdingTransaction((tx) =>
			tx
				.select()
				.from(photoUpload)
				.where(eq(photoUpload.id, key.split('/')[1]))
				.for('update')
		);
		try {
			await parked.result;
			// The withdrawal goes first, so it is the one that waits for the upload row ...
			const withdrawing = withdrawMember({ id: actor.memberId });
			await waitForLockWaiters(1);
			// ... and the edit takes the Recipe row before it waits for the same upload.
			const editing = updateRecipe(db, actor, created.value.id, body(ing.id, key));
			await waitForLockWaiters(2);
			parked.commit();
			const [w, e] = await Promise.allSettled([withdrawing, editing]);
			expect(w).toMatchObject({ status: 'fulfilled' });
			expect(e).toMatchObject({ status: 'fulfilled', value: { ok: false, error: 'not_found' } });
			expect(await db.select().from(member).where(eq(member.id, actor.memberId))).toEqual([]);
		} finally {
			parked.commit();
			await parked.done;
		}
	});
});
