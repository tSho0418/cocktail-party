import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import {
	account,
	follow,
	ingredient,
	like,
	member,
	recipe,
	recipePhoto,
	report,
	save,
	session
} from '#lib/server/db/schema.js';
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
