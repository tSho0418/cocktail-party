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
	REPORT_STATUSES,
	listReports,
	type ReportStatus,
	listSuspendedMembers,
	setMemberSuspension,
	setReportStatus
} from '#lib/server/services/reports/index.js';
import { adminErrorMessage } from '#lib/report-messages.js';
import { requireAdmin } from './require-admin';
import type { Actions, PageServerLoad } from './$types';

// Reports shown at once. The page says so when the list was cut.
const REPORT_LIMIT = 200;

// Default: unhandled Reports only, so old open ones never fall off a list full of handled ones.
export const load: PageServerLoad = async ({ locals, url }) => {
	const actor = requireAdmin(locals);
	const param = url.searchParams.get('status');
	const status: ReportStatus | 'all' =
		param === 'all' ? 'all' : (REPORT_STATUSES.find((s) => s === param) ?? 'open');
	const [reports, suspended, ingredients] = await Promise.all([
		listReports(db, actor, {
			status: status === 'all' ? undefined : status,
			limit: REPORT_LIMIT + 1
		}),
		listSuspendedMembers(db, actor),
		listIngredientsWithAbv(db)
	]);
	return {
		status,
		reports: reports.ok ? reports.value.slice(0, REPORT_LIMIT) : [],
		reportsCut: reports.ok && reports.value.length > REPORT_LIMIT,
		reportLimit: REPORT_LIMIT,
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
		const actor = requireAdmin(locals);
		const data = await request.formData();
		const r = await setReportStatus(db, actor, text(data, 'id'), text(data, 'status'));
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	// FR-074: the author is not notified; the Report stays as a record.
	deleteRecipe: async ({ locals, request }) => {
		const actor = requireAdmin(locals);
		const data = await request.formData();
		const r = await deleteRecipe(db, actor, text(data, 'recipeId'));
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
		await deleteUnreferencedPhotos(defaultStore, r.value.photoKeys);
	},
	// FR-075
	suspend: async ({ locals, request }) => {
		const actor = requireAdmin(locals);
		const username = text(await request.formData(), 'username').trim();
		const r = await setMemberSuspension(db, actor, username, true);
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	unsuspend: async ({ locals, request }) => {
		const actor = requireAdmin(locals);
		const username = text(await request.formData(), 'username').trim();
		const r = await setMemberSuspension(db, actor, username, false);
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	// FR-013/076
	createIngredient: async ({ locals, request }) => {
		const actor = requireAdmin(locals);
		const data = await request.formData();
		const r = await createAlcoholicIngredient(actor, {
			name: text(data, 'name'),
			abvPercent: abvOf(text(data, 'abvPercent')),
			isBaseSpirit: data.get('isBaseSpirit') === 'on'
		});
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	},
	// FR-015/076
	updateAbv: async ({ locals, request }) => {
		const actor = requireAdmin(locals);
		const data = await request.formData();
		const r = await updateIngredientAbv(actor, text(data, 'id'), abvOf(text(data, 'abvPercent')));
		if (!r.ok) return fail(400, { error: adminErrorMessage(r.error) });
	}
};
