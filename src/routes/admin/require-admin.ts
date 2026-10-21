import { error, redirect } from '@sveltejs/kit';

/**
 * FR-077: the signed-in Administrator. SvelteKit runs a form action without running the layout
 * load, so the load and every action call this themselves. Signed out goes to log in; anyone
 * else is 403.
 */
export function requireAdmin(locals: App.Locals) {
	const m = locals.member;
	if (!m) redirect(303, '/login');
	if (!m.username || !m.isAdministrator) error(403, 'この画面は管理者だけが使えます');
	return { memberId: m.id, isAdministrator: true };
}
