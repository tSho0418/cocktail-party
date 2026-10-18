import { redirect } from '@sveltejs/kit';
import { defaultStore } from '#lib/server/api/photos.js';
import { auth } from '#lib/server/auth/index.js';
import { deleteUnreferencedPhotos } from '#lib/server/services/images/cleanup.js';
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
		// Before the delete: the session row is gone afterwards, and signOut also clears the cookie.
		await auth().api.signOut({ headers: request.headers });
		const keys = await withdrawMember({ id: locals.member.id });
		await deleteUnreferencedPhotos(defaultStore, keys);
		redirect(303, '/');
	}
};
