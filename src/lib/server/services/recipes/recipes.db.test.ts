import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	like,
	photoUpload,
	recipe,
	recipeIngredient,
	recipePhoto,
	recipeStep,
	report,
	save
} from '#lib/server/db/schema.js';
import {
	clearAbvOverride,
	createRecipe,
	deleteRecipe,
	getRecipeDetail,
	setAbvOverride,
	updateRecipe,
	type Db
} from './recipes';
import {
	input,
	isolated,
	make,
	own,
	photoKey,
	seedIngredients,
	seedMember,
	upload
} from './test-fixtures';

/** Both derivatives of a photo, as returned for deletion from storage. */
const filesOf = (listKey: string) => [listKey, listKey.replace('list.webp', 'detail.webp')];

const stored = async (tx: Db, id: string) =>
	(await tx.select().from(recipe).where(eq(recipe.id, id)))[0];

describe('createRecipe', () => {
	it('stores derived Alcohol columns, search_text and ordered children (ADR 0004, FR-043)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const extras = [photoKey(), photoKey('detail')];
			const id = await make(
				tx,
				alice,
				input(
					'マティーニ',
					[
						[i.gin, 4.5],
						[i.vermouth, 1.5]
					],
					{
						description: '辛口の定番',
						extraPhotoKeys: extras,
						steps: ['ミキシンググラスでステア', 'オリーブを飾る']
					}
				)
			);

			const r = await stored(tx, id);
			expect(r).toMatchObject({ autoAbv: 34.5, hasAlcohol: true, abvOverride: null });
			expect(r.searchText).toBe(
				'マティーニ\n辛口の定番\nジン\nドライ・ベルモット\nミキシンググラスでステア\nオリーブを飾る'
			);
			const detail = await getRecipeDetail(tx, id);
			expect(detail?.ingredients.map((x) => x.name)).toEqual(['ジン', 'ドライ・ベルモット']);
			expect(detail?.steps).toEqual(['ミキシンググラスでステア', 'オリーブを飾る']);
			expect(detail?.extraPhotoKeys).toEqual(extras);
		}));

	it('fixes a Recipe without alcohol at 0% and floors a tiny alcoholic one at 0.1 (FR-020/024)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const na = await make(
				tx,
				alice,
				input('ライムソーダ', [
					[i.lime, 1],
					[i.soda, 4]
				])
			);
			const tiny = await make(
				tx,
				alice,
				input('ほぼソーダ', [
					[i.gin, 0.1],
					[i.soda, 99.9]
				])
			);
			expect(await stored(tx, na)).toMatchObject({ autoAbv: 0, hasAlcohol: false });
			expect(await stored(tx, tiny)).toMatchObject({ autoAbv: 0.1, hasAlcohol: true });
		}));

	it('rejects out-of-bounds input with a typed error and writes nothing', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const ok = input(
				'ジントニック',
				[
					[i.gin, 1],
					[i.tonic, 3]
				],
				{ mainPhotoKey: await upload(tx, alice) }
			);
			const cases: [Partial<typeof ok>, string][] = [
				[{ title: '  ' }, 'title_invalid'],
				[{ title: 'あ'.repeat(51) }, 'title_invalid'],
				[{ description: 'あ'.repeat(501) }, 'description_too_long'],
				[{ mainPhotoKey: '' }, 'main_photo_required'],
				[{ extraPhotoKeys: ['a', 'b', 'c', 'd'] }, 'too_many_photos'],
				[{ mainPhotoKey: 'photos/a' }, 'photo_key_invalid'],
				[{ mainPhotoKey: 'recipe/not-a-uuid/list.webp' }, 'photo_key_invalid'],
				[{ extraPhotoKeys: [`member/${crypto.randomUUID()}/list.webp`] }, 'photo_key_invalid'],
				[{ extraPhotoKeys: ['x'] }, 'photo_key_invalid'],
				[{ mainPhotoKey: photoKey() }, 'photo_key_invalid'], // never uploaded
				[{ steps: [] }, 'steps_invalid'],
				[{ steps: Array(11).fill('混ぜる') }, 'steps_invalid'],
				[{ steps: ['あ'.repeat(201)] }, 'steps_invalid'],
				[{ ingredients: [] }, 'ingredients_empty'],
				[
					{
						ingredients: [
							{ ingredientId: i.gin, mixRatio: 1 },
							{ ingredientId: i.gin, mixRatio: 2 }
						]
					},
					'duplicate_ingredient'
				],
				[{ ingredients: [{ ingredientId: i.gin, mixRatio: 0.05 }] }, 'mix_ratio_invalid'],
				[{ ingredients: [{ ingredientId: i.gin, mixRatio: 100 }] }, 'mix_ratio_invalid'],
				[{ ingredients: [{ ingredientId: 'not-a-uuid', mixRatio: 1 }] }, 'unknown_ingredient'],
				[
					{ ingredients: [{ ingredientId: crypto.randomUUID(), mixRatio: 1 }] },
					'unknown_ingredient'
				],
				[{ abvOverride: 40.1 }, 'override_invalid'],
				[{ abvOverride: 0 }, 'override_invalid'],
				[{ abvOverride: 12.25 }, 'override_invalid']
			];
			for (const [patch, error] of cases)
				expect(await createRecipe(tx, alice, { ...ok, ...patch }), error).toEqual({
					ok: false,
					error
				});
			expect(
				await createRecipe(
					tx,
					alice,
					await own(tx, alice, input('ノンアル', [[i.lime, 1]], { abvOverride: 1 }))
				)
			).toEqual({ ok: false, error: 'override_not_allowed' });
			expect(await tx.select().from(recipe)).toEqual([]);
		}));

	it('accepts the upper bounds (50/500/10x200 chars, 3 extra photos, 20 Ingredients)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const many = await tx.execute<{ id: string }>(
				sql`insert into ingredient (name, abv_percent) select 'i' || n, 0 from generate_series(1, 20) n returning id`
			);
			const r = await createRecipe(tx, alice, {
				title: '🍸'.repeat(50),
				description: 'あ'.repeat(500),
				mainPhotoKey: await upload(tx, alice),
				extraPhotoKeys: [await upload(tx, alice), await upload(tx, alice), await upload(tx, alice)],
				ingredients: many.rows.map((x) => ({ ingredientId: x.id, mixRatio: 1 })),
				steps: Array(10).fill('あ'.repeat(200))
			});
			expect(r.ok).toBe(true);
		}));

	it('rejects a suspended actor', () =>
		isolated(async (tx) => {
			const sus = await seedMember(tx, 'sus', { suspended: true });
			const i = await seedIngredients(tx);
			expect(await createRecipe(tx, sus, input('x', [[i.gin, 1]]))).toEqual({
				ok: false,
				error: 'suspended'
			});
		}));

	it('is atomic: a failing child insert leaves no Recipe behind', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			await tx.execute(sql`
				create function fail_step() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
				create trigger fail_step before insert on recipe_step for each row execute function fail_step();
			`);
			await expect(
				createRecipe(tx, alice, await own(tx, alice, input('x', [[i.gin, 1]])))
			).rejects.toThrow();
			expect(await tx.select().from(recipe)).toEqual([]);
			expect(await tx.select().from(recipeIngredient)).toEqual([]);
		}));
});

