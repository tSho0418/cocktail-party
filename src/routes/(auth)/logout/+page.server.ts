import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/server/auth/index.js';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		await auth().api.signOut({ headers: request.headers });
		redirect(303, '/');
	}
};
