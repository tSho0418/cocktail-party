import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, seedMember, type TestMember } from './test-helpers';

let alice: TestMember;
let bob: TestMember;
let noName: TestMember;
let recipeId: string;
const tag = randomUUID().slice(0, 8);

beforeAll(async () => {
	[alice, bob, noName] = [
		await seedMember(`alice_${tag}`),
		await seedMember(`bob_${tag}`),
		await seedMember(null)
	];
	const admin = await seedMember(`admin_${tag}`, { isAdministrator: true });
	const gin = (
		await (
			await call(admin, 'POST', '/ingredients', {
				name: `ジン${tag}`,
				abvPercent: 40,
				isBaseSpirit: true
			})
		).json()
	).id;
	const res = await call(alice, 'POST', '/recipes', {
		title: `レシピ${tag}`,
		mainPhotoKey: `recipe/${randomUUID()}/list.webp`,
		ingredients: [{ ingredientId: gin, mixRatio: 3 }],
		steps: ['注ぐ']
	});
	recipeId = (await res.json()).id;
});

describe('Like / Save routes', () => {
	it('401 signed out, 403 without a Username, for every mutating route', async () => {
		for (const [method, path] of [
			['PUT', `/recipes/${recipeId}/like`],
			['DELETE', `/recipes/${recipeId}/like`],
			['PUT', `/recipes/${recipeId}/save`],
			['DELETE', `/recipes/${recipeId}/save`],
			['GET', '/me/saves'],
			['PUT', `/members/alice_${tag}/follow`],
			['DELETE', `/members/alice_${tag}/follow`]
		]) {
			expect((await call(null, method, path)).status, `${method} ${path}`).toBe(401);
			expect((await call(noName, method, path)).status, `${method} ${path}`).toBe(403);
		}
	});

	it('like: counts, is idempotent, refuses own Recipe, 404 unknown', async () => {
		const put = await call(bob, 'PUT', `/recipes/${recipeId}/like`);
		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ liked: true, likeCount: 1 });
		expect(await (await call(bob, 'PUT', `/recipes/${recipeId}/like`)).json()).toMatchObject({
			likeCount: 1
		});
		const own = await call(alice, 'PUT', `/recipes/${recipeId}/like`);
		expect(own.status).toBe(422);
		expect(await own.json()).toEqual({ error: 'own_recipe' });
		expect((await call(bob, 'PUT', `/recipes/${randomUUID()}/like`)).status).toBe(404);

		// The Like count is public; who liked is not exposed anywhere.
		const detail = await (await call(null, 'GET', `/recipes/${recipeId}`)).json();
		expect(detail.likeCount).toBe(1);
		expect(JSON.stringify(detail)).not.toContain(bob.id);
		expect(await (await call(null, 'GET', `/recipes/${recipeId}/reactions`)).json()).toEqual({
			likeCount: 1,
			liked: false,
			saved: false
		});
		expect(await (await call(bob, 'GET', `/recipes/${recipeId}/reactions`)).json()).toMatchObject({
			liked: true
		});

		const del = await call(bob, 'DELETE', `/recipes/${recipeId}/like`);
		expect(await del.json()).toEqual({ liked: false, likeCount: 0 });
	});

	it('save: only the owner sees the list', async () => {
		expect((await call(bob, 'PUT', `/recipes/${recipeId}/save`)).status).toBe(200);
		const mine = await (await call(bob, 'GET', '/me/saves')).json();
		expect(mine.items.map((r: { id: string }) => r.id)).toEqual([recipeId]);
		// Another Member's /me/saves is their own list; the Save is not reachable from the profile.
		expect((await (await call(alice, 'GET', '/me/saves')).json()).items).toEqual([]);
		const profile = await call(bob, 'GET', `/members/bob_${tag}`);
		expect(JSON.stringify(await profile.json())).not.toContain(recipeId);
		expect((await call(null, 'GET', `/recipes/${recipeId}/reactions`)).status).toBe(200);
		expect(await (await call(null, 'GET', `/recipes/${recipeId}/reactions`)).json()).toMatchObject({
			saved: false
		});

		expect(await (await call(bob, 'DELETE', `/recipes/${recipeId}/save`)).json()).toEqual({
			saved: false
		});
		expect((await (await call(bob, 'GET', '/me/saves')).json()).items).toEqual([]);
	});
});

describe('Follow and profile routes', () => {
	it('follow: not oneself, 404 unknown, idempotent; lists are public', async () => {
		const self = await call(alice, 'PUT', `/members/ALICE_${tag}/follow`);
		expect(self.status).toBe(422);
		expect(await self.json()).toEqual({ error: 'self_follow' });
		expect((await call(bob, 'PUT', '/members/nobody_zz/follow')).status).toBe(404);

		for (let n = 0; n < 2; n++) {
			const res = await call(bob, 'PUT', `/members/alice_${tag}/follow`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ following: true });
		}

		const asBob = await (await call(bob, 'GET', `/members/alice_${tag}`)).json();
		expect(asBob).toMatchObject({
			username: `alice_${tag}`,
			followerCount: 1,
			recipeCount: 1,
			isFollowing: true
		});
		expect(asBob).not.toHaveProperty('email');
		expect(await (await call(null, 'GET', `/members/alice_${tag}`)).json()).toMatchObject({
			isFollowing: false
		});
		const followers = await (await call(null, 'GET', `/members/alice_${tag}/followers`)).json();
		expect(followers.items).toEqual([{ username: `bob_${tag}`, iconKey: null }]);
		const following = await (await call(null, 'GET', `/members/bob_${tag}/following`)).json();
		expect(following.items.map((m: { username: string }) => m.username)).toEqual([`alice_${tag}`]);
		const recipes = await (await call(null, 'GET', `/members/alice_${tag}/recipes`)).json();
		expect(recipes.items.map((r: { id: string }) => r.id)).toEqual([recipeId]);

		expect(await (await call(bob, 'DELETE', `/members/alice_${tag}/follow`)).json()).toEqual({
			following: false
		});
		expect(
			(await (await call(null, 'GET', `/members/alice_${tag}/followers`)).json()).items
		).toEqual([]);
	});

	it('404 for an unknown profile', async () => {
		expect((await call(null, 'GET', '/members/nobody_zz')).status).toBe(404);
		expect((await call(null, 'GET', '/members/nobody_zz/followers')).status).toBe(404);
	});
});
