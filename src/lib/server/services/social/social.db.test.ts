import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { follow, member, save } from '#lib/server/db/schema.js';
import { input, isolated, make, seedIngredients, seedMember } from '../recipes/test-fixtures';
import {
	followMember,
	getProfile,
	getReactions,
	likeRecipe,
	listFollowers,
	listFollowing,
	listMemberRecipes,
	listSavedRecipes,
	saveRecipe,
	unfollowMember,
	unlikeRecipe,
	unsaveRecipe,
	updateProfile
} from './index';

async function world(tx: Parameters<Parameters<typeof isolated>[0]>[0]) {
	const alice = await seedMember(tx, 'alice');
	const bob = await seedMember(tx, 'bob');
	const i = await seedIngredients(tx);
	const r = await make(
		tx,
		alice,
		input('ジントニック', [
			[i.gin, 3],
			[i.tonic, 5]
		])
	);
	return { alice, bob, r, i };
}

describe('Like (FR-055)', () => {
	it('likes once, counts, unlikes; idempotent both ways', () =>
		isolated(async (tx) => {
			const { bob, r } = await world(tx);
			expect(await likeRecipe(tx, bob, r)).toEqual({
				ok: true,
				value: { liked: true, likeCount: 1 }
			});
			expect(await likeRecipe(tx, bob, r)).toMatchObject({ ok: true, value: { likeCount: 1 } });
			expect(await unlikeRecipe(tx, bob, r)).toEqual({
				ok: true,
				value: { liked: false, likeCount: 0 }
			});
			expect(await unlikeRecipe(tx, bob, r)).toMatchObject({ ok: true });
		}));

	it('refuses own Recipe, suspended actor, unknown or malformed id', () =>
		isolated(async (tx) => {
			const { alice, bob, r } = await world(tx);
			expect(await likeRecipe(tx, alice, r)).toEqual({ ok: false, error: 'own_recipe' });
			expect(await likeRecipe(tx, { ...bob, suspended: true }, r)).toEqual({
				ok: false,
				error: 'suspended'
			});
			expect(await likeRecipe(tx, bob, crypto.randomUUID())).toEqual({
				ok: false,
				error: 'not_found'
			});
			expect(await likeRecipe(tx, bob, 'nope')).toEqual({ ok: false, error: 'not_found' });
			expect(await unlikeRecipe(tx, bob, 'nope')).toEqual({ ok: false, error: 'not_found' });
		}));

	it('cannot like a Recipe whose author is suspended', () =>
		isolated(async (tx) => {
			const { alice, bob, r } = await world(tx);
			await tx.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, alice.memberId));
			expect(await likeRecipe(tx, bob, r)).toEqual({ ok: false, error: 'not_found' });
		}));

	it('getReactions shows the count to everyone and own state only to the viewer', () =>
		isolated(async (tx) => {
			const { alice, bob, r } = await world(tx);
			await likeRecipe(tx, bob, r);
			await saveRecipe(tx, bob, r);
			expect(await getReactions(tx, r, bob.memberId)).toEqual({
				likeCount: 1,
				liked: true,
				saved: true
			});
			expect(await getReactions(tx, r, alice.memberId)).toEqual({
				likeCount: 1,
				liked: false,
				saved: false
			});
			expect(await getReactions(tx, r, null)).toMatchObject({ liked: false, saved: false });
			expect(await getReactions(tx, crypto.randomUUID(), null)).toBeNull();
		}));
});

