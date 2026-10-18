import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { recipe, recipePhoto } from '#lib/server/db/schema.js';
import { requireMember } from '#lib/server/auth/guards.js';
import {
	createRecipe,
	deleteRecipe,
	getRecipeDetail,
	searchRecipes,
	updateRecipe,
	type RecipeInput,
	type SearchParams
} from '#lib/server/services/recipes/index.js';
import type { ImageStore } from '#lib/server/services/images/index.js';
import { actorOf, firstValues, invalidRequest, isRecord, statusOf, type ApiEnv } from './http';

const isStringArray = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((s) => typeof s === 'string');

function parseRecipeBody(v: unknown): (RecipeInput & { resetOverride?: boolean }) | null {
	if (!isRecord(v)) return null;
	const { title, description, mainPhotoKey, extraPhotoKeys, ingredients, steps, abvOverride } = v;
	if (
		typeof title !== 'string' ||
		(description !== undefined && typeof description !== 'string') ||
		typeof mainPhotoKey !== 'string' ||
		(extraPhotoKeys !== undefined && !isStringArray(extraPhotoKeys)) ||
		!isStringArray(steps) ||
		!Array.isArray(ingredients) ||
		!ingredients.every(
			(i) => isRecord(i) && typeof i.ingredientId === 'string' && typeof i.mixRatio === 'number'
		) ||
		(abvOverride !== undefined && abvOverride !== null && typeof abvOverride !== 'number') ||
		(v.resetOverride !== undefined && typeof v.resetOverride !== 'boolean')
	)
		return null;
	return {
		title,
		description,
		mainPhotoKey,
		extraPhotoKeys,
		ingredients: ingredients as RecipeInput['ingredients'],
		steps,
		abvOverride,
		resetOverride: v.resetOverride as boolean | undefined
	};
}

const list = (s: string | undefined) => (s ? s.split(',').filter(Boolean) : undefined);
// Non-numeric text becomes NaN so the service answers invalid_query; absent/empty stays undefined.
const num = (s: string | undefined) => (s ? Number(s) : undefined);

function parseSearch(query: Record<string, string | string[]>): SearchParams | null {
	const q = firstValues(query);
	if (q.sort !== undefined && q.sort !== 'new' && q.sort !== 'like') return null;
	return {
		ingredientIds: list(q.ingredientIds),
		onlyThese: q.onlyThese === 'true',
		keyword: q.keyword,
		baseIds: list(q.baseIds),
		abvMin: num(q.abvMin),
		abvMax: num(q.abvMax),
		nonAlcoholic: q.nonAlcoholic === 'true',
		sort: q.sort,
		cursor: q.cursor || null,
		limit: num(q.limit)
	};
}

// Keys come from the Member's own request (upload keys are not bound to the uploader), so only
// ever delete what storePhoto produces for a Recipe photo; never a Member icon or any other path.
const RECIPE_PHOTO_KEY =
	/^(recipe\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)(list|detail)\.webp$/;

/** The `recipe/<uuid>/` prefixes of the Recipe photo keys among `keys`; other keys are ignored. */
const photoPrefixes = (keys: string[]) => [
	...new Set(keys.flatMap((k) => RECIPE_PHOTO_KEY.exec(k)?.[1] ?? []))
];

/**
 * Photos no Recipe references any more, deleted as pairs: a pair (`list.webp` + `detail.webp`)
 * goes only when neither file is still used, so a key given by one Member cannot take out the
 * other derivative of someone else's photo. Runs after commit, so nothing here may fail the
 * request: the reference check, building the store (missing R2_* env) and every delete are
 * inside the guard.
 */
async function deletePhotos(store: () => ImageStore, keys: string[]) {
	const prefixes = photoPrefixes(keys);
	if (prefixes.length === 0) return;
	try {
		const files = prefixes.flatMap((p) => [`${p}list.webp`, `${p}detail.webp`]);
		const used = await db.execute<{ key: string }>(sql`
			select ${recipe.mainPhotoKey} as key from ${recipe} where ${inArray(recipe.mainPhotoKey, files)}
			union select ${recipePhoto.photoKey} from ${recipePhoto} where ${inArray(recipePhoto.photoKey, files)}`);
		const usedKeys = new Set(used.rows.map((r) => r.key));
		const doomed = files.filter((f) => !usedKeys.has(f) && !usedKeys.has(pairOf(f)));
		const s = store();
		await Promise.allSettled(doomed.map((k) => s.delete(k)));
	} catch (e) {
		console.error('photo cleanup failed', e);
	}
}

const pairOf = (file: string) =>
	file.endsWith('/list.webp')
		? file.replace(/list\.webp$/, 'detail.webp')
		: file.replace(/detail\.webp$/, 'list.webp');

export const recipesRoute = ({ store }: { store: () => ImageStore }) =>
	new Hono<ApiEnv>()
		// FR-040..046: public, keyset-paginated.
		.get(
			'/',
			validator('query', (q, c) => parseSearch(q) ?? invalidRequest(c)),
			async (c) => {
				const result = await searchRecipes(db, c.req.valid('query'));
				if (!result.ok) return c.json({ error: result.error }, 400);
				return c.json(result.value);
			}
		)
		.get('/:id', async (c) => {
			const detail = await getRecipeDetail(db, c.req.param('id'));
			if (!detail) return c.json({ error: 'not_found' as const }, 404);
			return c.json(detail);
		})
		.post(
			'/',
			requireMember,
			validator('json', (b, c) => parseRecipeBody(b) ?? invalidRequest(c)),
			async (c) => {
				const result = await createRecipe(db, actorOf(c), c.req.valid('json'));
				if (!result.ok) return c.json({ error: result.error }, statusOf(result.error));
				return c.json(result.value, 201);
			}
		)
		.put(
			'/:id',
			requireMember,
			validator('json', (b, c) => parseRecipeBody(b) ?? invalidRequest(c)),
			async (c) => {
				const result = await updateRecipe(db, actorOf(c), c.req.param('id'), c.req.valid('json'));
				if (!result.ok) return c.json({ error: result.error }, statusOf(result.error));
				const { removedPhotoKeys, ...rest } = result.value;
				await deletePhotos(store, removedPhotoKeys);
				return c.json(rest);
			}
		)
		.delete('/:id', requireMember, async (c) => {
			const result = await deleteRecipe(db, actorOf(c), c.req.param('id'));
			if (!result.ok) return c.json({ error: result.error }, statusOf(result.error));
			await deletePhotos(store, result.value.photoKeys);
			return c.body(null, 204);
		});
