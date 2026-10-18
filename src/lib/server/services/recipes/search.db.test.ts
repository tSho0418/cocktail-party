import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { like } from '#lib/server/db/schema.js';
import type { Db } from './recipes';
import { searchRecipes, type SearchParams } from './search';
import { input, isolated, make, seedIngredients, seedMember } from './test-fixtures';

/** Titles of the matching Recipes, in result order. */
async function titles(tx: Db, params: SearchParams) {
	const r = await searchRecipes(tx, { limit: 50, ...params });
	if (!r.ok) throw new Error(r.error);
	return r.value.items.map((i) => i.title);
}

// Inside one transaction now() is constant, so spread created_at to make "new" order explicit.
const age = (tx: Db, id: string, minutes: number) =>
	tx.execute(
		sql`update recipe set created_at = now() - make_interval(mins => ${minutes}) where id = ${id}`
	);

let likers = 0;
async function addLikes(tx: Db, recipeId: string, n: number) {
	for (let k = 0; k < n; k++) {
		const m = await seedMember(tx, `liker_${++likers}`);
		await tx.insert(like).values({ memberId: m.memberId, recipeId });
	}
}

describe('searchRecipes: Ingredient search', () => {
	it('AND requires every Ingredient; onlyThese requires nothing outside the set (FR-041/042)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const [a, b, c] = [i.gin, i.tonic, i.lime];
			const fixtures: [string, [string, number][]][] = [
				['A', [[a, 1]]],
				[
					'AB',
					[
						[a, 1],
						[b, 3]
					]
				],
				[
					'ABC',
					[
						[a, 1],
						[b, 3],
						[c, 1]
					]
				],
				[
					'BC',
					[
						[b, 3],
						[c, 1]
					]
				],
				[
					'A+ベルモット',
					[
						[a, 4],
						[i.vermouth, 1]
					]
				]
			];
			for (const [n, [title, ings]] of fixtures.entries())
				await age(tx, await make(tx, alice, input(title, ings)), n);

			expect(await titles(tx, { ingredientIds: [a] })).toEqual(['A', 'AB', 'ABC', 'A+ベルモット']);
			expect(await titles(tx, { ingredientIds: [a, b] })).toEqual(['AB', 'ABC']);
			expect(await titles(tx, { ingredientIds: [a, b, c] })).toEqual(['ABC']);
			expect(await titles(tx, { ingredientIds: [a, a, b] })).toEqual(['AB', 'ABC']);
			expect(await titles(tx, { ingredientIds: [a], onlyThese: true })).toEqual(['A']);
			expect(await titles(tx, { ingredientIds: [a, b], onlyThese: true })).toEqual(['A', 'AB']);
			expect(await titles(tx, { ingredientIds: [a, b, c], onlyThese: true })).toEqual([
				'A',
				'AB',
				'ABC',
				'BC'
			]);
			expect(await titles(tx, { ingredientIds: [i.soda], onlyThese: true })).toEqual([]);
			// onlyThese without Ingredients is no filter at all.
			expect(await titles(tx, { onlyThese: true })).toHaveLength(5);
		}));
});

