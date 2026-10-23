// Query-plan check on ~2,000 generated Recipes; prints EXPLAIN ANALYZE, asserts no timings.
// It commits data and truncates member/ingredient afterwards, which is safe because every
// `pnpm test:db` run has its own database. EXPLAIN_SEARCH is the report path (not `1`):
// EXPLAIN_SEARCH=/tmp/explain.txt pnpm test:db search.explain
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '#lib/server/db/schema.js';
import { recomputeDerived } from '#lib/domain/alcohol/index.js';
import { searchRecipes, type SearchParams } from './search';
import { seedMember } from './test-fixtures';

describe.skipIf(!process.env.EXPLAIN_SEARCH)('searchRecipes EXPLAIN on 2,000 Recipes', () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	let last: { query: string; params: unknown[] }[] = [];
	const db = drizzle({
		client: pool,
		schema,
		logger: { logQuery: (query, params) => last.push({ query, params }) }
	});
	afterAll(async () => {
		await db.execute(sql`truncate member, ingredient cascade`);
		await pool.end();
	});

	it('generates data and explains the main queries', async () => {
		let seed = 42;
		// MINSTD: the product stays below 2^53, so the sequence is exact in doubles.
		const rand = (n: number) => ((seed = (seed * 48271) % 2147483647), seed % n);
		const words = [
			'爽やか',
			'甘口',
			'辛口',
			'フルーティー',
			'夏向け',
			'食後に',
			'定番',
			'ビター',
			'香り高い',
			'すっきり'
		];
		const verbs = [
			'シェイクする',
			'ステアする',
			'ビルドする',
			'氷を入れる',
			'レモンピールを搾る',
			'塩をつける',
			'ミントを叩く'
		];

		const members: { id: string }[] = [];
		for (let n = 0; n < 200; n++)
			members.push({ id: (await seedMember(db, `user_${n}`)).memberId });
		const ings = await db
			.insert(schema.ingredient)
			.values(
				Array.from({ length: 60 }, (_, n) => ({
					name: `材料${n}${words[n % 10]}`,
					abvPercent: n < 20 ? 40 : n < 35 ? 20 : 0,
					isBaseSpirit: n < 20
				}))
			)
			.returning();
		const recipes: (typeof schema.recipe.$inferInsert)[] = [];
		const items: { r: number; ingredientId: string; mixRatio: number; position: number }[] = [];
		for (let r = 0; r < 2000; r++) {
			const picked = [...new Set(Array.from({ length: 2 + rand(4) }, () => ings[rand(60)]))];
			const mix = picked.map((i) => ({ ...i, mixRatio: 1 + rand(5) }));
			const d = recomputeDerived(mix);
			const title = `${words[rand(10)]}なカクテル${r}`;
			const description = `${words[rand(10)]}で${words[rand(10)]}な一杯。`.repeat(1 + rand(5));
			const steps = Array.from({ length: 1 + rand(5) }, () => verbs[rand(7)]);
			recipes.push({
				memberId: members[rand(200)].id,
				title,
				description,
				mainPhotoKey: `p/${r}`,
				autoAbv: d.autoAbv,
				hasAlcohol: d.hasAlcohol,
				abvOverride: d.hasAlcohol && rand(5) === 0 ? Math.min(d.maxIngredientAbv, 5) : null,
				searchText: [title, description, ...picked.map((i) => i.name), ...steps].join('\n'),
				createdAt: new Date(Date.now() - r * 60_000)
			});
			mix.forEach((i, n) =>
				items.push({ r, ingredientId: i.id, mixRatio: i.mixRatio, position: n + 1 })
			);
		}
		const ids: { id: string }[] = [];
		for (let k = 0; k < recipes.length; k += 500)
			ids.push(
				...(await db
					.insert(schema.recipe)
					.values(recipes.slice(k, k + 500))
					.returning({ id: schema.recipe.id }))
			);
		for (let k = 0; k < items.length; k += 1000)
			await db
				.insert(schema.recipeIngredient)
				.values(items.slice(k, k + 1000).map(({ r, ...i }) => ({ ...i, recipeId: ids[r].id })));
		const likes = ids.flatMap(({ id }) =>
			Array.from(
				new Set(Array.from({ length: rand(8) }, () => members[rand(200)].id)),
				(memberId) => ({ memberId, recipeId: id })
			)
		);
		for (let k = 0; k < likes.length; k += 1000)
			await db.insert(schema.like).values(likes.slice(k, k + 1000));
		await db.execute(sql`analyze`);

		const cases: [string, SearchParams][] = [
			['keyword 1 char', { keyword: '塩' }],
			['keyword 2 chars', { keyword: '甘口' }],
			['keyword 3+ chars', { keyword: 'フルーティー' }],
			['rare keyword', { keyword: 'カクテル1234' }],
			['rare keyword, seq scan off', { keyword: 'カクテル1234' }],
			['keyword with %', { keyword: '100%' }],
			['AND 2 ingredients', { ingredientIds: [ings[0].id, ings[40].id] }],
			[
				'onlyThese 10 ingredients',
				{ ingredientIds: ings.slice(0, 10).map((i) => i.id), onlyThese: true }
			],
			['sort like, page 1', { sort: 'like' }],
			['new + base + abv range', { baseIds: [ings[1].id, ings[2].id], abvMin: 5, abvMax: 20 }]
		];
		const report: string[] = [];
		for (const [name, params] of cases) {
			last = [];
			const t = performance.now();
			const r = await searchRecipes(db, { limit: 20, ...params });
			const ms = (performance.now() - t).toFixed(1);
			expect(r.ok).toBe(true);
			const main = last[0];
			const client = await pool.connect();
			// Shows the trigram index is usable; at 2,000 rows the planner rightly prefers a seq scan.
			await client.query(`set enable_seqscan = ${!name.includes('seq scan off')}`);
			const plan = await client.query(`explain (analyze, buffers) ${main.query}`, main.params);
			client.release();
			const lines = plan.rows.map((row) => row['QUERY PLAN'] as string);
			report.push(
				`### ${name}: ${r.ok ? r.value.items.length : 0} rows, searchRecipes ${ms} ms`,
				...lines.filter((l) => /Scan|Execution Time|Planning Time/.test(l))
			);
		}
		writeFileSync(process.env.EXPLAIN_SEARCH!, report.join('\n'));
	}, 120_000);
});