describe('Save (FR-056)', () => {
	it("saves, lists only the owner's Saves newest first, unsaves; idempotent", () =>
		isolated(async (tx) => {
			const { alice, bob, r, i } = await world(tx);
			const r2 = await make(
				tx,
				alice,
				input('モスコミュール', [
					[i.vodka, 3],
					[i.lime, 1]
				])
			);
			await saveRecipe(tx, bob, r);
			await saveRecipe(tx, bob, r);
			await saveRecipe(tx, bob, r2);
			// One transaction has one now(): order the Saves explicitly.
			await tx
				.update(save)
				.set({ createdAt: new Date(Date.now() + 60_000) })
				.where(and(eq(save.memberId, bob.memberId), eq(save.recipeId, r2)));
			await saveRecipe(tx, alice, r2); // own Recipe may be saved
			const mine = await listSavedRecipes(tx, bob.memberId);
			expect(mine.items.map((x) => x.id)).toEqual([r2, r]);
			expect((await listSavedRecipes(tx, alice.memberId)).items.map((x) => x.id)).toEqual([r2]);
			expect(await unsaveRecipe(tx, bob, r2)).toEqual({ ok: true, value: { saved: false } });
			expect(await unsaveRecipe(tx, bob, r2)).toMatchObject({ ok: true });
			expect((await listSavedRecipes(tx, bob.memberId)).items.map((x) => x.id)).toEqual([r]);
			expect(await saveRecipe(tx, bob, crypto.randomUUID())).toEqual({
				ok: false,
				error: 'not_found'
			});
		}));

	it('hides Saved Recipes of suspended authors', () =>
		isolated(async (tx) => {
			const { alice, bob, r } = await world(tx);
			await saveRecipe(tx, bob, r);
			await tx.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, alice.memberId));
			expect((await listSavedRecipes(tx, bob.memberId)).items).toEqual([]);
		}));

	it('pages with a cursor without repeating or skipping', () =>
		isolated(async (tx) => {
			const { alice, bob, i } = await world(tx);
			const ids: string[] = [];
			for (let n = 0; n < 5; n++) {
				const id = await make(
					tx,
					alice,
					input(`r${n}`, [
						[i.gin, 3],
						[i.tonic, 5]
					])
				);
				await saveRecipe(tx, bob, id);
				ids.push(id);
			}
			const seen: string[] = [];
			let cursor: string | null = null;
			do {
				const p = await listSavedRecipes(tx, bob.memberId, { cursor, limit: 2 });
				seen.push(...p.items.map((x) => x.id));
				cursor = p.nextCursor;
			} while (cursor);
			expect([...seen].sort()).toEqual([...ids].sort());
		}));
});

describe('Follow (FR-057)', () => {
	it('follows by Username ignoring case, idempotently, and unfollows', () =>
		isolated(async (tx) => {
			const { alice, bob } = await world(tx);
			expect(await followMember(tx, bob, 'ALICE')).toEqual({
				ok: true,
				value: { following: true }
			});
			expect(await followMember(tx, bob, 'alice')).toMatchObject({ ok: true });
			expect(await tx.select().from(follow)).toHaveLength(1);
			expect((await getProfile(tx, 'alice', bob.memberId))?.isFollowing).toBe(true);
			expect((await getProfile(tx, 'alice', null))?.isFollowing).toBe(false);
			expect((await listFollowers(tx, alice.memberId)).items).toEqual([
				{ username: 'bob', iconKey: null }
			]);
			expect((await listFollowing(tx, bob.memberId)).items.map((m) => m.username)).toEqual([
				'alice'
			]);
			expect(await unfollowMember(tx, bob, 'alice')).toEqual({
				ok: true,
				value: { following: false }
			});
			expect(await tx.select().from(follow)).toHaveLength(0);
		}));

	it('refuses self-follow, unknown Members, suspended targets and suspended actors', () =>
		isolated(async (tx) => {
			const { alice, bob } = await world(tx);
			expect(await followMember(tx, alice, 'Alice')).toEqual({ ok: false, error: 'self_follow' });
			expect(await followMember(tx, alice, 'nobody')).toEqual({ ok: false, error: 'not_found' });
			expect(await followMember(tx, { ...alice, suspended: true }, 'bob')).toEqual({
				ok: false,
				error: 'suspended'
			});
			await tx.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, bob.memberId));
			expect(await followMember(tx, alice, 'bob')).toEqual({ ok: false, error: 'not_found' });
		}));

	it('lists leave out suspended Members and counts follow suit', () =>
		isolated(async (tx) => {
			const { alice, bob } = await world(tx);
			await followMember(tx, bob, 'alice');
			await tx.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, bob.memberId));
			expect((await listFollowers(tx, alice.memberId)).items).toEqual([]);
			expect((await getProfile(tx, 'alice', null))?.followerCount).toBe(0);
		}));
});

