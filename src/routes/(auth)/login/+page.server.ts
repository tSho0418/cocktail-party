import { redirect } from '@sveltejs/kit';
import { auth, type Provider } from '#lib/server/auth/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.member) redirect(303, '/');
};

const signIn =
	(provider: Provider): Actions[string] =>
	async ({ request }) => {
		const { url } = await auth().api.signInSocial({
			body: {
				provider,
				callbackURL: '/',
				newUserCallbackURL: '/welcome',
				errorCallbackURL: '/login'
			},
			headers: request.headers
		});
		if (!url) throw new Error(`no authorization URL for ${provider}`);
		redirect(303, url);
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