describe('updateRecipe', () => {
	it('lets only the owner update and rejects suspended actors', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const bob = await seedMember(tx, 'bob');
			const admin = await seedMember(tx, 'admin', { isAdministrator: true });
			const i = await seedIngredients(tx);
			const id = await make(
				tx,
				alice,
				input('ジントニック', [
					[i.gin, 1],
					[i.tonic, 3]
				])
			);
			const next = input('改', [[i.gin, 1]]);
			expect(await updateRecipe(tx, bob, id, next)).toEqual({ ok: false, error: 'forbidden' });
			expect(await updateRecipe(tx, admin, id, next)).toEqual({ ok: false, error: 'forbidden' });
			expect(await updateRecipe(tx, { ...alice, suspended: true }, id, next)).toEqual({
				ok: false,
				error: 'suspended'
			});
			expect(await updateRecipe(tx, alice, crypto.randomUUID(), next)).toEqual({
				ok: false,
				error: 'not_found'
			});
			expect((await stored(tx, id)).title).toBe('ジントニック');
		}));

	it('recomputes derived columns, replaces children and returns dropped photo keys', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const [p1, p2, p3] = [
				await upload(tx, alice),
				await upload(tx, alice),
				await upload(tx, alice)
			];
			const first = input(
				'ジントニック',
				[
					[i.gin, 1],
					[i.tonic, 3]
				],
				{ extraPhotoKeys: [p1, p2] }
			);
			const id = await make(tx, alice, first);
			const r = await updateRecipe(
				tx,
				alice,
				id,
				input(
					'ノンアルトニック',
					[
						[i.tonic, 3],
						[i.lime, 1]
					],
					{
						mainPhotoKey: p2,
						extraPhotoKeys: [p3],
						steps: ['注ぐ']
					}
				)
			);
			expect(r).toEqual({
				ok: true,
				value: {
					id,
					overrideDiscarded: false,
					removedPhotoKeys: [...filesOf(first.mainPhotoKey), ...filesOf(p1)]
				}
			});
			expect(await stored(tx, id)).toMatchObject({
				autoAbv: 0,
				hasAlcohol: false,
				searchText: 'ノンアルトニック\n\nトニックウォーター\nライムジュース\n注ぐ'
			});
			const steps = await tx.select().from(recipeStep).where(eq(recipeStep.recipeId, id));
			expect(steps.map((s) => s.text)).toEqual(['注ぐ']);
			const photos = await tx.select().from(recipePhoto).where(eq(recipePhoto.recipeId, id));
			expect(photos.map((p) => p.photoKey)).toEqual([p3]);
		}));

	it('keeps an in-range override, drops an out-of-range one, and resets on request (FR-015/023)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const gt = input('ジントニック', [
				[i.gin, 1],
				[i.tonic, 3]
			]);
			const id = await make(tx, alice, { ...gt, abvOverride: 9 });
			// An update must use photos not released by an earlier one.
			const fresh = <T extends typeof gt>(patch: T) =>
				own(tx, alice, { ...patch, mainPhotoKey: photoKey() });

			// Ingredients edited, override still within (0, 40]: kept.
			let r = await updateRecipe(
				tx,
				alice,
				id,
				await own(
					tx,
					alice,
					input('ジントニック', [
						[i.gin, 1],
						[i.tonic, 4]
					])
				)
			);
			expect(r.ok && r.value.overrideDiscarded).toBe(false);
			expect(await stored(tx, id)).toMatchObject({ autoAbv: 8, abvOverride: 9 });

			// "Recompute": back to the auto value.
			expect(
				(await updateRecipe(tx, alice, id, await fresh({ ...gt, resetOverride: true }))).ok
			).toBe(true);
			expect(await stored(tx, id)).toMatchObject({ autoAbv: 10, abvOverride: null });

			// Override above the new max ABV (25) is discarded silently with a flag.
			await setAbvOverride(tx, alice, id, 30);
			r = await updateRecipe(
				tx,
				alice,
				id,
				await own(
					tx,
					alice,
					input('カンパリソーダ', [
						[i.campari, 1],
						[i.soda, 2]
					])
				)
			);
			expect(r.ok && r.value.overrideDiscarded).toBe(true);
			expect((await stored(tx, id)).abvOverride).toBeNull();

			// Explicit new override is validated strictly.
			r = await updateRecipe(tx, alice, id, await fresh({ ...gt, abvOverride: 41 }));
			expect(r).toEqual({ ok: false, error: 'override_invalid' });
			expect(
				(await updateRecipe(tx, alice, id, await fresh({ ...gt, abvOverride: 12.5 }))).ok
			).toBe(true);
			expect((await stored(tx, id)).abvOverride).toBe(12.5);
		}));

	it('is atomic: a failing step leaves the previous Recipe intact', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const id = await make(
				tx,
				alice,
				input('ジントニック', [
					[i.gin, 1],
					[i.tonic, 3]
				])
			);
			await tx.execute(sql`
				create function fail_step() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
				create trigger fail_step before insert on recipe_step for each row execute function fail_step();
			`);
			await expect(
				updateRecipe(tx, alice, id, await own(tx, alice, input('改', [[i.lime, 1]])))
			).rejects.toThrow();
			expect(await stored(tx, id)).toMatchObject({
				title: 'ジントニック',
				autoAbv: 10,
				hasAlcohol: true
			});
			const ings = await tx
				.select()
				.from(recipeIngredient)
				.where(eq(recipeIngredient.recipeId, id));
			expect(ings).toHaveLength(2);
			const steps = await tx.select().from(recipeStep).where(eq(recipeStep.recipeId, id));
			expect(steps).toHaveLength(2);
		}));
});

