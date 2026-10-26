import { redirect } from '@sveltejs/kit';
import { defaultStore } from '#lib/server/api/photos.js';
import { auth } from '#lib/server/auth/index.js';
import { providerTokenOf } from '#lib/server/auth/provider-access-token.js';
import { unlinkProvider } from '#lib/server/auth/unlink-provider.js';
import { deleteObjects } from '#lib/server/services/images/delete-objects.js';
import { withdrawMember } from '#lib/server/services/members/index.js';
import type { Actions, PageServerLoad } from './$types';

// adapter-vercel route config (ServerlessConfig.maxDuration, seconds). The provider calls are
// bounded by PROVIDER_CALL_TIMEOUT_MS each (two of them, before and after the delete).
export const config = { maxDuration: 30 };

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.member) redirect(303, '/login');
	return { username: locals.member.username };
};

export const actions: Actions = {
	// FR-058: no grace period; the confirmation page is the only safeguard.
	default: async ({ locals, request }) => {
		if (!locals.member) redirect(303, '/login');
		// The account row, and the provider's token with it, goes with the Member: read it first.
		const token = await providerTokenOf(locals.member.id);
		// The delete comes next: if it fails the Member stays signed in and can try again.
		const keys = await withdrawMember({ id: locals.member.id });
		// Committed from here on, so no step may fail the request. The provider call is outside the
		// transaction (no lock held while talking to LINE or Google).
		await Promise.all([unlinkProvider(token), deleteObjects(defaultStore, keys)]);
		try {
			// The session row went with the Member; this clears the cookie.
			await auth().api.signOut({ headers: request.headers });
		} catch (e) {
			console.error('sign-out after withdrawal failed', e);
		}
		redirect(303, '/');
	}
};
