import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { searchRecipes } from '#lib/server/services/recipes/index.js';
import { listIngredientOptions } from '#lib/server/services/ingredients/list.js';
import { photoUrl } from '#lib/server/services/images/url.js';
import { isFiltered, parseSearchQuery, searchQuery } from '#lib/search-query.js';
import type { PageServerLoad } from './$types';

const optionalNumber = (s: string) => (s === '' ? undefined : Number(s));

// FR-040..046: public, rendered on the server. Two queries for the page (list + Bases of the
// listed Recipes) plus the Ingredient master for the form, all in parallel.
export const load: PageServerLoad = async ({ url }) => {
	const { form, cursor } = parseSearchQuery(url.searchParams);
	const [result, ingredients] = await Promise.all([
		searchRecipes(db, {
			keyword: form.keyword,
			ingredientIds: form.ingredientIds,
			onlyThese: form.onlyThese,
			baseIds: form.baseIds,
			abvMin: optionalNumber(form.abvMin),
			abvMax: optionalNumber(form.abvMax),
			nonAlcoholic: form.nonAlcoholic,
			sort: form.sort,
			cursor
		}),
		listIngredientOptions(db)
	]);
	if (!result.ok) error(400, '検索条件が正しくありません');

	return {
		form,
		ingredients,
		recipes: result.value.items.map((r) => ({ ...r, photoUrl: photoUrl(r.mainPhotoKey, 'list') })),
		nextQuery: result.value.nextCursor ? searchQuery(form, result.value.nextCursor) : null,
		firstQuery: searchQuery(form),
		hasCursor: cursor !== null,
		filtered: isFiltered(form)
	};
};
