import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import * as schema from '#lib/server/db/schema.js';
import {
	ingredient,
	like,
	member,
	recipe,
	recipeIngredient,
	recipePhoto,
	recipeStep,
	report
} from '#lib/server/db/schema.js';
import { lockPhotos, recipePhotoId, releaseUnreferenced } from './photos';
import {
	recomputeDerived,
	resolveEffectiveAbv,
	validateAbvOverride,
	validateMixRatio,
	validateRecipeIngredients,
	type Result
} from '#lib/domain/alcohol/index.js';

/** The app's `db` or a transaction on it; nested calls become savepoints. */
export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export type Actor = { memberId: string; isAdministrator: boolean; suspended?: boolean };

export type RecipeInput = {
	title: string;
	description?: string;
	mainPhotoKey: string;
	extraPhotoKeys?: string[];
	ingredients: { ingredientId: string; mixRatio: number }[];
	steps: string[];
	abvOverride?: number | null;
};

export type RecipeInputError =
	| 'title_invalid'
	| 'description_too_long'
	| 'main_photo_required'
	| 'photo_key_invalid'
	| 'too_many_photos'
	| 'steps_invalid'
	| 'ingredients_empty'
	| 'too_many_ingredients'
	| 'duplicate_ingredient'
	| 'mix_ratio_invalid'
	| 'unknown_ingredient'
	| 'override_not_allowed'
	| 'override_invalid';
export type AccessError = 'suspended' | 'not_found' | 'forbidden';

const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = <E extends string>(error: E) => ({ ok: false as const, error });

// Malformed ids would make Postgres throw (22P02); treat them as "no such row" instead.
export const isUuid = (s: unknown): s is string =>
	typeof s === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Postgres char_length counts code points, JS .length counts UTF-16 units.
const charLength = (s: string) => [...s].length;
const isKey = (k: unknown): k is string => typeof k === 'string' && k.trim().length > 0;

const ingredientErrors = {
	empty: 'ingredients_empty',
	too_many: 'too_many_ingredients',
	duplicate: 'duplicate_ingredient'
} as const;

/** FR-003..FR-007 bounds, mirroring the CHECKs in schema.ts so user input never reaches them. */
function validateRecipeInput(input: RecipeInput): Result<Required<RecipeInput>, RecipeInputError> {
	const title = input.title?.trim() ?? '';
	const description = input.description?.trim() ?? '';
	const steps = (input.steps ?? []).map((s) => s?.trim() ?? '');
	const extraPhotoKeys = input.extraPhotoKeys ?? [];
	const ingredients = input.ingredients ?? [];

	if (title.length === 0 || charLength(title) > 50) return fail('title_invalid');
	if (charLength(description) > 500) return fail('description_too_long');
	if (!isKey(input.mainPhotoKey)) return fail('main_photo_required');
	if (extraPhotoKeys.length > 3) return fail('too_many_photos');
	if (!extraPhotoKeys.every(isKey)) return fail('photo_key_invalid');
	if (![input.mainPhotoKey, ...extraPhotoKeys].every((k) => recipePhotoId(k) !== null))
		return fail('photo_key_invalid');
	if (steps.length < 1 || steps.length > 10) return fail('steps_invalid');
	if (steps.some((s) => s.length === 0 || charLength(s) > 200)) return fail('steps_invalid');
	const valid = validateRecipeIngredients(ingredients.map((i) => ({ ...i, id: i.ingredientId })));
	if (!valid.ok) return fail(ingredientErrors[valid.error]);
	if (!ingredients.every((i) => validateMixRatio(i.mixRatio).ok)) return fail('mix_ratio_invalid');
	if (!ingredients.every((i) => isUuid(i.ingredientId))) return fail('unknown_ingredient');

	return ok({
		title,
		description,
		mainPhotoKey: input.mainPhotoKey,
		extraPhotoKeys,
		ingredients,
		steps,
		abvOverride: input.abvOverride ?? null
	});
}

