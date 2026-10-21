import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { defaultStore } from '#lib/server/api/photos.js';
import { deleteObjects } from '#lib/server/services/images/delete-objects.js';
import { deleteRecipe, getRecipeDetail } from '#lib/server/services/recipes/index.js';
import { getReactions } from '#lib/server/services/social/index.js';
import { submitReport } from '#lib/server/services/reports/index.js';
import { photoUrl } from '#lib/server/services/images/url.js';
import { adminErrorMessage } from '#lib/report-messages.js';
import type { Actions, PageServerLoad } from './$types';

// FR-046/062/080: public and always server-rendered, so the body is in the HTML for crawlers
// (behind the Age Gate too) and the OGP tags are in the head.
export const load: PageServerLoad = async ({ params, locals }) => {
	const recipe = await getRecipeDetail(db, params.id);
	if (!recipe) error(404, 'レシピが見つかりません');
	const m = locals.member;
	const isOwner = !!m && recipe.owner.id === m.id;
	// Initial Like/Save state comes from here so the buttons do not flicker after hydration.
	// getReactions is null only if the Recipe vanished (or its Member was suspended) in between.
	const reactions = (await getReactions(db, recipe.id, m?.username ? m.id : null)) ?? {
		likeCount: recipe.likeCount,
		liked: false,
		saved: false
	};
	return {
		recipe,
		reactions,
		// FR-055/056: a Member without a Username is treated as signed out here, like canReport.
		signedIn: !!m?.username,
		isOwner,
		// FR-008/074: the owner edits and deletes; an Administrator deletes only. The action re-checks.
		canEdit: isOwner,
		canDelete: isOwner || !!m?.isAdministrator,
		mainPhotoUrl: photoUrl(recipe.mainPhotoKey, 'detail'),
		extraPhotoUrls: recipe.extraPhotoKeys.map((k) => photoUrl(k, 'detail')),
		// Only a Member with a Username may report (FR-070); the form is hidden otherwise.
		canReport: !!locals.member?.username
	};
};

export const actions: Actions = {
	// FR-070/071
	report: async ({ params, locals, request }) => {
		const m = locals.member;
		if (!m?.username) return fail(401, { reportError: adminErrorMessage('unauthorized') });
		const data = await request.formData();
		const result = await submitReport(
			db,
			{ memberId: m.id, isAdministrator: m.isAdministrator },
			params.id,
			{ reason: String(data.get('reason') ?? ''), detail: String(data.get('detail') ?? '') }
		);
		if (!result.ok) return fail(400, { reportError: adminErrorMessage(result.error) });
		return { reported: true };
	},
	// FR-008/074: owner or Administrator (deleteRecipe enforces it); no notice goes to the author.
	delete: async ({ params, locals }) => {
		const m = locals.member;
		if (!m?.username) return fail(401, { deleteError: adminErrorMessage('unauthorized') });
		const result = await deleteRecipe(
			db,
			{ memberId: m.id, isAdministrator: m.isAdministrator },
			params.id
		);
		if (!result.ok) {
			const status = result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : 400;
			return fail(status, { deleteError: adminErrorMessage(result.error) });
		}
		await deleteObjects(defaultStore, result.value.photoKeys);
		redirect(303, '/');
	}
};
