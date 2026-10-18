import { error, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { defaultStore } from '#lib/server/api/photos.js';
import { getRecipeDetail } from '#lib/server/services/recipes/index.js';
import type { PageServerLoad } from './$types';

/** Preview URL of a stored photo; null when no public base URL is configured (R2_PUBLIC_BASE_URL unset). */
function previewUrl(key: string) {
	try {
		return defaultStore().publicUrl(key);
	} catch {
		return null;
	}
}

// FR-008: only the owner edits. Signed out goes to log in; someone else's Recipe is 403.
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.member) redirect(303, '/login');
	const recipe = await getRecipeDetail(db, params.id);
	if (!recipe) error(404, 'レシピが見つかりません');
	if (recipe.owner.id !== locals.member.id) error(403, 'このレシピは編集できません');

	return {
		recipeId: recipe.id,
		initial: {
			title: recipe.title,
			description: recipe.description,
			mainPhoto: { key: recipe.mainPhotoKey, url: previewUrl(recipe.mainPhotoKey) },
			extraPhotos: recipe.extraPhotoKeys.map((key) => ({ key, url: previewUrl(key) })),
			ingredients: recipe.ingredients.map((i, n) => ({
				rowId: n + 1,
				ingredient: {
					id: i.id,
					name: i.name,
					abvPercent: i.abvPercent,
					isBaseSpirit: i.isBaseSpirit
				},
				mixRatio: String(i.mixRatio)
			})),
			steps: recipe.steps,
			// FR-021/023: an override stays an override until the Member recomputes.
			abvOverride: recipe.abvOverride === null ? '' : String(recipe.abvOverride)
		}
	};
};
