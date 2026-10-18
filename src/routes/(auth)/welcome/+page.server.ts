import { fail, redirect } from '@sveltejs/kit';
import { setUsername } from '#lib/server/services/members/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.member) redirect(303, '/login');
	if (locals.member.username) redirect(303, '/');
};

const MESSAGES = {
	invalid: 'Username は半角英数字とアンダースコア(_)で、3〜20文字にしてください。',
	taken: 'この Username は使われています。大文字と小文字は区別しません。'
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.member) redirect(303, '/login');
		const username = String((await request.formData()).get('username') ?? '').trim();
		const result = await setUsername(locals.member.id, username);
		if (!result.ok) return fail(400, { username, error: MESSAGES[result.error] });
		redirect(303, '/');
	}
};
