import { fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import { defaultStore } from '#lib/server/api/photos.js';
import { deleteUnreferencedPhotos } from '#lib/server/services/images/cleanup.js';
import {
	createAlcoholicIngredient,
	updateIngredientAbv
} from '#lib/server/services/ingredients/index.js';
import { listIngredientsWithAbv } from '#lib/server/services/ingredients/list.js';
import { deleteRecipe } from '#lib/server/services/recipes/index.js';
import {
	listReports,
	listSuspendedMembers,
	setMemberSuspension,
	setReportStatus
} from '#lib/server/services/reports/index.js';
import { adminErrorMessage } from '#lib/report-messages.js';
import type { Actions, PageServerLoad } from './$types';

// The layout load has already refused anyone but an Administrator; the services check again.
const actorOf = (locals: App.Locals) => ({
	memberId: locals.member!.id,
	isAdministrator: locals.member!.isAdministrator
});

export const load: PageServerLoad = async ({ locals }) => {
	const actor = actorOf(locals);
	const [reports, suspended, ingredients] = await Promise.all([
		listReports(db, actor),
		listSuspendedMembers(db, actor),
		listIngredientsWithAbv(db)
	]);
	return {
		reports: reports.ok ? reports.value : [],
		suspended: suspended.ok ? suspended.value : [],
		ingredients
	};
};

const text = (data: FormData, key: string) => String(data.get(key) ?? '');
// Number('') is 0, which is a valid-looking ABV: blank must stay NaN so the service rejects it.
const abvOf = (s: string) => (s.trim() === '' ? NaN : Number(s));

export const actions: Actions = {
	// FR-072
	setStatus: async ({ locals, request }) => {
		const data = await request.formData();
		const r = await setReportStatus(db, actorOf(locals), text(data, 'id'), text(data, 'status'));
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	// FR-074: the author is not notified; the Report stays as a record.
	deleteRecipe: async ({ locals, request }) => {
		const data = await request.formData();
		const r = await deleteRecipe(db, actorOf(locals), text(data, 'recipeId'));
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
		await deleteUnreferencedPhotos(defaultStore, r.value.photoKeys);
	},
	// FR-075
	suspend: async ({ locals, request }) => {
		const username = text(await request.formData(), 'username').trim();
		const r = await setMemberSuspension(db, actorOf(locals), username, true);
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	unsuspend: async ({ locals, request }) => {
		const username = text(await request.formData(), 'username').trim();
		const r = await setMemberSuspension(db, actorOf(locals), username, false);
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	// FR-013/076
	createIngredient: async ({ locals, request }) => {
		const data = await request.formData();
		const r = await createAlcoholicIngredient(actorOf(locals), {
			name: text(data, 'name'),
			abvPercent: abvOf(text(data, 'abvPercent')),
			isBaseSpirit: data.get('isBaseSpirit') === 'on'
		});
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	// FR-015/076
	updateAbv: async ({ locals, request }) => {
		const data = await request.formData();
		const r = await updateIngredientAbv(
			actorOf(locals),
			text(data, 'id'),
			abvOf(text(data, 'abvPercent'))
		);
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	}
};
