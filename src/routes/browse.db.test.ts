import { randomUUID } from 'node:crypto';
import { isHttpError } from '@sveltejs/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { ingredient, member } from '#lib/server/db/schema.js';
import { createRecipe } from '#lib/server/services/recipes/index.js';
import type { PageData as ListData } from './$types';
import type { PageData as DetailData } from './recipes/[id]/$types';
import { load as loadList } from './+page.server';
import { load as loadDetail } from './recipes/[id]/+page.server';

const tag = `browse${randomUUID().slice(0, 8)}`;
const tag2 = `filter${randomUUID().slice(0, 8)}`;
let gin: string;
let tonic: string;
let owner: { memberId: string; isAdministrator: boolean };
let suspendedOwner: { memberId: string; isAdministrator: boolean };

// Our load functions always return data; SvelteKit's loose type is replaced by the page's real one.
const list = async (search: string) =>
	(await loadList({ url: new URL(`http://localhost/${search}`) } as Parameters<
		typeof loadList
	>[0])) as unknown as ListData;
const detail = async (id: string) =>
	(await loadDetail({ params: { id } } as Parameters<
		typeof loadDetail
	>[0])) as unknown as DetailData;

async function make(actor: typeof owner, title: string, ids = [gin, tonic], extra = {}) {
	const r = await createRecipe(db, actor, {
		title,
		description: `${tag} の説明`,
		mainPhotoKey: `recipe/${randomUUID()}/list.webp`,
		ingredients: ids.map((ingredientId) => ({ ingredientId, mixRatio: 3 })),
		steps: ['注ぐ', '混ぜる'],
		...extra
	});
	if (!r.ok) throw new Error(r.error);
	return r.value.id;
}

beforeAll(async () => {
	const [a, b] = await db
		.insert(member)
		.values([{ username: `own_${tag}` }, { username: `sus_${tag}`, suspendedAt: new Date() }])
		.returning();
	owner = { memberId: a.id, isAdministrator: false };
	suspendedOwner = { memberId: b.id, isAdministrator: false };
	[gin, tonic] = (
		await db
			.insert(ingredient)
			.values([
				{ name: `ジン${tag}`, abvPercent: 40, isBaseSpirit: true },
				{ name: `トニック${tag}`, abvPercent: 0 }
			])
			.returning()
	).map((r) => r.id);
});

describe('top page load', () => {
	it('pages through the list with the cursor in the next link and keeps the search', async () => {
		for (let i = 0; i < 21; i++) await make(owner, `一覧${i}`);

		const first = await list(`?q=${tag}`);
		expect(first.recipes).toHaveLength(20);
		expect(first.hasCursor).toBe(false);
		expect(first.nextQuery).toContain(`q=${tag}`);

		const second = await list(first.nextQuery!);
		expect(second.recipes).toHaveLength(1);
		expect(second.hasCursor).toBe(true);
		expect(second.nextQuery).toBeNull();
		expect(second.firstQuery).toBe(`?q=${tag}`);
		const ids = [...first.recipes, ...second.recipes].map((r) => r.id);
		expect(new Set(ids).size).toBe(21);
	});

	it('applies ingredient AND, only-these and Base filters from the URL', async () => {
		await make(owner, `${tag2}両方`, [gin, tonic]);
		await make(owner, `${tag2}ジンだけ`, [gin]);
		const titles = async (q: string) => (await list(`?q=${tag2}&${q}`)).recipes.map((r) => r.title);

		expect(await titles(`ing=${gin}&ing=${tonic}`)).toEqual([`${tag2}両方`]);
		expect((await titles(`ing=${gin}&only=1`)).sort()).toEqual([`${tag2}ジンだけ`]);
		expect(await titles(`base=${gin}&ing=${tonic}`)).toEqual([`${tag2}両方`]);
	});

	it('lists the Ingredient master and hides Recipes of suspended Members', async () => {
		await make(suspendedOwner, '停止中の人のレシピ');
		const page = await list(`?q=${tag}`);
		expect(page.recipes.map((r) => r.title)).not.toContain('停止中の人のレシピ');
		expect(page.ingredients.map((i) => i.id)).toEqual(expect.arrayContaining([gin, tonic]));
	});

	it('answers 400 for a malformed search', async () => {
		for (const q of ['?cursor=nonsense', '?ing=not-a-uuid', '?abvMin=abc'])
			await expect(list(q)).rejects.toSatisfy((e) => isHttpError(e, 400));
	});
});

describe('Recipe detail load', () => {
	it('returns the Recipe with its Ingredients and steps in order', async () => {
		const id = await make(owner, '詳細', [gin, tonic]);
		const page = await detail(id);
		expect(page.recipe).toMatchObject({ id, title: '詳細', steps: ['注ぐ', '混ぜる'] });
		expect(page.recipe.ingredients.map((i) => i.id)).toEqual([gin, tonic]);
		expect(page.recipe.owner.username).toBe(`own_${tag}`);
	});

	it('is 404 for unknown, malformed and suspended-owner Recipes', async () => {
		const hidden = await make(suspendedOwner, '見えない');
		for (const id of [randomUUID(), 'nope', hidden])
			await expect(detail(id)).rejects.toSatisfy((e) => isHttpError(e, 404));
	});
});