describe('searchRecipes: keyword (FR-043)', () => {
	it('matches title, description, Ingredient names and steps literally, incl. short Japanese', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const soda = (title: string, extra = {}) =>
				make(tx, alice, input(title, [[i.soda, 1]], { steps: ['注ぐ'], ...extra }));
			await soda('果汁100%ソーダ');
			await soda('ジン_スペシャル');
			await soda('バック\\スラッシュ');
			await soda('ソルティドッグ', { steps: ['グラスの縁に塩をつける'] });
			await soda('Gin Fizz', { description: '爽やかな一杯' });
			await make(tx, alice, input('ライム', [[i.lime, 1]], { steps: ['注ぐ'] }));

			const kw = async (keyword: string) => (await titles(tx, { keyword })).sort();
			expect(await kw('%')).toEqual(['果汁100%ソーダ']);
			expect(await kw('0%')).toEqual(['果汁100%ソーダ']);
			expect(await kw('_')).toEqual(['ジン_スペシャル']);
			expect(await kw('\\')).toEqual(['バック\\スラッシュ']);
			expect(await kw('ジ')).toEqual(['ジン_スペシャル', 'ライム']); // ライム has ライムジュース
			expect(await kw('塩')).toEqual(['ソルティドッグ']);
			expect(await kw('ドッ')).toEqual(['ソルティドッグ']);
			expect(await kw('スペシャル')).toEqual(['ジン_スペシャル']);
			expect(await kw('ライムジュース')).toEqual(['ライム']);
			expect(await kw('爽やか')).toEqual(['Gin Fizz']);
			expect(await kw('GIN fizz')).toEqual(['Gin Fizz']);
			expect(await kw('gin　爽やか')).toEqual(['Gin Fizz']);
			expect(await kw('gin 塩')).toEqual([]);
			expect(await kw('   ')).toHaveLength(6);
		}));
});

describe('searchRecipes: filters (FR-044, FR-025)', () => {
	it('matches any of the given Bases', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			await make(tx, alice, input('ジン', [[i.gin, 1]]));
			await make(tx, alice, input('ウォッカ', [[i.vodka, 1]]));
			await make(
				tx,
				alice,
				input('ラムとジン', [
					[i.rum, 1],
					[i.gin, 1]
				])
			);
			await make(tx, alice, input('ノンアル', [[i.lime, 1]]));
			const bases = async (baseIds: string[]) => (await titles(tx, { baseIds })).sort();
			expect(await bases([i.vodka, i.rum])).toEqual(['ウォッカ', 'ラムとジン']);
			expect(await bases([i.gin])).toEqual(['ジン', 'ラムとジン']);
			expect(await bases([i.vermouth])).toEqual([]); // not a Base

			const r = await searchRecipes(tx, { baseIds: [i.rum] });
			expect(r.ok && r.value.items[0].bases.map((b) => b.name)).toEqual(['ラム', 'ジン']);
		}));

	it('filters ABV on the override when present; Non-alcoholic ignores the override', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			await make(
				tx,
				alice,
				input('ジントニック', [
					[i.gin, 1],
					[i.tonic, 3]
				])
			); // auto 10
			await make(
				tx,
				alice,
				input(
					'薄いマティーニ',
					[
						[i.gin, 4.5],
						[i.vermouth, 1.5]
					],
					{ abvOverride: 12 }
				)
			); // auto 34.5
			await make(
				tx,
				alice,
				input(
					'ほぼ水',
					[
						[i.gin, 0.1],
						[i.soda, 99.9]
					],
					{ abvOverride: 0.1 }
				)
			);
			await make(
				tx,
				alice,
				input('ライムソーダ', [
					[i.lime, 1],
					[i.soda, 4]
				])
			);

			const abv = async (p: SearchParams) => (await titles(tx, p)).sort();
			expect(await abv({ abvMin: 11, abvMax: 13 })).toEqual(['薄いマティーニ']);
			expect(await abv({ abvMin: 30, abvMax: 40 })).toEqual([]);
			expect(await abv({ abvMin: 10, abvMax: 10 })).toEqual(['ジントニック']);
			expect(await abv({ abvMax: 0 })).toEqual(['ライムソーダ']);
			expect(await abv({ abvMax: 0.1 })).toEqual(['ほぼ水', 'ライムソーダ']);
			expect(await abv({ nonAlcoholic: true })).toEqual(['ライムソーダ']);
			expect(await abv({ nonAlcoholic: false })).toHaveLength(4);

			const r = await searchRecipes(tx, { keyword: 'マティーニ' });
			expect(r.ok && r.value.items[0]).toMatchObject({
				effectiveAbv: 12,
				isOverride: true,
				nonAlcoholic: false,
				ownerUsername: 'alice',
				likeCount: 0
			});
		}));

	it("hides suspended Members' Recipes (FR-075)", () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const sus = await seedMember(tx, 'sus');
			const i = await seedIngredients(tx);
			await make(tx, alice, input('見える', [[i.gin, 1]]));
			await make(tx, sus, input('隠れる', [[i.gin, 1]]));
			await tx.execute(sql`update member set suspended_at = now() where id = ${sus.memberId}`);
			expect(await titles(tx, {})).toEqual(['見える']);
			expect(await titles(tx, { sort: 'like', ingredientIds: [i.gin] })).toEqual(['見える']);
		}));
});

