import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, seedMember, store, type TestMember } from './test-helpers';

let alice: TestMember;
let bob: TestMember;
let admin: TestMember;
let noName: TestMember;
let gin: string;
let tonic: string;
const tag = randomUUID().slice(0, 8);

const recipeBody = (title: string, extra: object = {}) => ({
	title,
	description: '',
	mainPhotoKey: `recipe/${title}/detail.webp`,
	ingredients: [
		{ ingredientId: gin, mixRatio: 3 },
		{ ingredientId: tonic, mixRatio: 5 }
	],
	steps: ['注ぐ', '混ぜる'],
	...extra
});

async function createRecipe(as: TestMember, title: string, extra: object = {}) {
	const res = await call(as, 'POST', '/recipes', recipeBody(title, extra));
	expect(res.status).toBe(201);
	return (await res.json()).id as string;
}

beforeAll(async () => {
	[alice, bob, noName] = [
		await seedMember('alice_rec'),
		await seedMember('bob_rec'),
		await seedMember(null)
	];
	admin = await seedMember('admin_rec', { isAdministrator: true });
	gin = (
		await (
			await call(admin, 'POST', '/ingredients', {
				name: `ジン${tag}`,
				abvPercent: 40,
				isBaseSpirit: true
			})
		).json()
	).id;
	tonic = (
		await (
			await call(alice, 'POST', '/ingredients', { name: `トニック${tag}`, abvPercent: 0 })
		).json()
	).id;
});

describe('POST /api/recipes', () => {
	it('401 signed out, 403 without a Username, 400 for a malformed body', async () => {
		expect((await call(null, 'POST', '/recipes', recipeBody('a'))).status).toBe(401);
		expect((await call(noName, 'POST', '/recipes', recipeBody('a'))).status).toBe(403);
		expect((await call(alice, 'POST', '/recipes', { title: 'a' })).status).toBe(400);
	});

	it('422 with the service error for a rejected Recipe (FR-007)', async () => {
		const res = await call(alice, 'POST', '/recipes', recipeBody('x', { mainPhotoKey: ' ' }));
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe('main_photo_required');
	});

	it('publishes and is readable by anyone (FR-001, FR-046)', async () => {
		const id = await createRecipe(alice, `公開${tag}`, { abvOverride: 15 });
		const res = await call(null, 'GET', `/recipes/${id}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			id,
			title: `公開${tag}`,
			owner: { username: 'alice_rec' },
			isOverride: true,
			effectiveAbv: 15,
			bases: [{ name: `ジン${tag}` }]
		});
	});
});

describe('GET /api/recipes/:id', () => {
	it('404 for a missing or malformed id', async () => {
		expect((await call(null, 'GET', `/recipes/${randomUUID()}`)).status).toBe(404);
		expect((await call(null, 'GET', '/recipes/nope')).status).toBe(404);
	});
});

describe('PUT /api/recipes/:id', () => {
	it('401 / 403 / 404 / 200 and removes dropped photos from storage (FR-008)', async () => {
		const id = await createRecipe(alice, `編集${tag}`);
		await store.put(`recipe/編集${tag}/detail.webp`, new Uint8Array([1]), 'image/webp');
		await store.put(`recipe/編集${tag}/list.webp`, new Uint8Array([1]), 'image/webp');
		const next = recipeBody(`編集後${tag}`);
		await store.put(next.mainPhotoKey, new Uint8Array([1]), 'image/webp');

		expect((await call(null, 'PUT', `/recipes/${id}`, next)).status).toBe(401);
		expect((await call(bob, 'PUT', `/recipes/${id}`, next)).status).toBe(403);
		expect((await call(alice, 'PUT', `/recipes/${randomUUID()}`, next)).status).toBe(404);

		const res = await call(alice, 'PUT', `/recipes/${id}`, next);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id, overrideDiscarded: false });
		expect([...store.objects.keys()]).toEqual([next.mainPhotoKey]);
		expect((await (await call(null, 'GET', `/recipes/${id}`)).json()).title).toBe(`編集後${tag}`);
	});
});

describe('DELETE /api/recipes/:id', () => {
	it('401 / 403 / 204 for the owner, then 404; an Administrator may delete too (FR-008, FR-074)', async () => {
		const id = await createRecipe(alice, `削除${tag}`);
		expect((await call(null, 'DELETE', `/recipes/${id}`)).status).toBe(401);
		expect((await call(bob, 'DELETE', `/recipes/${id}`)).status).toBe(403);
		expect((await call(alice, 'DELETE', `/recipes/${id}`)).status).toBe(204);
		expect((await call(null, 'GET', `/recipes/${id}`)).status).toBe(404);
		expect((await call(alice, 'DELETE', `/recipes/${id}`)).status).toBe(404);

		const other = await createRecipe(bob, `管理者削除${tag}`);
		expect((await call(admin, 'DELETE', `/recipes/${other}`)).status).toBe(204);
	});
});

describe('GET /api/recipes (search)', () => {
	it('is public, filters, and pages with a keyset cursor (FR-041..045)', async () => {
		const titles = [1, 2, 3].map((n) => `検索${tag}${n}`);
		for (const t of titles) await createRecipe(alice, t);
		await createRecipe(alice, `別${tag}`, { ingredients: [{ ingredientId: tonic, mixRatio: 1 }] });

		const q = `keyword=${encodeURIComponent(`検索${tag}`)}&limit=2`;
		const first = await call(null, 'GET', `/recipes?${q}`);
		expect(first.status).toBe(200);
		const page1 = await first.json();
		expect(page1.items).toHaveLength(2);
		expect(page1.nextCursor).toBeTruthy();

		const page2 = await (
			await call(null, 'GET', `/recipes?${q}&cursor=${page1.nextCursor}`)
		).json();
		const seen = [...page1.items, ...page2.items].map((r: { title: string }) => r.title).sort();
		expect(seen).toEqual(titles);
		expect(page2.nextCursor).toBeNull();

		const byIngredient = await (
			await call(
				null,
				'GET',
				`/recipes?ingredientIds=${gin}&keyword=${encodeURIComponent(`検索${tag}`)}`
			)
		).json();
		expect(byIngredient.items).toHaveLength(3);
		const nonAlc = await (
			await call(null, 'GET', `/recipes?nonAlcoholic=true&keyword=${tag}`)
		).json();
		expect(nonAlc.items.map((r: { title: string }) => r.title)).toEqual([`別${tag}`]);
	});

	it('400 for a bad cursor, limit or sort', async () => {
		expect((await call(null, 'GET', '/recipes?cursor=garbage')).status).toBe(400);
		expect((await call(null, 'GET', '/recipes?limit=0')).status).toBe(400);
		expect((await call(null, 'GET', '/recipes?abvMin=abc')).status).toBe(400);
		expect((await call(null, 'GET', '/recipes?sort=random')).status).toBe(400);
	});
});
