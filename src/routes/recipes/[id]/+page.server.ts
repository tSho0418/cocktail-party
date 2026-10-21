import { error, fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { getRecipeDetail } from '#lib/server/services/recipes/index.js';
import { submitReport } from '#lib/server/services/reports/index.js';
import { photoUrl } from '#lib/server/services/images/url.js';
import { adminErrorMessage, reportErrorMessage } from '#lib/report-messages.js';
import type { Actions, PageServerLoad } from './$types';

// FR-046/062/080: public and always server-rendered, so the body is in the HTML for crawlers
// (behind the Age Gate too) and the OGP tags are in the head.
export const load: PageServerLoad = async ({ params, locals }) => {
	const recipe = await getRecipeDetail(db, params.id);
	if (!recipe) error(404, 'レシピが見つかりません');
	return {
		recipe,
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
		if (!result.ok) return fail(400, { reportError: reportErrorMessage(result.error) });
		return { reported: true };
	}
};