describe('profile (FR-054)', () => {
	it('shows counts and Recipes; hides suspended and unnamed Members', () =>
		isolated(async (tx) => {
			const { alice, bob, r } = await world(tx);
			await followMember(tx, bob, 'alice');
			await likeRecipe(tx, bob, r);
			const p = await getProfile(tx, 'Alice', null);
			expect(p).toMatchObject({
				username: 'alice',
				recipeCount: 1,
				followerCount: 1,
				followingCount: 0
			});
			expect(Object.keys(p!)).not.toContain('email');
			const recipes = await listMemberRecipes(tx, alice.memberId);
			expect(recipes.items).toEqual([
				{
					id: r,
					title: 'ジントニック',
					mainPhotoKey: 'photos/ジントニック/main',
					ownerUsername: 'alice',
					likeCount: 1
				}
			]);
			await tx.insert(member).values({ username: null });
			expect(await getProfile(tx, 'null', null)).toBeNull();
			await tx.update(member).set({ suspendedAt: new Date() }).where(eq(member.id, alice.memberId));
			expect(await getProfile(tx, 'alice', null)).toBeNull();
		}));

	it('updateProfile: Username change is all-or-nothing and case-insensitively unique', () =>
		isolated(async (tx) => {
			const { alice } = await world(tx);
			expect(await updateProfile(tx, alice.memberId, { username: 'a!' })).toEqual({
				ok: false,
				error: 'username_invalid'
			});
			// Savepoint: the unique violation must not poison the test transaction.
			expect(await updateProfile(tx, alice.memberId, { username: 'BOB', bio: 'hi' })).toEqual({
				ok: false,
				error: 'username_taken'
			});
			expect(await getProfile(tx, 'alice', null)).toMatchObject({ bio: null });
			expect((await updateProfile(tx, alice.memberId, { username: 'Alice2', bio: 'hi' })).ok).toBe(
				true
			);
			expect(await getProfile(tx, 'alice2', null)).toMatchObject({ username: 'Alice2', bio: 'hi' });
		}));

	it('updateProfile: bio rules and icon replacement', () =>
		isolated(async (tx) => {
			const { alice } = await world(tx);
			const icon = () => `member/${crypto.randomUUID()}/list.webp`;
			expect(await updateProfile(tx, alice.memberId, { bio: 'あ'.repeat(201) })).toEqual({
				ok: false,
				error: 'bio_too_long'
			});
			expect(await updateProfile(tx, alice.memberId, { bio: 'あ'.repeat(200) })).toMatchObject({
				ok: true
			});
			expect(await updateProfile(tx, alice.memberId, { iconKey: 'recipe/x/list.webp' })).toEqual({
				ok: false,
				error: 'icon_key_invalid'
			});
			const first = icon();
			const second = icon();
			expect(await updateProfile(tx, alice.memberId, { iconKey: first })).toEqual({
				ok: true,
				value: { replacedIconKey: null }
			});
			expect(await updateProfile(tx, alice.memberId, { iconKey: second, bio: '  ' })).toEqual({
				ok: true,
				value: { replacedIconKey: first }
			});
			const p = await getProfile(tx, 'alice', null);
			expect(p).toMatchObject({ bio: null, iconKey: second });
			expect((await updateProfile(tx, alice.memberId, { iconKey: null })).ok).toBe(true);
			expect((await getProfile(tx, 'alice', null))?.iconKey).toBeNull();
		}));
});