describe('setAbvOverride / clearAbvOverride', () => {
	it('allows 0 < override <= highest Ingredient ABV on a Recipe with alcohol (FR-021/022)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const bob = await seedMember(tx, 'bob');
			const i = await seedIngredients(tx);
			const id = await make(
				tx,
				alice,
				input('マティーニ', [
					[i.gin, 4.5],
					[i.vermouth, 1.5]
				])
			);
			const err = (error: string) => ({ ok: false, error });
			expect(await setAbvOverride(tx, alice, id, 0)).toEqual(err('override_invalid'));
			expect(await setAbvOverride(tx, alice, id, 40.1)).toEqual(err('override_invalid'));
			expect(await setAbvOverride(tx, alice, id, 30.25)).toEqual(err('override_invalid'));
			expect(await setAbvOverride(tx, bob, id, 30)).toEqual(err('forbidden'));
			expect(await setAbvOverride(tx, alice, id, 40)).toEqual({
				ok: true,
				value: { abvOverride: 40 }
			});
			expect(await clearAbvOverride(tx, bob, id)).toEqual(err('forbidden'));
			expect((await stored(tx, id)).abvOverride).toBe(40);
			expect(await clearAbvOverride(tx, alice, id)).toEqual({ ok: true, value: null });
			expect(await stored(tx, id)).toMatchObject({ abvOverride: null, autoAbv: 34.5 });
		}));

	it('refuses an override on a Recipe without alcohol (FR-024)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const id = await make(
				tx,
				alice,
				input('ライムソーダ', [
					[i.lime, 1],
					[i.soda, 4]
				])
			);
			expect(await setAbvOverride(tx, alice, id, 1)).toEqual({
				ok: false,
				error: 'override_not_allowed'
			});
		}));
});