describe('searchRecipes: sort and pagination (FR-045)', () => {
	it('sorts by like count, newest first among ties', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const ids: Record<string, string> = {};
			for (const [n, t] of ['P', 'Q', 'R', 'S'].entries()) {
				ids[t] = await make(tx, alice, input(t, [[i.gin, 1]]));
				await age(tx, ids[t], 10 - n); // P oldest, S newest
			}
			await addLikes(tx, ids.P, 2);
			await addLikes(tx, ids.Q, 1);
			await addLikes(tx, ids.R, 1);
			expect(await titles(tx, { sort: 'like' })).toEqual(['P', 'R', 'Q', 'S']);
			expect(await titles(tx, { sort: 'new' })).toEqual(['S', 'R', 'Q', 'P']);
		}));

	it('pages without duplicates or gaps, even when created_at and like counts tie', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const all: string[] = [];
			for (let n = 0; n < 8; n++) {
				const id = await make(tx, alice, input(`R${n}`, [[i.gin, 1]]));
				all.push(id);
				if (n % 3 === 0) await addLikes(tx, id, 1); // ties on likes and created_at
				if (n >= 5) await age(tx, id, n); // and a few distinct timestamps
			}
			for (const sort of ['new', 'like'] as const) {
				const full = await searchRecipes(tx, { sort, limit: 50 });
				const expected = full.ok ? full.value.items.map((x) => x.id) : [];
				const seen: string[] = [];
				let cursor: string | null = null;
				let pages = 0;
				do {
					const r = await searchRecipes(tx, { sort, limit: 3, cursor });
					if (!r.ok) throw new Error(r.error);
					seen.push(...r.value.items.map((x) => x.id));
					cursor = r.value.nextCursor;
					pages++;
				} while (cursor);
				expect(pages).toBe(3);
				expect(seen).toEqual(expected);
				expect(new Set(seen)).toEqual(new Set(all));
			}
		}));

	it('rejects malformed queries instead of throwing', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			for (let n = 0; n < 2; n++) await make(tx, alice, input(`R${n}`, [[i.gin, 1]]));
			const page = await searchRecipes(tx, { limit: 1 });
			const cursor = page.ok ? page.value.nextCursor : null;
			expect(cursor).toBeTypeOf('string');

			const forged = (c: object) => Buffer.from(JSON.stringify(c)).toString('base64url');
			const bad: SearchParams[] = [
				{ limit: 0 },
				{ limit: 51 },
				{ limit: 1.5 },
				{ cursor: 'garbage' },
				{ cursor, sort: 'like' }, // cursor from another sort
				{ cursor: forged({ s: 'new', l: 0, t: '2026-13-01 00:00:00+00', i: crypto.randomUUID() }) },
				{
					cursor: forged({ s: 'new', l: 0, t: "'; drop table recipe; --", i: crypto.randomUUID() })
				},
				{ ingredientIds: ['nope'] },
				{ baseIds: ['nope'] },
				{ abvMin: Number.NaN }
			];
			for (const p of bad)
				expect(await searchRecipes(tx, p), JSON.stringify(p)).toEqual({
					ok: false,
					error: 'invalid_query'
				});
		}));
});
