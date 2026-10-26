import { redirect } from '@sveltejs/kit';
import { defaultStore } from '#lib/server/api/photos.js';
import { auth } from '#lib/server/auth/index.js';
import { lineAccessTokenOf } from '#lib/server/auth/line-access-token.js';
import { deauthorizeLine, LineDeauthorizeError } from '#lib/server/auth/line-deauthorize.js';
import { deleteObjects } from '#lib/server/services/images/delete-objects.js';
import { withdrawMember } from '#lib/server/services/members/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.member) redirect(303, '/login');
	return { username: locals.member.username };
};

/** Best effort: the withdrawal is committed. Logs the status or the error's name, never the token. */
async function deauthorize(lineToken: string | null) {
	if (!lineToken) return;
	try {
		await deauthorizeLine(lineToken);
	} catch (e) {
		console.error(
			'LINE deauthorization failed',
			e instanceof LineDeauthorizeError ? e.message : e instanceof Error ? e.name : typeof e
		);
	}
}

export const actions: Actions = {
	// FR-058: no grace period; the confirmation page is the only safeguard.
	default: async ({ locals, request }) => {
		if (!locals.member) redirect(303, '/login');
		// The account row, and the LINE token with it, goes with the Member: read it first.
		const lineToken = await lineAccessTokenOf(locals.member.id);
		// The delete comes next: if it fails the Member stays signed in and can try again.
		const keys = await withdrawMember({ id: locals.member.id });
		// Committed from here on, so no step may fail the request. LINE's guidelines require removing
		// the app link on withdrawal; the call is outside the transaction (no lock held on LINE).
		await Promise.all([deauthorize(lineToken), deleteObjects(defaultStore, keys)]);
		try {
			// The session row went with the Member; this clears the cookie.
			await auth().api.signOut({ headers: request.headers });
		} catch (e) {
			console.error('sign-out after withdrawal failed', e);
		}
		redirect(303, '/');
	}
};
