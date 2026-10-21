import { redirect } from '@sveltejs/kit';
import { defaultStore } from '#lib/server/api/photos.js';
import { auth } from '#lib/server/auth/index.js';
import { deleteObjects } from '#lib/server/services/images/delete-objects.js';
import { withdrawMember } from '#lib/server/services/members/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.member) redirect(303, '/login');
	return { username: locals.member.username };
};

export const actions: Actions = {
	// FR-058: no grace period; the confirmation page is the only safeguard.
	default: async ({ locals, request }) => {
		if (!locals.member) redirect(303, '/login');
		// The delete comes first: if it fails the Member stays signed in and can try again.
		const keys = await withdrawMember({ id: locals.member.id });
		// Committed from here on, so neither step may fail the request.
		await deleteObjects(defaultStore, keys);
		try {
			// The session row went with the Member; this clears the cookie.
			await auth().api.signOut({ headers: request.headers });
		} catch (e) {
			console.error('sign-out after withdrawal failed', e);
		}
		redirect(303, '/');
	}
};
