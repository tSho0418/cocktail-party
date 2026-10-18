import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { getRecipeDetail } from '#lib/server/services/recipes/index.js';
import { photoUrl } from '#lib/server/services/images/url.js';
import type { PageServerLoad } from './$types';

// FR-046/062/080: public and always server-rendered, so the body is in the HTML for crawlers
// (behind the Age Gate too) and the OGP tags are in the head.
export const load: PageServerLoad = async ({ params }) => {
	const recipe = await getRecipeDetail(db, params.id);
	if (!recipe) error(404, 'レシピが見つかりません');
	return {
		recipe,
		mainPhotoUrl: photoUrl(recipe.mainPhotoKey, 'detail'),
		extraPhotoUrls: recipe.extraPhotoKeys.map((k) => photoUrl(k, 'detail'))
	};
};
