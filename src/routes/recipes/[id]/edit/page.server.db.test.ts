import { randomUUID } from 'node:crypto';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { ingredient, member } from '#lib/server/db/schema.js';
import { createRecipe } from '#lib/server/services/recipes/index.js';
import { load } from './+page.server';

const tag = randomUUID().slice(0, 8);
let alice: App.Locals['member'];
let bob: App.Locals['member'];
let recipeId: string;

const run = (member: App.Locals['member'], id: string) =>
	load({ locals: { member }, params: { id } } as unknown as Parameters<typeof load>[0]);

beforeAll(async () => {
	const [a, b] = await db
		.insert(member)
		.values([{ username: `alice_${tag}` }, { username: `bob_${tag}` }])
		.returning();
	alice = { id: a.id, username: a.username, isAdministrator: false };
	bob = { id: b.id, username: b.username, isAdministrator: false };
	const [gin, tonic] = await db
		.insert(ingredient)
		.values([
			{ name: `ジン${tag}`, abvPercent: 40, isBaseSpirit: true },
			{ name: `トニック${tag}`, abvPercent: 0 }
		])
		.returning();
	const created = await createRecipe(
		db,
		{ memberId: a.id, isAdministrator: false },
		{
			title: 'ジントニック',
			mainPhotoKey: 'recipe/6a1d5f0e-0000-4000-8000-000000000001/list.webp',
			extraPhotoKeys: ['recipe/6a1d5f0e-0000-4000-8000-000000000002/list.webp'],
			ingredients: [
				{ ingredientId: gin.id, mixRatio: 1 },
				{ ingredientId: tonic.id, mixRatio: 3.5 }
			],
			steps: ['氷を入れる', '注ぐ'],
			abvOverride: 12
		}
	);
	if (!created.ok) throw new Error(created.error);
	recipeId = created.value.id;
});

describe('/recipes/[id]/edit load', () => {
	it('sends a signed-out visitor to log in', async () => {
		try {
			await run(null, recipeId);
			expect.unreachable();
		} catch (e) {
			expect(isRedirect(e) && [e.status, e.location]).toEqual([303, '/login']);
		}
	});

	it('gives the owner the Recipe as form values, keeping Mix Ratios and the override as saved', async () => {
		const data = await run(alice, recipeId);
		expect(data).toMatchObject({
			recipeId,
			initial: {
				title: 'ジントニック',
				mainPhoto: { key: 'recipe/6a1d5f0e-0000-4000-8000-000000000001/list.webp' },
				extraPhotos: [{ key: 'recipe/6a1d5f0e-0000-4000-8000-000000000002/list.webp' }],
				steps: ['氷を入れる', '注ぐ'],
				abvOverride: '12'
			}
		});
		expect(
			data!.initial.ingredients.map((r: { ingredient: { name: string }; mixRatio: string }) => [
				r.ingredient.name,
				r.mixRatio
			])
		).toEqual([
			[`ジン${tag}`, '1'],
			[`トニック${tag}`, '3.5']
		]);
	});

	it.each([
		['another Member', 403, () => run(bob, recipeId)],
		['an unknown id', 404, () => run(alice, randomUUID())],
		['a malformed id', 404, () => run(alice, 'nope')]
	])('answers %s with %i', async (_, status, call) => {
		try {
			await call();
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, status)).toBe(true);
		}
	});
});