/** Ingredient rows in input order. FOR SHARE makes a concurrent ABV edit (FR-015) wait for us. */
async function loadIngredients(tx: Db, items: RecipeInput['ingredients']) {
	const rows = await tx
		.select({
			id: ingredient.id,
			name: ingredient.name,
			abvPercent: ingredient.abvPercent,
			isBaseSpirit: ingredient.isBaseSpirit
		})
		.from(ingredient)
		.where(
			inArray(
				ingredient.id,
				items.map((i) => i.ingredientId)
			)
		)
		.for('share');
	const byId = new Map(rows.map((r) => [r.id, r]));
	if (byId.size !== items.length) return fail('unknown_ingredient');
	return ok(items.map((i) => ({ ...byId.get(i.ingredientId)!, mixRatio: i.mixRatio })));
}

function checkOverride(override: number, derived: ReturnType<typeof recomputeDerived>) {
	const v = validateAbvOverride({ override, ...derived });
	if (v.ok) return ok(v.value);
	return fail(v.error === 'no_alcohol' ? 'override_not_allowed' : 'override_invalid');
}

/** recipe columns + children for a validated input (FR-043 search_text included). */
async function writeRecipe(
	tx: Db,
	recipeId: string | null,
	memberId: string,
	v: Required<RecipeInput>,
	ings: { name: string }[],
	derived: ReturnType<typeof recomputeDerived>,
	abvOverride: number | null
) {
	const values = {
		title: v.title,
		description: v.description,
		mainPhotoKey: v.mainPhotoKey,
		autoAbv: derived.autoAbv,
		hasAlcohol: derived.hasAlcohol,
		abvOverride,
		searchText: [v.title, v.description, ...ings.map((i) => i.name), ...v.steps].join('\n')
	};
	let id: string;
	if (recipeId == null) {
		[{ id }] = await tx
			.insert(recipe)
			.values({ ...values, memberId })
			.returning({ id: recipe.id });
	} else {
		id = recipeId;
		await tx.update(recipe).set(values).where(eq(recipe.id, id));
		await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id));
		await tx.delete(recipeStep).where(eq(recipeStep.recipeId, id));
		await tx.delete(recipePhoto).where(eq(recipePhoto.recipeId, id));
	}
	await tx.insert(recipeIngredient).values(
		v.ingredients.map((i, n) => ({
			recipeId: id,
			ingredientId: i.ingredientId,
			mixRatio: i.mixRatio,
			position: n + 1
		}))
	);
	await tx
		.insert(recipeStep)
		.values(v.steps.map((text, n) => ({ recipeId: id, position: n + 1, text })));
	if (v.extraPhotoKeys.length > 0)
		await tx
			.insert(recipePhoto)
			.values(v.extraPhotoKeys.map((photoKey, n) => ({ recipeId: id, photoKey, position: n + 1 })));
	return id;
}

/** FR-001: publish a Recipe; derived Alcohol columns are stored in the same transaction (ADR 0004). */
export async function createRecipe(
	db: Db,
	actor: Actor,
	input: RecipeInput
): Promise<Result<{ id: string }, RecipeInputError | 'suspended'>> {
	if (actor.suspended) return fail('suspended');
	const v = validateRecipeInput(input);
	if (!v.ok) return v;
	return db.transaction(async (tx) => {
		const keys = [v.value.mainPhotoKey, ...v.value.extraPhotoKeys];
		if (!(await lockPhotos(tx, keys)).ownedBy(actor.memberId, keys))
			return fail('photo_key_invalid');
		const ings = await loadIngredients(tx, v.value.ingredients);
		if (!ings.ok) return ings;
		const derived = recomputeDerived(ings.value);
		let override: number | null = null;
		if (v.value.abvOverride != null) {
			const o = checkOverride(v.value.abvOverride, derived);
			if (!o.ok) return o;
			override = o.value;
		}
		const id = await writeRecipe(tx, null, actor.memberId, v.value, ings.value, derived, override);
		return ok({ id });
	});
}

