import { redirect } from '@sveltejs/kit';
import { auth, type Provider } from '#lib/server/auth/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.member) redirect(303, '/');
};

// SvelteKit 3 refuses a redirect to another origin unless it is allowed; only the providers'
// own authorization hosts are (the URL comes from Better Auth, never from the request).
const PROVIDER_ORIGINS = ['https://accounts.google.com', 'https://access.line.me'];

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
		redirect(303, url, { external: PROVIDER_ORIGINS });
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
