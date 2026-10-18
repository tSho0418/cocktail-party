import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { ingredient, member, recipe, recipeIngredient } from '#lib/server/db/schema.js';
import type { Result } from '#lib/domain/alcohol/index.js';
import { isUuid, likeCountOf, type Db } from './recipes';

export type SearchParams = {
	/** FR-041: Recipes containing ALL of these. With `onlyThese`, FR-042 instead. */
	ingredientIds?: string[];
	/** FR-042: Recipes whose liquid Ingredients are all within `ingredientIds` (need not use all). */
	onlyThese?: boolean;
	/** FR-043: whitespace-separated terms, each a literal substring of title/description/Ingredients/steps. */
	keyword?: string;
	/** FR-044: Recipes with any of these Bases. */
	baseIds?: string[];
	/** FR-044: on the override when present, else the auto value. Inclusive. */
	abvMin?: number;
	abvMax?: number;
	/** FR-025: true keeps only Non-alcoholic Recipes; false/undefined does not filter. */
	nonAlcoholic?: boolean;
	sort?: 'new' | 'like';
	cursor?: string | null;
	limit?: number;
};

export type RecipeSummary = {
	id: string;
	title: string;
	mainPhotoKey: string;
	ownerUsername: string | null;
	likeCount: number;
	effectiveAbv: number;
	isOverride: boolean;
	nonAlcoholic: boolean;
	bases: { id: string; name: string }[];
};

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

type Cursor = { s: 'new' | 'like'; l: number; t: string; i: string };

// created_at travels as Postgres text (microseconds + offset) so the keyset compares exactly.
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string, sort: Cursor['s']): Cursor | null {
	let c: Cursor;
	try {
		c = JSON.parse(Buffer.from(raw, 'base64url').toString());
	} catch {
		return null;
	}
	const ts = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:\d\d)?$/;
	const valid =
		c?.s === sort &&
		Number.isSafeInteger(c.l) &&
		c.l >= 0 &&
		typeof c.t === 'string' &&
		ts.test(c.t) &&
		!Number.isNaN(Date.parse(c.t.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))) &&
		isUuid(c.i);
	return valid ? c : null;
}

/** LIKE pattern matching `term` literally. */
const literal = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Public Recipe list (FR-040..FR-046), keyset-paginated and viewer-independent. Recipes of
 * suspended Members are hidden (FR-075). Like counts can change between pages, so a Recipe may
 * move across a page boundary under `sort: 'like'`; the order itself is total.
 */
export async function searchRecipes(
	db: Db,
	params: SearchParams = {}
): Promise<Result<{ items: RecipeSummary[]; nextCursor: string | null }, 'invalid_query'>> {
	const sort = params.sort ?? 'new';
	const limit = params.limit ?? DEFAULT_LIMIT;
	const ingredientIds = [...new Set(params.ingredientIds ?? [])];
	const baseIds = [...new Set(params.baseIds ?? [])];
	const cursor = params.cursor ? decodeCursor(params.cursor, sort) : null;
	if (
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > MAX_LIMIT ||
		(params.cursor && !cursor) ||
		!ingredientIds.every(isUuid) ||
		!baseIds.every(isUuid) ||
		[params.abvMin, params.abvMax].some((n) => n !== undefined && !Number.isFinite(n))
	)
		return { ok: false, error: 'invalid_query' };

	const likeCount = likeCountOf(recipe.id);
	const effectiveAbv = sql<number>`coalesce(${recipe.abvOverride}, ${recipe.autoAbv})`;
	const where: (SQL | undefined)[] = [isNull(member.suspendedAt)];

	if (ingredientIds.length > 0 && params.onlyThese) {
		where.push(
			sql`not exists (select 1 from ${recipeIngredient} where ${recipeIngredient.recipeId} = ${recipe.id} and ${notInArray(recipeIngredient.ingredientId, ingredientIds)})`
		);
	} else if (ingredientIds.length > 0) {
		where.push(
			sql`${recipe.id} in (select ${recipeIngredient.recipeId} from ${recipeIngredient} where ${inArray(recipeIngredient.ingredientId, ingredientIds)} group by 1 having count(*) = ${ingredientIds.length})`
		);
	}
	for (const term of params.keyword?.split(/\s+/).filter(Boolean) ?? [])
		where.push(sql`${recipe.searchText} ilike ${literal(term)} escape '\\'`);
	if (baseIds.length > 0)
		where.push(
			sql`exists (select 1 from ${recipeIngredient} join ${ingredient} on ${ingredient.id} = ${recipeIngredient.ingredientId} where ${recipeIngredient.recipeId} = ${recipe.id} and ${ingredient.isBaseSpirit} and ${inArray(ingredient.id, baseIds)})`
		);
	if (params.abvMin !== undefined) where.push(sql`${effectiveAbv} >= ${params.abvMin}`);
	if (params.abvMax !== undefined) where.push(sql`${effectiveAbv} <= ${params.abvMax}`);
	if (params.nonAlcoholic) where.push(eq(recipe.hasAlcohol, false));
	if (cursor)
		where.push(
			sort === 'like'
				? sql`(${likeCount}, ${recipe.createdAt}, ${recipe.id}) < (${cursor.l}, ${cursor.t}::timestamptz, ${cursor.i}::uuid)`
				: sql`(${recipe.createdAt}, ${recipe.id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`
		);

	const rows = await db
		.select({
			id: recipe.id,
			title: recipe.title,
			mainPhotoKey: recipe.mainPhotoKey,
			ownerUsername: member.username,
			likeCount,
			effectiveAbv: effectiveAbv.mapWith(Number),
			isOverride: sql<boolean>`${recipe.abvOverride} is not null`,
			hasAlcohol: recipe.hasAlcohol,
			createdAt: sql<string>`${recipe.createdAt}::text`
		})
		.from(recipe)
		.innerJoin(member, eq(member.id, recipe.memberId))
		.where(and(...where))
		.orderBy(...(sort === 'like' ? [desc(likeCount)] : []), desc(recipe.createdAt), desc(recipe.id))
		.limit(limit + 1);

	const page = rows.slice(0, limit);
	const ids = page.map((r) => r.id);
	const baseRows =
		ids.length === 0
			? []
			: await db
					.select({ recipeId: recipeIngredient.recipeId, id: ingredient.id, name: ingredient.name })
					.from(recipeIngredient)
					.innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
					.where(and(inArray(recipeIngredient.recipeId, ids), eq(ingredient.isBaseSpirit, true)))
					.orderBy(asc(recipeIngredient.position));

	const last = page.at(-1);
	return {
		ok: true,
		value: {
			items: page.map((r) => ({
				id: r.id,
				title: r.title,
				mainPhotoKey: r.mainPhotoKey,
				ownerUsername: r.ownerUsername,
				likeCount: r.likeCount,
				effectiveAbv: r.effectiveAbv,
				isOverride: r.isOverride,
				nonAlcoholic: !r.hasAlcohol,
				bases: baseRows.filter((b) => b.recipeId === r.id).map(({ id, name }) => ({ id, name }))
			})),
			nextCursor:
				rows.length > limit && last
					? encodeCursor({ s: sort, l: last.likeCount, t: last.createdAt, i: last.id })
					: null
		}
	};
}
