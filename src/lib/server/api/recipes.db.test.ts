import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '#lib/server/db/index.js';
import { like, photoUpload } from '#lib/server/db/schema.js';
import { MAX_JSON_BYTES } from './http';
import { createApp } from './app';
import { call, seedMember, store, uploadPhoto, type TestMember } from './test-helpers';

let alice: TestMember;
let bob: TestMember;
let admin: TestMember;
let noName: TestMember;
let gin: string;
let tonic: string;
const tag = randomUUID().slice(0, 8);

// Photos go through the real upload route, which records the uploader (FR-007).
const recipeBody = async (as: TestMember, title: string, extra: object = {}) => ({
	title,
	description: '',
	mainPhotoKey: (await uploadPhoto(as)).detail,
	ingredients: [
		{ ingredientId: gin, mixRatio: 3 },
		{ ingredientId: tonic, mixRatio: 5 }
	],
	steps: ['注ぐ', '混ぜる'],
	...extra
});

async function createRecipe(as: TestMember, title: string, extra: object = {}) {
	const res = await call(as, 'POST', '/recipes', await recipeBody(as, title, extra));
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
		const body = await recipeBody(alice, 'a');
		expect((await call(null, 'POST', '/recipes', body)).status).toBe(401);
		expect((await call(noName, 'POST', '/recipes', body)).status).toBe(403);
		expect((await call(alice, 'POST', '/recipes', { title: 'a' })).status).toBe(400);
	});

	it('422 with the service error for a rejected Recipe (FR-007)', async () => {
		const res = await call(
			alice,
			'POST',
			'/recipes',
			await recipeBody(alice, 'x', { mainPhotoKey: ' ' })
		);
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
		const first = await uploadPhoto(alice);
		const id = await createRecipe(alice, `編集${tag}`, { mainPhotoKey: first.detail });
		const next = await recipeBody(alice, `編集後${tag}`);

		expect((await call(null, 'PUT', `/recipes/${id}`, next)).status).toBe(401);
		expect((await call(bob, 'PUT', `/recipes/${id}`, next)).status).toBe(403);
		expect((await call(alice, 'PUT', `/recipes/${randomUUID()}`, next)).status).toBe(404);
		expect(store.objects.has(first.list)).toBe(true);

		const res = await call(alice, 'PUT', `/recipes/${id}`, next);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id, overrideDiscarded: false });
		expect(store.objects.has(first.detail)).toBe(false);
		expect(store.objects.has(first.list)).toBe(false);
		expect(store.objects.has(next.mainPhotoKey)).toBe(true);
		expect((await (await call(null, 'GET', `/recipes/${id}`)).json()).title).toBe(`編集後${tag}`);
	});

	it("422 for another Member's upload, a Member icon, an unknown or malformed key, and deletes nothing", async () => {
		const mine = await uploadPhoto(alice);
		const theirs = await uploadPhoto(bob);
		const icon = (await uploadPhoto(bob, 'member')).list;
		const id = await createRecipe(alice, `細工${tag}`, { mainPhotoKey: mine.detail });
		const keys = [
			theirs.detail,
			theirs.list,
			icon,
			`recipe/${randomUUID()}/list.webp`,
			'recipe/not-a-uuid/detail.webp',
			'photos/main'
		];
		for (const key of keys) {
			for (const field of ['mainPhotoKey', 'extraPhotoKeys'] as const) {
				const patch = { [field]: field === 'mainPhotoKey' ? key : [key] };
				const body = await recipeBody(alice, `細工後${tag}`, patch);
				const put = await call(alice, 'PUT', `/recipes/${id}`, body);
				expect([key, field, put.status]).toEqual([key, field, 422]);
				expect((await put.json()).error).toBe('photo_key_invalid');
				const post = await call(alice, 'POST', '/recipes', body);
				expect([key, field, post.status]).toEqual([key, field, 422]);
			}
		}
		for (const k of [mine.detail, mine.list, theirs.detail, theirs.list, icon])
			expect(store.objects.has(k)).toBe(true);
		expect((await (await call(null, 'GET', `/recipes/${id}`)).json()).title).toBe(`細工${tag}`);
	});

	it('keeps a photo another of the same Member’s Recipes still uses', async () => {
		const shared = await uploadPhoto(alice);
		const a = await createRecipe(alice, `共有A${tag}`, { mainPhotoKey: shared.detail });
		await createRecipe(alice, `共有B${tag}`, { extraPhotoKeys: [shared.list] });
		const res = await call(alice, 'PUT', `/recipes/${a}`, await recipeBody(alice, `共有A後${tag}`));
		expect(res.status).toBe(200);
		expect(store.objects.has(shared.detail)).toBe(true);
		expect(store.objects.has(shared.list)).toBe(true);
	});

	it('does not fail a committed write when storage cannot be reached', async () => {
		const broken = createApp({
			store: () => {
				throw new Error('R2_BUCKET is not set');
			}
		});
		const first = (await uploadPhoto(alice)).detail;
		const id = await createRecipe(alice, `障害${tag}`, { mainPhotoKey: first });
		const res = await call(
			alice,
			'PUT',
			`/recipes/${id}`,
			await recipeBody(alice, `障害後${tag}`),
			broken
		);
		expect(res.status).toBe(200);
		expect((await call(alice, 'DELETE', `/recipes/${id}`, undefined, broken)).status).toBe(204);
	});

	it('answers 200 / 204 when a storage delete rejects, and the writes still apply (best effort)', async () => {
		const failing = createApp({
			store: () => ({
				put: store.put,
				publicUrl: store.publicUrl,
				delete: () => Promise.reject(new Error('R2 unavailable'))
			})
		});
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const first = await uploadPhoto(alice);
		const id = await createRecipe(alice, `削除失敗${tag}`, { mainPhotoKey: first.detail });
		const next = await recipeBody(alice, `削除失敗後${tag}`);
		const put = await call(alice, 'PUT', `/recipes/${id}`, next, failing);
		expect(put.status).toBe(200);
		expect((await (await call(null, 'GET', `/recipes/${id}`)).json()).title).toBe(
			`削除失敗後${tag}`
		);
		const del = await call(alice, 'DELETE', `/recipes/${id}`, undefined, failing);
		expect(del.status).toBe(204);
		expect((await call(null, 'GET', `/recipes/${id}`)).status).toBe(404);
		// The orphaned objects were attempted (and logged), not silently skipped.
		expect(log).toHaveBeenCalledWith('photo cleanup failed', expect.any(Error));
		log.mockRestore();
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

describe('GET /api/recipes query parameters', () => {
	// Own tag and Ingredients so these Recipes never show up in the other tests' searches.
	const q = `p${randomUUID().slice(0, 8)}`;
	let rum: string;
	let lime: string;
	const ids: Record<string, string> = {};
	const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title);
	const search = async (query: string) => {
		const res = await call(null, 'GET', `/recipes?keyword=${q}&${query}`);
		expect(res.status).toBe(200);
		return res.json();
	};

	beforeAll(async () => {
		rum = (
			await (
				await call(admin, 'POST', '/ingredients', {
					name: `ラム${q}`,
					abvPercent: 40,
					isBaseSpirit: true
				})
			).json()
		).id;
		lime = (
			await (
				await call(alice, 'POST', '/ingredients', { name: `ライム${q}`, abvPercent: 0 })
			).json()
		).id;
		// Oldest first. ABV: gt 15, gt2 20, rum 10, soft 0, gin 40.
		const recipes: [string, [string, number][]][] = [
			[
				'gt',
				[
					[gin, 3],
					[tonic, 5]
				]
			],
			[
				'gt2',
				[
					[gin, 1],
					[tonic, 1]
				]
			],
			[
				'rum',
				[
					[rum, 1],
					[tonic, 3]
				]
			],
			[
				'soft',
				[
					[tonic, 1],
					[lime, 1]
				]
			],
			['gin', [[gin, 1]]]
		];
		for (const [name, ing] of recipes)
			ids[name] = await createRecipe(alice, `${name}${q}`, {
				ingredients: ing.map(([ingredientId, mixRatio]) => ({ ingredientId, mixRatio }))
			});
		await db.insert(like).values([
			{ memberId: alice.id, recipeId: ids.gt2 },
			{ memberId: bob.id, recipeId: ids.gt2 },
			{ memberId: bob.id, recipeId: ids.gt }
		]);
	});

	it('ingredientIds is AND (FR-041); onlyThese turns it into "within these" (FR-042)', async () => {
		expect(titles(await search(`ingredientIds=${gin},${tonic}`))).toEqual([`gt2${q}`, `gt${q}`]);
		expect(titles(await search(`ingredientIds=${gin},${tonic}&onlyThese=true`))).toEqual([
			`gin${q}`,
			`gt2${q}`,
			`gt${q}`
		]);
		expect(titles(await search(`ingredientIds=${tonic},${lime}`))).toEqual([`soft${q}`]);
	});

	it('baseIds matches any of the Bases (FR-044)', async () => {
		expect(titles(await search(`baseIds=${rum}`))).toEqual([`rum${q}`]);
		expect(titles(await search(`baseIds=${rum},${gin}`))).toEqual([
			`gin${q}`,
			`rum${q}`,
			`gt2${q}`,
			`gt${q}`
		]);
	});

	it('abvMin and abvMax bound the effective ABV inclusively (FR-044)', async () => {
		expect(titles(await search('abvMin=15'))).toEqual([`gin${q}`, `gt2${q}`, `gt${q}`]);
		expect(titles(await search('abvMax=10'))).toEqual([`soft${q}`, `rum${q}`]);
		expect(titles(await search('abvMin=10&abvMax=15'))).toEqual([`rum${q}`, `gt${q}`]);
		expect(titles(await search('abvMin=41'))).toEqual([]);
	});

	it('sort=like orders by likes, then newest, and its cursor round-trips', async () => {
		expect(titles(await search(''))).toEqual(['gin', 'soft', 'rum', 'gt2', 'gt'].map((n) => n + q));

		const query = 'sort=like&limit=2';
		const p1 = await search(query);
		expect(titles(p1)).toEqual([`gt2${q}`, `gt${q}`]);
		const p2 = await search(`${query}&cursor=${p1.nextCursor}`);
		expect(titles(p2)).toEqual([`gin${q}`, `soft${q}`]);
		const p3 = await search(`${query}&cursor=${p2.nextCursor}`);
		expect(titles(p3)).toEqual([`rum${q}`]);
		expect(p3.nextCursor).toBeNull();

		// A cursor minted for another sort is not accepted.
		const newCursor = (await search('limit=1')).nextCursor;
		expect((await call(null, 'GET', `/recipes?sort=like&cursor=${newCursor}`)).status).toBe(400);
	});
});

describe('input bounds (FR-043, #11)', () => {
	const terms = (n: number) => Array.from({ length: n }, (_, k) => `t${k}`).join('+');
	const uuids = (n: number) => Array.from({ length: n }, () => randomUUID()).join(',');

	it('caps keyword terms at 10 and ingredientIds / baseIds at 20 with 400', async () => {
		const status = async (query: string) => (await call(null, 'GET', `/recipes?${query}`)).status;
		expect(await status(`keyword=${terms(10)}`)).toBe(200);
		expect(await status(`keyword=${terms(11)}`)).toBe(400);
		expect(await status(`ingredientIds=${uuids(20)}`)).toBe(200);
		expect(await status(`ingredientIds=${uuids(21)}`)).toBe(400);
		expect(await status(`baseIds=${uuids(20)}`)).toBe(200);
		expect(await status(`baseIds=${uuids(21)}`)).toBe(400);
	});

	it('413 for a JSON body over the limit on POST and PUT, before any parsing', async () => {
		const id = await createRecipe(alice, `大きい${tag}`);
		const huge = {
			...(await recipeBody(alice, `巨大${tag}`)),
			description: 'a'.repeat(MAX_JSON_BYTES)
		};
		for (const [method, path] of [
			['POST', '/recipes'],
			['PUT', `/recipes/${id}`]
		] as const) {
			const res = await call(alice, method, path, huge);
			expect([method, res.status]).toEqual([method, 413]);
			expect(await res.json()).toEqual({ error: 'too_large' });
		}
		expect(
			(await call(alice, 'POST', '/recipes', await recipeBody(alice, `通常${tag}`))).status
		).toBe(201);
	});

	it('413 for an oversized chunked body (no Content-Length) too', async () => {
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(MAX_JSON_BYTES + 1));
				controller.close();
			}
		});
		const res = await createApp({ store: () => store }).request(
			'/api/recipes',
			{
				method: 'POST',
				body,
				...({ duplex: 'half' } as RequestInit),
				headers: { 'content-type': 'application/json' }
			},
			{ locals: { member: alice } }
		);
		expect(res.status).toBe(413);
	});
});

describe('uploads are recorded against the uploader (FR-007)', () => {
	it('POST /api/photos records the Member, and deleting the last Recipe using it releases the row', async () => {
		const keys = await uploadPhoto(alice);
		const row = () =>
			db
				.select()
				.from(photoUpload)
				.where(eq(photoUpload.id, keys.list.split('/')[1]));
		expect(await row()).toMatchObject([{ memberId: alice.id, kind: 'recipe' }]);
		const id = await createRecipe(alice, `記録${tag}`, { mainPhotoKey: keys.list });
		expect((await call(alice, 'DELETE', `/recipes/${id}`)).status).toBe(204);
		expect(await row()).toEqual([]);
		// Released: it can no longer be attached to a new Recipe.
		const again = await call(
			alice,
			'POST',
			'/recipes',
			await recipeBody(alice, 'x', { mainPhotoKey: keys.list })
		);
		expect(again.status).toBe(422);
	});
});