describe('deleteRecipe', () => {
	it('lets the owner or an Administrator delete, keeps Reports and returns photo keys (FR-008/074)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const bob = await seedMember(tx, 'bob');
			const admin = await seedMember(tx, 'admin', { isAdministrator: true });
			const i = await seedIngredients(tx);
			const [m, x1, x2] = [photoKey(), photoKey(), photoKey()];
			const a = await make(
				tx,
				alice,
				input('a', [[i.gin, 1]], { mainPhotoKey: m, extraPhotoKeys: [x1, x2] })
			);
			const b = await make(tx, alice, input('b', [[i.gin, 1]]));
			await tx.insert(like).values({ memberId: bob.memberId, recipeId: a });
			await tx.insert(save).values({ memberId: bob.memberId, recipeId: a });
			const [rep] = await tx
				.insert(report)
				.values({
					recipeId: a,
					reporterId: bob.memberId,
					reportedMemberId: alice.memberId,
					reason: 'spam'
				})
				.returning();

			expect(await deleteRecipe(tx, bob, a)).toEqual({ ok: false, error: 'forbidden' });
			expect(await deleteRecipe(tx, { ...alice, suspended: true }, a)).toEqual({
				ok: false,
				error: 'suspended'
			});
			expect(await deleteRecipe(tx, alice, a)).toEqual({
				ok: true,
				value: { photoKeys: [...filesOf(m), ...filesOf(x1), ...filesOf(x2)] }
			});
			expect(await tx.select().from(like)).toEqual([]);
			expect(await tx.select().from(save)).toEqual([]);
			expect(await tx.select().from(recipePhoto)).toEqual([]);
			const [kept] = await tx.select().from(report).where(eq(report.id, rep.id));
			expect(kept).toMatchObject({
				recipeId: null,
				targetState: 'recipe_deleted',
				reportedMemberId: alice.memberId,
				status: 'open'
			});

			expect((await deleteRecipe(tx, admin, b)).ok).toBe(true);
			expect(await deleteRecipe(tx, admin, b)).toEqual({ ok: false, error: 'not_found' });
		}));

	it('releases a photo only once no Recipe uses it, and a released upload cannot be attached again', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const shared = await upload(tx, alice);
			const a = await make(tx, alice, input('a', [[i.gin, 1]], { mainPhotoKey: shared }));
			const b = await make(tx, alice, input('b', [[i.gin, 1]], { mainPhotoKey: shared }));

			expect(await deleteRecipe(tx, alice, a)).toEqual({ ok: true, value: { photoKeys: [] } });
			expect(await deleteRecipe(tx, alice, b)).toEqual({
				ok: true,
				value: { photoKeys: filesOf(shared) }
			});
			expect(
				await createRecipe(tx, alice, input('c', [[i.gin, 1]], { mainPhotoKey: shared }))
			).toEqual({ ok: false, error: 'photo_key_invalid' });
		}));

	it('treats the list and detail keys of one upload as one photo', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const list = await upload(tx, alice);
			const detail = list.replace('list.webp', 'detail.webp');
			const a = await make(tx, alice, input('a', [[i.gin, 1]], { mainPhotoKey: list }));
			const b = await make(tx, alice, input('b', [[i.gin, 1]], { mainPhotoKey: detail }));
			expect(await deleteRecipe(tx, alice, a)).toEqual({ ok: true, value: { photoKeys: [] } });
			expect(await deleteRecipe(tx, alice, b)).toEqual({
				ok: true,
				value: { photoKeys: filesOf(list) }
			});
		}));
});