/** Locks the Recipe row and checks the actor may change it. */
async function lockRecipe(tx: Db, actor: Actor, recipeId: string, allowAdministrator = false) {
	if (actor.suspended) return fail('suspended');
	if (!isUuid(recipeId)) return fail('not_found');
	const [row] = await tx
		.select({
			memberId: recipe.memberId,
			mainPhotoKey: recipe.mainPhotoKey,
			abvOverride: recipe.abvOverride,
			hasAlcohol: recipe.hasAlcohol
		})
		.from(recipe)
		.where(eq(recipe.id, recipeId))
		.for('update');
	if (!row) return fail('not_found');
	if (row.memberId !== actor.memberId && !(allowAdministrator && actor.isAdministrator))
		return fail('forbidden');
	return ok(row);
}

async function photoKeys(tx: Db, recipeId: string, mainPhotoKey: string) {
	const extras = await tx
		.select({ key: recipePhoto.photoKey })
		.from(recipePhoto)
		.where(eq(recipePhoto.recipeId, recipeId))
		.orderBy(asc(recipePhoto.position));
	return [mainPhotoKey, ...extras.map((p) => p.key)];
}

/**
 * FR-008: the owner replaces the whole Recipe. The stored override is kept while it stays in
 * range (FR-015/023) unless `resetOverride` (the "recompute" button) or an explicit
 * `abvOverride` (number to set, null to clear) is given. Photo keys must be uploads of the
 * actor. `removedPhotoKeys` are no longer referenced and their uploads are released in the
 * same transaction (nothing can attach them again); the caller deletes the objects from
 * storage after commit.
 */
export async function updateRecipe(
	db: Db,
	actor: Actor,
	recipeId: string,
	input: RecipeInput & { resetOverride?: boolean }
): Promise<
	Result<
		{ id: string; overrideDiscarded: boolean; removedPhotoKeys: string[] },
		RecipeInputError | AccessError
	>
> {
	const v = validateRecipeInput(input);
	return db.transaction(async (tx) => {
		const cur = await lockRecipe(tx, actor, recipeId);
		if (!cur.ok) return cur;
		if (!v.ok) return v;
		const before = await photoKeys(tx, recipeId, cur.value.mainPhotoKey);
		const keys = [v.value.mainPhotoKey, ...v.value.extraPhotoKeys];
		// One locking pass over old and new photos, so attaching and releasing serialise per photo.
		const photos = await lockPhotos(tx, [...before, ...keys]);
		if (
			!photos.ownedBy(
				actor.memberId,
				keys.filter((k) => !before.includes(k))
			)
		)
			return fail('photo_key_invalid');
		const ings = await loadIngredients(tx, v.value.ingredients);
		if (!ings.ok) return ings;
		const explicit = input.resetOverride || input.abvOverride !== undefined;
		const derived = recomputeDerived(ings.value, explicit ? null : cur.value.abvOverride);
		let override = derived.abvOverride;
		if (!input.resetOverride && v.value.abvOverride != null) {
			const o = checkOverride(v.value.abvOverride, derived);
			if (!o.ok) return o;
			override = o.value;
		}
		await writeRecipe(tx, recipeId, actor.memberId, v.value, ings.value, derived, override);
		return ok({
			id: recipeId,
			overrideDiscarded: derived.overrideDiscarded,
			removedPhotoKeys: await releaseUnreferenced(tx, photos.ids)
		});
	});
}

/** FR-021/022/024: the owner overrides the Alcohol Content of a Recipe with alcohol. */
export async function setAbvOverride(
	db: Db,
	actor: Actor,
	recipeId: string,
	override: number
): Promise<
	Result<{ abvOverride: number }, AccessError | 'override_not_allowed' | 'override_invalid'>
> {
	return db.transaction(async (tx) => {
		const cur = await lockRecipe(tx, actor, recipeId);
		if (!cur.ok) return cur;
		const [{ max }] = await tx
			.select({ max: sql<number>`coalesce(max(${ingredient.abvPercent}), 0)`.mapWith(Number) })
			.from(recipeIngredient)
			.innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
			.where(eq(recipeIngredient.recipeId, recipeId));
		const v = validateAbvOverride({
			override,
			hasAlcohol: cur.value.hasAlcohol,
			maxIngredientAbv: max
		});
		if (!v.ok) return fail(v.error === 'no_alcohol' ? 'override_not_allowed' : 'override_invalid');
		await tx.update(recipe).set({ abvOverride: v.value }).where(eq(recipe.id, recipeId));
		return ok({ abvOverride: v.value });
	});
}

