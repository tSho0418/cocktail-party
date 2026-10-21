import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// FR-077: only an Administrator. Signed out goes to log in; anyone else gets 403.
export const load: LayoutServerLoad = ({ locals }) => {
	const m = locals.member;
	if (!m) redirect(303, '/login');
	if (!m.username || !m.isAdministrator) error(403, 'この画面は管理者だけが使えます');
	return {};
};