describe('photo ownership (FR-007)', () => {
	it("rejects another Member's still-unattached upload and one attached to another Recipe", () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const mallory = await seedMember(tx, 'mallory');
			const i = await seedIngredients(tx);
			const unattached = await upload(tx, alice);
			const attached = await upload(tx, alice);
			await make(tx, alice, input('a', [[i.gin, 1]], { mainPhotoKey: attached }));
			const own = await make(tx, mallory, input('m', [[i.gin, 1]]));

			for (const key of [unattached, attached, unattached.replace('list', 'detail')]) {
				expect(
					await createRecipe(tx, mallory, input('x', [[i.gin, 1]], { mainPhotoKey: key }))
				).toEqual({ ok: false, error: 'photo_key_invalid' });
				expect(
					await createRecipe(tx, mallory, input('x', [[i.gin, 1]], { extraPhotoKeys: [key] }))
				).toEqual({ ok: false, error: 'photo_key_invalid' });
				expect(
					await updateRecipe(tx, mallory, own, input('x', [[i.gin, 1]], { mainPhotoKey: key }))
				).toEqual({ ok: false, error: 'photo_key_invalid' });
			}
			// Nothing of Alice's was released or attached by the attempts.
			expect((await tx.select().from(recipe)).map((r) => r.title).sort()).toEqual(['a', 'm']);
			expect(await tx.select().from(photoUpload)).toHaveLength(3);
		}));

	it('lets an update keep and swap among the actor’s own uploads, and add a fresh one', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const i = await seedIngredients(tx);
			const fresh = await upload(tx, alice);
			const first = input('a', [[i.gin, 1]]);
			const id = await make(tx, alice, first);
			const r = await updateRecipe(
				tx,
				alice,
				id,
				input('a', [[i.gin, 1]], { mainPhotoKey: first.mainPhotoKey, extraPhotoKeys: [fresh] })
			);
			expect(r).toMatchObject({ ok: true, value: { removedPhotoKeys: [] } });
		}));
});

describe('getRecipeDetail', () => {
	it('returns ordered Ingredients, Bases, like count and effective ABV', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const bob = await seedMember(tx, 'bob');
			const carol = await seedMember(tx, 'carol');
			const i = await seedIngredients(tx);
			const id = await make(
				tx,
				alice,
				input(
					'ロングアイランド風',
					[
						[i.vodka, 1],
						[i.tonic, 2],
						[i.gin, 1],
						[i.rum, 1]
					],
					{
						abvOverride: 15
					}
				)
			);
			await tx.insert(like).values([
				{ memberId: bob.memberId, recipeId: id },
				{ memberId: carol.memberId, recipeId: id }
			]);
			const d = await getRecipeDetail(tx, id);
			expect(d).toMatchObject({
				id,
				title: 'ロングアイランド風',
				autoAbv: 24,
				abvOverride: 15,
				effectiveAbv: 15,
				isOverride: true,
				isNonAlcoholic: false,
				likeCount: 2,
				owner: { id: alice.memberId, username: 'alice' }
			});
			expect(d?.ingredients.map((x) => [x.name, x.mixRatio, x.abvPercent])).toEqual([
				['ウォッカ', 1, 40],
				['トニックウォーター', 2, 0],
				['ジン', 1, 40],
				['ラム', 1, 40]
			]);
			expect(d?.bases.map((b) => b.name)).toEqual(['ウォッカ', 'ジン', 'ラム']);
		}));

	it('reports a Non-alcoholic Recipe at 0% and hides missing or suspended ones (FR-075)', () =>
		isolated(async (tx) => {
			const alice = await seedMember(tx, 'alice');
			const sus = await seedMember(tx, 'sus');
			const i = await seedIngredients(tx);
			const na = await make(
				tx,
				alice,
				input('ライムソーダ', [
					[i.lime, 1],
					[i.soda, 4]
				])
			);
			const hidden = await make(tx, sus, input('隠れる', [[i.gin, 1]]));
			await tx.execute(sql`update member set suspended_at = now() where id = ${sus.memberId}`);
			expect(await getRecipeDetail(tx, na)).toMatchObject({
				effectiveAbv: 0,
				isOverride: false,
				isNonAlcoholic: true,
				bases: [],
				likeCount: 0
			});
			expect(await getRecipeDetail(tx, hidden)).toBeNull();
			expect(await getRecipeDetail(tx, crypto.randomUUID())).toBeNull();
			expect(await getRecipeDetail(tx, 'nope')).toBeNull();
		}));
});