/** FR-023 "recompute": drop the override so the stored auto value shows again. */
export async function clearAbvOverride(
	db: Db,
	actor: Actor,
	recipeId: string
): Promise<Result<null, AccessError>> {
	return db.transaction(async (tx) => {
		const cur = await lockRecipe(tx, actor, recipeId);
		if (!cur.ok) return cur;
		await tx.update(recipe).set({ abvOverride: null }).where(eq(recipe.id, recipeId));
		return ok(null);
	});
}

/**
 * FR-008/074: owner or Administrator. Likes, Saves, steps and photos cascade; Reports stay with
 * target_state 'recipe_deleted'. Releases the now-unreferenced photo uploads and returns their keys
 * for the caller to delete from storage after commit.
 */
export async function deleteRecipe(
	db: Db,
	actor: Actor,
	recipeId: string
): Promise<Result<{ photoKeys: string[] }, AccessError>> {
	return db.transaction(async (tx) => {
		const cur = await lockRecipe(tx, actor, recipeId, true);
		if (!cur.ok) return cur;
		const keys = await photoKeys(tx, recipeId, cur.value.mainPhotoKey);
		await tx
			.update(report)
			.set({ targetState: 'recipe_deleted' })
			.where(eq(report.recipeId, recipeId));
		const photos = await lockPhotos(tx, keys);
		await tx.delete(recipe).where(eq(recipe.id, recipeId));
		return ok({ photoKeys: await releaseUnreferenced(tx, photos.ids) });
	});
}

export const likeCountOf = (recipeId: typeof recipe.id) =>
	sql<number>`(select count(*) from ${like} where ${like.recipeId} = ${recipeId})`.mapWith(Number);

/** FR-046: public Recipe detail; null when missing or its Member is suspended (FR-075). */
export async function getRecipeDetail(db: Db, recipeId: string) {
	if (!isUuid(recipeId)) return null;
	const [row] = await db
		.select({
			id: recipe.id,
			title: recipe.title,
			description: recipe.description,
			mainPhotoKey: recipe.mainPhotoKey,
			autoAbv: recipe.autoAbv,
			abvOverride: recipe.abvOverride,
			hasAlcohol: recipe.hasAlcohol,
			createdAt: recipe.createdAt,
			updatedAt: recipe.updatedAt,
			likeCount: likeCountOf(recipe.id),
			owner: { id: member.id, username: member.username, iconKey: member.iconKey }
		})
		.from(recipe)
		.innerJoin(member, eq(member.id, recipe.memberId))
		.where(and(eq(recipe.id, recipeId), isNull(member.suspendedAt)));
	if (!row) return null;

	const ingredients = await db
		.select({
			id: ingredient.id,
			name: ingredient.name,
			abvPercent: ingredient.abvPercent,
			isBaseSpirit: ingredient.isBaseSpirit,
			mixRatio: recipeIngredient.mixRatio
		})
		.from(recipeIngredient)
		.innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
		.where(eq(recipeIngredient.recipeId, recipeId))
		.orderBy(asc(recipeIngredient.position));
	const steps = await db
		.select({ text: recipeStep.text })
		.from(recipeStep)
		.where(eq(recipeStep.recipeId, recipeId))
		.orderBy(asc(recipeStep.position));
	const [, ...extraPhotoKeys] = await photoKeys(db, recipeId, row.mainPhotoKey);

	const { autoAbv, abvOverride, hasAlcohol, ...rest } = row;
	const effective = resolveEffectiveAbv({ autoAbv, hasAlcohol, override: abvOverride });
	return {
		...rest,
		autoAbv,
		abvOverride,
		effectiveAbv: effective.value,
		isOverride: effective.isOverride,
		isNonAlcoholic: !hasAlcohol,
		ingredients,
		bases: ingredients.filter((i) => i.isBaseSpirit).map(({ id, name }) => ({ id, name })), // FR-026
		steps: steps.map((s) => s.text),
		extraPhotoKeys
	};
}
